import { Link } from 'react-router-dom';
import { Gamepad2, LoaderCircle, Monitor, Square } from 'lucide-react';
import { HostNotice, isLive, useGaming } from '../App';
import BrowserPlayer from '../components/BrowserPlayer';
import { gameArt } from '../components/GameArtwork';
export default function Session() {
  const { session, host, user, busy, end, fresh } = useGaming();
  if (!session) return <div className="content-wrap session-page"><HostNotice/><div className="empty-state panel"><div className="empty-icon"><Gamepad2 size={30}/></div><p className="eyebrow">READY WHEN YOU ARE</p><h1>No session yet</h1><p>Choose a game from your library to start playing in your browser.</p><Link className="button" to="/">Browse library</Link></div></div>;
  const live = isLive(session);
  const statusLabels = { READY: 'Game prepared', STARTING: 'Preparing game', ACTIVE: 'Game running', ENDED: 'Session ended', FAILED: 'Session failed' };
  return <div className="content-wrap session-page">
    <div className="page-heading"><div><p className="eyebrow">YOUR GAMING SPACE</p><h1>{live ? session.game.title : 'Back for another round?'}</h1><p className="subheading">{live ? 'Your own game, display, and audio. Other players can use a different slot.' : 'Your last session is shown below. Start a new one from the library.'}</p></div>
      {live && <button className="button danger" disabled={busy || !fresh} onClick={end}>{busy ? <LoaderCircle size={16} className="spin"/> : <Square size={16}/>} {busy ? 'Ending session…' : 'End session'}</button>}
    </div>
    {(!fresh || live && !host?.streaming?.ready) && <HostNotice/>}
    {session.game.launchId === 'flare' && <div className="notice"><Gamepad2 size={18}/><p>Character saves belong to {user?.displayName || 'your account'}. Use the game’s Save & Exit option before ending your session. Sign in on another device and launch Flare to load the same character.</p></div>}
    {live && <BrowserPlayer key={session.id} session={session}/>}
    <section className="panel session-summary"><div className="session-game"><img src={gameArt(session.game)} alt={`${session.game.title} artwork`}/><div><p className="eyebrow">YOUR SESSION #{session.id.toString().padStart(3, '0')} · SLOT {(session.slot ?? 0) + 1}</p><h2>{session.game.title}</h2><span className={`status-badge ${live ? 'live' : ''}`}>{statusLabels[session.status] || session.status}</span></div></div><div className="summary-details"><p><Monitor size={15}/>{session.hostAddress}</p><p>Started {new Date(session.startedAt).toLocaleString()}</p>{session.endedAt && <p>Ended {new Date(session.endedAt).toLocaleString()}</p>}<p>Game readiness is tracked by the backend; stream status comes from the player in this browser.</p></div>
      {!live && <div className="session-result">{session.status === 'FAILED' && <p>The game failed or the backend restarted. Check the host desktop and logs before retrying.</p>}<Link className="button" to="/">Back to library</Link></div>}
    </section>
  </div>;
}
