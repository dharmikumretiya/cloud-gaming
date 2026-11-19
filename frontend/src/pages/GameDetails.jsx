import { Link, useParams } from 'react-router-dom';
import { Cloud, Gamepad2, Keyboard, Monitor, ChevronLeft, Hand } from 'lucide-react';
import { HostNotice, PlayButton, useGaming } from '../App';
import { gameArt, isSuperTuxKart, gamePresentation } from '../components/GameArtwork';
export default function GameDetails() {
  const { id } = useParams();
  const { games } = useGaming();
  const game = games.find(x => String(x.id) === id);
  if (!game) return <div className="empty-state"><h1>Game not found</h1><Link className="button" to="/">Back to library</Link></div>;
  const stk = isSuperTuxKart(game);
  const metadata = gamePresentation(game);
  return <>
    <section className="hero detail-hero" style={{ '--hero-art': `url("${gameArt(game)}")` }}><div className="detail-content"><Link className="back-link" to="/"><ChevronLeft size={18}/>All games</Link><h1>{game.title}</h1><p className="detail-byline">{metadata.developer ? `${metadata.developer} · ${metadata.genre}` : metadata.genre} · Linux</p><div className="detail-controls">{metadata.touch ? <span><Hand size={22}/>Tap to match · Touch friendly</span> : <span><Keyboard size={22}/>Keyboard & mouse</span>}{metadata.controller && <span><Gamepad2 size={24}/>Controller compatible</span>}</div><p className="detail-description">{game.description}</p><div className="hero-actions"><PlayButton game={game}/></div><p className="muted small">Streams from your host. No client installation required.</p></div></section>
    <div className="content-wrap detail-below"><HostNotice/><div className="about-grid"><section><p className="eyebrow">THE GAME</p><h2>{stk ? 'Get ready for one more lap.' : `About ${game.title}`}</h2><p>{stk ? 'Take the wheel in an open-source kart racer packed with colorful characters, imaginative tracks, and playful power-ups. Race for the podium, explore story mode, or mix things up with a battle.' : game.description}</p></section><div className="detail-specs"><span><Monitor/>Runs on your Linux host</span><span><Cloud/>Play directly in your browser</span><span><Gamepad2/>Your own game, display & audio</span></div></div>{stk && <section className="gallery"><div className="section-heading"><h2>A look inside</h2><span className="section-note">SuperTuxKart screenshots</span></div><div className="gallery-rail">{[['stk-world','Racing through an autumn landscape'],['stk-adventure','Kart soccer on a tropical arena'],['stk-race','Neon kart soccer stadium']].map(([file,alt]) => <a key={file} href={`/images/${file}.jpg`} target="_blank" rel="noreferrer" aria-label={`View screenshot: ${alt}`}><img src={`/images/${file}.jpg`} alt={alt} loading="lazy"/></a>)}</div><p className="art-credit">Game artwork © SuperTuxKart contributors. <a href="https://supertuxkart.net/Gallery" target="_blank" rel="noreferrer">Official gallery</a></p></section>}</div>
  </>;
}
