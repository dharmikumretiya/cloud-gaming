import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock3, Eye, EyeOff, Gamepad2, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import { isLive, useGaming } from '../App';

export default function Account() {
  const { user, session, busy, authenticate } = useGaming();
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState('');
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await authenticate(mode, Object.fromEntries(values));
      form.reset();
    } catch (error) { setError(error.message); }
  }
  return <div className="content-wrap account-page">
    <div className="account-intro"><p className="eyebrow">YOUR PLAYER SPACE</p><h1>{user ? `Welcome, ${user.displayName}.` : 'Make every session yours.'}</h1><p className="subheading">Your games. Your play history. Wherever you sign in.</p></div>
    <div className="account-layout">
      <section className="account-card">
        {user ? <>
          <div className="account-avatar"><UserRound size={32}/></div><h2>{user.displayName}</h2><p className="account-handle">@{user.username}</p>
          <dl className="account-facts"><div><dt>Member since</dt><dd>{new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</dd></div><div><dt>Role</dt><dd>{user.isAdmin ? 'Admin' : 'Player'}</dd></div><div><dt>Account</dt><dd className="green">Signed in on this device</dd></div></dl>
          <Link to="/history" className="button account-primary">View play history<ArrowRight size={18}/></Link>
          {isLive(session) && <p className="account-help">Signing out ends the game playing in this browser. Games on your other devices keep running.</p>}
          <button className="button secondary account-primary" disabled={busy} onClick={async () => { setError(''); try { await authenticate('logout'); setNotice('You’re signed out. Guest play is still available.'); } catch (error) { setError(error.message); } }}>{busy ? <LoaderCircle size={17} className="spin"/> : <LogOut size={17}/>}Sign out{isLive(session) ? ' and end game' : ''}</button>
        </> : <>
          <div className="account-tabs" aria-label="Account options"><button className={mode === 'login' ? 'selected' : ''} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Sign in</button><button className={mode === 'register' ? 'selected' : ''} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); setNotice(''); }}>Create account</button></div>
          <h2>{mode === 'register' ? 'Create your player profile.' : 'Good to have you back.'}</h2><p className="account-help">{mode === 'register' ? 'Choose a username and password to save your future sessions.' : 'Sign in to keep your play history together.'}</p>
          {notice && <p className="form-success" role="status">{notice}</p>}
          <form className="account-form" onSubmit={submit} key={mode}>
            {mode === 'register' && <label>Display name<input name="displayName" autoComplete="nickname" required maxLength={40} placeholder="What should we call you?"/></label>}
            <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="Your player name" aria-describedby={mode === 'register' ? 'username-help' : undefined}/></label>
            {mode === 'register' && <p id="username-help" className="field-help">3–24 letters, numbers, or underscores. Usernames aren’t case-sensitive.</p>}
            <label htmlFor="account-password">Password</label><div className="password-field"><input id="account-password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={10} maxLength={128} placeholder="At least 10 characters" aria-describedby="password-help"/><button className="icon-button" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div>
            <p id="password-help" className="field-help">10–128 characters. Use a password you can remember; password recovery isn’t available yet.</p>
            <button className="button account-primary" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>} {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
          <Link className="guest-link" to="/">Continue playing as a guest <ArrowRight size={15}/></Link>
        </>}
        {error && <div className="form-error" role="alert">{error}{isLive(session) && <Link to="/session">Return to your game →</Link>}</div>}
      </section>
      <aside className="account-benefits"><div><Clock3 size={23}/><h3>Pick up your history</h3><p>See what you played, when you played, and time spent in completed sessions.</p></div><div><Gamepad2 size={23}/><h3>One account. Your devices.</h3><p>Sign in on another screen to see the same history. Every device still gets its own game and stream.</p></div><div><UserRound size={23}/><h3>A space for your sessions</h3><p>Your account history is private. Games played as a guest stay separate.</p></div></aside>
    </div>
  </div>;
}
