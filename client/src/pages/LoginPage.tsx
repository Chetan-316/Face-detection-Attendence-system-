import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authApi } from '../api/auth.api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Eye, EyeOff, ShieldCheck, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const from = (location.state as any)?.from?.pathname || '/';

  const validate = (): boolean => {
    const errors: { username?: string; password?: string } = {};
    if (!username.trim()) {
      errors.username = 'Username is required';
    }
    if (!password) {
      errors.password = 'Password is required';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!validate()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.login(username.trim(), password);
      login(response.token, response.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      // Prompt requirement: display generic "Invalid username or password", do not expose server details
      if (err.status === 401) {
        setAuthError('Invalid username or password');
      } else if (err.code === 'TOO_MANY_REQUESTS') {
        setAuthError('Too many failed attempts. Please try again later.');
      } else {
        setAuthError(err.message || 'Unable to connect to authorization server');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-card-wrapper">
        <div className="login-header">
          <div className="login-brand-icon">
            <ShieldCheck size={32} />
          </div>
          <h1 className="login-title">PRAVAHAx</h1>
          <p className="login-subtitle">Hostel Attendance & Resident Management</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          {authError && (
            <div className="alert-banner alert-banner-error" role="alert">
              <AlertCircle size={18} className="alert-icon" />
              <span>{authError}</span>
            </div>
          )}

          <Input
            label="Staff Username"
            id="username"
            type="text"
            name="username"
            autoComplete="username"
            placeholder="e.g. admin or warden"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (fieldErrors.username) {
                setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }
              if (authError) setAuthError(null);
            }}
            error={fieldErrors.username}
            required
            disabled={isLoading}
          />

          <Input
            label="Password"
            id="password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
              if (authError) setAuthError(null);
            }}
            error={fieldErrors.password}
            required
            disabled={isLoading}
            rightElement={
              <button
                type="button"
                className="btn-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            className="w-full mt-4"
          >
            Sign In to Console
          </Button>
        </form>

        <div className="login-footer-notes">
          <p className="security-notice">
            Staff access is monitored and logged in compliance with institutional audit requirements.
          </p>
        </div>
      </div>
    </div>
  );
};
