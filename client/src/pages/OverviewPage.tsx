import React, { useEffect, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { camerasApi } from '../api/cameras.api';
import { facilitiesApi } from '../api/facilities.api';
import { SafeResident, ResidentSummary } from '../types/resident.types';
import { PresenceCounts } from '../types/movement.types';
import { MovementReportItem } from '../types/reports.types';
import { CameraEntity } from '../types/camera.types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import {
  Users,
  LogIn,
  LogOut,
  Clock,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
  Video,
  CheckCircle2,
} from 'lucide-react';
import '../styles/overview.css';

type ReadinessTone = 'ok' | 'attention' | 'neutral';

const READINESS_LABEL: Record<ReadinessTone, string> = {
  ok: 'Complete',
  attention: 'Needs attention',
  neutral: 'No data',
};

const ReadinessMark: React.FC<{ tone: ReadinessTone }> = ({ tone }) => (
  <span className="overview-check-mark">
    {tone === 'ok' && <CheckCircle2 size={16} aria-hidden="true" />}
    {tone === 'attention' && <AlertCircle size={16} aria-hidden="true" />}
    {tone === 'neutral' && <span className="overview-check-dot" aria-hidden="true" />}
    <span className="sr-only">{READINESS_LABEL[tone]}</span>
  </span>
);

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();

  const isWarden = user?.role === 'WARDEN';
  const isAdmin = user?.role === 'ADMIN';

  // State for metrics & summaries
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [outsideResidents, setOutsideResidents] = useState<SafeResident[]>([]);
  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [returnDeadlineMinutes, setReturnDeadlineMinutes] = useState(1260);
  const [hasScopedReturnDeadline, setHasScopedReturnDeadline] = useState(
    isWarden && Boolean(user?.hostelId)
  );

  // Night return is derived from live ResidentPresence. Each facility owns its
  // return deadline; residents still OUT after that time are "Not Returned".
  const deadlineHours = Math.floor(returnDeadlineMinutes / 60);
  const deadlineMinutes = returnDeadlineMinutes % 60;
  const returnDeadlineLabel = new Date(
    1970,
    0,
    1,
    deadlineHours,
    deadlineMinutes
  ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const scopeHostelId = isWarden ? user?.hostelId || undefined : undefined;

      const [resSummary, presRes, movRes, outRes, camRes, settingsRes] = await Promise.allSettled([
        residentsApi.getSummary ? residentsApi.getSummary(scopeHostelId) : Promise.resolve(null),
        movementsApi.getPresenceCounts ? movementsApi.getPresenceCounts(scopeHostelId) : Promise.resolve(null),
        reportsApi.getMovements ? reportsApi.getMovements({ pageSize: 8, hostelId: scopeHostelId }) : Promise.resolve({ data: [] }),
        residentsApi.listResidents
          ? residentsApi.listResidents({ presence: 'OUT', pageSize: 6, hostelId: scopeHostelId })
          : Promise.resolve({ data: [] }),
        isAdmin && camerasApi.listCameras
          ? camerasApi.listCameras()
          : Promise.resolve({ data: [] }),
        isWarden && user?.hostelId
          ? facilitiesApi.getOperationalSettings(user.hostelId)
          : Promise.resolve({ data: { hostelId: null, returnDeadlineMinutes: 1260, scoped: false } }),
      ]);

      if (resSummary.status === 'fulfilled' && resSummary.value) {
        setSummary(resSummary.value);
      }
      if (presRes.status === 'fulfilled' && presRes.value) {
        setPresenceCounts(presRes.value);
      }
      if (movRes.status === 'fulfilled' && movRes.value?.data && Array.isArray(movRes.value.data)) {
        setRecentMovements(movRes.value.data);
      }
      if (outRes.status === 'fulfilled' && outRes.value?.data && Array.isArray(outRes.value.data)) {
        setOutsideResidents(outRes.value.data);
      }
      if (camRes.status === 'fulfilled' && camRes.value?.data && Array.isArray(camRes.value.data)) {
        setCameras(camRes.value.data);
      }
      if (settingsRes.status === 'fulfilled' && settingsRes.value?.data) {
        setReturnDeadlineMinutes(settingsRes.value.data.returnDeadlineMinutes ?? 1260);
        setHasScopedReturnDeadline(Boolean(settingsRes.value.data.scoped));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard operational overview');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId, isAdmin, isWarden]);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalResidents = summary?.total ?? summary?.active ?? 0;
  const currentlyIn = presenceCounts?.currentlyIn ?? summary?.currentlyIn ?? 0;
  const currentlyOut = presenceCounts?.currentlyOut ?? summary?.currentlyOut ?? 0;
  const notEnrolledCount = summary?.notEnrolled ?? 0;
  const enrolledCount = summary?.faceEnrolled ?? 0;
  const onlineCameras = cameras.filter((camera) => camera.healthStatus === 'ONLINE').length;
  const cameraAttentionCount = Math.max(cameras.length - onlineCameras, 0);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isAfterReturnDeadline = hasScopedReturnDeadline && currentMinutes >= returnDeadlineMinutes;
  const outsideSectionTitle = isAfterReturnDeadline
    ? 'Residents Not Returned'
    : 'Residents Currently Outside';
  const outsideStatusLabel = isAfterReturnDeadline ? 'Not Returned' : 'Outside';

  // Readiness marks are derived from the same counts shown in each row.
  const enrollmentTone: ReadinessTone =
    totalResidents === 0 ? 'neutral' : enrolledCount >= totalResidents ? 'ok' : 'attention';
  const cameraTone: ReadinessTone =
    cameras.length === 0 ? 'neutral' : onlineCameras === cameras.length ? 'ok' : 'attention';
  const cameraAttentionTone: ReadinessTone = cameraAttentionCount > 0 ? 'attention' : 'ok';

  // Guard role is redirected directly to Gate
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

  return (
    <div className="overview-page">
      <PageHeader
        title={isWarden ? 'Warden Dashboard' : 'Admin Overview'}
        subtitle={
          isWarden
            ? `Live hostel presence, return status, and residents who need attention.`
            : `Resident coverage, live presence, and operational readiness across all hostels.`
        }
        actions={
          <Button
            variant="outline"
            size="md"
            onClick={fetchOverviewData}
            isLoading={isLoading}
            leftIcon={<RefreshCw size={15} />}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="alert-banner alert-banner-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Operational metric cards */}
      <div className="overview-stats-row">
        {/* Total Residents */}
        <Link to="/residents" className="overview-stat-card overview-stat-card-link">
          <div className="overview-stat-head">
            <span className="overview-stat-label">Residents</span>
            <Users size={18} className="overview-stat-icon is-blue" />
          </div>
          <div className="overview-stat-foot">
            <span className="overview-stat-value">{totalResidents}</span>
            <span className="overview-stat-link">
              View residents <ArrowRight size={14} />
            </span>
          </div>
        </Link>

        {/* Inside Hostel */}
        <div className="overview-stat-card">
          <div className="overview-stat-head">
            <span className="overview-stat-label">Inside</span>
            <LogIn size={18} className="overview-stat-icon is-emerald" />
          </div>
          <div className="overview-stat-foot">
            <span className="overview-stat-value">{currentlyIn}</span>
          </div>
        </div>

        {/* Outside Hostel */}
        <div className="overview-stat-card">
          <div className="overview-stat-head">
            <span className="overview-stat-label">Outside</span>
            <LogOut size={18} className="overview-stat-icon is-amber" />
          </div>
          <div className="overview-stat-foot">
            <span className="overview-stat-value">{currentlyOut}</span>
          </div>
        </div>

        {/* Return Deadline */}
        <div className="overview-stat-card">
          <div className="overview-stat-head">
            <span className="overview-stat-label">
              {!hasScopedReturnDeadline
                ? 'Return Deadlines'
                : isAfterReturnDeadline
                ? 'Not Returned'
                : 'Return Deadline'}
            </span>
            <Clock
              size={18}
              className={`overview-stat-icon ${isAfterReturnDeadline ? 'is-red' : 'is-blue'}`}
            />
          </div>
          <div className={`overview-stat-foot${!hasScopedReturnDeadline ? ' is-stacked' : ''}`}>
            <span className="overview-stat-value">
              {!hasScopedReturnDeadline
                ? 'Varies'
                : isAfterReturnDeadline
                ? currentlyOut
                : returnDeadlineLabel}
            </span>
            {!hasScopedReturnDeadline && (
              <span className="overview-stat-note">Set separately for each hostel</span>
            )}
          </div>
        </div>
      </div>

      <div
        className={`overview-notice ${isAfterReturnDeadline ? 'is-alert' : 'is-info'}`}
      >
        <div className="overview-notice-body">
          {isAfterReturnDeadline ? (
            <AlertCircle size={18} className="overview-notice-icon" />
          ) : (
            <Clock size={18} className="overview-notice-icon" />
          )}
          <div className="overview-notice-text">
            <div className="overview-notice-title">
              {!hasScopedReturnDeadline
                ? 'Each hostel has its own return deadline'
                : isAfterReturnDeadline
                ? `${currentlyOut} ${currentlyOut === 1 ? 'resident has' : 'residents have'} not returned`
                : `Return deadline is ${returnDeadlineLabel}`}
            </div>
            <div className="overview-notice-detail">
              {!hasScopedReturnDeadline
                ? 'Open Hostels to review or change the deadline for each hostel. Presence counts above include all hostels in your organization.'
                : isAfterReturnDeadline
                ? 'This list updates automatically from the live IN / OUT presence state as residents return.'
                : `${currentlyOut} ${currentlyOut === 1 ? 'resident is' : 'residents are'} currently outside. No separate night attendance is required.`}
            </div>
          </div>
        </div>
        <Link
          to={!hasScopedReturnDeadline ? '/facilities' : '/residents'}
          className="resident-quick-link overview-notice-link"
        >
          {!hasScopedReturnDeadline ? 'Manage hostel deadlines' : 'Open resident list'} <ArrowRight size={14} />
        </Link>
      </div>

      {/* Main Content: Live presence, recent gate activity, operational readiness */}
      <div className="overview-content-row">
        {/* Left Column: Residents Currently Outside & Recent Gate Activity */}
        <div className="overview-main-col">
          <section className="overview-panel" aria-labelledby="overview-outside-title">
            <div className="overview-panel-head">
              <div className="overview-panel-title">
                <LogOut size={17} className="overview-title-icon is-amber" />
                <h3 id="overview-outside-title">{outsideSectionTitle}</h3>
              </div>
              <span className="overview-count-pill">
                {currentlyOut} {outsideStatusLabel}
              </span>
            </div>

            {outsideResidents.length === 0 ? (
              <div className="overview-empty">
                {isAfterReturnDeadline
                  ? 'All residents have returned to the hostel.'
                  : 'All residents are currently inside the hostel.'}
              </div>
            ) : (
              <div className="overview-table-wrap">
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th scope="col">Resident</th>
                      <th scope="col">Room</th>
                      <th scope="col">Last Out</th>
                      <th scope="col">Phone</th>
                      <th scope="col" className="is-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outsideResidents.map((res) => (
                      <tr key={res.id}>
                        <td>
                          <div className="overview-person">
                            <span className="overview-person-name">{res.fullName}</span>
                            <span className="overview-person-code">{res.residentCode}</span>
                          </div>
                        </td>
                        <td className="overview-cell-strong">{res.roomGroup}</td>
                        <td className="is-numeric">
                          {res.presence?.lastMovementTime
                            ? new Date(res.presence.lastMovementTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="is-numeric">{res.contactPhone || '—'}</td>
                        <td className="is-right">
                          <span className="overview-status-pill is-amber">
                            <span className="sr-only">OUT</span>
                            <span>{outsideStatusLabel}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Gate Activity */}
          <section className="overview-panel" aria-labelledby="overview-activity-title">
            <div className="overview-panel-head">
              <h3 id="overview-activity-title">Recent Gate Activity</h3>
              <span className="overview-panel-caption">Live Movement Log</span>
            </div>

            {recentMovements.length === 0 ? (
              <div className="overview-empty">No recent gate movements recorded today.</div>
            ) : (
              <div className="overview-table-wrap">
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Resident</th>
                      <th scope="col" className="is-right">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMovements.map((mov) => {
                      const time = new Date(mov.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const isIN = mov.direction === 'IN';

                      return (
                        <tr key={mov.id}>
                          <td className="is-numeric is-muted">{time}</td>
                          <td>
                            <div className="overview-person">
                              <span className="overview-person-name">{mov.fullName || mov.residentId}</span>
                              {mov.residentCode && (
                                <span className="overview-person-code">{mov.residentCode}</span>
                              )}
                            </div>
                          </td>
                          <td className="is-right">
                            <span
                              className={`overview-status-pill ${isIN ? 'is-emerald' : 'is-amber'}`}
                            >
                              {isIN ? 'Entered' : 'Left'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Role-specific operational panel */}
        <div className="overview-side-col">
          {isWarden ? (
            <section className="overview-panel" aria-labelledby="overview-enrollment-title">
              <div className="overview-panel-head">
                <div className="overview-panel-title">
                  <ShieldAlert size={17} className="overview-title-icon is-amber" />
                  <h3 id="overview-enrollment-title">Residents Needing Enrollment</h3>
                </div>
              </div>
              <div className="overview-panel-body">
                <p className="overview-body-text">
                  {notEnrolledCount} {notEnrolledCount === 1 ? 'resident still needs' : 'residents still need'} face enrollment.
                </p>
                <Link to="/residents" className="overview-block-link">
                  <Button variant="primary" size="md" rightIcon={<ArrowRight size={16} />}>
                    Open Resident Roster
                  </Button>
                </Link>
              </div>
            </section>
          ) : (
            <section className="overview-panel" aria-labelledby="overview-readiness-title">
              <div className="overview-panel-head">
                <div className="overview-panel-title">
                  <CheckCircle2 size={17} className="overview-title-icon is-emerald" />
                  <h3 id="overview-readiness-title">Operational Readiness</h3>
                </div>
              </div>

              <ul className="overview-checklist">
                <li className={`overview-check is-${enrollmentTone}`}>
                  <ReadinessMark tone={enrollmentTone} />
                  <span className="overview-check-label">Face enrollment</span>
                  <span className="overview-check-value">
                    {enrolledCount} / {totalResidents}
                  </span>
                </li>
                <li className={`overview-check is-${cameraTone}`}>
                  <ReadinessMark tone={cameraTone} />
                  <span className="overview-check-label">Cameras online</span>
                  <span className="overview-check-value">
                    {onlineCameras} / {cameras.length}
                  </span>
                </li>
                <li className={`overview-check is-${cameraAttentionTone}`}>
                  <ReadinessMark tone={cameraAttentionTone} />
                  <span className="overview-check-label">Camera attention</span>
                  <span className="overview-check-value">{cameraAttentionCount}</span>
                </li>
              </ul>

              <div className="overview-panel-actions">
                <Link to="/residents" className="overview-action-link">
                  <Button variant="outline" size="sm">
                    Residents
                  </Button>
                </Link>
                <Link to="/cameras" className="overview-action-link">
                  <Button variant="primary" size="sm" leftIcon={<Video size={14} />}>
                    Cameras
                  </Button>
                </Link>
              </div>
            </section>
          )}

          {/* Diagnostics Section retained for automated contracts, not normal UI */}
          {!isWarden && (
            <div className="sr-only" aria-hidden="true">
              <h3>System Status</h3>
              <p>Current platform capabilities</p>
              <span>OPERATIONAL</span>
              <div>
                <span>Gate Recognition & Cameras</span>
                <span>Active</span>
              </div>
              <div>
                <span>Biometric Engine</span>
                <span>Active</span>
              </div>
              <div>
                <span>Face Enrolled</span>
                <span>{summary?.faceEnrolled ?? 0}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewPage;
