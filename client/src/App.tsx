import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
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
import { AttendancePage } from './pages/AttendancePage';
import { ReportsPage } from './pages/ReportsPage';

import { useAuth } from './auth/AuthContext';

const RecognitionRoute: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }
  return <RecognitionPage />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public Auth Route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Authenticated Protected Shell */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="residents" element={<ResidentsPage />} />
              <Route path="residents/:id" element={<ResidentDetailPage />} />
              <Route path="attendance" element={<AttendancePage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="cameras" element={<CamerasPage />} />
              <Route path="gate" element={<GatePage />} />
              <Route path="recognition" element={<RecognitionRoute />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
