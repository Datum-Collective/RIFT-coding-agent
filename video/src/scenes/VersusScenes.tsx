/**
 * A split-screen comparison, one claim per scene. The frame (divider, both identities) sits in
 * the same place in every beat, so a fade between rounds changes only what differs; the close
 * collapses the split and grows the monogram back into the whole mark.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TypeReveal, typeDuration } from "../components/Effects/TypeReveal";
import { BotGlyph } from "../components/UI/BotGlyph";
import { parseEmphasis } from "../lib/captions/build";
import { useSafeArea, useVideo } from "../lib/context";
import type { SceneOf } from "../spec/schema";
import { contentBox, versusSideWidth } from "../styles/scale";
import { motion } from "../styles/theme";

type Scene = SceneOf<"versus">;
type Layout = ReturnType<typeof useLayout>;

export function VersusScene(props: { scene: Scene }) {
  const scene = props.scene;
  const { theme } = useVideo();
  const layout = useLayout(scene);
  if (scene.beat === "close") return <Close scene={scene} layout={layout} />;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.background }}>
      <Divider layout={layout} intro={scene.beat === "intro"} />
      <Identities scene={scene} layout={layout} />
      <Claim text={scene.headline} layout={layout} start={scene.beat === "intro" ? -0.3 : 0.05} />
      {scene.beat === "intro" ? <Intro layout={layout} /> : null}
      {scene.beat === "check" ? <Check scene={scene} layout={layout} /> : null}
      {scene.beat === "memory" ? <Memory layout={layout} /> : null}
      {scene.beat === "alert" ? <Alert scene={scene} layout={layout} /> : null}
    </AbsoluteFill>
  );
}

/** Where everything sits. Derived from the frame and safe area, identical for every beat. */
function useLayout(scene: Scene) {
  const { frame, space } = useVideo();
  const inset = useSafeArea();
  const box = contentBox(frame);
  const edge = Math.max(inset.left, inset.right);
  const mid = frame.width / 2;
  // The split starts just above the frame's middle, so the claim and both sides sit as one block.
  const splitTop = Math.round(inset.top + box.height * 0.36);
  // 192px on a 1080 frame renders the 192-unit mark 1:1, so every 8-unit cell is a whole 8px.
  const markHeight = space(24);
  const markTop = splitTop + space(3);
  const contentTop = markTop + markHeight + space(10);
  return {
    inset,
    edge,
    mid,
    splitTop,
    splitBottom: frame.height - inset.bottom - space(12),
    markHeight,
    markTop,
    contentTop,
    sideWidth: versusSideWidth(frame),
    centers: { left: (edge + mid) / 2, right: (mid + frame.width - edge) / 2 },
    // The whole mark at the close: 1.5 × its native 576 units on a 1080 frame keeps pixel cells whole.
    closeWidth: space(108),
    aspect: scene.markAspect,
    monogram: scene.monogram ?? scene.markAspect,
  };
}

/** 0 → 1 between two times in seconds, on the system's entrance curve unless told otherwise. */
function useTween() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (start: number, duration: number, easing = motion.enter) =>
    interpolate(frame, [start * fps, (start + duration) * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing,
    });
}

/** Each side's column: centred on its half, clear of the divider and the safe edge. */
function Side(props: {
  side: "left" | "right";
  top: number;
  layout: Layout;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: props.top,
        left: props.layout.centers[props.side] - props.layout.sideWidth / 2,
        width: props.layout.sideWidth,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

function Divider(props: { layout: Layout; intro: boolean }) {
  const { theme } = useVideo();
  const tween = useTween();
  const drawn = props.intro ? tween(0.15, 0.9, motion.move) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: props.layout.mid - theme.hairline / 2,
        top: props.layout.splitTop,
        width: theme.hairline,
        height: props.layout.splitBottom - props.layout.splitTop,
        backgroundColor: theme.palette.border,
        transformOrigin: "top",
        scale: `1 ${drawn}`,
      }}
    />
  );
}

/** The bot glyph on the left, the product's monogram on the right. Grey until the rounds start. */
function Identities(props: { scene: Scene; layout: Layout }) {
  const { theme } = useVideo();
  const tween = useTween();
  const intro = props.scene.beat === "intro";
  const layout = props.layout;
  const left = intro ? tween(0.3, 0.7) : 1;
  const right = intro ? tween(0.42, 0.7) : 1;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: layout.centers.left - layout.markHeight / 2,
          top: layout.markTop,
          opacity: left,
          translate: `0px ${(1 - left) * 16}px`,
        }}
      >
        <BotGlyph size={layout.markHeight} color={theme.palette.textMuted} />
      </div>
      <Mark
        src={props.scene.mark}
        layout={layout}
        x={layout.centers.right - (layout.markHeight * layout.monogram) / 2}
        y={layout.markTop + (1 - right) * 16}
        height={layout.markHeight}
        shown={0}
        style={{
          opacity: right,
          filter: intro ? "grayscale(1)" : undefined,
        }}
      />
    </>
  );
}

/**
 * The real mark file, sized directly so the SVG rasterizes at display size (a CSS downscale blurs
 * the cells). `shown` reveals the rest past the monogram (0–1), stepped in whole 8-unit columns.
 */
function Mark(props: {
  src: string;
  layout: Layout;
  x: number;
  y: number;
  height: number;
  shown: number;
  style?: CSSProperties;
}) {
  const layout = props.layout;
  const height = props.height;
  const width = height * layout.aspect;
  const share = Math.min(1, layout.monogram / layout.aspect);
  // A 576-unit banner is 72 columns of 8-unit cells; the reveal steps a whole column at a time.
  const columns = 72;
  const visible =
    props.shown <= 0
      ? share
      : Math.max(share, Math.round((share + (1 - share) * props.shown) * columns) / columns);
  return (
    <div
      style={{
        position: "absolute",
        left: props.x,
        top: props.y,
        width,
        height,
        clipPath: `inset(0 ${(1 - Math.min(1, visible)) * 100}% 0 0)`,
        ...props.style,
      }}
    >
      <Img src={staticFile(props.src)} style={{ width, height, display: "block" }} />
    </div>
  );
}

/** The round's claim, bottom-aligned above the split so one- and two-line claims sit alike. */
/** The intro starts mid-rise so frame 0, the feed thumbnail, already carries the hook. */
function Claim(props: { text: string; layout: Layout; start: number }) {
  const { type, space } = useVideo();
  const layout = props.layout;
  return (
    <div
      style={{
        position: "absolute",
        left: layout.inset.left,
        right: layout.inset.right,
        top: layout.inset.top,
        height: layout.splitTop - space(7) - layout.inset.top,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <Words
        text={props.text}
        start={props.start}
        step={0.07}
        style={{
          fontSize: type("headline"),
          fontWeight: 700,
          letterSpacing: "-0.035em",
          lineHeight: 1.04,
        }}
      />
    </div>
  );
}

/** Copy that rises in word by word; *marked* words take the accent. */
function Words(props: {
  text: string;
  start: number;
  step: number;
  style?: CSSProperties;
}) {
  const { theme } = useVideo();
  const tween = useTween();
  // "\n" forces a line break, so a tagline can break on its phrases instead of wherever it wraps.
  const lines = props.text.split("\n").map((line) =>
    parseEmphasis(line).flatMap((segment) =>
      segment.text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({ word, emphasis: segment.emphasis })),
    ),
  );
  // Word order across lines, so the stagger runs through the whole text.
  const offsets = lines.map((_, row) =>
    lines.slice(0, row).reduce((sum, line) => sum + line.length, 0),
  );
  return (
    <div
      style={{
        fontFamily: theme.fonts.sans,
        color: theme.palette.text,
        textAlign: "center",
        textWrap: "balance",
        ...props.style,
      }}
    >
      {lines.map((line, row) => (
        <div key={row}>
          {line.map((item, index) => {
            const amount = tween(
              props.start + ((offsets[row] ?? 0) + index) * props.step,
              0.7,
            );
            return (
              <span
                key={index}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  opacity: amount,
                  translate: `0px ${(1 - amount) * 0.28}em`,
                  color: item.emphasis ? theme.palette.accent : undefined,
                }}
              >
                {item.word}
                {index < line.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Same task on both sides: two identical, plain task cards. */
function Intro(props: { layout: Layout }) {
  const tween = useTween();
  return (
    <>
      {(["left", "right"] as const).map((side, index) => {
        const amount = tween(0.7 + index * 0.1, 0.7);
        return (
          <Side key={side} side={side} top={props.layout.contentTop} layout={props.layout}>
            <div style={{ opacity: amount, translate: `0px ${(1 - amount) * 24}px` }}>
              <TaskCard />
            </div>
          </Side>
        );
      })}
    </>
  );
}

function TaskCard() {
  const { theme, space } = useVideo();
  const bar = (width: string, color = theme.palette.border) => (
    <div style={{ height: space(1.5), width, borderRadius: space(0.75), backgroundColor: color }} />
  );
  return (
    <div
      style={{
        width: space(38),
        padding: space(4),
        boxSizing: "border-box",
        borderRadius: theme.radius.lg,
        border: `${theme.hairline}px solid ${theme.palette.border}`,
        display: "flex",
        flexDirection: "column",
        gap: space(2.5),
      }}
    >
      <div style={{ display: "flex", gap: space(1.5), alignItems: "center", marginBottom: space(1) }}>
        <div
          style={{
            width: space(2.5),
            height: space(2.5),
            borderRadius: space(0.6),
            border: `${theme.hairline * 1.5}px solid ${theme.palette.textMuted}`,
          }}
        />
        {bar("46%", theme.palette.textMuted)}
      </div>
      {bar("100%")}
      {bar("84%")}
      {bar("62%")}
    </div>
  );
}

/** Round 1: both claim the tests pass; only the right side runs them. */
function Check(props: { scene: Scene; layout: Layout }) {
  const { theme, type, space } = useVideo();
  const tween = useTween();
  const layout = props.layout;
  const claim = tween(0.55, 0.7);
  const panel = tween(1.35, 0.6);
  const input = props.scene.run.find((line) => line.kind === "input");
  const results = props.scene.run.filter((line) => line.kind !== "input");
  const typed = 1.55;
  const running = typed + typeDuration(input?.text ?? "", 18) + 0.2;
  // The cells count the tests in the result line, one cell per test.
  const count = Math.min(
    60,
    Number(results.map((line) => line.text.match(/\d+/)?.[0]).find(Boolean) ?? 0),
  );
  const runFor = 0.9;
  const done = running + (count > 0 ? runFor : 0) + 0.1;
  const proven = tween(done, 0.35);
  const claimStyle = {
    fontFamily: theme.fonts.sans,
    fontSize: type("body"),
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: 1.3,
    display: "flex",
    alignItems: "center",
    gap: space(1.5),
    opacity: claim,
    translate: `0px ${(1 - claim) * 20}px`,
  } as const;
  const claimText = (props.scene.claim ?? "").replace(/^✓\s*/, "");
  return (
    <>
      <Side side="left" top={layout.contentTop} layout={layout}>
        <div style={{ ...claimStyle, color: theme.palette.textMuted }}>
          <CheckMark color={theme.palette.textMuted} size={type("body")} />
          {claimText}
        </div>
      </Side>
      <Side side="right" top={layout.contentTop} layout={layout}>
        <div style={{ ...claimStyle, color: theme.palette.text }}>
          <CheckMark
            color={proven > 0.5 ? theme.palette.accent : theme.palette.text}
            size={type("body")}
            scale={1 + Math.sin(proven * Math.PI) * 0.18}
          />
          {claimText}
        </div>
        <div
          style={{
            marginTop: space(5),
            width: "100%",
            boxSizing: "border-box",
            padding: `${space(3)}px ${space(3)}px`,
            borderRadius: theme.radius.md,
            border: `${theme.hairline}px solid ${theme.palette.border}`,
            backgroundColor: theme.palette.surface,
            fontFamily: theme.fonts.mono,
            fontSize: type("mono"),
            lineHeight: 1.5,
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: space(2),
            opacity: panel,
            translate: `0px ${(1 - panel) * 20}px`,
          }}
        >
          {input ? (
            <div style={{ color: theme.palette.text }}>
              <span style={{ color: theme.palette.accent }}>$ </span>
              <TypeReveal text={input.text} delay={typed} charsPerSecond={18} caret={false} />
            </div>
          ) : null}
          {count > 0 ? <TestCells count={count} start={running} duration={runFor} /> : null}
          {results.map((line, index) => {
            const shown = tween(done + index * 0.12, 0.4);
            return (
              <div
                key={index}
                style={{
                  color: line.kind === "error" ? theme.palette.danger : theme.palette.accent,
                  fontWeight: 700,
                  opacity: shown,
                  translate: `0px ${(1 - shown) * 10}px`,
                }}
              >
                {line.kind === "error" ? "✗ " : line.kind === "success" ? "✓ " : "  "}
                {line.text}
              </div>
            );
          })}
        </div>
      </Side>
    </>
  );
}

/** One square per test, lighting up in order as the run goes: the count is visibly real. */
function TestCells(props: { count: number; start: number; duration: number }) {
  const { theme, space } = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const columns = 14;
  const lit = Math.floor(
    interpolate(frame, [props.start * fps, (props.start + props.duration) * fps], [0, props.count], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const cell = space(2.25);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
        gap: space(0.75),
        opacity: frame >= props.start * fps - 6 ? 1 : 0,
      }}
    >
      {Array.from({ length: props.count }, (_, index) => (
        <div
          key={index}
          style={{
            width: cell,
            height: cell,
            backgroundColor: index < lit ? theme.palette.accent : theme.palette.border,
          }}
        />
      ))}
    </div>
  );
}

function CheckMark(props: { color: string; size: number; scale?: number }) {
  return (
    <svg
      width={props.size * 0.8}
      height={props.size * 0.8}
      viewBox="0 0 24 24"
      style={{ display: "block", flexShrink: 0, scale: props.scale ?? 1 }}
    >
      <path
        d="M4 12.5 L9.5 18 L20 6.5"
        fill="none"
        stroke={props.color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Round 2: a lone flat bubble against a history that fills in as the replay plays. */
function Memory(props: { layout: Layout }) {
  const { theme, space } = useVideo();
  const tween = useTween();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = props.layout;
  const bubble = tween(0.55, 0.7);
  const grid = tween(0.65, 0.6);
  const columns = 11;
  const rows = 7;
  const cell = space(3.25);
  const gap = space(1);
  const width = columns * cell + (columns - 1) * gap;
  const playStart = 1.0;
  const playFor = 2.7;
  const play = interpolate(frame, [playStart * fps, (playStart + playFor) * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: motion.move,
  });
  const levels = [
    theme.palette.surfaceRaised,
    "rgba(0, 0, 170, 0.45)",
    "rgba(0, 0, 170, 0.8)",
    "#2A2AD4",
    theme.palette.accent,
  ];
  return (
    <>
      <Side side="left" top={layout.contentTop} layout={layout}>
        <div style={{ opacity: bubble, translate: `0px ${(1 - bubble) * 20}px` }}>
          <Bubble />
        </div>
      </Side>
      <Side side="right" top={layout.contentTop} layout={layout}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(${rows}, ${cell}px)`,
            gap,
            opacity: grid,
            translate: `0px ${(1 - grid) * 20}px`,
          }}
        >
          {Array.from({ length: columns * rows }, (_, index) => {
            const column = Math.floor(index / rows);
            const row = index % rows;
            // Busier toward the recent end, like a real week of work.
            const level = Math.min(
              4,
              Math.floor(random(`memory-${column}-${row}`) * 3 + (column / columns) * 2.4),
            );
            const reached = play >= (column + 0.5) / columns;
            const at = playStart + ((column + 0.5) / columns) * playFor;
            const pop = tween(at + row * 0.02, 0.3);
            return (
              <div
                key={index}
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: space(0.5),
                  backgroundColor: reached ? levels[level] : levels[0],
                  scale: reached ? 0.7 + 0.3 * pop : 1,
                }}
              />
            );
          })}
        </div>
        <Replay width={width} columns={columns} play={play} opacity={grid} />
      </Side>
    </>
  );
}

/** The replay timeline under the history: one tick per step, a playhead crossing them. */
function Replay(props: { width: number; columns: number; play: number; opacity: number }) {
  const { theme, space } = useVideo();
  const height = space(4);
  const tick = space(1.25);
  const line = theme.hairline * 1.5;
  const x = props.play * props.width;
  return (
    <div
      style={{
        position: "relative",
        width: props.width,
        height,
        marginTop: space(6),
        opacity: props.opacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: height / 2 - line / 2,
          height: line,
          backgroundColor: theme.palette.border,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          width: x,
          top: height / 2 - line / 2,
          height: line,
          backgroundColor: theme.palette.accent,
        }}
      />
      {Array.from({ length: props.columns }, (_, index) => {
        const at = ((index + 0.5) / props.columns) * props.width;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: at - tick / 2,
              top: height / 2 - tick / 2,
              width: tick,
              height: tick,
              backgroundColor: x >= at ? theme.palette.accent : theme.palette.border,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: x - line,
          top: 0,
          width: line * 2,
          height,
          borderRadius: line,
          backgroundColor: theme.palette.text,
          opacity: props.play > 0 && props.play < 1 ? 1 : props.play >= 1 ? 0.0 : 0.6,
        }}
      />
    </div>
  );
}

function Bubble() {
  const { theme, space } = useVideo();
  const bar = (width: string) => (
    <div
      style={{
        height: space(1.5),
        width,
        borderRadius: space(0.75),
        backgroundColor: theme.palette.border,
      }}
    />
  );
  const tail = space(3);
  return (
    <div style={{ position: "relative", width: space(34) }}>
      <div
        style={{
          padding: `${space(3.5)}px ${space(4)}px`,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.palette.surfaceRaised,
          display: "flex",
          flexDirection: "column",
          gap: space(2),
        }}
      >
        {bar("100%")}
        {bar("58%")}
      </div>
      <svg
        width={tail}
        height={tail}
        viewBox="0 0 10 10"
        style={{ position: "absolute", left: space(4), bottom: -tail + 1, display: "block" }}
      >
        <path d="M0 0 L10 0 L0 10 Z" fill={theme.palette.surfaceRaised} />
      </svg>
    </div>
  );
}

/** Round 3: the same failure, buried on the left and impossible to miss on the right. */
function Alert(props: { scene: Scene; layout: Layout }) {
  const { theme, type, space } = useVideo();
  const tween = useTween();
  const layout = props.layout;
  const icon = space(16);
  // The check has to read as a check before it turns, or the turn means nothing.
  const draw = tween(0.45, 0.5, motion.move);
  const turn = tween(1.4, 0.45, motion.move);
  const loud = tween(1.75, 0.35);
  const quiet = tween(1.2, 1.2);
  const loudSize = type("headline") * 0.8;
  const textTop = layout.contentTop + icon + space(4);
  return (
    <>
      <Side side="left" top={textTop + loudSize * 1.04 - type("body") * 0.65} layout={layout}>
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: type("body") * 0.9,
            fontWeight: 400,
            color: theme.palette.textMuted,
            opacity: 0.36 * quiet,
          }}
        >
          {props.scene.claim}
        </div>
      </Side>
      <Side side="right" top={layout.contentTop} layout={layout}>
        <CheckToCross size={icon} draw={draw} turn={turn} color={theme.palette.danger} />
      </Side>
      <Side side="right" top={textTop} layout={layout}>
        <div
          style={{
            fontFamily: theme.fonts.sans,
            fontSize: loudSize,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1.04,
            color: theme.palette.warning,
            textWrap: "balance",
            opacity: loud,
            scale: 1.08 - 0.08 * loud,
          }}
        >
          {props.scene.claim}
        </div>
      </Side>
    </>
  );
}

/** A check mark drawn in, then its two strokes swing into an X. */
function CheckToCross(props: { size: number; draw: number; turn: number; color: string }) {
  const mix = (a: number, b: number) => a + (b - a) * props.turn;
  const first = [mix(14, 20), mix(52, 20), mix(38, 80), mix(76, 80)];
  const second = [mix(38, 80), mix(76, 20), mix(86, 20), mix(24, 80)];
  const stroke = (points: number[], key: string, delay: number) => {
    const shown = Math.min(1, Math.max(0, (props.draw - delay) / (1 - delay || 1)));
    return (
      <line
        key={key}
        x1={points[0]}
        y1={points[1]}
        x2={points[2]}
        y2={points[3]}
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - shown}
        stroke={props.color}
        strokeWidth={8}
        strokeLinecap="round"
      />
    );
  };
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 100 100" style={{ display: "block" }}>
      {stroke(first, "a", 0)}
      {stroke(second, "b", 0.35)}
    </svg>
  );
}

/** The close: the split resolves, the monogram grows into the whole mark, then the line. */
function Close(props: { scene: Scene; layout: Layout }) {
  const { theme, type, space, frame } = useVideo();
  const tween = useTween();
  const layout = props.layout;
  const width = layout.closeWidth;
  const height = width / layout.aspect;
  const x = (frame.width - width) / 2;
  const top = Math.round(frame.height * 0.28);
  // Nothing moves until the fade in has finished, so the outgoing frame's mark never ghosts.
  const settle = props.scene.transition?.durationInSeconds ?? 0;
  const move = tween(settle, 0.7, motion.move);
  const fromHeight = layout.markHeight;
  const fromX = layout.centers.right - (fromHeight * layout.monogram) / 2;
  const gone = tween(settle, 0.4, motion.exit);
  const lines = tween(settle + 1.6, 0.6);
  const url = tween(settle + 1.75, 0.6);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.background }}>
      <div
        style={{
          position: "absolute",
          left: layout.mid - theme.hairline / 2,
          top: layout.splitTop,
          width: theme.hairline,
          height: layout.splitBottom - layout.splitTop,
          backgroundColor: theme.palette.border,
          scale: `1 ${1 - gone}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: layout.centers.left - layout.markHeight / 2,
          top: layout.markTop,
          opacity: 1 - gone,
          scale: 1 - gone * 0.1,
        }}
      >
        <BotGlyph size={layout.markHeight} color={theme.palette.textMuted} />
      </div>
      <Mark
        src={props.scene.mark}
        layout={layout}
        x={fromX + (x - fromX) * move}
        y={layout.markTop + (top - layout.markTop) * move}
        height={fromHeight + (height - fromHeight) * move}
        shown={tween(settle + 0.2, 0.6, motion.move)}
      />
      <div
        style={{
          position: "absolute",
          left: layout.inset.left,
          right: layout.inset.right,
          top: top + height + space(10),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: space(1.5),
        }}
      >
        <Words
          text={props.scene.headline}
          start={settle + 0.8}
          step={0.045}
          style={{
            fontSize: type("headline") * 0.7,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            marginBottom: space(7),
          }}
        />
        {props.scene.subline ? (
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: type("label") * 1.1,
              fontWeight: 600,
              color: theme.palette.text,
              opacity: lines,
              translate: `0px ${(1 - lines) * 12}px`,
            }}
          >
            {props.scene.subline}
          </div>
        ) : null}
        {props.scene.url ? (
          <div
            style={{
              fontFamily: theme.fonts.sans,
              fontSize: type("label"),
              fontWeight: 500,
              color: theme.palette.textMuted,
              opacity: url,
              translate: `0px ${(1 - url) * 12}px`,
            }}
          >
            {props.scene.url}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
