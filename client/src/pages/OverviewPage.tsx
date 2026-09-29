import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { ResidentSummary } from '../types/resident.types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import {
  Users,
  UserCheck,
  LogIn,
  LogOut,
  ScanFace,
  UserX,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Building,
  ShieldAlert,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await residentsApi.getSummary();
      setSummary(data);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve resident overview metrics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="overview-page">
      <PageHeader
        title="Hostel Overview"
        subtitle={`Welcome back, ${user?.fullName || user?.username}. Real-time facility occupancy and roster status.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSummary}
            isLoading={isLoading}
            leftIcon={<RefreshCw size={14} />}
          >
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="alert-banner alert-banner-error mb-6" role="alert">
          <AlertCircle size={20} className="alert-icon" />
          <div className="alert-body">
            <span className="font-semibold">Failed to load overview data:</span> {error}
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={fetchSummary}>
                Try Again
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Primary Metrics Grid */}
      <div className="metrics-grid">
        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Total Residents</span>
            <div className="metric-icon-wrap icon-blue">
              <Users size={20} />
            </div>
          </div>
          <div className="metric-value">
            {isLoading ? <span className="skeleton-line" /> : summary?.total ?? 0}
          </div>
          <div className="metric-footer">
            <span>Roster registered under current scope</span>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Active Residents</span>
            <div className="metric-icon-wrap icon-green">
              <UserCheck size={20} />
            </div>
          </div>
          <div className="metric-value">
            {isLoading ? <span className="skeleton-line" /> : summary?.active ?? 0}
          </div>
          <div className="metric-footer">
            <span>{summary?.inactive ?? 0} inactive / suspended</span>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Currently IN</span>
            <div className="metric-icon-wrap icon-emerald">
              <LogIn size={20} />
            </div>
          </div>
          <div className="metric-value text-emerald">
            {isLoading ? <span className="skeleton-line" /> : summary?.currentlyIn ?? 0}
          </div>
          <div className="metric-footer">
            <span>Inside hostel perimeter</span>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Currently OUT</span>
            <div className="metric-icon-wrap icon-amber">
              <LogOut size={20} />
            </div>
          </div>
          <div className="metric-value text-amber">
            {isLoading ? <span className="skeleton-line" /> : summary?.currentlyOut ?? 0}
          </div>
          <div className="metric-footer">
            <span>Outside hostel premises</span>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Face Enrolled</span>
            <div className="metric-icon-wrap icon-purple">
              <ScanFace size={20} />
            </div>
          </div>
          <div className="metric-value">
            {isLoading ? <span className="skeleton-line" /> : summary?.faceEnrolled ?? 0}
          </div>
          <div className="metric-footer">
            <span>Biometric profile attached</span>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-header">
            <span className="metric-label">Not Enrolled</span>
            <div className="metric-icon-wrap icon-slate">
              <UserX size={20} />
            </div>
          </div>
          <div className="metric-value text-muted">
            {isLoading ? <span className="skeleton-line" /> : summary?.notEnrolled ?? 0}
          </div>
          <div className="metric-footer">
            <span>Pending enrollment in Phase 04</span>
          </div>
        </Card>
      </div>

      {/* Scope and Operational Banner */}
      <div className="overview-details-grid mt-6">
        <Card title="Facility & Operational Scope" subtitle="Current session security context">
          <div className="context-list">
            <div className="context-item">
              <Building size={16} className="text-muted" />
              <div>
                <span className="context-item-label">Hostel Node Scope</span>
                <p className="context-item-value">
                  {user?.hostelId ? `Scoped to Assigned Hostel (${user.hostelId})` : 'All Hostels (Org-Wide Admin)'}
                </p>
              </div>
            </div>

            <div className="context-item">
              <ShieldAlert size={16} className="text-muted" />
              <div>
                <span className="context-item-label">Staff Role Authorization</span>
                <p className="context-item-value">
                  {user?.role === 'ADMIN' && 'Full administrative authority across organization records.'}
                  {user?.role === 'WARDEN' && 'Warden authority: resident management & audit trail in assigned hostel.'}
                  {user?.role === 'GUARD' && 'Gate Guard authority: view roster and gate presence.'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border flex justify-between items-center">
            <span className="text-sm text-secondary">
              Need to inspect resident directory or update resident status?
            </span>
            <Link to="/residents">
              <Button size="sm" variant="primary" rightIcon={<ArrowRight size={14} />}>
                Go to Residents
              </Button>
            </Link>
          </div>
        </Card>

        <Card title="Step 03 System Status" subtitle="Verified platform foundation">
          <div className="system-status-body">
            <div className="status-row">
              <span className="status-label">Authentication Layer</span>
              <span className="status-pill status-pill-success">ACTIVE & SECURED</span>
            </div>
            <div className="status-row">
              <span className="status-label">Resident REST API</span>
              <span className="status-pill status-pill-success">OPERATIONAL</span>
            </div>
            <div className="status-row">
              <span className="status-label">PostgreSQL Database</span>
              <span className="status-pill status-pill-success">SYNCHRONIZED</span>
            </div>
            <div className="status-row">
              <span className="status-label">Biometric Recognition Hardware</span>
              <span className="status-pill status-pill-neutral">DEFERRED TO PHASE 04</span>
            </div>
            <p className="status-note mt-4 text-xs text-muted">
              Face Recognition camera streaming and feature vector extraction are intentionally deferred to Step 04. No simulated or mock recognition pipelines are active.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
};
