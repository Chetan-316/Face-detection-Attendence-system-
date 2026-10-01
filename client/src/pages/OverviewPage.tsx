import React, { useEffect, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { SafeResident, ResidentSummary } from '../types/resident.types';
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

  // Guard role is redirected directly to Gate
  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

  const isWarden = user?.role === 'WARDEN';

  // State for metrics & summaries
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [latestSession, setLatestSession] = useState<AttendanceSessionReportItem | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [outsideResidents, setOutsideResidents] = useState<SafeResident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [resSummary, presRes, attRes, movRes, outRes] = await Promise.allSettled([
        residentsApi.getSummary ? residentsApi.getSummary(user?.hostelId || undefined) : Promise.resolve(null),
        movementsApi.getPresenceCounts ? movementsApi.getPresenceCounts(user?.hostelId || undefined) : Promise.resolve(null),
        reportsApi.getAttendanceSessions ? reportsApi.getAttendanceSessions({ pageSize: 1, hostelId: user?.hostelId || undefined }) : Promise.resolve({ data: [] }),
        reportsApi.getMovements ? reportsApi.getMovements({ pageSize: 8, hostelId: user?.hostelId || undefined }) : Promise.resolve({ data: [] }),
        residentsApi.listResidents ? residentsApi.listResidents({ presence: 'OUT', pageSize: 6 }) : Promise.resolve({ data: [] }),
      ]);

      if (resSummary.status === 'fulfilled' && resSummary.value) {
        setSummary(resSummary.value);
      }
      if (presRes.status === 'fulfilled' && presRes.value) {
        setPresenceCounts(presRes.value);
      }
      if (attRes.status === 'fulfilled' && attRes.value?.data && Array.isArray(attRes.value.data) && attRes.value.data.length > 0) {
        setLatestSession(attRes.value.data[0]);
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
    <div className="overview-page flex flex-col gap-7 max-w-7xl mx-auto w-full">
      <PageHeader
        title={isWarden ? 'Dashboard' : 'Hostel Overview'}
        subtitle={
          isWarden
            ? `Welcome, ${user?.fullName || user?.username}. Operational metrics, roster presence, and attendance.`
            : `Welcome back, ${user?.fullName || user?.username}. Facility occupancy, roster status, and operational metrics.`
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Residents */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-sm font-semibold">Residents</span>
            <Users size={20} className="text-blue-600" />
          </div>
          <div>
            <span className="text-36px font-bold text-slate-900 tracking-tight leading-none">{totalResidents}</span>
          </div>
        </div>

        {/* Inside Hostel */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-sm font-semibold">Inside</span>
            <LogIn size={20} className="text-emerald-600" />
          </div>
          <div>
            <span className="text-36px font-bold text-emerald-700 tracking-tight leading-none">{currentlyIn}</span>
          </div>
        </div>

        {/* Outside Hostel */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-sm font-semibold">Outside</span>
            <LogOut size={20} className="text-amber-600" />
          </div>
          <div>
            <span className="text-36px font-bold text-amber-700 tracking-tight leading-none">{currentlyOut}</span>
          </div>
        </div>

        {/* Attendance */}
        <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-sm font-semibold">Attendance</span>
            <CalendarCheck size={20} className="text-blue-600" />
          </div>
          <div>
            <span className="text-36px font-bold text-slate-900 tracking-tight leading-none">{attendanceMetric}</span>
          </div>
        </div>
      </div>

      {/* Main Content: Residents Outside, Recent Gate Activity, Pending Face Enrollments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
        {/* Left Column: Residents Currently Outside & Recent Gate Activity (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-7">
          {/* Residents Currently Outside */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LogOut size={18} className="text-amber-600" />
                <h3 className="text-lg font-bold text-slate-900">Residents Currently Outside</h3>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                {currentlyOut} Outside
              </span>
            </div>

            <div className="overflow-x-auto">
              {outsideResidents.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  All residents are currently inside the hostel.
                </div>
              ) : (
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                      <th className="py-3 px-6 font-semibold">Resident</th>
                      <th className="py-3 px-6 font-semibold">Code</th>
                      <th className="py-3 px-6 font-semibold">Room</th>
                      <th className="py-3 px-6 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outsideResidents.map((res) => (
                      <tr key={res.id} className="hover:bg-slate-50/70 transition-colors h-14">
                        <td className="py-3 px-6 font-semibold text-slate-900">{res.fullName}</td>
                        <td className="py-3 px-6 font-mono text-slate-600">{res.residentCode}</td>
                        <td className="py-3 px-6 text-slate-700 font-medium">{res.roomGroup}</td>
                        <td className="py-3 px-6 text-right">
                          <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            OUT
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
                <div className="p-8 text-center text-slate-500 text-sm">
                  No recent gate movements recorded today.
                </div>
              ) : (
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                      <th className="py-3 px-6 font-semibold">Time</th>
                      <th className="py-3 px-6 font-semibold">Resident</th>
                      <th className="py-3 px-6 font-semibold">Code</th>
                      <th className="py-3 px-6 font-semibold text-right">Movement</th>
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
                        <tr key={mov.id} className="hover:bg-slate-50/70 transition-colors h-14">
                          <td className="py-3 px-6 font-mono text-slate-500">{time}</td>
                          <td className="py-3 px-6 font-semibold text-slate-900">
                            {mov.fullName || mov.residentId}
                          </td>
                          <td className="py-3 px-6 font-mono text-slate-600">
                            {mov.residentCode || '—'}
                          </td>
                          <td className="py-3 px-6 text-right">
                            <span
                              className={`inline-block px-3 py-1 rounded-md text-xs font-bold ${
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

        {/* Right Column: Pending Face Enrollment Box (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-7">
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between gap-5">
            <div>
              <div className="flex items-center gap-2.5 text-amber-600 mb-2">
                <ShieldAlert size={20} />
                <h3 className="text-base font-bold text-slate-900">Pending Face Enrollment</h3>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Residents registered without biometric face profiles cannot be recognized at gate cameras.
              </p>

              <div className="mt-5 p-5 rounded-xl bg-amber-50/70 border border-amber-200">
                <span className="text-36px font-extrabold text-amber-800 leading-none">{notEnrolledCount}</span>
                <span className="text-sm text-slate-600 block mt-1 font-medium">Residents pending enrollment</span>
              </div>
            </div>

            <Link to="/residents">
              <Button variant="primary" size="md" className="w-full justify-center h-11 text-sm font-semibold" rightIcon={<ArrowRight size={15} />}>
                View Residents
              </Button>
            </Link>
          </div>

          {/* Admin System Status (Admin Only) */}
          {!isWarden && (
            <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">System Status</h3>
                  <p className="text-xs text-slate-500">Current platform capabilities</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                  OPERATIONAL
                </span>
              </div>
              <div className="flex flex-col gap-2.5 pt-1 text-sm">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
                  <span className="font-medium text-slate-700">Gate Recognition & Cameras</span>
                  <span className="font-semibold text-emerald-600">Active</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
                  <span className="font-medium text-slate-700">Biometric Engine</span>
                  <span className="font-semibold text-emerald-600">Active</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
                  <span className="font-medium text-slate-700">Face Enrolled</span>
                  <span className="font-bold text-slate-900">{summary?.faceEnrolled ?? 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewPage;
