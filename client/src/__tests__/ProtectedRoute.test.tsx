import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { AuthProvider } from '../auth/AuthContext';
import { authApi } from '../api/auth.api';

vi.mock('../api/auth.api', () => ({
  authApi: {
    login: vi.fn(),
    getMe: vi.fn(),
  },
}));

describe('ProtectedRoute Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('redirects unauthenticated user attempting to access /residents to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/residents']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
            <Route
              path="/residents"
              element={
                <ProtectedRoute>
                  <div data-testid="protected-content">Secret Residents Data</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('allows authenticated user with valid token to view protected content', async () => {
    localStorage.setItem('pravahax_access_token', 'valid-test-token');
    (authApi.getMe as any).mockResolvedValueOnce({
      user: {
        id: 'user-1',
        username: 'warden',
        fullName: 'Hostel Warden',
        role: 'WARDEN',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
    });

    render(
      <MemoryRouter initialEntries={['/residents']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
            <Route
              path="/residents"
              element={
                <ProtectedRoute>
                  <div data-testid="protected-content">Resident Management Area</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });
});
