import { useLayoutEffect, useRef, useState } from "react";
import type { AdminOverviewResponse } from "@renvia/types";
import { formatDay, formatNumber, formatUsd } from "../lib/format";

type Day = AdminOverviewResponse["daily"][number];

const HEIGHT = 200;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 32 };
const BAR_MAX = 24;
const ACCENT = "#2F6FED";
const GRID = "#EEEDE9";

/** A round-ish axis maximum so gridline labels read cleanly (1, 2, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value)!;
  return step * magnitude;
}

/** Column path with a 4px rounded top and a square base on the baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * Renders per day (one series, one axis). Spend is secondary and lives in the tooltip —
 * never on a second y-axis.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = niceMax(Math.max(0, ...days.map((day) => day.renders)));
  const band = days.length > 0 ? plotWidth / days.length : 0;
  const barWidth = Math.min(BAR_MAX, Math.max(2, band - 2));
  const y = (value: number) => MARGIN.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, max / 2, max];
  const activeDay = active === null ? null : days[active];

  return (
    <div ref={containerRef} className="relative">
      <svg width={width} height={HEIGHT} role="img" aria-label="Renders per day, last 14 days" className="block">
        <defs>
          <linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F86F5" />
            <stop offset="100%" stopColor="#2F6FED" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
            <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular-nums">
              {formatNumber(tick)}
            </text>
          </g>
        ))}

        {days.map((day, index) => {
          const x = MARGIN.left + index * band + (band - barWidth) / 2;
          const barHeight = MARGIN.top + plotHeight - y(day.renders);
          const isActive = active === index;
          return (
            <g key={day.date}>
              {barHeight > 0 && (
                <path
                  d={barPath(x, y(day.renders), barWidth, barHeight)}
                  fill="url(#bar-fill)"
                  className="transition-opacity duration-150"
                  opacity={active === null || isActive ? 1 : 0.3}
                />
              )}
              {/* Label every other day (plus the last) so 14 dates never collide. */}
              {(index % 2 === days.length % 2 || index === days.length - 1) && (
                <text
                  x={MARGIN.left + index * band + band / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-faint text-[11px]"
                >
                  {formatDay(day.date)}
                </text>
              )}
              {/* Hit target spans the whole column band, bigger than the mark itself. */}
              <rect
                x={MARGIN.left + index * band}
                y={MARGIN.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatDay(day.date)}: ${day.renders} renders, ${formatUsd(day.spentUsd)}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              />
            </g>
          );
        })}
      </svg>

      {activeDay && active !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(MARGIN.left + active * band + band / 2, 70), width - 70),
            top: Math.max(y(activeDay.renders) - 8, 48),
          }}
        >
          <p className="font-medium text-primary">{formatDay(activeDay.date)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-secondary">
            <span className="h-2 w-2 rounded-sm" style={{ background: ACCENT }} aria-hidden="true" />
            <span className="tabular-nums">{formatNumber(activeDay.renders)}</span> renders
          </p>
          <p className="mt-0.5 text-muted">
            <span className="tabular-nums">{formatUsd(activeDay.spentUsd)}</span> spent
          </p>
        </div>
      )}

      <table className="sr-only">
        <caption>Renders and spend per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Renders</th>
            <th scope="col">Spend</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{formatDay(day.date)}</td>
              <td>{day.renders}</td>
              <td>{formatUsd(day.spentUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
