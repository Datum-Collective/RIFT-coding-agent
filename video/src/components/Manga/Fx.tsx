/**
 * Manga FX kit: screentone halftone, speed lines, impact bursts, glints and
 * falling dirt. Everything vector, deterministic, no gradients or glow.
 */
import { useCurrentFrame } from "remotion";
import { useId } from "react";

export function hash(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Halftone dot rectangle for screentone shading. */
export function ToneRect(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  ink?: string;
  opacity?: number;
  gap?: number;
  dot?: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ink = props.ink ?? "#161616";
  const gap = props.gap ?? 12;
  const dot = props.dot ?? 3.2;
  return (
    <g>
      <defs>
        <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <circle cx={gap / 2} cy={gap / 2} r={dot} fill={ink} />
        </pattern>
      </defs>
      <rect
        x={props.x}
        y={props.y}
        width={props.w}
        height={props.h}
        fill={`url(#${id})`}
        opacity={props.opacity ?? 0.28}
      />
    </g>
  );
}

/** Horizontal speed lines rushing from the left (sprint panels). */
export function SpeedLines(props: { w: number; h: number; ink?: string; count?: number }) {
  const ink = props.ink ?? "#161616";
  const count = props.count ?? 22;
  return (
    <g stroke={ink} strokeLinecap="round">
      {Array.from({ length: count }, (_, i) => {
        const y = (i / count) * props.h + hash(i, 7) * 14;
        const len = props.w * (0.25 + hash(i, 8) * 0.55);
        const x = hash(i, 9) * props.w * 0.3;
        return (
          <line
            key={i}
            x1={x}
            y1={y}
            x2={x + len}
            y2={y}
            strokeWidth={3 + hash(i, 10) * 5}
            opacity={0.55 + hash(i, 11) * 0.45}
          />
        );
      })}
    </g>
  );
}

/** Tapered impact burst radiating from a focal point (white on black when inverted). */
export function ImpactLines(props: {
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  ink?: string;
  count?: number;
}) {
  const ink = props.ink ?? "#FFFFFF";
  const count = props.count ?? 26;
  return (
    <g fill={ink}>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + hash(i, 12) * 0.2;
        const r0 = props.r0 * (0.8 + hash(i, 13) * 0.4);
        const r1 = props.r1 * (0.7 + hash(i, 14) * 0.6);
        const spread = 0.02 + hash(i, 15) * 0.03;
        const p = (r: number, da: number) => `${props.cx + r * Math.cos(a + da)},${props.cy + r * Math.sin(a + da)}`;
        return <polygon key={i} points={`${p(r0, -spread)} ${p(r1, 0)} ${p(r0, spread)}`} />;
      })}
    </g>
  );
}

/** Film grain: fixed-seed turbulence, same every render. */
export function Grain(props: { opacity?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    >
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={7} />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter={`url(#${id})`} opacity={props.opacity ?? 0.1} />
    </svg>
  );
}
/** Four-point glint sparkle (the キラッ eye-shine). */
export function GlintStar(props: { x: number; y: number; s: number; fill?: string }) {
  const { x, y, s } = props;
  const fill = props.fill ?? "#161616";
  return (
    <polygon
      points={`${x},${y - s} ${x + s * 0.22},${y - s * 0.22} ${x + s},${y} ${x + s * 0.22},${y + s * 0.22} ${x},${y + s} ${x - s * 0.22},${y + s * 0.22} ${x - s},${y} ${x - s * 0.22},${y - s * 0.22}`}
      fill={fill}
    />
  );
}

/** Falling dirt chunks for the cave-in. Positions loop deterministically. */
export function Dirt(props: { w: number; h: number; ink?: string; count?: number }) {
  const frame = useCurrentFrame();
  const ink = props.ink ?? "#FFFFFF";
  const count = props.count ?? 26;
  return (
    <g fill={ink}>
      {Array.from({ length: count }, (_, i) => {
        const speed = 6 + hash(i, 16) * 10;
        const x = hash(i, 17) * props.w;
        const y = (hash(i, 18) * props.h + frame * speed) % (props.h + 60) - 30;
        const s = 6 + hash(i, 19) * 16;
        const wob = Math.sin(frame * 0.2 + i) * 8;
        return (
          <polygon
            key={i}
            points={`${x + wob},${y} ${x + wob + s},${y + s * 0.4} ${x + wob + s * 0.5},${y + s} ${x + wob - s * 0.3},${y + s * 0.5}`}
            opacity={0.7 + hash(i, 20) * 0.3}
          />
        );
      })}
    </g>
  );
}
