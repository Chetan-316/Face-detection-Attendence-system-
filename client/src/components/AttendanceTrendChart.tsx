import React, { useState } from 'react';
import { AttendanceTrendPoint } from '../types/reports.types';

interface AttendanceTrendChartProps {
  data: AttendanceTrendPoint[];
  height?: number;
}

export const AttendanceTrendChart: React.FC<AttendanceTrendChartProps> = ({
  data,
  height = 200,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<AttendanceTrendPoint | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="trend-chart-empty" role="region" aria-label="Attendance Trend Chart">
        <p className="text-sm text-muted text-center py-6">
          No attendance trend data available for this range.
        </p>
      </div>
    );
  }

  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 35;
  const width = 650;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // X coordinate calculation
  const getX = (index: number) => {
    if (data.length === 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (data.length - 1)) * chartWidth;
  };

  // Y coordinate calculation (0% to 100%)
  const getY = (rate: number) => {
    const clamped = Math.max(0, Math.min(100, rate));
    return paddingTop + chartHeight - (clamped / 100) * chartHeight;
  };

  // Generate SVG path for line
  const points = data.map((d, i) => `${getX(i)},${getY(d.attendanceRate)}`).join(' ');

  // Generate SVG path for gradient area
  const areaPoints = [
    `${getX(0)},${paddingTop + chartHeight}`,
    ...data.map((d, i) => `${getX(i)},${getY(d.attendanceRate)}`),
    `${getX(data.length - 1)},${paddingTop + chartHeight}`,
  ].join(' ');

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="attendance-trend-container" role="region" aria-label="Attendance Trend Line Chart">
      <div className="chart-header-row mb-2 flex justify-between items-center">
        <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
          Daily Attendance Rate (%)
        </span>
        {hoveredPoint && (
          <span className="text-xs font-medium text-primary">
            {hoveredPoint.date}: {hoveredPoint.attendanceRate}% ({hoveredPoint.presentCount} / {hoveredPoint.expectedCount})
          </span>
        )}
      </div>

      <div className="svg-chart-wrapper" style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="attendance-trend-svg"
          style={{ width: '100%', maxHeight: `${height}px`, display: 'block' }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary-500, #3b82f6)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--color-primary-500, #3b82f6)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines and Y-axis labels */}
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick} className="grid-tick">
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray={tick === 0 || tick === 100 ? 'none' : '3 3'}
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  fontWeight="500"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* Filled Area */}
          <polygon points={areaPoints} fill="url(#trendGradient)" />

          {/* Trend Line */}
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          {/* Data Points */}
          {data.map((d, i) => {
            const cx = getX(i);
            const cy = getY(d.attendanceRate);
            const isHovered = hoveredPoint?.date === d.date;

            return (
              <g
                key={d.date}
                className="chart-point-group"
                onMouseEnter={() => setHoveredPoint(d)}
                onMouseLeave={() => setHoveredPoint(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 5.5 : 3.5}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={isHovered ? 3 : 2}
                />
                {/* Date Label on X axis */}
                {(data.length <= 10 || i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#64748b"
                  >
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Accessible Table Representation (Requirement 46) */}
      <details className="mt-3 text-xs text-secondary">
        <summary className="cursor-pointer font-medium hover:text-primary">
          View trend as table
        </summary>
        <div className="table-responsive mt-2">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Sessions</th>
                <th>Present</th>
                <th>Expected</th>
                <th>Attendance Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.sessionTitles.join(', ') || 'Attendance'}</td>
                  <td>{d.presentCount}</td>
                  <td>{d.expectedCount}</td>
                  <td className="font-semibold">{d.attendanceRate}%</td>
                  <td>
                    <span className={`badge badge-sm badge-${d.status === 'CLOSED' ? 'success' : 'info'}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};
