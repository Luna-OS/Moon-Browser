import { useId } from "react";

/**
 * A moon whose lit part follows `phase` (0 = new, 0.5 = full, 1 = new) —
 * the same moon as in MoonDisk and MoonTask, here lit from the right while
 * waxing and from the left while waning, as seen from the north.
 */
export function MoonPhase({ phase, size = 40 }: { phase: number; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const p = ((phase % 1) + 1) % 1;
  const lit = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const waxing = p < 0.5;
  const r = 17;
  // The terminator is a half ellipse; it bulges into the lit half for a
  // crescent and out of it for a gibbous moon.
  const rx = r * Math.abs(1 - 2 * lit);
  const gibbous = lit > 0.5;
  const d = waxing
    ? `M 20 ${20 - r} A ${r} ${r} 0 0 1 20 ${20 + r} A ${rx} ${r} 0 0 ${gibbous ? 1 : 0} 20 ${20 - r} Z`
    : `M 20 ${20 - r} A ${r} ${r} 0 0 0 20 ${20 + r} A ${rx} ${r} 0 0 ${gibbous ? 0 : 1} 20 ${20 - r} Z`;

  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="shrink-0">
      <defs>
        <radialGradient id={`${id}-lit`} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#fdfbff" />
          <stop offset="55%" stopColor="#ddd6ff" />
          <stop offset="100%" stopColor="#a89cf2" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d={d} />
        </clipPath>
        <radialGradient id={`${id}-glow`}>
          <stop offset="70%" stopColor="#b9aefb" stopOpacity="1" />
          <stop offset="100%" stopColor="#b9aefb" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r={r + 3} fill={`url(#${id}-glow)`} opacity={0.1 + 0.3 * lit} />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="#221b47"
        stroke="rgb(185 174 251 / 0.35)"
        strokeWidth="1"
      />
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="20" cy="20" r={r} fill={`url(#${id}-lit)`} />
        <circle cx="25" cy="14" r="2.6" fill="#8f82e0" opacity="0.28" />
        <circle cx="29" cy="24" r="1.8" fill="#8f82e0" opacity="0.25" />
        <circle cx="20" cy="27" r="3.2" fill="#8f82e0" opacity="0.2" />
        <circle cx="13" cy="17" r="1.6" fill="#8f82e0" opacity="0.22" />
      </g>
    </svg>
  );
}
