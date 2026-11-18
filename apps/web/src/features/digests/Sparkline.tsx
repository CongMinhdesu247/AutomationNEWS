import { useId } from "react";

export function Sparkline({
  points,
  label,
  tone = "emerald",
}: {
  points: number[];
  label: string;
  tone?: "emerald" | "amber";
}) {
  const gradId = useId().replace(/:/g, "");
  const valid = points.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length < 2) return null;

  const width = 88;
  const height = 28;
  const padX = 3;
  const padY = 4;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min || 1;

  const coords = valid.map((val, idx) => {
    const x =
      padX + (idx / Math.max(1, valid.length - 1)) * (width - padX * 2);
    const y =
      height - padY - ((val - min) / span) * (height - padY * 2);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const areaPoints = `${first.x},${height - 1} ${linePoints} ${last.x},${height - 1}`;

  const strokeColor =
    tone === "amber" ? "var(--spark-amber, #b7791f)" : "var(--accent, #146954)";

  return (
    <svg
      className={"market-sparkline tone-" + tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: xu hướng ${valid.length} phiên gần nhất`}
    >
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.24" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#spark-${gradId})`} />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={linePoints}
      />
      <circle cx={last.x} cy={last.y} r="2.6" fill={strokeColor} />
    </svg>
  );
}
