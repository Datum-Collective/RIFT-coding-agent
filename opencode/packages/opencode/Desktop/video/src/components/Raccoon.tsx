import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

export type RaccoonFace = "neutral" | "focus" | "shock" | "happy" | "squint";
export type RaccoonPaws = "none" | "left" | "right" | "both";

type RaccoonProps = {
  face?: RaccoonFace;
  /** Which paw taps the keyboard. Each value drives one half of the tap cycle. */
  paws?: RaccoonPaws;
  /** Head tilt in degrees. */
  headTilt?: number;
  /** Tail wag amplitude in degrees. */
  tailWag?: number;
  /** Whole-body vertical bob in viewBox units. */
  bob?: number;
  /** Draws a laptop in front of the body and drops the paws onto its keyboard. */
  laptop?: boolean;
  /** Screen colour of the laptop. */
  screen?: string;
  /** Frames to wait before the first blink/tap cycle begins. */
  phase?: number;
};

/**
 * Ringed tail, drawn as circles sampled along a quadratic so the tube tapers
 * cleanly. Sample points are precomputed; only the group rotation animates.
 */
const TAIL_RINGS = [
  { x: 318, y: 272, r: 36, dark: true },
  { x: 343, y: 256, r: 34, dark: false },
  { x: 362, y: 237, r: 32, dark: true },
  { x: 375, y: 216, r: 29, dark: false },
  { x: 381, y: 191, r: 26, dark: true },
  { x: 381, y: 164, r: 22, dark: false },
  { x: 375, y: 134, r: 15, dark: true },
];

const RING_DARK = "#4d5069";

/** Rounded corners via a same-colour stroke on the polygon. */
const round = { strokeWidth: 16, strokeLinejoin: "round" } as const;

export const Raccoon: React.FC<RaccoonProps> = ({
  face = "neutral",
  paws = "none",
  headTilt = 0,
  tailWag = 6,
  bob = 0,
  laptop = false,
  screen = COLORS.teal,
  phase = 0,
}) => {
  const frame = useCurrentFrame() + phase;

  // Deterministic blink: closes over 4 frames once every 96 frames.
  const cycle = ((frame % 96) + 96) % 96;
  const lidOpen =
    cycle < 4
      ? interpolate(cycle, [0, 1.5, 2.5, 4], [1, 0.08, 0.08, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const wag =
    Math.sin(frame / 7) * tailWag +
    Math.sin(frame / 2.3) * tailWag * 0.25;

  // Paws tap on a 16-frame beat, offset per side so they alternate.
  const tapLeft = paws === "left" || paws === "both" ? Math.sin(frame / 2.6) : 0;
  const tapRight =
    paws === "right" || paws === "both" ? Math.sin(frame / 2.6 + Math.PI) : 0;

  const breathe = 1 + Math.sin(frame / 14) * 0.012;
  // "happy" replaces the eyes with arcs; "squint" keeps them but flattens the lids.
  const openEyes = face !== "happy";
  const eyeScale = face === "shock" ? 1.18 : 1;
  const eyeLid = face === "squint" ? 0.3 : lidOpen;
  const pawY = laptop ? 330 : 312;

  return (
    <svg viewBox="0 0 420 420" style={{ overflow: "visible" }}>
      {/* Tail */}
      <g transform={`rotate(${wag.toFixed(2)} 318 272)`}>
        {TAIL_RINGS.map((ring, i) => (
          <circle
            key={i}
            cx={ring.x}
            cy={ring.y}
            r={ring.r}
            fill={ring.dark ? RING_DARK : COLORS.fur}
          />
        ))}
      </g>

      <g transform={`translate(0 ${bob.toFixed(2)})`}>
        <g
          transform={`translate(210 250) scale(${breathe.toFixed(
            4,
          )}) translate(-210 -250)`}
        >
          {/* Body */}
          <ellipse cx={210} cy={296} rx={116} ry={100} fill={COLORS.fur} />
          <ellipse cx={210} cy={312} rx={62} ry={58} fill={COLORS.furLight} />
          <ellipse cx={162} cy={388} rx={44} ry={26} fill={COLORS.fur} />
          <ellipse cx={258} cy={388} rx={44} ry={26} fill={COLORS.fur} />

          {/* Arms */}
          <ellipse cx={126} cy={292} rx={50} ry={34} fill={COLORS.fur} />
          <ellipse cx={294} cy={292} rx={50} ry={34} fill={COLORS.fur} />
        </g>

        {/* Head */}
        <g transform={`rotate(${headTilt.toFixed(2)} 210 215)`}>
          {/* Ears */}
          <polygon
            points="124,100 104,34 170,78"
            fill={COLORS.fur}
            stroke={COLORS.fur}
            {...round}
          />
          <polygon
            points="296,100 316,34 250,78"
            fill={COLORS.fur}
            stroke={COLORS.fur}
            {...round}
          />
          <polygon points="131,94 119,60 158,80" fill={COLORS.pink} />
          <polygon points="289,94 301,60 262,80" fill={COLORS.pink} />

          <ellipse cx={210} cy={140} rx={92} ry={84} fill={COLORS.fur} />

          {/* Eye mask */}
          <ellipse cx={210} cy={132} rx={78} ry={44} fill={COLORS.mask} />

          {openEyes ? (
            <g
              style={{
                scale: `${eyeScale} ${(eyeScale * eyeLid).toFixed(3)}`,
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
            >
              <ellipse cx={168} cy={132} rx={24} ry={26} fill={COLORS.cream} />
              <ellipse cx={252} cy={132} rx={24} ry={26} fill={COLORS.cream} />
              {face === "shock" ? (
                <>
                  <circle cx={168} cy={136} r={8} fill={COLORS.ink} />
                  <circle cx={252} cy={136} r={8} fill={COLORS.ink} />
                </>
              ) : (
                <>
                  <circle cx={174} cy={138} r={12} fill={COLORS.ink} />
                  <circle cx={254} cy={138} r={12} fill={COLORS.ink} />
                  <circle cx={170} cy={133} r={4} fill={COLORS.cream} />
                  <circle cx={250} cy={133} r={4} fill={COLORS.cream} />
                </>
              )}
            </g>
          ) : (
            <path
              d="M 148,140 Q 168,116 188,140"
              fill="none"
              stroke={COLORS.ink}
              strokeWidth={8}
              strokeLinecap="round"
            />
          )}

          {/* Muzzle */}
          <ellipse cx={210} cy={180} rx={52} ry={36} fill={COLORS.cream} />
          <ellipse cx={210} cy={162} rx={18} ry={13} fill={COLORS.ink} />
          {face === "shock" ? (
            <ellipse cx={210} cy={198} rx={17} ry={19} fill={COLORS.ink} />
          ) : (
            <path
              d="M 210,175 L 210,188 M 196,182 Q 210,200 224,182"
              fill="none"
              stroke={COLORS.ink}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {face === "happy" && (
            <>
              <ellipse cx={126} cy={178} rx={18} ry={11} fill={COLORS.pink} opacity={0.75} />
              <ellipse cx={294} cy={178} rx={18} ry={11} fill={COLORS.pink} opacity={0.75} />
            </>
          )}

          {/* Whiskers stop short of the muzzle edge so they never cross the blush */}
          <g
            stroke={COLORS.cream}
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.8}
          >
            <path d="M 172,172 L 150,164" />
            <path d="M 172,186 L 154,192" />
            <path d="M 248,172 L 270,164" />
            <path d="M 248,186 L 266,192" />
          </g>
        </g>

        {laptop && (
          <g>
            {/* Lid, back panel, then the screen the paws rest against */}
            <path
              d="M 108,296 L 312,296 L 328,400 L 92,400 Z"
              fill={COLORS.slate}
            />
            <rect x={120} y={310} width={180} height={74} rx={10} fill={screen} />
            <rect x={132} y={322} width={96} height={9} rx={4.5} fill={COLORS.bgDeep} opacity={0.45} />
            <rect x={132} y={338} width={62} height={9} rx={4.5} fill={COLORS.bgDeep} opacity={0.45} />
            <rect x={132} y={354} width={78} height={9} rx={4.5} fill={COLORS.bgDeep} opacity={0.45} />
            <rect x={78} y={398} width={264} height={16} rx={8} fill={COLORS.panel} />
          </g>
        )}

        {/* Paws sit in front so they read as typing on the keyboard */}
        <ellipse
          cx={162}
          cy={pawY + tapLeft * 9}
          rx={30}
          ry={25}
          fill={COLORS.furLight}
        />
        <ellipse
          cx={258}
          cy={pawY + tapRight * 9}
          rx={30}
          ry={25}
          fill={COLORS.furLight}
        />
      </g>
    </svg>
  );
};