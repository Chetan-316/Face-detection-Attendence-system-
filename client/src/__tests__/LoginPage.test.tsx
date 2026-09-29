import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ToastContext';
import { authApi } from '../api/auth.api';
import { ApiError } from '../api/client';

vi.mock('../api/auth.api', () => ({
  authApi: {
    login: vi.fn(),
    getMe: vi.fn(),
  },
}));

describe('LoginPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const renderLoginPage = (initialRoute = '/login') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<div data-testid="dashboard">Dashboard Home</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
  };

  it('renders login form elements with accessible labels and show/hide password toggle', () => {
    renderLoginPage();

    expect(screen.getByLabelText(/staff username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in to console/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument();
  });

  it('validates required fields and shows inline errors without submitting', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const submitBtn = screen.getByRole('button', { name: /sign in to console/i });
    await user.click(submitBtn);

    expect(screen.getByText(/username is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('toggles password visibility between text and password types', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const passwordInput = screen.getByLabelText(/^password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: /show password/i });
    await user.click(toggleBtn);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
  });

  it('displays generic "Invalid username or password" on 401 error', async () => {
    const user = userEvent.setup();
    (authApi.login as any).mockRejectedValueOnce(
      new ApiError(401, 'Invalid username or password', 'UNAUTHORIZED')
    );

    renderLoginPage();

    await user.type(screen.getByLabelText(/staff username/i), 'warden');
    await user.type(screen.getByLabelText(/^password/i), 'wrongPassword');
    await user.click(screen.getByRole('button', { name: /sign in to console/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid username or password/i);
    });
  });

  it('completes successful login flow and redirects to application', async () => {
    const user = userEvent.setup();
    (authApi.login as any).mockResolvedValueOnce({
      user: {
        id: 'user-1',
        username: 'warden',
        fullName: 'Hostel Warden',
        email: 'warden@demo.test',
        role: 'WARDEN',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
      token: 'mock-jwt-token-123',
      expiresIn: 28800,
    });

    renderLoginPage();

    await user.type(screen.getByLabelText(/staff username/i), 'warden');
    await user.type(screen.getByLabelText(/^password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in to console/i }));

    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    });

    expect(localStorage.getItem('pravahax_access_token')).toBe('mock-jwt-token-123');
  });
});
