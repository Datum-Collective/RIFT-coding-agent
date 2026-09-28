/**
 * A plain geometric stand-in for "an AI agent": a rounded-rect head with two dot eyes. Built
 * from primitives on purpose so it never resembles any real product's mascot.
 */
export function BotGlyph(props: { size: number; color: string }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 100 100"
      style={{ display: "block" }}
    >
      <rect
        x={6}
        y={17}
        width={88}
        height={66}
        rx={21}
        fill="none"
        stroke={props.color}
        strokeWidth={6}
      />
      <circle cx={36} cy={50} r={7} fill={props.color} />
      <circle cx={64} cy={50} r={7} fill={props.color} />
    </svg>
  );
}
