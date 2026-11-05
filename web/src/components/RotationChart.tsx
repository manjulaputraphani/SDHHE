/**
 * 30-day rotation trend — daily net sales as a simple SVG area/line chart.
 * No external chart library, so it stays light and works on mobile.
 */
import { useState } from "react";
import { rupeesShort } from "./SalesChart";

export type RotationPoint = { date: string; netSalesPaise: number };

function shortDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

export default function RotationChart({ data }: { data: RotationPoint[] }) {
  const [active, setActive] = useState<number | null>(null);

  const values = data.map((point) => Number(point.netSalesPaise) || 0);
  const peak = values.reduce((max, value) => Math.max(max, value), 0);

  if (data.length === 0 || peak === 0) {
    return (
      <div className="flex h-44 items-center justify-center">
        <p className="text-sm text-muted">No sales in the last 30 days</p>
      </div>
    );
  }

  const W = 600;
  const H = 180;
  const PAD = 10;
  const max = niceMax(peak);
  const n = data.length;
  const x = (index: number) =>
    n === 1 ? W / 2 : PAD + (index / (n - 1)) * (W - PAD * 2);
  const y = (value: number) => H - PAD - (value / max) * (H - PAD * 2);

  const points = data.map((point, index) => ({
    x: x(index),
    y: y(values[index]),
  }));
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const area = `${line} L ${x(n - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const ticks = [0, max / 2, max];
  const activePoint = active === null ? null : points[active];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Rotation trend">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              className="text-line"
              opacity="0.6"
            />
            <text
              x={2}
              y={y(tick) + 3}
              fill="currentColor"
              className="text-muted text-[9px]"
            >
              {rupeesShort(tick)}
            </text>
          </g>
        ))}

        <path d={area} className="fill-chart-1" opacity="0.14" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          className="text-chart-1"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <circle
            key={data[index].date}
            cx={point.x}
            cy={point.y}
            r={active === index ? 4 : 2}
            fill="currentColor"
            className="text-chart-1"
          />
        ))}

        {/* Transparent hit areas make hover/tap easy on mobile. */}
        {data.map((point, index) => {
          const width = n > 1 ? (W - PAD * 2) / (n - 1) : W;
          const left = n > 1 ? x(index) - width / 2 : 0;
          return (
            <rect
              key={`hit-${point.date}`}
              x={Math.max(0, left)}
              y={0}
              width={width}
              height={H}
              fill="transparent"
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
              onPointerDown={() => setActive(index)}
            />
          );
        })}
      </svg>

      {active !== null && activePoint && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-surface px-2 py-1 text-xs shadow"
          style={{ left: `${(activePoint.x / W) * 100}%` }}
        >
          <p className="font-medium">{shortDate(data[active].date)}</p>
          <p className="text-muted">{rupeesShort(values[active])}</p>
        </div>
      )}

      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{shortDate(data[0].date)}</span>
        <span>{shortDate(data[Math.floor((n - 1) / 2)].date)}</span>
        <span>{shortDate(data[n - 1].date)}</span>
      </div>
    </div>
  );
}
