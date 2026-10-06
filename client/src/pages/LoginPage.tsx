import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authApi } from '../api/auth.api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Eye, EyeOff, ShieldCheck, AlertCircle, Users, DoorOpen, ClipboardCheck } from 'lucide-react';

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
      const destination = response.user.role === 'GUARD' 
        ? '/gate' 
        : (from && from !== '/gate' ? from : '/');
      navigate(destination, { replace: true });
    } catch (err: any) {
      // Prompt requirement: display generic "Invalid username or password", do not expose server details
      if (err.status === 401) {
        setAuthError('Invalid username or password');
      } else if (err.code === 'TOO_MANY_REQUESTS') {
        setAuthError('Too many failed attempts. Please try again later.');
      } else {
        setAuthError('Unable to sign in right now. Check your connection and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-shell">
        <section className="login-brand-panel" aria-label="PRAVAHAx hostel presence platform">
          <div>
            <div className="login-brand-lockup">
              <span className="login-brand-mark">PX</span>
              <div>
                <div className="login-brand-name">PRAVAHAx</div>
                <div className="login-brand-kicker">Hostel Resident & Presence Management</div>
              </div>
            </div>

            <div className="login-brand-copy">
              <h1>Simple hostel operations from one place.</h1>
              <p>
                Resident presence, gate movement, face enrollment, and audited corrections for hostel staff.
              </p>
            </div>
          </div>

          <div className="login-feature-list">
            <div className="login-feature-item">
              <Users size={18} />
              <span>Resident roster and live presence</span>
            </div>
            <div className="login-feature-item">
              <DoorOpen size={18} />
              <span>Gate entry and exit workflow</span>
            </div>
            <div className="login-feature-item">
              <ClipboardCheck size={18} />
              <span>Clear movement history and audit trail</span>
            </div>
          </div>
        </section>

        <section className="login-card-wrapper">
          <div className="login-header">
            <div className="login-brand-icon">
              <ShieldCheck size={28} />
            </div>
            <h2 className="login-title">Staff Sign In</h2>
            <p className="login-subtitle">Use your assigned PRAVAHAx staff account.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            {authError && (
              <div className="alert-banner alert-banner-error" role="alert">
                <AlertCircle size={18} className="alert-icon" />
                <span>{authError}</span>
              </div>
            )}

            <Input
              label="Username"
              id="username"
              type="text"
              name="username"
              autoComplete="username"
              placeholder="Enter username"
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
              placeholder="Enter password"
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
              Sign In
            </Button>
          </form>

          <div className="login-footer-notes">
            <p className="security-notice">
              Access is limited to authorized hostel staff.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
