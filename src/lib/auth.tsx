import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, isAdmin: false, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isAdmin: false, loading: true });
  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return setState({ user: null, isAdmin: false, loading: false });
        // Force refresh so a newly granted or revoked claim takes effect immediately.
        const token = await user.getIdTokenResult(true);
        setState({ user, isAdmin: token.claims.admin === true, loading: false });
      }),
    [],
  );
  // Re-check the admin claim every 10 minutes so revoked access takes effect without a reload.
  useEffect(() => {
    if (!state.user) return;
    const t = setInterval(async () => {
      try {
        const token = await state.user!.getIdTokenResult(true);
        setState((s) => ({ ...s, isAdmin: token.claims.admin === true }));
      } catch {
        await signOut(auth);
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [state.user]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/**
 * UI guard only. Real enforcement is the `admin` custom claim checked by
 * Firestore and Storage security rules.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-state">Checking access…</div>;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  if (!isAdmin)
    return (
      <div className="page-state">
        <h2>Access denied</h2>
        <p>Your account ({user.email}) is not an administrator.</p>
        <button className="btn" onClick={() => signOut(auth)}>Sign out</button>
      </div>
    );
  return <>{children}</>;
}
