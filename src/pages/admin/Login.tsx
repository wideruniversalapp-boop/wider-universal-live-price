import { browserSessionPersistence, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Logo } from '../../components/Layout';
import { auth } from '../../firebase';
import { useAuth } from '../../lib/auth';
import { useSiteConfig } from '../../lib/siteConfigStore';

export default function Login() {
  const { user, isAdmin, loading } = useAuth();
  const { config } = useSiteConfig();
  useEffect(() => {
    document.title = `Administrator sign in | ${config.company.name}`;
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [config.company.name]);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(() => {
    try {
      const r = sessionStorage.getItem('signout-reason');
      sessionStorage.removeItem('signout-reason');
      return r === 'idle' ? 'You were signed out after 30 minutes of inactivity.' : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);

  if (!loading && user && isAdmin) {
    const from = (location.state as { from?: string } | null)?.from ?? '/admin';
    return <Navigate to={from} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // Session ends when the browser is closed; the dashboard also signs out after inactivity.
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setMessage(code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.' : 'Incorrect email or password.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email) return setMessage('Enter your email address first.');
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      /* do not reveal whether the account exists */
    }
    setMessage('If an account exists for that address, a reset link has been sent.');
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Logo config={config} />
        <h1>Administrator sign in</h1>
        {user && !isAdmin && !loading && <div className="alert error">{user.email} does not have administrator access.</div>}
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {message && <p className="form-message">{message}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link-button" onClick={reset}>Forgot password?</button>
        <p className="muted small">Accounts are created by the system owner. There is no public registration. Your session ends when you close the browser or after 30 minutes of inactivity.</p>
      </form>
    </div>
  );
}
