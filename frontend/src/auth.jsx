import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearSession, getStoredUser, setUnauthorizedHandler, storeUser } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [bootstrapping, setBootstrapping] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (userRef.current) setSessionExpired(true);
      setUser(null);
      storeUser(null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api('/auth/me', { suppressAuthError: true });
        if (!cancelled) {
          setUser(result.user);
          storeUser(result.user);
          setSessionExpired(false);
        }
      } catch (error) {
        if (!cancelled && error.status === 401) {
          if (userRef.current) setSessionExpired(true);
          setUser(null);
          clearSession();
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } });
    storeUser(result.user);
    setUser(result.user);
    setSessionExpired(false);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be gone */
    }
    clearSession();
    setUser(null);
    setSessionExpired(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const result = await api('/auth/me');
    setUser(result.user);
    storeUser(result.user);
    return result.user;
  }, []);

  const updatePreferences = useCallback(async (types) => {
    const result = await api('/auth/preferences', { method: 'PATCH', body: { types } });
    setUser(result.user);
    storeUser(result.user);
    return result.user;
  }, []);

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), []);

  const value = useMemo(
    () => ({ user, bootstrapping, sessionExpired, login, logout, refreshUser, updatePreferences, dismissSessionExpired }),
    [user, bootstrapping, sessionExpired, login, logout, refreshUser, updatePreferences, dismissSessionExpired]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
