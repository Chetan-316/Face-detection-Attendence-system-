import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { StaffUser, AuthContextType } from '../types/auth.types';
import {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  registerUnauthorizedHandler,
} from '../api/client';
import { authApi } from '../api/auth.api';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setTokenState] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<StaffUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = useCallback(() => {
    clearStoredToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await authApi.getMe();
      setUser(response.user);
    } catch (error) {
      logout();
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    // Intercept 401 globally from API client
    registerUnauthorizedHandler(() => {
      logout();
    });

    refreshUser();
  }, [refreshUser, logout]);

  const login = useCallback((newToken: string, newUser: StaffUser) => {
    setStoredToken(newToken);
    setTokenState(newToken);
    setUser(newUser);
    setIsLoading(false);
  }, []);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    isLoading,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
