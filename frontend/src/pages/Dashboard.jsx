import { Link } from 'react-router-dom';
import { Activity, Check, CircleHelp, Database, Gamepad2, Monitor, Radio, RefreshCw, Server, Wifi } from 'lucide-react';
import { useGaming, isLive } from '../App';

export default function Dashboard() {
  const { host, games, session, user, fresh, refresh } = useGaming();
  if (!user?.isAdmin) return <div className="content-wrap host-dashboard"><div className="empty-state panel"><Server size={32}/><h1>Admin access required</h1><p>Only admins can view host details and gaming slots.</p><Link className="button" to={user ? '/' : '/account'}>{user ? 'Back to library' : 'Sign in as admin'}</Link></div></div>;
  const slots = host?.slots || [];
  const capacity = host?.maxSessions ?? 0;
  const active = host?.activeSessions ?? 0;
  const ready = Boolean(fresh && host?.streaming?.ready);
  const system = host?.system;
  return <div className="content-wrap host-dashboard">
    <div className="dashboard-heading"><div><p className="eyebrow">HOST OVERVIEW</p><h1>Dashboard</h1><p className="subheading">Host health, gaming capacity, and live slot status.</p></div><button className="button secondary" onClick={refresh}><RefreshCw size={17}/>Refresh status</button></div>
    {!fresh && <div className="notice" role="status"><CircleHelp size={19}/><p>Connection lost. These details may be out of date. Check the backend and refresh.</p></div>}
    <section className="overview-grid" aria-label="Host summary">
      <Summary icon={Server} title="Host" value={!fresh ? 'Unreachable' : ready ? 'Online' : 'Needs attention'} detail={host?.hostAddress || 'Not configured'} tone={ready ? 'green' : 'amber'}/>
      <Summary icon={Gamepad2} title="Gaming slots" value={fresh ? `${active} / ${capacity}` : '—'} detail="Slots in use"/>
      <Summary icon={Monitor} title="Available slots" value={fresh ? host?.availableSessions ?? 0 : '—'} detail="Ready for a new game"/>
      <Summary icon={Radio} title="Player connections" value={fresh ? host?.streaming?.connections ?? 0 : '—'} detail="Connected browser streams"/>
    </section>
    <section className="dashboard-section" aria-labelledby="slot-heading"><div className="section-heading"><div><h2 id="slot-heading">Gaming slots</h2><p className="dashboard-section-note">Each slot has its own game, screen, audio, and controls.</p></div><span className="refresh-note"><span/>Updates every 3 seconds</span></div>
      <div className="slot-grid">{slots.map(slot => {
        const state = !fresh ? 'Unknown' : slot.state === 'occupied' ? 'In use' : slot.state === 'available' ? 'Available' : 'Offline';
        const tone = !fresh || slot.state === 'offline' ? 'amber' : slot.state === 'occupied' ? 'blue' : 'green';
        return <article className={`slot-card ${tone}`} key={slot.slot}><div className="slot-top"><div className="slot-number"><Monitor size={20}/><h3>Slot {slot.slot + 1}</h3></div><span className={`dashboard-badge ${tone}`}><span/>{state}</span></div>
          <div className="slot-game"><p className="mini-label">{slot.gameTitle ? 'RUNNING GAME' : 'GAMING SLOT'}</p><h2>{slot.gameTitle || (slot.streamReady ? 'Choose a game' : 'Stream unavailable')}</h2>{slot.isCurrentDevice && <span className="your-slot">Your session</span>}</div>
          <dl className="slot-facts"><div><dt>Stream service</dt><dd>{!fresh ? 'Unknown' : slot.streamReady ? 'Ready' : 'Unavailable'}</dd></div><div><dt>Browser connections</dt><dd>{fresh ? slot.connections : '—'}</dd></div>{slot.startedAt && <div><dt>Started</dt><dd>{new Date(slot.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd></div>}</dl>
          {slot.reason && <p className="slot-warning"><CircleHelp size={15}/>{slot.reason}</p>}
          <div className="slot-action">{slot.isCurrentDevice && isLive(session) ? <Link to="/session">Return to your session</Link> : slot.state === 'available' && fresh ? <Link to="/">Browse games</Link> : <span>{slot.state === 'occupied' ? 'Managed by the player’s browser' : 'Check the host service'}</span>}</div>
        </article>;
      })}</div>
      {!slots.length && <div className="panel empty-state"><Monitor size={30}/><h3>Slot details unavailable</h3><p>Check that the backend is running and refresh the dashboard.</p></div>}
    </section>
    <div className="dashboard-detail-grid"><section className="dashboard-panel" aria-labelledby="host-heading"><div className="dashboard-panel-title"><Server size={21}/><h2 id="host-heading">Host details</h2></div><dl className="host-facts"><Fact label="Host name" value={system?.name}/><Fact label="LAN address" value={host?.hostAddress}/><Fact label="Operating system" value={system ? `${system.platform} · ${system.architecture}` : null}/><Fact label="Processor" value={system?.cpuModel}/><Fact label="Logical CPU cores" value={system?.logicalCores}/><Fact label="Installed memory" value={system ? `${(system.memoryBytes / 1024 ** 3).toFixed(1)} GB` : null}/><Fact label="Game library" value={`${games.length} installed titles`}/></dl></section>
    <section className="dashboard-panel" aria-labelledby="stream-heading"><div className="dashboard-panel-title"><Activity size={21}/><h2 id="stream-heading">Services</h2></div><div className="service-list"><Service icon={Server} title="Backend" description="Express application" ready={fresh}/><Service icon={Database} title="Database" description="SQLite game library and sessions" ready={fresh}/><Service icon={Radio} title="Streaming" description={`${host?.streaming?.engine || 'Selkies'} · ${host?.streaming?.transport || 'WebSockets'}`} ready={ready}/><Service icon={Wifi} title="Website connection" description={window.isSecureContext ? 'Secure browser context' : 'HTTPS required for remote play'} ready={window.isSecureContext}/></div><p className="dashboard-footnote">Service readiness does not confirm received video or audible playback. Check those in your gaming session.</p></section></div>
  </div>;
}
function Summary({ icon: Icon, title, value, detail, tone }) { return <article className={`summary-card ${tone || ''}`}><div><span>{title}</span><Icon size={20}/></div><strong>{value}</strong><p>{detail}</p></article>; }
function Fact({ label, value }) { return <div><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></div>; }
function Service({ icon: Icon, title, description, ready }) { return <div className="service-row"><div className="service-icon"><Icon size={19}/></div><div><h3>{title}</h3><p>{description}</p></div><span className={`service-state ${ready ? 'green' : 'amber'}`} aria-label={ready ? 'Available' : 'Needs attention'}>{ready ? <Check size={17}/> : <CircleHelp size={17}/>}</span></div>; }
