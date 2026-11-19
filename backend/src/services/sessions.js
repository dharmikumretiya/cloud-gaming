import os from 'node:os';

export const LIVE = ['STARTING', 'READY', 'ACTIVE'];
export class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}

export class SessionManager {
  constructor({ db, launcher, config, stream = null, runtimes = null }) {
    Object.assign(this, { db, config });
    this.runtimes = runtimes || [{ slot: 0, launcher, stream }];
    this.pending = Promise.resolve();
    this.system = { name: os.hostname(), platform: 'Linux', architecture: os.arch(), cpuModel: os.cpus()[0]?.model || 'Unknown', logicalCores: os.cpus().length, memoryBytes: os.totalmem() };
  }
  serialize(action) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  runtimeFor(session) { return this.runtimes.find(runtime => runtime.slot === session?.slot); }
  async recover() {
    await this.db.session.updateMany({ where: { status: { in: LIVE } }, data: { status: 'FAILED', endedAt: new Date() } });
  }
  async current(ownerId, userId) {
    const owner = { ...(ownerId === undefined ? {} : { ownerId }), ...(userId === undefined ? {} : { userId }) };
    const live = await this.db.session.findFirst({ where: { ...owner, status: { in: LIVE } }, include: { game: true } });
    return live || this.db.session.findFirst({ where: owner, orderBy: { id: 'desc' }, include: { game: true } });
  }
  present(session) {
    if (!session) return null;
    const { ownerId, userId, ...safe } = session;
    return { ...safe, hostAddress: this.config.hostAddress, streamingStatus: 'UNVERIFIED', browserPlayerUrl: this.runtimeFor(session)?.stream?.viewer(session) || null };
  }
  async hostStatus(ownerId) {
    const [games, sessions, streams] = await Promise.all([
      this.db.game.findMany({ where: { enabled: true } }),
      this.db.session.findMany({ where: { status: { in: LIVE } }, include: { game: { select: { title: true } } } }),
      Promise.all(this.runtimes.map(async runtime => ({ slot: runtime.slot, ...(await runtime.stream?.status() || { ready: false, reason: 'Streaming service is not configured.' }) }))),
    ]);
    const free = streams.filter(stream => stream.ready && !sessions.some(session => session.slot === stream.slot));
    const readiness = await this.runtimes[0].launcher.readinessMany(games.map(game => game.launchId));
    const launchers = games.map((game, index) => {
      if (sessions.some(session => session.gameId === game.id)) return { gameId: game.id, ready: false, reason: 'This game is already being played. Choose another title.' };
      return { gameId: game.id, ...readiness[index] };
    });
    const own = sessions.find(session => session.ownerId === ownerId);
    const selected = streams.find(stream => stream.slot === own?.slot) || free[0] || streams.find(stream => stream.ready) || streams[0];
    return {
      reserved: sessions.length >= this.runtimes.length, playerReserved: Boolean(own), launchers,
      activeSessions: sessions.length, maxSessions: this.runtimes.length, availableSessions: free.length,
      available: free.length > 0 && launchers.some(launcher => launcher.ready),
      streaming: { engine: 'Selkies', ready: Boolean(selected?.ready), transport: 'websockets',
        connections: streams.reduce((total, stream) => total + (stream.connections || 0), 0), reason: selected?.reason || null },
      system: this.system,
      slots: streams.map(stream => {
        const session = sessions.find(row => row.slot === stream.slot);
        return { slot: stream.slot, state: session ? 'occupied' : stream.ready ? 'available' : 'offline',
          streamReady: Boolean(stream.ready), connections: stream.connections || 0,
          gameTitle: session?.game?.title || null, sessionStatus: session?.status || null,
          startedAt: session?.startedAt || null, isCurrentDevice: Boolean(session && session.ownerId === ownerId),
          reason: stream.reason || null };
      }),
      hostAddress: this.config.hostAddress, streamingStatus: 'UNVERIFIED',
    };
  }
  start(gameId, ownerId = 'internal-device', userId = null, authorize = null) { return this.serialize(async () => {
    await authorize?.();
    const game = await this.db.game.findUnique({ where: { id: gameId } });
    if (!game) throw new ApiError(404, 'GAME_NOT_FOUND', 'Game not found.');
    if (!game.enabled) throw new ApiError(409, 'GAME_DISABLED', 'This game is disabled.');
    const sessions = await this.db.session.findMany({ where: { status: { in: LIVE } } });
    if (sessions.some(session => session.ownerId === ownerId)) throw new ApiError(409, 'DEVICE_BUSY', 'This browser already has a game. Return to your session or end it first.');
    if (sessions.some(session => session.gameId === gameId)) throw new ApiError(409, 'GAME_BUSY', 'This game is already being played. Choose another title.');
    const free = this.runtimes.filter(runtime => !sessions.some(session => session.slot === runtime.slot));
    if (!free.length) throw new ApiError(409, 'HOST_BUSY', 'All gaming slots are occupied. Try again when a player finishes.');
    let runtime;
    for (const candidate of free) {
      if ((await candidate.stream?.status())?.ready) { runtime = candidate; break; }
    }
    if (!runtime) {
      // Preserve the concrete stream's diagnostic, including for controlled test fixtures.
      await free[0].stream?.assertReady();
      throw new ApiError(503, 'STREAM_UNAVAILABLE', 'No free streaming display is ready. Check the backend logs.');
    }
    const readiness = await runtime.launcher.readiness(game.launchId);
    if (!readiness.ready) throw new ApiError(503, 'LAUNCHER_UNAVAILABLE', readiness.reason);
    await runtime.stream.assertReady();
    let session;
    try {
      session = await this.db.$transaction(async tx => {
        const active = await tx.session.findMany({ where: { status: { in: LIVE } } });
        if (active.some(row => row.ownerId === ownerId || row.gameId === gameId || row.slot === runtime.slot)) throw new ApiError(409, 'HOST_BUSY', 'The requested game or slot was just reserved. Please retry.');
        return tx.session.create({ data: { gameId, ownerId, userId, slot: runtime.slot, status: 'STARTING' } });
      });
    } catch (error) {
      if (error.code === 'P2002' || error.code === 'P2034') throw new ApiError(409, 'HOST_BUSY', 'The game or slot was just reserved. Please retry.');
      throw error;
    }
    try {
      await runtime.prepare?.(ownerId);
      await runtime.launcher.launch(game.launchId, code => {
        this.serialize(async () => {
          const row = await this.db.session.findUnique({ where: { id: session.id } });
          if (row && LIVE.includes(row.status)) {
            await runtime.stream.closeSession(row.id);
            await runtime.launcher.stop();
            await this.finish(row, code === 0 ? 'ENDED' : 'FAILED');
          }
        }).catch(error => console.error('Exit cleanup failed; slot stays reserved:', error.message));
      }, runtime.gameEnvironment?.() || runtime.stream.gameEnvironment());
      return await this.db.session.update({ where: { id: session.id }, data: { status: 'READY' }, include: { game: true } });
    } catch (error) {
      try { await runtime.launcher.stop(); }
      catch { throw new ApiError(503, 'CLEANUP_FAILED', 'Launch failed and cleanup could not be confirmed. Your slot remains reserved; retry End Session.'); }
      await this.db.session.update({ where: { id: session.id }, data: { status: 'FAILED', endedAt: new Date() } });
      console.error('Game launch failed:', error.message);
      throw new ApiError(503, 'LAUNCH_FAILED', 'The game could not start. Check the backend logs and retry.');
    }
  }); }
  finish(session, status) {
    const endedAt = new Date();
    const durationSeconds = status === 'ENDED' ? Math.max(0, Math.floor((endedAt - session.startedAt) / 1000)) : 0;
    return this.db.session.update({ where: { id: session.id }, data: { status, endedAt, durationSeconds }, include: { game: true } });
  }
  async stopSession(session) {
    const runtime = this.runtimeFor(session);
    if (!runtime) throw new ApiError(503, 'CLEANUP_FAILED', 'The owned gaming slot is unavailable. Restart the backend for recovery.');
    try { await runtime.stream?.closeSession(session.id); await runtime.launcher.stop(); }
    catch { throw new ApiError(503, 'CLEANUP_FAILED', 'Game termination could not be confirmed. Your slot remains reserved; retry End Session.'); }
    return this.finish(session, 'ENDED');
  }
  end(ownerId, userId) { return this.serialize(async () => {
    const session = await this.db.session.findFirst({ where: { ...(ownerId === undefined ? {} : { ownerId }), ...(userId === undefined ? {} : { userId }), status: { in: LIVE } } });
    return session ? this.stopSession(session) : this.current(ownerId, userId);
  }); }
  reconnect(ownerId, userId) { return this.serialize(async () => {
    const session = await this.current(ownerId, userId);
    if (!session || !['READY', 'ACTIVE'].includes(session.status)) throw new ApiError(409, 'NO_SESSION', 'No prepared session to reconnect.');
    await this.runtimeFor(session).stream.closeSession(session.id);
  }); }
  endAll() { return this.serialize(async () => {
    const sessions = await this.db.session.findMany({ where: { status: { in: LIVE } } });
    const results = await Promise.allSettled(sessions.map(session => this.stopSession(session)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }); }
}
