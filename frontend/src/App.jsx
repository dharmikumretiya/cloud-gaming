import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { CircleHelp, Gamepad2, LoaderCircle, Play, RotateCcw, X, Search, UserRound } from 'lucide-react';
import { request } from './services/api';
import Library from './pages/Library';
import Dashboard from './pages/Dashboard';
import GameDetails from './pages/GameDetails';
import Session from './pages/Session';
import Account from './pages/Account';
import History from './pages/History';

const GamingContext = createContext(null);
export const useGaming = () => useContext(GamingContext);
export const isLive = session => ['STARTING', 'READY', 'ACTIVE'].includes(session?.status);
export function PlayButton({ game, className = '' }) {
  const { host, session, busy, start, fresh } = useGaming();
  const navigate = useNavigate();
  if (isLive(session)) return <Link className={`button ${className}`} to="/session"><Gamepad2 size={17} />Return to session</Link>;
  const ready = game?.enabled && fresh && host?.available && host.launchers.some(x => x.gameId === game.id && x.ready);
  return <button className={`button ${className}`} disabled={!ready || busy} onClick={async () => { if (await start(game.id)) navigate('/session'); }}>
    {busy ? <LoaderCircle className="spin" size={17} /> : <Play size={17} fill="currentColor" />}{busy ? 'Preparing game…' : 'Play now'}
  </button>;
}
export function Availability() {
  const { host, session, fresh } = useGaming();
  const text = !fresh ? 'Host status unavailable' : host?.maxSessions ? `${host.activeSessions}/${host.maxSessions} slots in use` : 'Host needs attention';
  return <span className={`availability ${fresh && host?.available ? 'online' : ''}`}><span />{text}{isLive(session) && <span className="sr-only"> — your game has its own stream</span>}</span>;
}
export function HostNotice() {
  const { host, fresh, refresh } = useGaming();
  if (fresh && host?.available) return null;
  const message = !fresh ? 'Cannot reach the backend. Check that it is running, then retry.'
    : host?.reserved ? 'All gaming slots are in use. Your own session stays available from Session; new players can join when a slot opens.'
    : !host?.streaming?.ready ? host?.streaming?.reason || 'Selkies is not ready. Check the backend logs.'
    : host?.launchers.find(x => !x.ready)?.reason || 'No enabled game is ready to launch.';
  return <div className="notice"><CircleHelp size={18}/><p>{message}</p><button className="icon-button" onClick={refresh} aria-label="Refresh host status"><RotateCcw size={16}/></button></div>;
}
function Header() {
  const { session, user } = useGaming();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setSearchOpen(false); window.scrollTo(0, 0); }, [location.pathname]);
  return <header className="topbar">
    <nav aria-label="Main navigation"><NavLink to="/" end>Library</NavLink><NavLink to="/session">Session{isLive(session) && <span className="nav-indicator"/>}</NavLink><NavLink to="/history">History</NavLink>{user?.isAdmin && <NavLink to="/dashboard">Dashboard</NavLink>}</nav>
    <div className="header-right"><button className="icon-button" aria-label="Search games" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={24}/></button><NavLink to="/account" className="account-link" aria-label={user ? `Account: ${user.displayName}` : 'Sign in'}><UserRound size={20}/><span>{user ? user.displayName : 'Sign in'}</span></NavLink></div>
    {searchOpen && <form className="search-popover" role="search" onSubmit={event => { event.preventDefault(); navigate(`/?q=${encodeURIComponent(query)}`); setSearchOpen(false); }}><label htmlFor="game-search">Find your next game</label><div><Search size={20}/><input id="game-search" autoFocus placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setSearchOpen(false); }}/><button type="submit" className="button">Search</button></div></form>}
  </header>;
}
export default function App() {
  const [data, setData] = useState({ games: [], host: null, session: null, user: null });
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  async function refresh() {
    const seq = ++sequence.current;
    try {
      const [current, account] = await Promise.all([request('/session'), request('/auth/me')]);
      const [library, host] = await Promise.all([request('/games'), request(account.user?.isAdmin ? '/admin/host/status' : '/host/status')]);
      if (seq !== sequence.current) return;
      setData({ games: library.games, host, session: current.session, user: account.user });
      setFresh(true);
    } catch {
      if (seq === sequence.current) setFresh(false);
    } finally { if (seq === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    let stopped = false, timer;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 3000); };
    poll();
    return () => { stopped = true; clearTimeout(timer); sequence.current++; };
  }, []);
  async function action(path, body) {
    setBusy(true); setError('');
    try {
      const result = await request(path, body);
      setData(old => ({ ...old, session: result.session }));
      return true;
    } catch (error) { setError(error.message); return false; }
    finally { await refresh(); setBusy(false); }
  }
  async function authenticate(mode, credentials = {}) {
    setBusy(true); setError(''); sequence.current++;
    try {
      const result = await request(`/auth/${mode}`, credentials);
      sequence.current++;
      setData(old => ({ ...old, user: result.user, session: null }));
      return result.user;
    } finally { await refresh(); setBusy(false); }
  }
  const context = { ...data, loading, fresh, busy, error, refresh, authenticate, start: id => action('/session/start', { gameId: id }), end: () => action('/session/end', {}) };
  return <GamingContext.Provider value={context}>
    <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>
      <Header/>
      <main id="main-content">
        {error && <div className="notice error" role="alert"><CircleHelp size={18}/><p>{error}</p><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
        {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin"/><h1>Loading your library…</h1></div> : <Routes>
          <Route path="/" element={<Library/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/games/:id" element={<GameDetails/>}/><Route path="/session" element={<Session/>}/>
          <Route path="/account" element={<Account/>}/><Route path="/history" element={<History/>}/>
          <Route path="*" element={<div className="empty-state"><h1>Page not found</h1><Link className="button" to="/">Open library</Link></div>}/>
        </Routes>}
      </main>
    </div>
  </GamingContext.Provider>;
}
