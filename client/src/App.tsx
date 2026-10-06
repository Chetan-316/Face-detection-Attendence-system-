import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/ToastContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { ResidentDetailPage } from './pages/ResidentDetailPage';
import { GatePage } from './pages/GatePage';
import { CamerasPage } from './pages/CamerasPage';
import { RecognitionPage } from './pages/RecognitionPage';
import { ReportsPage } from './pages/ReportsPage';
import { StaffPage } from './pages/StaffPage';
import { FacilitiesPage } from './pages/FacilitiesPage';

type StaffRole = 'ADMIN' | 'WARDEN' | 'GUARD';

interface RoleRouteProps {
  allowed: StaffRole[];
  children: React.ReactElement;
}

const RoleRoute: React.FC<RoleRouteProps> = ({ allowed, children }) => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed.includes(user.role as StaffRole)) {
    return <Navigate to={user.role === 'GUARD' ? '/gate' : '/'} replace />;
  }

  return children;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewPage />} />

              <Route
                path="residents"
                element={
                  <RoleRoute allowed={['ADMIN', 'WARDEN']}>
                    <ResidentsPage />
                  </RoleRoute>
                }
              />

              <Route
                path="residents/:id"
                element={
                  <RoleRoute allowed={['ADMIN', 'WARDEN']}>
                    <ResidentDetailPage />
                  </RoleRoute>
                }
              />

              <Route
                path="reports"
                element={
                  <RoleRoute allowed={['ADMIN', 'WARDEN']}>
                    <ReportsPage />
                  </RoleRoute>
                }
              />

              <Route
                path="facilities"
                element={
                  <RoleRoute allowed={['ADMIN']}>
                    <FacilitiesPage />
                  </RoleRoute>
                }
              />

              <Route
                path="staff"
                element={
                  <RoleRoute allowed={['ADMIN']}>
                    <StaffPage />
                  </RoleRoute>
                }
              />

              <Route
                path="cameras"
                element={
                  <RoleRoute allowed={['ADMIN']}>
                    <CamerasPage />
                  </RoleRoute>
                }
              />

              <Route
                path="gate"
                element={
                  <RoleRoute allowed={['GUARD']}>
                    <GatePage />
                  </RoleRoute>
                }
              />

              <Route
                path="recognition"
                element={
                  <RoleRoute allowed={['ADMIN']}>
                    <RecognitionPage />
                  </RoleRoute>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
