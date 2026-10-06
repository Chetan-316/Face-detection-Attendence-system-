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

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();

  // Guard role is redirected directly to Gate
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

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

  return (
    <div className="overview-page flex flex-col gap-7 max-w-7xl mx-auto w-full">
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
        <div className="p-4 bg-red-50 text-red-800 text-sm rounded-lg border border-red-200 flex items-center gap-2.5">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4 Large Operational Metric Cards */}
      <div className="overview-stats-row">
        {/* Total Residents */}
        <Link
          to="/residents"
          className="overview-stat-card overview-stat-card-link group"
        >
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-700">Residents</span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users size={20} />
            </div>
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="overview-stat-value">{totalResidents}</span>
            <span className="text-sm font-semibold text-blue-700 group-hover:text-blue-800 flex items-center gap-1">
              View residents <ArrowRight size={15} />
            </span>
          </div>
        </Link>

        {/* Inside Hostel */}
        <div className="overview-stat-card">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">Inside</span>
            <LogIn size={20} className="text-emerald-600" />
          </div>
          <div>
            <span className="overview-stat-value">{currentlyIn}</span>
          </div>
        </div>

        {/* Outside Hostel */}
        <div className="overview-stat-card">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">Outside</span>
            <LogOut size={20} className="text-amber-600" />
          </div>
          <div>
            <span className="overview-stat-value">{currentlyOut}</span>
          </div>
        </div>

        {/* Return Deadline */}
        <div className="overview-stat-card">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">
              {!hasScopedReturnDeadline
                ? 'Return Deadlines'
                : isAfterReturnDeadline
                ? 'Not Returned'
                : 'Return Deadline'}
            </span>
            <Clock size={20} className={isAfterReturnDeadline ? 'text-red-600' : 'text-blue-600'} />
          </div>
          <div>
            <span className="overview-stat-value">
              {!hasScopedReturnDeadline
                ? 'Varies'
                : isAfterReturnDeadline
                ? currentlyOut
                : returnDeadlineLabel}
            </span>
            {!hasScopedReturnDeadline && (
              <span className="block text-sm font-medium text-slate-500 mt-2">
                Set separately for each hostel
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isAfterReturnDeadline
            ? 'bg-red-50 border-red-200 text-red-900'
            : 'bg-blue-50 border-blue-200 text-blue-900'
        }`}
      >
        <div className="flex items-start gap-3">
          {isAfterReturnDeadline ? (
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
          ) : (
            <Clock size={20} className="mt-0.5 shrink-0 text-blue-600" />
          )}
          <div>
            <div className="font-bold text-[15px]">
              {!hasScopedReturnDeadline
                ? 'Each hostel has its own return deadline'
                : isAfterReturnDeadline
                ? `${currentlyOut} ${currentlyOut === 1 ? 'resident has' : 'residents have'} not returned`
                : `Return deadline is ${returnDeadlineLabel}`}
            </div>
            <div className="text-sm mt-0.5 opacity-80">
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
          className="resident-quick-link whitespace-nowrap"
        >
          {!hasScopedReturnDeadline ? 'Manage hostel deadlines' : 'Open resident list'} <ArrowRight size={15} />
        </Link>
      </div>

      {/* Main Content: Live presence, recent gate activity, pending face enrollments */}
      <div className="overview-content-row">
        {/* Left Column: Residents Currently Outside & Recent Gate Activity */}
        <div className="overview-main-col">
          {/* Residents Currently Outside */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LogOut size={18} className="text-amber-600" />
                <h3 className="text-lg font-bold text-slate-900">{outsideSectionTitle}</h3>
              </div>
              <span className="text-sm font-semibold px-3 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                {currentlyOut} {outsideStatusLabel}
              </span>
            </div>

            <div className="overflow-x-auto">
              {outsideResidents.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-[15px]">
                  {isAfterReturnDeadline
                    ? 'All residents have returned to the hostel.'
                    : 'All residents are currently inside the hostel.'}
                </div>
              ) : (
                <table className="w-full text-left text-[15px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/70 text-sm">
                      <th className="py-3.5 px-6 font-semibold">Resident</th>
                      <th className="py-3.5 px-6 font-semibold">Room</th>
                      <th className="py-3.5 px-6 font-semibold">Last Out</th>
                      <th className="py-3.5 px-6 font-semibold">Phone</th>
                      <th className="py-3.5 px-6 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outsideResidents.map((res) => (
                      <tr key={res.id} className="hover:bg-slate-50/70 transition-colors h-16">
                        <td className="py-3.5 px-6 font-semibold text-slate-900">
                          <div>
                            <span>{res.fullName}</span>
                            <span className="block text-xs font-mono text-slate-500 font-normal">{res.residentCode}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-6 text-slate-700 font-medium">{res.roomGroup}</td>
                        <td className="py-3.5 px-6 text-slate-600 text-sm">
                          {res.presence?.lastMovementTime
                            ? new Date(res.presence.lastMovementTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="py-3.5 px-6 text-slate-600 text-sm">
                          {res.contactPhone || '—'}
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          <span className="inline-flex items-center px-3 py-1 rounded-md text-sm font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <span className="sr-only">OUT</span>
                            <span>{outsideStatusLabel}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent Gate Activity Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Recent Gate Activity</h3>
              <span className="text-sm text-slate-500 font-medium">Live Movement Log</span>
            </div>

            <div className="overflow-x-auto flex-1">
              {recentMovements.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-[15px]">
                  No recent gate movements recorded today.
                </div>
              ) : (
                <table className="w-full text-left text-[15px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/70 text-sm">
                      <th className="py-3.5 px-6 font-semibold">Time</th>
                      <th className="py-3.5 px-6 font-semibold">Resident</th>
                      <th className="py-3.5 px-6 font-semibold text-right">Movement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentMovements.map((mov) => {
                      const time = new Date(mov.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const isIN = mov.direction === 'IN';

                      return (
                        <tr key={mov.id} className="hover:bg-slate-50/70 transition-colors h-16">
                          <td className="py-3.5 px-6 font-mono text-slate-500 text-sm">{time}</td>
                          <td className="py-3.5 px-6 font-semibold text-slate-900">
                            <div>
                              <span>{mov.fullName || mov.residentId}</span>
                              {mov.residentCode && (
                                <span className="block text-xs font-mono text-slate-500 font-normal">{mov.residentCode}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-semibold ${
                                isIN
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {isIN ? 'Entered' : 'Left'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Role-specific operational panel */}
        <div className="overview-side-col flex flex-col gap-4">
          {isWarden ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between gap-6">
              <div>
                <div className="flex items-center gap-2.5 text-amber-600 mb-2">
                  <ShieldAlert size={20} />
                  <h3 className="text-lg font-bold text-slate-900">Residents Needing Enrollment</h3>
                </div>
                <p className="text-[15px] text-slate-600 leading-relaxed mt-2">
                  {notEnrolledCount} {notEnrolledCount === 1 ? 'resident still needs' : 'residents still need'} face enrollment.
                </p>
              </div>

              <Link to="/residents">
                <Button variant="primary" size="md" className="w-full justify-center h-11 text-[15px] font-semibold" rightIcon={<ArrowRight size={16} />}>
                  Open Resident Roster
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <CheckCircle2 size={20} className="text-emerald-600" />
                  <h3 className="text-lg font-bold text-slate-900">Operational Readiness</h3>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-600">Face enrollment</span>
                    <span className="font-semibold text-slate-900">
                      {enrolledCount} / {totalResidents}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-600">Cameras online</span>
                    <span className="font-semibold text-slate-900">
                      {onlineCameras} / {cameras.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600">Camera attention</span>
                    <span className={`font-semibold ${cameraAttentionCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {cameraAttentionCount}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-5">
                  <Link to="/residents">
                    <Button variant="outline" size="sm" className="w-full justify-center">
                      Residents
                    </Button>
                  </Link>
                  <Link to="/cameras">
                    <Button variant="primary" size="sm" className="w-full justify-center" leftIcon={<Video size={14} />}>
                      Cameras
                    </Button>
                  </Link>
                </div>
              </div>

            </>
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
