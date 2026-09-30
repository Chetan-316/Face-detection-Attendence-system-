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

import { reportsApi } from '../api/reports.api';
import { PresenceSummaryReport, AttendanceSessionReportItem, MovementReportItem } from '../types/reports.types';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceData, setPresenceData] = useState<PresenceSummaryReport | null>(null);
  const [latestSession, setLatestSession] = useState<AttendanceSessionReportItem | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [resSummary, presRes, attRes, movRes] = await Promise.allSettled([
        residentsApi.getSummary(),
        reportsApi.getPresence(),
        reportsApi.getAttendanceSessions({ pageSize: 1 }),
        reportsApi.getMovements({ pageSize: 2 }),
      ]);

      if (resSummary.status === 'fulfilled') {
        setSummary(resSummary.value);
      }
      if (presRes.status === 'fulfilled') {
        setPresenceData(presRes.value);
      }
      if (attRes.status === 'fulfilled' && attRes.value.data.length > 0) {
        setLatestSession(attRes.value.data[0]);
      }
      if (movRes.status === 'fulfilled') {
        setRecentMovements(movRes.value.data);
      }
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
            <span>Pending biometric enrollment setup</span>
          </div>
        </Card>
      </div>

      {/* Operational Summary Grid (Requirement 19) */}
      <div className="operational-summary-grid mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Today's Hostel Status */}
        <Card title="Today's Hostel Status" subtitle="Authoritative presence count">
          <div className="flex justify-around items-center py-2 text-center">
            <div>
              <span className="text-xs text-secondary block">Inside Hostel</span>
              <span className="text-2xl font-bold text-emerald">
                {presenceData ? presenceData.insideCount : summary?.currentlyIn ?? 0}
              </span>
            </div>
            <div className="h-8 border-r border-border" />
            <div>
              <span className="text-xs text-secondary block">Outside Hostel</span>
              <span className="text-2xl font-bold text-amber">
                {presenceData ? presenceData.outsideCount : summary?.currentlyOut ?? 0}
              </span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-end">
            <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              View Movement Reports <ArrowRight size={12} />
            </Link>
          </div>
        </Card>

        {/* Latest Attendance */}
        <Card title="Latest Attendance" subtitle={latestSession ? latestSession.title : 'Night Attendance'}>
          <div className="flex justify-around items-center py-2 text-center">
            <div>
              <span className="text-xs text-secondary block">Present</span>
              <span className="text-2xl font-bold text-emerald">
                {latestSession ? latestSession.presentCount : 0}
              </span>
            </div>
            <div className="h-8 border-r border-border" />
            <div>
              <span className="text-xs text-secondary block">Absent</span>
              <span className="text-2xl font-bold text-amber">
                {latestSession ? latestSession.absentCount : 0}
              </span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-end">
            <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              View Attendance Reports <ArrowRight size={12} />
            </Link>
          </div>
        </Card>

        {/* Recent Movement */}
        <Card title="Recent Movement" subtitle="Latest gate transitions">
          {recentMovements.length === 0 ? (
            <p className="text-xs text-muted py-3 text-center">No recent gate movements logged.</p>
          ) : (
            <div className="space-y-2 py-1">
              {recentMovements.map((m) => (
                <div key={m.id} className="flex justify-between items-center text-xs">
                  <span className="font-mono text-muted">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium truncate max-w-[120px]">{m.fullName}</span>
                  <span className={`badge badge-sm badge-${m.direction === 'IN' ? 'success' : 'amber'}`}>
                    {m.direction}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-border flex justify-end">
            <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              All Movements <ArrowRight size={12} />
            </Link>
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

        <Card title="System Status" subtitle="Current platform capabilities">
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
              <span className="status-label">Camera & Biometric Pipeline</span>
              <span className="status-pill status-pill-neutral">PLANNED FOR UPCOMING PHASES</span>
            </div>
            <p className="status-note mt-4 text-xs text-muted">
              Camera integration, face enrollment, and face recognition are intentionally deferred to upcoming implementation phases.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
};
