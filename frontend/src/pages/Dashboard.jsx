import { Link, useSearchParams } from 'react-router-dom';
import { Cloud, Gamepad2, Keyboard, Monitor, Wifi, Hand } from 'lucide-react';
import { Availability, HostNotice, PlayButton, useGaming, isLive } from '../App';
import GameArtwork, { gameArt, isSuperTuxKart, gamePresentation } from '../components/GameArtwork';

export default function Dashboard() {
  const { games, host, session, showGuide, fresh } = useGaming();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const filtered = [...games].sort((a, b) => Number(Boolean(gamePresentation(b).touch)) - Number(Boolean(gamePresentation(a).touch))).filter(game => game.title.toLowerCase().includes(query.toLowerCase()));
  const featured = games.find(game => game.enabled) || games[0];
  return <>
    {!query && featured && <section className="hero" style={{ '--hero-art': `url("${gameArt(featured)}")` }} aria-label="Featured game">
      <div className="hero-content"><p className="eyebrow"><Cloud size={18}/> STREAM FROM YOUR LIBRARY</p><h1>{isSuperTuxKart(featured) ? <>Small karts.<br/>Big adventures.</> : featured.title}</h1><p className="hero-description">{isSuperTuxKart(featured) ? 'Wild tracks. Familiar faces. One more race.' : featured.description}<br/>Your next game is just a click away.</p><div className="hero-actions"><PlayButton game={featured}/><Link className="button secondary" to={`/games/${featured.id}`}>See game details</Link></div><p className="hero-meta"><Gamepad2 size={17}/>{featured.title}<span>•</span>Play in your browser</p></div>
      <div className="hero-foot"><span>FEATURED ON ORBIT</span><span className="feature-marker"/></div>
    </section>}
    <div className={`content-wrap dashboard-content ${query ? 'search-results' : ''}`}>
      <HostNotice/>
      {query && <div className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h1>Results for “{query}”</h1></div><button className="text-button" onClick={() => setParams({})}>Clear search</button></div>}
      {!query && <section className="featured-rail" aria-label="Discover Orbit">
        {featured && <Link className="landscape-card" to={`/games/${featured.id}`}><GameArtwork game={featured}/><div className="tile-shade"/><div className="tile-copy"><span className="mini-label">ON YOUR HOST</span><h2>{featured.title}</h2><span className="tile-caption">Explore the game <Gamepad2 size={21}/></span></div></Link>}
        <button className="editorial-card" onClick={showGuide}><Cloud size={38}/><div><span className="mini-label">NO DOWNLOADS. JUST PLAY.</span><h2>Your machine.<br/>A whole new screen.</h2><span className="tile-caption">See how browser play works</span></div><OrbitLines/></button>
      </section>}
      <section className="library-section" id="library" aria-labelledby="library-heading"><div className="section-heading"><h2 id="library-heading">{query ? 'Matching games' : 'Play from your library'} <span className="count">{filtered.length}</span></h2><span className="section-note">Installed on your host</span></div>
        {filtered.length ? <div className="library-layout"><div className="cover-shelf">{filtered.map(game => <Link to={`/games/${game.id}`} className="cover-card" key={game.id}><div className={`cover-art cover-${game.launchId}`}><GameArtwork game={game} format="cover" loading="lazy"/>{!isSuperTuxKart(game) && <div className="cover-title"><span>{gamePresentation(game).genre}</span><strong>{game.title}</strong></div>}<div className="cover-bottom"><span className="orbit-badge">ORBIT<br/>PLAY</span><span aria-label={gamePresentation(game).touch ? "Touch screen" : gamePresentation(game).controller ? "Keyboard and controller" : "Keyboard and mouse"}>{gamePresentation(game).touch ? <Hand size={20}/> : <Keyboard size={20}/>}
{gamePresentation(game).controller && <Gamepad2 size={21}/>}</span></div></div><h3>{game.title}</h3><p className={`game-status ${fresh && game.available ? 'ready' : ''}`}><span/>{!fresh ? 'Status unavailable' : !game.enabled ? 'Disabled' : game.available ? 'Ready to play' : host?.reserved ? 'Host reserved' : 'Unavailable'}</p></Link>)}</div>{!query && games.length < 3 && <aside className="library-note"><span className="mini-label">MADE FOR YOUR LIBRARY</span><h2>The games you love.<br/>The host you own.</h2><p>Every game here runs on your Linux machine. Different players can stream different games at the same time.</p><div><Monitor size={19}/>One host<Wifi size={19}/>Your network</div></aside>}</div> : <div className="empty-state panel"><Gamepad2 size={32}/><h2>{query ? 'No games found' : 'Your library is waiting'}</h2><p>{query ? 'Try a different title or clear your search.' : 'Seed the host database to add your first game.'}</p></div>}
      </section>
      {session && !query && <section className="recent-section"><div className="section-heading"><h2>{isLive(session) ? 'Jump back in' : 'Last played'}</h2></div><Link className="recent-card" to="/session"><GameArtwork game={session.game} loading="lazy"/><div><span className="mini-label">{isLive(session) ? 'CURRENT SESSION' : 'YOUR RECENT SESSION'}</span><h3>{session.game.title}</h3><p>{isLive(session) ? 'Return to your browser stream' : new Date(session.startedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p></div><Gamepad2 size={27}/></Link></section>}
      <div className="host-strip"><Monitor size={25}/><div><strong>Your Linux host</strong><p>{host?.hostAddress || 'Not configured'} · {host?.activeSessions || 0} of {host?.maxSessions || 2} gaming slots in use · Independent streams</p></div><Availability/></div>
    </div>
  </>;
}
function OrbitLines() { return <div className="orbit-lines" aria-hidden="true"><i/><i/><i/></div>; }
