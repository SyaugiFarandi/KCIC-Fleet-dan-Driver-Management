import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearSession, getStoredUser, getToken, setUnauthorizedHandler, storeSession } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getToken());
  const [user, setUser] = useState(() => getStoredUser());
  const [bootstrapping, setBootstrapping] = useState(Boolean(getToken()));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken('');
      setUser(null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setBootstrapping(false);
      return undefined;
    }
    (async () => {
      try {
        const result = await api('/auth/me');
        if (!cancelled) {
          setUser(result.user);
          storeSession(token, result.user);
        }
      } catch (error) {
        if (!cancelled && error.status === 401) {
          clearSession();
          setToken('');
          setUser(null);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } });
    storeSession(result.token, result.user);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* token may already be invalid */
    }
    clearSession();
    setToken('');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const result = await api('/auth/me');
    setUser(result.user);
    storeSession(getToken(), result.user);
    return result.user;
  }, []);

  const value = useMemo(
    () => ({ token, user, bootstrapping, login, logout, refreshUser }),
    [token, user, bootstrapping, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
