import React, { useEffect, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { ResidentSummary } from '../types/resident.types';
import { PresenceCounts } from '../types/movement.types';
import { AttendanceSessionReportItem, MovementReportItem } from '../types/reports.types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import {
  Users,
  LogIn,
  LogOut,
  CalendarCheck,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();

  // Guard role is redirected directly to Gate Monitor
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

  const isWarden = user?.role === 'WARDEN';

  // State for metrics & summaries
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [latestSession, setLatestSession] = useState<AttendanceSessionReportItem | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [resSummary, presRes, attRes, movRes] = await Promise.allSettled([
        residentsApi.getSummary(user?.hostelId || undefined),
        movementsApi.getPresenceCounts(user?.hostelId || undefined),
        reportsApi.getAttendanceSessions({ pageSize: 1, hostelId: user?.hostelId || undefined }),
        reportsApi.getMovements({ pageSize: 8, hostelId: user?.hostelId || undefined }),
      ]);

      if (resSummary.status === 'fulfilled') {
        setSummary(resSummary.value);
      }
      if (presRes.status === 'fulfilled') {
        setPresenceCounts(presRes.value);
      }
      if (attRes.status === 'fulfilled' && attRes.value.data.length > 0) {
        setLatestSession(attRes.value.data[0]);
      }
      if (movRes.status === 'fulfilled' && movRes.value.data) {
        setRecentMovements(movRes.value.data);
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

  const totalResidents = summary?.total ?? summary?.active ?? 0;
  const currentlyIn = presenceCounts?.currentlyIn ?? summary?.currentlyIn ?? 0;
  const currentlyOut = presenceCounts?.currentlyOut ?? summary?.currentlyOut ?? 0;
  const notEnrolledCount = summary?.notEnrolled ?? 0;

  let attendanceMetric = 'No Session';
  if (latestSession) {
    if (latestSession.expectedResidents > 0) {
      attendanceMetric = `${Math.round(latestSession.attendanceRate)}%`;
    } else {
      attendanceMetric = `${latestSession.presentCount} Present`;
    }
  }

  return (
    <div className="overview-page flex flex-col gap-6 max-w-7xl mx-auto w-full">
      <PageHeader
        title={isWarden ? 'Warden Dashboard' : 'Hostel Overview'}
        subtitle={
          isWarden
            ? `Welcome, ${user?.fullName || user?.username}. Operational metrics, roster presence, and attendance.`
            : `Welcome back, ${user?.fullName || user?.username}. Facility occupancy, roster status, and operational metrics.`
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOverviewData}
            isLoading={isLoading}
            leftIcon={<RefreshCw size={14} />}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded border border-red-200 dark:border-red-800 flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 4 Compact Operational Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Residents */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase font-bold tracking-wider">Residents</span>
            <Users size={16} className="text-blue-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold text-white">{totalResidents}</span>
          </div>
        </div>

        {/* Inside Hostel */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase font-bold tracking-wider">Inside</span>
            <LogIn size={16} className="text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold text-emerald-400">{currentlyIn}</span>
          </div>
        </div>

        {/* Outside Hostel */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase font-bold tracking-wider">Outside</span>
            <LogOut size={16} className="text-amber-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold text-amber-400">{currentlyOut}</span>
          </div>
        </div>

        {/* Attendance */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs uppercase font-bold tracking-wider">Attendance</span>
            <CalendarCheck size={16} className="text-purple-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-100">{attendanceMetric}</span>
          </div>
        </div>
      </div>

      {/* Main Content: Recent Gate Activity + Pending Face Enrollments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Activity Table (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-4 py-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Recent Gate Activity</h3>
            <span className="text-xs text-slate-400">Live Movement Log</span>
          </div>

          <div className="overflow-x-auto flex-1">
            {recentMovements.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No recent gate movements recorded today.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider bg-slate-900/50">
                    <th className="py-2.5 px-4 font-semibold">Time</th>
                    <th className="py-2.5 px-4 font-semibold">Resident</th>
                    <th className="py-2.5 px-4 font-semibold">Code</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Movement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recentMovements.map((mov) => {
                    const time = new Date(mov.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const isIN = mov.direction === 'IN';

                    return (
                      <tr key={mov.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-4 font-mono text-slate-400">{time}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-200">
                          {mov.fullName || mov.residentId}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {mov.residentCode || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                              isIN
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
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

        {/* Pending Face Enrollment Box (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-400 mb-2">
              <ShieldAlert size={18} />
              <h3 className="text-sm font-semibold text-slate-200">Pending Face Enrollment</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Residents registered without biometric face profiles cannot be recognized at gate cameras.
            </p>

            <div className="mt-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <span className="text-3xl font-extrabold text-amber-400">{notEnrolledCount}</span>
              <span className="text-xs text-slate-400 block mt-0.5">Residents pending enrollment</span>
            </div>
          </div>

          <Link to="/residents">
            <Button variant="primary" size="sm" className="w-full justify-center" rightIcon={<ArrowRight size={14} />}>
              View Residents
            </Button>
          </Link>
        </div>
      </div>

      {/* Admin Infrastructure & Platform Capabilities (Admin Only) */}
      {!isWarden && (
        <div className="card p-5 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">System Status</h3>
              <p className="text-xs text-slate-400">Current platform capabilities</p>
            </div>
            <span className="badge badge-success text-xs font-semibold px-2.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
              OPERATIONAL
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="p-3 bg-slate-800/50 rounded border border-slate-700/50 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">Gate Recognition & Cameras</span>
              <span className="text-xs font-semibold text-emerald-400">OPERATIONAL</span>
            </div>
            <div className="p-3 bg-slate-800/50 rounded border border-slate-700/50 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">Biometric Engine</span>
              <span className="text-xs font-semibold text-emerald-400">OPERATIONAL</span>
            </div>
            <div className="p-3 bg-slate-800/50 rounded border border-slate-700/50 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">Face Enrolled</span>
              <span className="text-xs font-semibold text-slate-100">{summary?.faceEnrolled ?? 0}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
