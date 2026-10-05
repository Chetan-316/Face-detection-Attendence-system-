import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Badge } from '../components/Badge';
import { ToastContainer } from '../components/Toast';
import {
  LayoutDashboard,
  Users,
  Video,
  LogOut,
  Menu,
  X,
  Shield,
  Building2,
  Eye,
  FileText,
  UserCog,
} from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { info } = useToast();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    info('You have been signed out.');
    navigate('/login');
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
            aria-controls="primary-navigation"
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="brand-container">
            <span className="brand-logo-badge">PX</span>
            <div className="brand-text-group">
              <span className="brand-name">PRAVAHAx</span>
              <span className="brand-tagline">Hostel Resident & Presence Management</span>
            </div>
          </div>
        </div>

        <div className="header-right">
          {user && (
            <div className="user-profile-badge">
              <div className="user-meta">
                <span className="user-fullname">{user.fullName || user.username}</span>
                <span className="user-role-label">
                  <Badge type="role" value={user.role} size="sm" />
                </span>
              </div>
              <button
                type="button"
                className="btn-logout"
                onClick={handleLogout}
                title="Sign out of system"
                aria-label="Sign out"
              >
                <LogOut size={16} />
                <span className="logout-text">Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="app-body">
        {isMobileMenuOpen && (
          <div
            className="mobile-backdrop"
            onClick={closeMobileMenu}
            aria-hidden="true"
          />
        )}

        <aside id="primary-navigation" className={`app-sidebar ${isMobileMenuOpen ? 'is-open' : ''}`}>
          <div className="sidebar-section-title">Navigation</div>

          <nav className="sidebar-nav">
            {user?.role === 'GUARD' ? (
              <NavLink
                to="/gate"
                className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                onClick={closeMobileMenu}
              >
                <Eye size={18} />
                <span>Gate</span>
              </NavLink>
            ) : (
              <>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={closeMobileMenu}
                >
                  <LayoutDashboard size={18} />
                  <span>Dashboard</span>
                </NavLink>

                <NavLink
                  to="/residents"
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={closeMobileMenu}
                >
                  <Users size={18} />
                  <span>Residents</span>
                </NavLink>

                <NavLink
                  to="/reports"
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={closeMobileMenu}
                >
                  <FileText size={18} />
                  <span>Reports</span>
                </NavLink>

                {user?.role === 'ADMIN' && (
                  <>
                    <NavLink
                      to="/cameras"
                      className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                      onClick={closeMobileMenu}
                    >
                      <Video size={18} />
                      <span>Cameras</span>
                    </NavLink>

                    <NavLink
                      to="/staff"
                      className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                      onClick={closeMobileMenu}
                    >
                      <UserCog size={18} />
                      <span>Staff</span>
                    </NavLink>
                  </>
                )}
              </>
            )}
          </nav>

          <div className="sidebar-system-info">
            <div className="system-scope-card">
              <div className="scope-row">
                <Building2 size={14} className="scope-icon" />
                <span className="scope-label">Facility</span>
              </div>
              <span className="scope-value">
                {user?.hostelId ? 'Assigned Hostel' : 'All Facilities'}
              </span>

              <div className="scope-row mt-2">
                <Shield size={14} className="scope-icon" />
                <span className="scope-label">Role</span>
              </div>
              <span className="scope-value">{user?.role}</span>
            </div>
          </div>
        </aside>

        <main className="app-main-content">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
};
