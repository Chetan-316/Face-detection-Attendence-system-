import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { StaffUser, AuthContextType } from '../types/auth.types';
import {
  ApiError,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  registerUnauthorizedHandler,
} from '../api/client';
import { authApi } from '../api/auth.api';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_VERIFY_ERROR = 'Could not verify your session. Retry?';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setTokenState] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<StaffUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const logout = useCallback(() => {
    clearStoredToken();
    setTokenState(null);
    setUser(null);
    setSessionError(null);
  }, []);

  // Also the retry entry point: calling refreshUser again re-verifies the stored session.
  const refreshUser = useCallback(async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      setUser(null);
      setSessionError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.getMe();
      setUser(response.user);
      setSessionError(null);
    } catch (error) {
      // Only an explicit rejection (401/403) ends the session. Network errors, 5xx and timeouts keep
      // the token and any loaded user, and surface a retryable error instead.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        logout();
      } else {
        setSessionError(SESSION_VERIFY_ERROR);
      }
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
    setSessionError(null);
    setIsLoading(false);
  }, []);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: Boolean(token && user),
    isLoading,
    sessionError,
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
