import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Button } from '../components/Button';

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading, sessionError, refreshUser } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading-screen" role="status" aria-label="Loading authentication">
        <div className="loading-spinner" />
        <p className="loading-text">Verifying credentials...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Transient verification failure: keep the session and offer a retry instead of signing out.
    if (sessionError) {
      return (
        <div className="auth-loading-screen" role="alert">
          <p className="loading-text">{sessionError}</p>
          <Button variant="primary" size="sm" onClick={() => { void refreshUser(); }}>
            Retry
          </Button>
        </div>
      );
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? <>{children}</> : null;
};
