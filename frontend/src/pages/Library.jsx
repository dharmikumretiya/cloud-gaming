import { Link, useSearchParams } from 'react-router-dom';
import { Gamepad2, Keyboard, Hand } from 'lucide-react';
import { HostNotice, PlayButton, useGaming, isLive } from '../App';
import GameArtwork, { gameArt, isSuperTuxKart, gamePresentation } from '../components/GameArtwork';

export default function Library() {
  const { games, host, session, fresh } = useGaming();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const filtered = [...games].sort((a, b) => Number(Boolean(gamePresentation(b).touch)) - Number(Boolean(gamePresentation(a).touch))).filter(game => game.title.toLowerCase().includes(query.toLowerCase()));
  const featured = games.find(game => game.enabled) || games[0];
  return <>
    {!query && featured && <section className="hero" style={{ '--hero-art': `url("${gameArt(featured)}")` }} aria-label="Featured game">
      <div className="hero-content"><h1>{isSuperTuxKart(featured) ? <>Small karts.<br/>Big adventures.</> : featured.title}</h1><p className="hero-description">{isSuperTuxKart(featured) ? 'Wild tracks. Familiar faces. One more race.' : featured.description}<br/>Your next game is just a click away.</p><div className="hero-actions"><PlayButton game={featured}/><Link className="button secondary" to={`/games/${featured.id}`}>See game details</Link></div><p className="hero-meta"><Gamepad2 size={17}/>{featured.title}<span>•</span>Play in your browser</p></div>
    </section>}
    <div className={`content-wrap dashboard-content ${query ? 'search-results' : ''}`}>
      <HostNotice/>
      {query && <div className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h1>Results for “{query}”</h1></div><button className="text-button" onClick={() => setParams({})}>Clear search</button></div>}
      <section className="library-section" id="library" aria-labelledby="library-heading"><div className="section-heading"><h2 id="library-heading">{query ? 'Matching games' : 'Play from your library'} <span className="count">{filtered.length}</span></h2><span className="section-note">Installed on your host</span></div>
        {filtered.length ? <div className="library-layout"><div className="cover-shelf">{filtered.map(game => <Link to={`/games/${game.id}`} className="cover-card" key={game.id}><div className={`cover-art cover-${game.launchId}`}><GameArtwork game={game} format="cover" loading="lazy"/>{!isSuperTuxKart(game) && <div className="cover-title"><span>{gamePresentation(game).genre}</span><strong>{game.title}</strong></div>}<div className="cover-bottom"><span aria-label={gamePresentation(game).touch ? "Touch screen" : gamePresentation(game).controller ? "Keyboard and controller" : "Keyboard and mouse"}>{gamePresentation(game).touch ? <Hand size={20}/> : <Keyboard size={20}/>}
{gamePresentation(game).controller && <Gamepad2 size={21}/>}</span></div></div><h3>{game.title}</h3><p className={`game-status ${fresh && game.available ? 'ready' : ''}`}><span/>{!fresh ? 'Status unavailable' : !game.enabled ? 'Disabled' : game.available ? 'Ready to play' : host?.reserved ? 'Host reserved' : 'Unavailable'}</p></Link>)}</div></div> : <div className="empty-state panel"><Gamepad2 size={32}/><h2>{query ? 'No games found' : 'Your library is waiting'}</h2><p>{query ? 'Try a different title or clear your search.' : 'Seed the host database to add your first game.'}</p></div>}
      </section>
      {session && !query && <section className="recent-section"><div className="section-heading"><h2>{isLive(session) ? 'Jump back in' : 'Last played'}</h2></div><Link className="recent-card" to="/session"><GameArtwork game={session.game} loading="lazy"/><div><span className="mini-label">{isLive(session) ? 'CURRENT SESSION' : 'YOUR RECENT SESSION'}</span><h3>{session.game.title}</h3><p>{isLive(session) ? 'Return to your browser stream' : new Date(session.startedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p></div><Gamepad2 size={27}/></Link></section>}

    </div>
  </>;
}
