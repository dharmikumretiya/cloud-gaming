import { useEffect, useRef, useState } from 'react';
import { Expand, Hand, LoaderCircle, MousePointer2, Radio, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { request } from '../services/api';
import { gamePresentation } from './GameArtwork';

const labels = { CONNECTING: 'Connecting browser stream…', CONNECTED: 'Stream connected · waiting for video', PLAYING: 'Video received in this browser', STOPPED: 'Stream disconnected', ERROR: 'Stream needs attention' };
export default function BrowserPlayer({ session }) {
  const frame = useRef(null);
  const [state, setState] = useState('CONNECTING');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [sound, setSound] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [touch, setTouch] = useState(Boolean(gamePresentation(session.game).touch));
  const preferences = useRef({ sound, volume, touch });
  preferences.current = { sound, volume, touch };
  const send = data => frame.current?.contentWindow?.postMessage(data, location.origin);
  function applyPreferences() {
    const settings = preferences.current;
    send({ type: settings.touch ? 'touchinput:touch' : 'touchinput:trackpad' });
    send({ type: 'pipelineControl', pipeline: 'audio', enabled: settings.sound });
    send({ type: 'setVolume', value: settings.volume });
    send({ type: 'setMute', value: !settings.sound });
  }
  useEffect(() => {
    if (!window.isSecureContext) return;
    setState('CONNECTING'); setMessage('');
    const timer = setTimeout(() => { setState('ERROR'); setMessage('The stream has not connected. Check Selkies and try Reconnect.'); }, 30000);
    let received = false, configured = false;
    const poll = setInterval(() => send({ type: 'getStats' }), 1000);
    const onMessage = event => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'stats') return;
      const data = event.data.data;
      if (!data || typeof data !== 'object') return;
      // Apply through Selkies' supported message API after its listener is ready.
      if (!configured) { configured = true; applyPreferences(); }
      if (Number(data.clientFps) > 0 && data.isVideoPipelineActive) {
        received = true; setState('PLAYING'); setMessage(''); clearTimeout(timer);
      } else if (data.isVideoPipelineActive) {
        setState('CONNECTED'); clearTimeout(timer);
      } else if (received) { setState('STOPPED'); }
    };
    window.addEventListener('message', onMessage);
    return () => { clearTimeout(timer); clearInterval(poll); window.removeEventListener('message', onMessage); };
  }, [session.id, session.browserPlayerUrl, attempt]);
  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    send({ type: 'pipelineControl', pipeline: 'audio', enabled });
    send({ type: 'setMute', value: !enabled });
    send({ type: 'setVolume', value: volume });
  }
  function toggleTouch() {
    setTouch(!touch);
    send({ type: touch ? 'touchinput:trackpad' : 'touchinput:touch' });
  }
  async function reconnect() {
    setReconnecting(true); setMounted(false);
    try {
      await request('/stream/reconnect', {});
      setAttempt(old => old + 1); setMounted(true);
    } catch (error) { setState('ERROR'); setMessage(error.message); }
    finally { setReconnecting(false); }
  }
  if (!window.isSecureContext) return <section className="panel browser-player" aria-label="Secure connection required"><div className="player-help"><h2>Open Orbit over HTTPS</h2><p>Your browser requires a secure connection to stream games from another device.</p><p><a className="button" href={`https://${window.location.host}/session`}>Open secure session</a></p><p>The host must have HTTPS configured. A local certificate may need to be trusted on this device.</p></div></section>;
  return <section className="panel browser-player" aria-label="Browser game player">
    <div className="player-toolbar"><div role="status">{state === 'CONNECTING' ? <LoaderCircle size={16} className="spin"/> : <Radio size={16}/>}<span>{labels[state]}</span></div><div className="player-tools">
      <button className="player-control" aria-label="Game sound" aria-pressed={sound} onClick={toggleSound}>{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}<span>Sound {sound ? 'on' : 'off'}</span></button>
      <input className="volume-slider" type="range" min="0" max="1" step="0.05" aria-label="Game volume" value={volume} onChange={event => { const value = Number(event.target.value); setVolume(value); send({ type: 'setVolume', value }); }}/>
      <button className="player-control" aria-label="Direct touch mode" aria-pressed={touch} onClick={toggleTouch}>{touch ? <Hand size={18}/> : <MousePointer2 size={18}/>}<span>{touch ? 'Touch mode' : 'Trackpad'}</span></button>
      <button className="icon-button" aria-label="Reconnect stream" title="Reconnect stream" onClick={reconnect} disabled={reconnecting}><RotateCcw size={17}/></button>
      <button className="icon-button" aria-label="Fullscreen player" title="Fullscreen player" onClick={async () => { try { await frame.current?.requestFullscreen(); } catch { setMessage('Fullscreen is unavailable. Use the player’s fullscreen control or browser fullscreen.'); } }}><Expand size={18}/></button>
    </div></div>
    {session.browserPlayerUrl && mounted ? <iframe ref={frame} key={attempt} title={`${session.game.title} live stream`} src={`${session.browserPlayerUrl}&attempt=${attempt}`} allow="autoplay; fullscreen; gamepad; keyboard-map" allowFullScreen sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"/> : <div className="player-placeholder">{reconnecting ? 'Reconnecting…' : 'The browser player is not ready. Check Selkies status.'}</div>}
    <div className="player-help"><p>{gamePresentation(session.game).touch ? 'Turn your phone sideways, then tap matching free tiles. Touch mode sends taps directly to the board.' : 'Tap or click inside the game once to unlock browser audio. On a touch screen, use Touch mode for direct taps or Trackpad to move the pointer.'}</p><p>Check device media volume and Sound on above. Gaming Mode: Ctrl+Shift+X; hold Esc to release capture. End Session stops the game and stream.</p>{message && <p className={state === 'ERROR' ? 'player-error' : ''} role="status">{message}</p>}</div>
  </section>;
}
