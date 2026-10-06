import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { Badge } from '../components/Badge';
import { AttendanceTrendChart } from '../components/AttendanceTrendChart';
import { reportsApi } from '../api/reports.api';
import { residentsApi } from '../api/residents.api';
import {
  AttendanceSessionReportItem,
  AttendanceReportSummary,
  SessionRosterReport,
  AttendanceTrendPoint,
  MovementReportItem,
  PresenceSummaryReport,
  CurrentlyOutsideReportItem,
  ResidentSummaryReport,
} from '../types/reports.types';
import { SafeResident } from '../types/resident.types';
import {
  FileText,
  Calendar,
  ArrowRightLeft,
  Users,
  Download,
  Search,
  Eye,
  LogIn,
  LogOut,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

type ReportTab = 'attendance' | 'movement' | 'residents';

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const isGuard = user?.role === 'GUARD';

  const [activeTab, setActiveTab] = useState<ReportTab>('movement');

  // ----------------------------------------------------
  // ATTENDANCE TAB STATE
  // ----------------------------------------------------
  const [attDateRange, setAttDateRange] = useState<string>('last7');
  const [attCustomFrom, setAttCustomFrom] = useState<string>('');
  const [attCustomTo, setAttCustomTo] = useState<string>('');
  const [attSessions, setAttSessions] = useState<AttendanceSessionReportItem[]>([]);
  const [attSummary, setAttSummary] = useState<AttendanceReportSummary | null>(null);
  const [attPage, setAttPage] = useState<number>(1);
  const [attPageSize] = useState<number>(15);
  const [attTotal, setAttTotal] = useState<number>(0);
  const [attTotalPages, setAttTotalPages] = useState<number>(1);
  const [attTrend, setAttTrend] = useState<AttendanceTrendPoint[]>([]);
  const [attLoading, setAttLoading] = useState<boolean>(false);
  const [attError, setAttError] = useState<string | null>(null);

  // Session Roster Modal State
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionRosterData, setSessionRosterData] = useState<SessionRosterReport | null>(null);
  const [rosterLoading, setRosterLoading] = useState<boolean>(false);
  const [rosterStatusFilter, setRosterStatusFilter] = useState<string>('ALL');
  const [rosterSearch, setRosterSearch] = useState<string>('');

  // ----------------------------------------------------
  // MOVEMENT TAB STATE
  // ----------------------------------------------------
  const [movDateRange, setMovDateRange] = useState<string>('today');
  const [movCustomFrom, setMovCustomFrom] = useState<string>('');
  const [movCustomTo, setMovCustomTo] = useState<string>('');
  const [movDirection, setMovDirection] = useState<string>('ALL');
  const [movSearch, setMovSearch] = useState<string>('');
  const [movPage, setMovPage] = useState<number>(1);
  const [movPageSize] = useState<number>(15);
  const [movTotal, setMovTotal] = useState<number>(0);
  const [movTotalPages, setMovTotalPages] = useState<number>(1);
  const [movements, setMovements] = useState<MovementReportItem[]>([]);
  const [movLoading, setMovLoading] = useState<boolean>(false);
  const [movError, setMovError] = useState<string | null>(null);

  // Presence State (authoritative)
  const [presenceSummary, setPresenceSummary] = useState<PresenceSummaryReport | null>(null);
  const [showOutsideModal, setShowOutsideModal] = useState<boolean>(false);
  const [outsideList, setOutsideList] = useState<CurrentlyOutsideReportItem[]>([]);
  const [outsideLoading, setOutsideLoading] = useState<boolean>(false);

  // ----------------------------------------------------
  // RESIDENT SUMMARY TAB STATE
  // ----------------------------------------------------
  const [residentSearch, setResidentSearch] = useState<string>('');
  const [residentSearchResults, setResidentSearchResults] = useState<SafeResident[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [residentSummary, setResidentSummary] = useState<ResidentSummaryReport | null>(null);
  const [resSummaryLoading, setResSummaryLoading] = useState<boolean>(false);
  const [resSummaryError, setResSummaryError] = useState<string | null>(null);

  // Calculate Date Ranges
  const getDateRangeParams = (range: string, customFrom: string, customTo: string) => {
    const today = new Date().toISOString().split('T')[0];
    if (range === 'today') {
      return { dateFrom: `${today}T00:00:00.000Z`, dateTo: `${today}T23:59:59.999Z` };
    }
    if (range === 'last7') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { dateFrom: d.toISOString(), dateTo: new Date().toISOString() };
    }
    if (range === 'last30') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { dateFrom: d.toISOString(), dateTo: new Date().toISOString() };
    }
    if (range === 'custom' && (customFrom || customTo)) {
      return {
        dateFrom: customFrom ? `${customFrom}T00:00:00.000Z` : undefined,
        dateTo: customTo ? `${customTo}T23:59:59.999Z` : undefined,
      };
    }
    return {};
  };

  // ----------------------------------------------------
  // FETCH ATTENDANCE DATA
  // ----------------------------------------------------
  const fetchAttendanceReport = useCallback(async () => {
    setAttLoading(true);
    setAttError(null);
    try {
      const { dateFrom, dateTo } = getDateRangeParams(attDateRange, attCustomFrom, attCustomTo);

      const [sessionsRes, trendRes] = await Promise.all([
        reportsApi.getAttendanceSessions({
          dateFrom,
          dateTo,
          page: attPage,
          pageSize: attPageSize,
        }),
        !isGuard ? reportsApi.getAttendanceTrend({ dateFrom, dateTo }) : Promise.resolve({ data: [] }),
      ]);

      setAttSessions(sessionsRes.data);
      setAttSummary(sessionsRes.summary);
      setAttTotal(sessionsRes.total);
      setAttTotalPages(sessionsRes.totalPages);
      setAttTrend(trendRes.data);
    } catch (err: any) {
      setAttError(err.message || 'Unable to load attendance report. Please try again.');
    } finally {
      setAttLoading(false);
    }
  }, [attDateRange, attCustomFrom, attCustomTo, attPage, attPageSize, isGuard]);

  // Fetch Session Roster Details
  const fetchSessionRoster = useCallback(
    async (sessionId: string) => {
      setRosterLoading(true);
      try {
        const data = await reportsApi.getSessionRoster(sessionId, {
          status: rosterStatusFilter,
          search: rosterSearch,
        });
        setSessionRosterData(data);
      } catch (err: any) {
        toastError(err.message || 'Failed to load session roster.');
      } finally {
        setRosterLoading(false);
      }
    },
    [rosterStatusFilter, rosterSearch, toastError]
  );

  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionRoster(selectedSessionId);
    }
  }, [selectedSessionId, fetchSessionRoster]);

  // ----------------------------------------------------
  // FETCH MOVEMENT DATA & PRESENCE
  // ----------------------------------------------------
  const fetchMovementReport = useCallback(async () => {
    setMovLoading(true);
    setMovError(null);
    try {
      const { dateFrom, dateTo } = getDateRangeParams(movDateRange, movCustomFrom, movCustomTo);
      const dir = movDirection === 'ALL' ? undefined : movDirection;

      const [movRes, presRes] = await Promise.all([
        reportsApi.getMovements({
          dateFrom,
          dateTo,
          direction: dir,
          search: movSearch || undefined,
          page: movPage,
          pageSize: movPageSize,
        }),
        reportsApi.getPresence(),
      ]);

      setMovements(movRes.data);
      setMovTotal(movRes.total);
      setMovTotalPages(movRes.totalPages);
      setPresenceSummary(presRes);
    } catch (err: any) {
      setMovError(err.message || 'Unable to load movement history. Please try again.');
    } finally {
      setMovLoading(false);
    }
  }, [movDateRange, movCustomFrom, movCustomTo, movDirection, movSearch, movPage, movPageSize]);

  // Fetch Currently Outside List
  const fetchCurrentlyOutside = async () => {
    setOutsideLoading(true);
    try {
      const res = await reportsApi.getCurrentlyOutside();
      setOutsideList(res.data);
      setShowOutsideModal(true);
    } catch (err: any) {
      toastError(err.message || 'Failed to load currently outside list.');
    } finally {
      setOutsideLoading(false);
    }
  };

  // ----------------------------------------------------
  // FETCH RESIDENT SUMMARY
  // ----------------------------------------------------
  const searchResidents = async (query: string) => {
    if (!query || query.trim().length === 0) {
      setResidentSearchResults([]);
      return;
    }
    try {
      const res = await residentsApi.getResidents({ search: query, pageSize: 8 });
      setResidentSearchResults(res.data);
    } catch {
      // Ignore search errors in typing
    }
  };

  const loadResidentReport = async (residentId: string) => {
    setSelectedResidentId(residentId);
    setResSummaryLoading(true);
    setResSummaryError(null);
    try {
      const data = await reportsApi.getResidentSummary(residentId);
      setResidentSummary(data);
    } catch (err: any) {
      setResSummaryError(err.message || 'Unable to load resident summary report.');
    } finally {
      setResSummaryLoading(false);
    }
  };

  // Initial Load on Tab Change
  useEffect(() => {
    if (activeTab === 'attendance') {
      fetchAttendanceReport();
    } else if (activeTab === 'movement') {
      fetchMovementReport();
    }
  }, [activeTab, fetchAttendanceReport, fetchMovementReport]);

  const movementSourceLabel = (source?: string | null) => {
    if (!source) return 'System';
    if (source === 'FACE_RECOGNITION') return 'Camera Recognition';
    if (source === 'GUARD_CONFIRMATION') return 'Guard Confirmation';
    if (source === 'WARDEN_CORRECTION') return 'Staff Correction';
    if (source === 'MANUAL') return 'Manual Entry';
    return source
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  // ----------------------------------------------------
  // EXPORT HANDLERS
  // ----------------------------------------------------
  const handleExportAttendance = async () => {
    try {
      const { dateFrom, dateTo } = getDateRangeParams(attDateRange, attCustomFrom, attCustomTo);
      await reportsApi.downloadAttendanceCsv({ dateFrom, dateTo });
      success('Attendance CSV exported successfully.');
    } catch (err: any) {
      toastError(err.message || 'Failed to export attendance CSV.');
    }
  };

  const handleExportMovement = async () => {
    try {
      const { dateFrom, dateTo } = getDateRangeParams(movDateRange, movCustomFrom, movCustomTo);
      const dir = movDirection === 'ALL' ? undefined : movDirection;
      await reportsApi.downloadMovementCsv({ dateFrom, dateTo, direction: dir });
      success('Movement CSV exported successfully.');
    } catch (err: any) {
      toastError(err.message || 'Failed to export movement CSV.');
    }
  };

  // Attendance Aggregates for Cards (Authoritative Server-side Summary across all matching rows)
  const totalSessionsCount = attSummary?.sessions ?? 0;
  const avgAttendanceRate = attSummary?.attendanceRate ?? 0;
  const totalPresentResidents = attSummary?.present ?? 0;
  const totalAbsentResidents = attSummary?.absent ?? 0;

  return (
    <div className="reports-page">
      <PageHeader
        title="Reports"
        subtitle="Live presence, gate movement history, corrected events, and resident movement summaries."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab === 'movement') fetchMovementReport();
                if (activeTab === 'residents' && selectedResidentId) loadResidentReport(selectedResidentId);
              }}
              leftIcon={<RefreshCw size={14} />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Primary Tab Navigation */}
      <div className="reports-tab-nav mb-6 flex border-b border-border" role="tablist" aria-label="Report sections">
        <button
          type="button"
          className={`tab-btn px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'movement'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
          onClick={() => setActiveTab('movement')}
          role="tab"
          aria-selected={activeTab === 'movement'}
        >
          <ArrowRightLeft size={16} />
          <span>Presence & Movement</span>
        </button>

        <button
          type="button"
          className={`tab-btn px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'residents'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
          onClick={() => setActiveTab('residents')}
          role="tab"
          aria-selected={activeTab === 'residents'}
        >
          <Users size={16} />
          <span>Residents</span>
        </button>
      </div>

      {/* ==================================================== */}
      {/* 1. ATTENDANCE TAB */}
      {/* ==================================================== */}
      {activeTab === 'attendance' && (
        <div className="tab-pane-attendance">
          {/* Filter Bar */}
          <div className="report-filter-bar mb-6 p-4 bg-surface border border-border rounded-lg flex flex-wrap gap-4 items-end justify-between">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="filter-group">
                <label className="block text-xs font-semibold text-secondary mb-1">Date Range</label>
                <div className="flex gap-1">
                  {[
                    { key: 'today', label: 'Today' },
                    { key: 'last7', label: 'Last 7 Days' },
                    { key: 'last30', label: 'Last 30 Days' },
                    { key: 'custom', label: 'Custom' },
                  ].map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`btn-filter px-3 py-1.5 text-xs rounded border transition-colors ${
                        attDateRange === r.key
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-secondary border-border hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setAttDateRange(r.key);
                        setAttPage(1);
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {attDateRange === 'custom' && (
                <div className="flex gap-2 items-center">
                  <div>
                    <label className="block text-xs text-secondary mb-1">From</label>
                    <input
                      type="date"
                      className="input-field text-xs py-1.5 px-2 border border-border rounded"
                      value={attCustomFrom}
                      onChange={(e) => {
                        setAttCustomFrom(e.target.value);
                        setAttPage(1);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-secondary mb-1">To</label>
                    <input
                      type="date"
                      className="input-field text-xs py-1.5 px-2 border border-border rounded"
                      value={attCustomTo}
                      onChange={(e) => {
                        setAttCustomTo(e.target.value);
                        setAttPage(1);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {!isGuard && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAttendance}
                leftIcon={<Download size={14} />}
              >
                Export CSV
              </Button>
            )}
          </div>

          {/* Overview Cards */}
          <div className="metrics-grid mb-6">
            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Sessions</span>
                <div className="metric-icon-wrap icon-blue">
                  <Calendar size={18} />
                </div>
              </div>
              <div className="metric-value">
                {attLoading ? '...' : totalSessionsCount}
              </div>
              <div className="metric-footer">
                <span>In selected reporting window</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Attendance Rate</span>
                <div className="metric-icon-wrap icon-emerald">
                  <CheckCircle size={18} />
                </div>
              </div>
              <div className="metric-value text-emerald">
                {attLoading ? '...' : `${avgAttendanceRate}%`}
              </div>
              <div className="metric-footer">
                <span>Average across completed sessions</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Total Present</span>
                <div className="metric-icon-wrap icon-green">
                  <CheckCircle size={18} />
                </div>
              </div>
              <div className="metric-value">
                {attLoading ? '...' : totalPresentResidents}
              </div>
              <div className="metric-footer">
                <span>Verified attendances marked</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Total Absent</span>
                <div className="metric-icon-wrap icon-amber">
                  <XCircle size={18} />
                </div>
              </div>
              <div className="metric-value text-amber">
                {attLoading ? '...' : totalAbsentResidents}
              </div>
              <div className="metric-footer">
                <span>Absences logged on session close</span>
              </div>
            </Card>
          </div>

          {/* Attendance Trend Chart (Guard restricted) */}
          {!isGuard && (
            <Card title="Attendance Trend" subtitle="Daily attendance percentage over time" className="mb-6">
              {attLoading ? (
                <p className="text-sm text-muted py-6 text-center">Loading attendance trend...</p>
              ) : (
                <AttendanceTrendChart data={attTrend} />
              )}
            </Card>
          )}

          {/* Attendance Sessions History Table */}
          <Card title="Attendance Sessions" subtitle="Historical record of attendance sessions">
            {attError && (
              <div className="alert-banner alert-banner-error mb-4" role="alert">
                <AlertCircle size={18} />
                <span>{attError}</span>
              </div>
            )}

            {attLoading ? (
              <p className="text-sm text-muted py-6 text-center">Loading attendance...</p>
            ) : attSessions.length === 0 ? (
              <p className="text-sm text-muted py-8 text-center">
                No attendance sessions found for this period.
              </p>
            ) : (
              <>
                <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Session</th>
                      <th>Status</th>
                      <th>Expected</th>
                      <th>Present</th>
                      <th>Absent</th>
                      <th>Attendance Rate</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attSessions.map((session) => (
                      <tr key={session.id}>
                        <td className="font-medium">
                          {session.attendanceDate.split('T')[0]}
                        </td>
                        <td>{session.title}</td>
                        <td>
                          <span
                            className={`badge badge-sm badge-${
                              session.status === 'CLOSED'
                                ? 'success'
                                : session.status === 'ACTIVE'
                                ? 'info'
                                : 'neutral'
                            }`}
                          >
                            {session.status}
                          </span>
                        </td>
                        <td>{session.expectedResidents}</td>
                        <td className="text-emerald font-semibold">{session.presentCount}</td>
                        <td className={session.absentCount > 0 ? 'text-amber font-semibold' : ''}>
                          {session.isFinalized ? session.absentCount : `— (${session.remainingCount} remaining)`}
                        </td>
                        <td className="font-bold">{session.attendanceRate}%</td>
                        <td>
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Eye size={12} />}
                            onClick={() => setSelectedSessionId(session.id)}
                          >
                            View Roster
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end">
                <Pagination
                  currentPage={attPage}
                  totalPages={attTotalPages}
                  totalItems={attTotal}
                  pageSize={attPageSize}
                  onPageChange={(page) => setAttPage(page)}
                  itemLabel="attendance records"
                />
              </div>
            </>
            )}
          </Card>
        </div>
      )}

      {/* ==================================================== */}
      {/* 2. MOVEMENT TAB */}
      {/* ==================================================== */}
      {activeTab === 'movement' && (
        <div className="tab-pane-movement">
          {/* Current Presence Cards */}
          <div className="metrics-grid mb-6">
            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Currently Inside</span>
                <div className="metric-icon-wrap icon-emerald">
                  <LogIn size={18} />
                </div>
              </div>
              <div className="metric-value text-emerald">
                {presenceSummary?.insideCount ?? 0}
              </div>
              <div className="metric-footer flex flex-col gap-3 items-start">
                <span>{presenceSummary?.insideRate ?? 0}% of residents in hostel</span>
                <Button
                  size="md"
                  variant="outline"
                  onClick={() => setActiveTab('residents')}
                  leftIcon={<Users size={15} />}
                >
                  Browse Residents
                </Button>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Currently Outside</span>
                <div className="metric-icon-wrap icon-amber">
                  <LogOut size={18} />
                </div>
              </div>
              <div className="metric-value text-amber">
                {presenceSummary?.outsideCount ?? 0}
              </div>
              <div className="metric-footer flex flex-col gap-3 items-start">
                <span>{presenceSummary?.outsideRate ?? 0}% outside premises</span>
                <Button
                  size="md"
                  variant="outline"
                  onClick={fetchCurrentlyOutside}
                  isLoading={outsideLoading}
                  leftIcon={<Eye size={15} />}
                >
                  View Outside Residents
                </Button>
              </div>
            </Card>
          </div>

          {/* Movement Filters */}
          <div className="report-filter-bar mb-6 p-4 bg-surface border border-border rounded-lg flex flex-wrap gap-4 items-end justify-between">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="filter-group">
                <label className="block text-xs font-semibold text-secondary mb-1">Date Range</label>
                <div className="flex gap-1">
                  {[
                    { key: 'today', label: 'Today' },
                    { key: 'last7', label: 'Last 7 Days' },
                    { key: 'custom', label: 'Custom' },
                  ].map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`btn-filter px-3 py-1.5 text-xs rounded border transition-colors ${
                        movDateRange === r.key
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-secondary border-border hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setMovDateRange(r.key);
                        setMovPage(1);
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <label className="block text-xs font-semibold text-secondary mb-1">Movement</label>
                <select
                  className="input-field text-xs py-1.5 px-3 border border-border rounded"
                  value={movDirection}
                  onChange={(e) => {
                    setMovDirection(e.target.value);
                    setMovPage(1);
                  }}
                >
                  <option value="ALL">All movement</option>
                  <option value="IN">Entered hostel</option>
                  <option value="OUT">Left hostel</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="block text-xs font-semibold text-secondary mb-1">Resident Search</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search name or code..."
                    className="input-field text-xs py-1.5 pl-8 pr-3 border border-border rounded"
                    value={movSearch}
                    onChange={(e) => {
                      setMovSearch(e.target.value);
                      setMovPage(1);
                    }}
                  />
                  <Search size={14} className="absolute left-2.5 top-2 text-muted" />
                </div>
              </div>

              {movDateRange === 'custom' && (
                <div className="flex gap-2 items-center">
                  <div>
                    <label className="block text-xs text-secondary mb-1">From</label>
                    <input
                      type="date"
                      className="input-field text-xs py-1.5 px-2 border border-border rounded"
                      value={movCustomFrom}
                      onChange={(e) => {
                        setMovCustomFrom(e.target.value);
                        setMovPage(1);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-secondary mb-1">To</label>
                    <input
                      type="date"
                      className="input-field text-xs py-1.5 px-2 border border-border rounded"
                      value={movCustomTo}
                      onChange={(e) => {
                        setMovCustomTo(e.target.value);
                        setMovPage(1);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {!isGuard && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportMovement}
                leftIcon={<Download size={14} />}
              >
                Export CSV
              </Button>
            )}
          </div>

          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Current presence is derived from the latest verified entry or exit. Staff corrections remain clearly marked for audit.
          </div>

          {/* Movement Table */}
          <Card title="Movement History" subtitle="Verified hostel entry and exit events">
            {movError && (
              <div className="alert-banner alert-banner-error mb-4" role="alert">
                <AlertCircle size={18} />
                <span>{movError}</span>
              </div>
            )}

            {movLoading ? (
              <p className="text-sm text-muted py-8 text-center">Loading movement history...</p>
            ) : movements.length === 0 ? (
              <div className="py-10 text-center">
                <ArrowRightLeft size={28} className="mx-auto text-slate-300 mb-3" />
                <p className="text-base font-semibold text-slate-700">No movement records found</p>
                <p className="text-sm text-slate-500 mt-1">
                  Try a wider date range or clear the resident search.
                </p>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Resident Code</th>
                        <th>Name</th>
                        <th>Room</th>
                        <th>Movement</th>
                        <th>Gate</th>
                        <th>Recorded By</th>
                        <th>Record Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((ev) => (
                        <tr key={ev.id}>
                          <td className="font-mono text-xs">
                            {new Date(ev.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="font-medium">{ev.residentCode}</td>
                          <td>{ev.fullName}</td>
                          <td>{ev.roomGroup}</td>
                          <td>
                            <span
                              className={`badge badge-sm badge-${
                                ev.direction === 'IN' ? 'success' : 'amber'
                              }`}
                            >
                              {ev.direction === 'IN' ? 'Entered' : 'Left'}
                            </span>
                          </td>
                          <td>{ev.gateName}</td>
                          <td className="text-xs text-secondary">{movementSourceLabel(ev.source)}</td>
                          <td>
                            {ev.isCorrection ? (
                              <span className="badge badge-sm badge-info">Corrected</span>
                            ) : (
                              <span className="badge badge-sm badge-neutral">Verified</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex justify-end">
                  <Pagination
                    currentPage={movPage}
                    totalPages={movTotalPages}
                    totalItems={movTotal}
                    pageSize={movPageSize}
                    onPageChange={(page) => setMovPage(page)}
                    itemLabel="movement records"
                  />
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ==================================================== */}
      {/* 3. RESIDENTS SUMMARY TAB */}
      {/* ==================================================== */}
      {activeTab === 'residents' && (
        <div className="tab-pane-residents">
          {isGuard ? (
            <Card title="Resident Reports Access Restricted">
              <div className="p-6 text-center">
                <ShieldAlert size={36} className="mx-auto text-amber mb-3" />
                <h4 className="text-base font-semibold mb-1">Access Restricted</h4>
                <p className="text-sm text-secondary max-w-md mx-auto">
                  Guards are authorized for real-time presence verification and gate monitoring. Individual historical resident summaries are restricted to Wardens and Administrators.
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* Resident Search Bar */}
              <div className="resident-search-bar mb-6 p-4 bg-surface border border-border rounded-lg">
                <label className="block text-xs font-semibold text-secondary mb-2">
                  Select Resident to Inspect
                </label>
                <div className="relative max-w-md">
                  <input
                    type="text"
                    placeholder="Type name or resident code..."
                    className="input-field text-sm py-2 pl-9 pr-4 w-full border border-border rounded"
                    value={residentSearch}
                    onChange={(e) => {
                      setResidentSearch(e.target.value);
                      searchResidents(e.target.value);
                    }}
                  />
                  <Search size={16} className="absolute left-3 top-2.5 text-muted" />

                  {/* Dropdown Suggestions */}
                  {residentSearchResults.length > 0 && (
                    <div className="resident-autocomplete-dropdown absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded shadow-lg z-20 max-h-60 overflow-y-auto">
                      {residentSearchResults.map((r) => (
                        <div
                          key={r.id}
                          className="autocomplete-item p-2.5 hover:bg-surface-hover cursor-pointer border-b border-border last:border-none flex justify-between items-center"
                          onClick={() => {
                            setResidentSearch(`${r.fullName} (${r.residentCode})`);
                            setResidentSearchResults([]);
                            loadResidentReport(r.id);
                          }}
                        >
                          <div>
                            <span className="font-medium text-sm">{r.fullName}</span>
                            <span className="text-xs text-secondary ml-2">({r.residentCode})</span>
                          </div>
                          <span className="text-xs text-muted">Room {r.roomGroup}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {resSummaryLoading ? (
                <p className="text-sm text-muted py-8 text-center">Loading resident summary...</p>
              ) : resSummaryError ? (
                <div className="alert-banner alert-banner-error mb-4" role="alert">
                  <AlertCircle size={18} />
                  <span>{resSummaryError}</span>
                </div>
              ) : !residentSummary ? (
                <Card>
                  <div className="py-12 text-center text-muted">
                    <Users size={36} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No resident selected. Search above to view summary.</p>
                  </div>
                </Card>
              ) : (
                <div className="resident-summary-content space-y-6">
                  {/* Resident Header Profile Card */}
                  <Card>
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-bold">{residentSummary.fullName}</h3>
                          <Badge type="status" value={residentSummary.status} />
                        </div>
                        <p className="text-sm text-secondary mt-1">
                          Code: <span className="font-semibold">{residentSummary.residentCode}</span> · Room: <span className="font-semibold">{residentSummary.roomGroup}</span> · Hostel: <span className="font-semibold">{residentSummary.hostelName}</span>
                        </p>
                      </div>

                      <div className="flex gap-4 items-center">
                        <div className="text-right">
                          <span className="text-xs text-secondary block">Current Presence</span>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              residentSummary.currentPresence === 'IN'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {residentSummary.currentPresence === 'IN' ? 'Inside Hostel' : 'Outside Hostel'}
                          </span>
                        </div>
                        <div className="text-right border-l border-border pl-4">
                          <span className="text-xs text-secondary block">Last Movement</span>
                          <span className="text-sm font-semibold text-primary">
                            {residentSummary.lastMovementDirection || 'No movement'}
                          </span>
                          <span className="text-xs text-muted block">
                            {residentSummary.lastMovementTime
                              ? new Date(residentSummary.lastMovementTime).toLocaleString()
                              : 'No movement recorded'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 gap-6">
                    <Card title="Movement Timeline" subtitle="Recent verified gate movements">
                      {residentSummary.recentMovements.length === 0 ? (
                        <p className="text-xs text-muted py-4">No gate movements found.</p>
                      ) : (
                        <div className="table-responsive">
                          <table className="data-table text-xs">
                            <thead>
                              <tr>
                                <th>Time</th>
                                <th>Direction</th>
                                <th>Gate</th>
                                <th>Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {residentSummary.recentMovements.map((mov) => (
                                <tr key={mov.id}>
                                  <td className="font-mono">
                                    {new Date(mov.timestamp).toLocaleDateString()} {' '}
                                    {new Date(mov.timestamp).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </td>
                                  <td>
                                    <span
                                      className={`badge badge-sm badge-${
                                        mov.direction === 'IN' ? 'success' : 'amber'
                                      }`}
                                    >
                                      {mov.direction === 'IN' ? 'Entered' : 'Left'}
                                    </span>
                                  </td>
                                  <td>{mov.gateName}</td>
                                  <td className="text-muted">{movementSourceLabel(mov.source)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==================================================== */}
      {/* SESSION ROSTER MODAL */}
      {/* ==================================================== */}
      {selectedSessionId && (
        <Modal
          isOpen={Boolean(selectedSessionId)}
          onClose={() => {
            setSelectedSessionId(null);
            setSessionRosterData(null);
          }}
          title={sessionRosterData ? sessionRosterData.session.title : 'Session Roster'}
          size="lg"
        >
          {rosterLoading ? (
            <p className="text-sm text-muted py-8 text-center">Loading session roster...</p>
          ) : !sessionRosterData ? (
            <p className="text-sm text-muted py-8 text-center">Unable to load session data.</p>
          ) : (
            <div className="session-roster-modal-content space-y-4">
              {/* Session Meta Stats */}
              <div className="grid grid-cols-4 gap-2 p-3 bg-surface-subtle rounded border border-border text-center text-xs">
                <div>
                  <span className="text-secondary block">Expected</span>
                  <span className="font-bold text-sm">{sessionRosterData.stats.expectedResidents}</span>
                </div>
                <div>
                  <span className="text-secondary block">Present</span>
                  <span className="font-bold text-sm text-emerald">
                    {sessionRosterData.stats.presentCount}
                  </span>
                </div>
                <div>
                  <span className="text-secondary block">Absent</span>
                  <span className="font-bold text-sm text-amber">
                    {sessionRosterData.session.isFinalized
                      ? sessionRosterData.stats.absentCount
                      : `${sessionRosterData.stats.remainingCount} remaining`}
                  </span>
                </div>
                <div>
                  <span className="text-secondary block">Rate</span>
                  <span className="font-bold text-sm text-primary">
                    {sessionRosterData.stats.attendanceRate}%
                  </span>
                </div>
              </div>

              {/* Roster Filters */}
              <div className="flex justify-between items-center gap-4">
                <div className="flex gap-2">
                  {['ALL', 'PRESENT', 'ABSENT'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                        rosterStatusFilter === status
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-secondary border-border hover:bg-surface-hover'
                      }`}
                      onClick={() => setRosterStatusFilter(status)}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search roster..."
                    className="input-field text-xs py-1 pl-7 pr-2 border border-border rounded"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                  />
                  <Search size={12} className="absolute left-2 top-2 text-muted" />
                </div>
              </div>

              {/* Roster Table */}
              <div className="table-responsive max-h-96 overflow-y-auto">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>Resident Code</th>
                      <th>Name</th>
                      <th>Room</th>
                      <th>Status</th>
                      <th>Marked At</th>
                      <th>Method</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionRosterData.roster.map((item) => (
                      <tr key={item.residentId}>
                        <td className="font-medium">{item.residentCode}</td>
                        <td>{item.fullName}</td>
                        <td>{item.roomGroup}</td>
                        <td>
                          <span
                            className={`badge badge-sm badge-${
                              item.status === 'PRESENT' || item.status === 'CORRECTED_PRESENT'
                                ? 'success'
                                : item.status === 'ABSENT'
                                ? 'amber'
                                : 'neutral'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="font-mono text-muted">
                          {item.markedAt
                            ? new Date(item.markedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="text-muted">{item.markMethod || '—'}</td>
                        <td>
                          {item.isCorrected ? (
                            <span
                              className="badge badge-sm badge-info"
                              title={item.correctionReason || 'Manual override'}
                            >
                              Corrected
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ==================================================== */}
      {/* CURRENTLY OUTSIDE MODAL */}
      {/* ==================================================== */}
      {showOutsideModal && (
        <Modal
          isOpen={showOutsideModal}
          onClose={() => setShowOutsideModal(false)}
          title="Residents Currently Outside Hostel"
          size="lg"
        >
          {outsideList.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              All residents are currently inside the hostel.
            </p>
          ) : (
            <div className="table-responsive max-h-96 overflow-y-auto">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Resident Code</th>
                    <th>Name</th>
                    <th>Room</th>
                    <th>Exit Time</th>
                    <th>Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {outsideList.map((item) => (
                    <tr key={item.residentId}>
                      <td className="font-medium">{item.residentCode}</td>
                      <td>{item.fullName}</td>
                      <td>{item.roomGroup}</td>
                      <td className="font-mono text-muted">
                        {item.lastMovementTime
                          ? new Date(item.lastMovementTime).toLocaleString([], {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td>{item.gateName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
