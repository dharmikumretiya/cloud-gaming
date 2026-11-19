import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Clock3, Gamepad2, History as HistoryIcon, LoaderCircle, RotateCcw } from 'lucide-react';
import { useGaming } from '../App';
import { request } from '../services/api';
import GameArtwork from '../components/GameArtwork';

export function playtime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
const statusLabels = { STARTING: 'Starting', READY: 'In session', ACTIVE: 'In session', ENDED: 'Completed', FAILED: 'Interrupted' };
export default function History() {
  const { user } = useGaming();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get('page') || '1', 10) || 1));
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false;
    setData(null); setError('');
    if (user) request(`/history?page=${page}`).then(result => { if (!stopped) setData(result); }).catch(error => { if (!stopped) setError(error.message); });
    return () => { stopped = true; };
  }, [user?.id, page, revision]);
  if (!user) return <div className="content-wrap history-page"><div className="empty-state panel"><HistoryIcon size={32}/><h1>Your story starts here.</h1><p>Sign in to see your play history across devices. Guest games stay separate.</p><Link className="button" to="/account">Sign in or create account</Link></div></div>;
  return <div className="content-wrap history-page">
    <div className="dashboard-heading"><div><p className="eyebrow">YOUR PLAYER SPACE</p><h1>Play history</h1><p className="subheading">Every session, all in one place.</p></div><button className="button secondary" onClick={() => setRevision(value => value + 1)}><RotateCcw size={16}/>Refresh history</button></div>
    {error ? <div className="form-error" role="alert">{error}</div> : !data ? <div className="empty-state" role="status"><LoaderCircle className="spin"/><p>Loading your sessions…</p></div> : <>
      <div className="overview-grid history-overview"><article className="summary-card"><div>Sessions<HistoryIcon size={19}/></div><strong>{data.summary.sessions}</strong><p>All your recorded sessions</p></article><article className="summary-card"><div>Games played<Gamepad2 size={19}/></div><strong>{data.summary.games}</strong><p>Different titles explored</p></article><article className="summary-card green"><div>Session time<Clock3 size={19}/></div><strong>{playtime(data.summary.durationSeconds)}</strong><p>Time in completed sessions</p></article></div>
      {data.sessions.length ? <section aria-label="Your gaming sessions" className="history-list">{data.sessions.map(session => <article className="history-row" key={session.id}>
        <Link to={`/games/${session.game.id}`} className="history-art"><GameArtwork game={session.game} loading="lazy"/></Link><div className="history-game"><Link to={`/games/${session.game.id}`}><h2>{session.game.title}</h2></Link><p>{new Date(session.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div>
        <span className={`history-status ${session.status.toLowerCase()}`}>{statusLabels[session.status] || session.status}</span><div className="history-time"><Clock3 size={15}/>{session.endedAt ? session.status === 'FAILED' ? 'Not counted' : playtime(session.durationSeconds) : 'In progress'}</div>
        <Link className="history-action" to={session.isCurrentDevice ? '/session' : `/games/${session.game.id}`}>{session.isCurrentDevice ? 'Return to game' : 'View game'}<ArrowRight size={16}/></Link>
      </article>)}</section> : <div className="empty-state panel"><Gamepad2 size={30}/><h2>{page > 1 ? 'No sessions on this page.' : 'Your first game is waiting.'}</h2><p>{page > 1 ? 'Go back to an earlier page to see your history.' : 'Play a game while signed in and it will appear here.'}</p><Link className="button" to="/">Browse games</Link></div>}
      {(page > 1 || data.total > data.pageSize) && <div className="history-pagination"><button className="button secondary" disabled={page === 1} onClick={() => setParams({ page: String(page - 1) })}><ArrowLeft size={16}/>Previous</button><span>Page {page} of {Math.max(page, Math.ceil(data.total / data.pageSize))}</span><button className="button secondary" disabled={page * data.pageSize >= data.total} onClick={() => setParams({ page: String(page + 1) })}>Next<ArrowRight size={16}/></button></div>}
      <p className="history-footnote">Session time measures how long the game was running, including menus. Interrupted sessions aren’t included in total time. Older guest sessions stay on their original device.</p>
    </>}
  </div>;
}
