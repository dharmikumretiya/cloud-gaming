import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { CircleHelp, Gamepad2, LoaderCircle, Orbit, Play, RotateCcw, X, Search, Cloud, Keyboard } from 'lucide-react';
import { request } from './services/api';
import Dashboard from './pages/Dashboard';
import GameDetails from './pages/GameDetails';
import Session from './pages/Session';

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
export function ConnectionSteps() {
  return <ol className="steps">
    <li><span>1</span><div><strong>Choose your game</strong><p>Browse games installed on your Linux host and click Play.</p></div></li>
    <li><span>2</span><div><strong>Connect automatically</strong><p>The host prepares your game and opens a browser stream through Selkies.</p></div></li>
    <li><span>3</span><div><strong>Play right here</strong><p>Click the player to enable controls and audio. No Moonlight installation is needed on your device.</p></div></li>
  </ol>;
}

function Header() {
  const { session, showGuide } = useGaming();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setSearchOpen(false); window.scrollTo(0, 0); }, [location.pathname]);
  return <header className="topbar">
    <Link to="/" className="brand" aria-label="Orbit home"><Orbit size={34}/><span>orbit<span className="brand-period">.</span></span></Link>
    <span className="brand-divider"/><Link className="product-name" to="/">CLOUD GAMING</Link>
    <nav aria-label="Main navigation"><NavLink to="/" end>Library</NavLink><NavLink to="/session">Session{isLive(session) && <span className="nav-indicator"/>}</NavLink></nav>
    <div className="header-right"><div className="header-availability"><Availability/></div><button className="icon-button" aria-label="Search games" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={24}/></button><button className="icon-button" onClick={showGuide} aria-label="How to play"><Gamepad2 size={25}/></button></div>
    {searchOpen && <form className="search-popover" role="search" onSubmit={event => { event.preventDefault(); navigate(`/?q=${encodeURIComponent(query)}`); setSearchOpen(false); }}><label htmlFor="game-search">Find your next game</label><div><Search size={20}/><input id="game-search" autoFocus placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setSearchOpen(false); }}/><button type="submit" className="button">Search</button></div></form>}
  </header>;
}
function PlayGuide({ open, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}><div className="guide-heading"><Cloud size={30}/><button className="icon-button" onClick={onClose} aria-label="Close how to play"><X/></button></div><p className="eyebrow">YOUR GAMES. ANY SCREEN.</p><h2 id="guide-title">From browse to play.</h2><ConnectionSteps/><div className="guide-note"><Keyboard size={22}/><p>Each browser gets its own session. Choose a different title from other players. Controller support depends on your browser and device. Keep your host running and connect to the same network.</p></div><button className="button" onClick={onClose}>Got it</button></dialog>;
}

export default function App() {
  const [data, setData] = useState({ games: [], host: null, session: null });
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const sequence = useRef(0);
  async function refresh() {
    const seq = ++sequence.current;
    try {
      const current = await request('/session');
      const [library, host] = await Promise.all([request('/games'), request('/host/status')]);
      if (seq !== sequence.current) return;
      setData({ games: library.games, host, session: current.session });
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
  const context = { showGuide: () => setGuideOpen(true), ...data, loading, fresh, busy, error, refresh, start: id => action('/session/start', { gameId: id }), end: () => action('/session/end', {}) };
  return <GamingContext.Provider value={context}>
    <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>
      <Header/>
      <main id="main-content">
        {error && <div className="notice error" role="alert"><CircleHelp size={18}/><p>{error}</p><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
        {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin"/><h1>Loading your library…</h1></div> : <Routes>
          <Route path="/" element={<Dashboard/>}/><Route path="/games/:id" element={<GameDetails/>}/><Route path="/session" element={<Session/>}/>
          <Route path="*" element={<div className="empty-state"><h1>Page not found</h1><Link className="button" to="/">Open library</Link></div>}/>
        </Routes>}
      </main>
      <PlayGuide open={guideOpen} onClose={() => setGuideOpen(false)}/>
      <footer><span><Orbit size={16}/> Your games. Your machine. Anywhere on your LAN.</span><span>LINUX HOST <span className="footer-divider">/</span> POWERED BY SELKIES</span></footer>
    </div>
  </GamingContext.Provider>;
}
