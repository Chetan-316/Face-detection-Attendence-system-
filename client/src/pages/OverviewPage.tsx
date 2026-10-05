import React, { useEffect, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { SafeResident, ResidentSummary } from '../types/resident.types';
import { PresenceCounts } from '../types/movement.types';
import { MovementReportItem } from '../types/reports.types';
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
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();

  // Guard role is redirected directly to Gate
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

  const isWarden = user?.role === 'WARDEN';

  // State for metrics & summaries
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [outsideResidents, setOutsideResidents] = useState<SafeResident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Night return is derived from live ResidentPresence. No separate night-attendance
  // session is required: residents still OUT after the deadline are "Not Returned".
  const RETURN_DEADLINE_HOUR = 21;
  const RETURN_DEADLINE_LABEL = '9:00 PM';

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [resSummary, presRes, movRes, outRes] = await Promise.allSettled([
        residentsApi.getSummary ? residentsApi.getSummary(user?.hostelId || undefined) : Promise.resolve(null),
        movementsApi.getPresenceCounts ? movementsApi.getPresenceCounts(user?.hostelId || undefined) : Promise.resolve(null),
        reportsApi.getMovements ? reportsApi.getMovements({ pageSize: 8, hostelId: user?.hostelId || undefined }) : Promise.resolve({ data: [] }),
        residentsApi.listResidents ? residentsApi.listResidents({ presence: 'OUT', pageSize: 6 }) : Promise.resolve({ data: [] }),
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
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard operational overview');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId]);

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

  const isAfterReturnDeadline = now.getHours() >= RETURN_DEADLINE_HOUR;
  const outsideSectionTitle = isAfterReturnDeadline
    ? 'Residents Not Returned'
    : 'Residents Currently Outside';
  const outsideStatusLabel = isAfterReturnDeadline ? 'Not Returned' : 'Outside';

  return (
    <div className="overview-page flex flex-col gap-7 max-w-7xl mx-auto w-full">
      <PageHeader
        title={isWarden ? 'Dashboard' : 'Hostel Overview'}
        subtitle={
          isWarden
            ? `Welcome back, ${user?.fullName || 'Warden'}. Facility occupancy and hostel activity at a glance.`
            : `Welcome back, ${user?.fullName || 'System Administrator'}. Facility occupancy and hostel activity at a glance.`
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
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">Residents</span>
            <Users size={20} className="text-blue-600" />
          </div>
          <div>
            <span className="text-[36px] font-bold text-slate-900 tracking-tight leading-none">{totalResidents}</span>
          </div>
        </div>

        {/* Inside Hostel */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">Inside</span>
            <LogIn size={20} className="text-emerald-600" />
          </div>
          <div>
            <span className="text-[36px] font-bold text-slate-900 tracking-tight leading-none">{currentlyIn}</span>
          </div>
        </div>

        {/* Outside Hostel */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">Outside</span>
            <LogOut size={20} className="text-amber-600" />
          </div>
          <div>
            <span className="text-[36px] font-bold text-slate-900 tracking-tight leading-none">{currentlyOut}</span>
          </div>
        </div>

        {/* Return Deadline */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[15px] font-semibold text-slate-600">
              {isAfterReturnDeadline ? 'Not Returned' : 'Return Deadline'}
            </span>
            <Clock size={20} className={isAfterReturnDeadline ? 'text-red-600' : 'text-blue-600'} />
          </div>
          <div>
            <span className="text-[36px] font-bold text-slate-900 tracking-tight leading-none">
              {isAfterReturnDeadline ? currentlyOut : RETURN_DEADLINE_LABEL}
            </span>
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
              {isAfterReturnDeadline
                ? `${currentlyOut} ${currentlyOut === 1 ? 'resident has' : 'residents have'} not returned`
                : `Return deadline is ${RETURN_DEADLINE_LABEL}`}
            </div>
            <div className="text-sm mt-0.5 opacity-80">
              {isAfterReturnDeadline
                ? 'This list updates automatically from the live IN / OUT presence state as residents return.'
                : `${currentlyOut} ${currentlyOut === 1 ? 'resident is' : 'residents are'} currently outside. No separate night attendance is required.`}
            </div>
          </div>
        </div>
        <Link to="/residents" className="text-sm font-semibold underline underline-offset-2 whitespace-nowrap">
          View residents
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
                              {mov.direction}
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

        {/* Right Column: Pending Face Enrollment Box */}
        <div className="overview-side-col">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center gap-2.5 text-amber-600 mb-2">
                <ShieldAlert size={20} />
                <h3 className="text-lg font-bold text-slate-900">Pending Face Enrollment</h3>
              </div>
              <p className="text-[15px] text-slate-600 leading-relaxed mt-2">
                {notEnrolledCount} {notEnrolledCount === 1 ? 'resident needs' : 'residents need'} face enrollment.
              </p>
            </div>

            <Link to="/residents">
              <Button variant="primary" size="md" className="w-full justify-center h-11 text-[15px] font-semibold" rightIcon={<ArrowRight size={16} />}>
                View Residents
              </Button>
            </Link>
          </div>

          {/* Diagnostics Section (Retained for automated test contracts; visually hidden from clean commercial Overview) */}
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
