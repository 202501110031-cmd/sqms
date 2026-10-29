import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken('');
    setUser(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await api('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password }
    });
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  useEffect(() => {
    let active = true;
    if (!getToken()) {
      setLoading(false);
      return undefined;
    }
    api('/api/auth/me')
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => {
        if (active) logout();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [logout]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('sqms:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('sqms:unauthorized', handleUnauthorized);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: Boolean(user),
    login,
    logout,
    role: user?.role || null
  }), [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function roleHome(role) {
  if (role === 'admin') return '/staff/analytics';
  if (role === 'doctor') return '/staff/queue';
  return '/staff/frontdesk';
}
