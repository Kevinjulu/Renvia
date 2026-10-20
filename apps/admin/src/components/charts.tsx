import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatDay } from "../lib/format";

/** Chart colours match DailyChart; categorical series stay distinguishable without colour alone (labels + tables). */
export const CHART = {
  blue: "#2F6FED",
  amber: "#E8A857",
  emerald: "#10B981",
  rose: "#F43F5E",
  grey: "#9A9A94",
  grid: "#EEEDE9",
  track: "#EFEDE8",
} as const;

/** A round-ish axis maximum so gridline labels read cleanly (1, 2, 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value)! * magnitude;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Tiny trend line for a KPI tile. Decorative: the tile's number is the accessible value. */
export function Sparkline({ values, color = CHART.blue, height = 32 }: { values: number[]; color?: string; height?: number }) {
  const width = 120;
  if (values.length < 2 || values.every((value) => value === 0)) {
    return <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2={width} y1={height - 2} y2={height - 2} stroke={CHART.track} strokeWidth="2" /></svg>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * width, height - 3 - ((value - min) / span) * (height - 6)] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      <path d={`${line}L${width},${height}L0,${height}Z`} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface DonutSlice { label: string; value: number; color: string }

/** Ring with the total in the middle; the legend carries the exact numbers. */
export function Donut({ slices, centerLabel, centerValue, size = 132 }: { slices: DonutSlice[]; centerLabel: string; centerValue: string; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(", ")}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={CHART.track} strokeWidth="12" />
      {total > 0 && slices.filter((slice) => slice.value > 0).map((slice) => {
        const length = (slice.value / total) * circumference;
        const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
        const circle = <circle key={slice.label} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={slice.color} strokeWidth="12" strokeDasharray={dash} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        offset += length;
        return circle;
      })}
      <text x="50%" y="48%" textAnchor="middle" className="fill-primary text-[20px] font-bold tabular-nums">{centerValue}</text>
      <text x="50%" y="62%" textAnchor="middle" className="fill-faint text-[10px]">{centerLabel}</text>
    </svg>
  );
}

/** Half-circle gauge for a ratio against a cap; colour steps at the warning/critical thresholds. */
export function Gauge({ ratio, warning, critical, label, size = 180 }: { ratio: number; warning: number; critical: number; label: string; size?: number }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const radius = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const arc = (from: number) => {
    const angle = Math.PI * (1 - from);
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy - radius * Math.sin(angle)).toFixed(2)}`;
  };
  const color = clamped >= critical ? CHART.rose : clamped >= warning ? CHART.amber : CHART.blue;
  return (
    <svg width={size} height={size / 2 + 18} viewBox={`0 0 ${size} ${size / 2 + 18}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)} aria-label={label} className="block">
      <path d={`M${arc(0)}A${radius},${radius} 0 0 1 ${arc(1)}`} fill="none" stroke={CHART.track} strokeWidth="12" strokeLinecap="round" />
      {clamped > 0 && <path d={`M${arc(0)}A${radius},${radius} 0 0 1 ${arc(clamped)}`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />}
      <text x={cx} y={cy - 6} textAnchor="middle" className="fill-primary text-[26px] font-bold tabular-nums">{Math.round(clamped * 100)}%</text>
    </svg>
  );
}

export interface HBarRow { label: string; value: number; display: string; detail?: string }

/** Horizontal bars, one series, sorted by the caller. Values are printed, so no axis is needed. */
export function HBar({ rows, color = CHART.blue }: { rows: HBarRow[]; color?: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value)) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-mono text-secondary" title={row.label}>{row.label}</span>
            <span className="shrink-0 tabular-nums"><span className="font-medium text-primary">{row.display}</span>{row.detail && <span className="text-faint"> · {row.detail}</span>}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100)}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

export interface AreaSeries { name: string; color: string; values: number[]; format: (value: number) => string }

const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 26, left: 44 };

/**
 * Time series as lines with a soft area under the first series. All series share one y-axis, so
 * callers only combine series in the same unit (e.g. revenue and cost, both USD).
 */
export function AreaChart({ days, series, caption }: { days: string[]; series: AreaSeries[]; caption: string }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values)));
  const x = (index: number) => MARGIN.left + (days.length > 1 ? (index / (days.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => MARGIN.top + plotHeight - (value / max) * plotHeight;
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join("");
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotWidth / 70))));
  const first = series[0];
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={HEIGHT} role="img" aria-label={caption} className="block">
        {[0, max / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={CHART.grid} />
            <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular-nums">{first ? first.format(tick) : tick}</text>
          </g>
        ))}
        {first && days.length > 1 && <path d={`${path(first.values)}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={first.color} opacity="0.1" />}
        {series.map((item) => <path key={item.name} d={path(item.values)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {days.map((day, index) => (index % labelEvery === 0 || index === days.length - 1) && (index === days.length - 1 || days.length - 1 - index >= labelEvery / 2) ? (
          <text key={day} x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="fill-faint text-[11px]">{formatDay(day)}</text>
        ) : null)}
        {active !== null && <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={CHART.grey} strokeDasharray="3 3" />}
        {active !== null && series.map((item) => <circle key={item.name} cx={x(active)} cy={y(item.values[active] ?? 0)} r="4" fill={item.color} stroke="white" strokeWidth="1.5" />)}
        {days.map((day, index) => {
          const band = days.length > 1 ? plotWidth / (days.length - 1) : plotWidth;
          return <rect key={day} x={x(index) - band / 2} y={MARGIN.top} width={band} height={plotHeight} fill="transparent" tabIndex={0} aria-label={`${formatDay(day)}: ${series.map((item) => `${item.name} ${item.format(item.values[index] ?? 0)}`).join(", ")}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} className="outline-none" />;
        })}
      </svg>
      {active !== null && days[active] && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-hairline bg-canvas px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(Math.max(x(active), 80), width - 80), top: 0 }}>
          <p className="font-medium text-primary">{formatDay(days[active]!)}</p>
          {series.map((item) => <p key={item.name} className="mt-0.5 flex items-center gap-1.5 text-secondary"><span className="h-2 w-2 rounded-sm" style={{ background: item.color }} aria-hidden="true" />{item.name} <span className="tabular-nums font-medium text-primary">{item.format(item.values[active] ?? 0)}</span></p>)}
        </div>
      )}
      <Legend items={series.map((item) => ({ label: item.name, color: item.color }))} />
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Day</th>{series.map((item) => <th key={item.name} scope="col">{item.name}</th>)}</tr></thead>
        <tbody>{days.map((day, index) => <tr key={day}><td>{formatDay(day)}</td>{series.map((item) => <td key={item.name}>{item.format(item.values[index] ?? 0)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }): ReactNode {
  if (items.length < 2) return null;
  return <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{items.map((item) => <li key={item.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>;
}
