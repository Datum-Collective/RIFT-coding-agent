/**
 * The ANSI stage: span-styled character art drawn cell by cell, each with its
 * own foreground and background colour, plus the showdown cast — a cigarette
 * with a flickering ember, looping smoke, a bracket bot, a 6-frame bolt and
 * one-frame impact flash. Every motion is a pure function of the frame.
 */
import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { TypeReveal } from "../components/Effects/TypeReveal";
import { SceneFrame } from "../components/Layout/SceneFrame";
import { useVideo } from "../lib/context";
import type { AnsiCell } from "../../scripts/lib/ansi";
import { RIFT_CIG_COLS, riftCig } from "../data/ansiArt/riftCig";
import { contentBox } from "../styles/scale";
import type { SceneOf } from "../spec/schema";
import { SceneHeading } from "./parts";

type AnsiProps = { scene: SceneOf<"ansi"> };

const EMBER_A = "#FF5500";
const EMBER_B = "#FFAA00";
const EMBER_FLARE = "#FFD23F";
const INK = "#FFFFFF";
const DIM = "#AAAAAA";
const SHADE = "#555555";

/** Deterministic 0..1 hash for confetti and smoke scatter. No random. */
function hash(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function emberColor(frame: number, flare: boolean) {
  if (flare) return EMBER_FLARE;
  return frame % 10 < 5 ? EMBER_A : EMBER_B;
}

/** One row of fixed cells. Missing columns are empty cells. */
function CellRow(props: {
  cells: AnsiCell[];
  cols: number;
  cellW: number;
  font: string;
  reveal?: (index: number) => boolean;
  offset?: number;
}) {
  const cellH = props.cellW * 1.17;
  const fontSize = props.cellW / 0.6;
  return (
    <div style={{ height: cellH, whiteSpace: "nowrap", lineHeight: 1 }}>
      {Array.from({ length: props.cols }, (_, col) => {
        const cell = props.cells[col];
        const index = (props.offset ?? 0) + col;
        const on = props.reveal ? props.reveal(index) : true;
        return (
          <span
            key={col}
            style={{
              display: "inline-block",
              width: props.cellW,
              height: cellH,
              overflow: "hidden",
              textAlign: "center",
              fontFamily: props.font,
              fontSize,
              lineHeight: 1.17,
              color: cell?.fg ?? INK,
              backgroundColor: cell?.bg ?? "transparent",
              opacity: on ? 1 : 0,
            }}
          >
            {cell?.ch ?? " "}
          </span>
        );
      })}
    </div>
  );
}

function ArtGrid(props: {
  rows: AnsiCell[][];
  cols: number;
  cellW: number;
  reveal?: (index: number) => boolean;
}) {
  const { theme } = useVideo();
  return (
    <div>
      {props.rows.map((cells, row) => (
        <CellRow
          key={row}
          cells={cells}
          cols={props.cols}
          cellW={props.cellW}
          font={theme.fonts.mono}
          reveal={props.reveal}
          offset={row * props.cols}
        />
      ))}
    </div>
  );
}

/** Smoke: ░▒ characters rising from the ember, drifting and fading, looping. */
function Smoke(props: {
  originX: number;
  originY: number;
  cellW: number;
  count?: number;
  period?: number;
  rise?: number;
  bright?: boolean;
  start?: number;
}) {
  const frame = useCurrentFrame();
  const { theme } = useVideo();
  const count = props.count ?? 10;
  const period = props.period ?? 96;
  const particles = Array.from({ length: count }, (_, i) => {
    const age = (frame - (props.start ?? 0) + (i * period) / count) % period;
    if (age < 0) return null;
    const t = age / period;
    const drift = Math.sin(age * 0.12 + i * 1.7) * props.cellW * (0.6 + t * 1.6);
    return {
      x: props.originX + drift,
      y: props.originY - age * (props.rise ?? props.cellW * 0.55),
      ch: i % 2 === 0 ? "░" : "▒",
      opacity: (props.bright ? 0.85 : 0.55) * (1 - t),
      size: props.cellW * (0.9 + t * 0.7),
      key: i,
    };
  }).filter((p) => p !== null);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {particles.map((p) => (
        <span
          key={p.key}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            fontFamily: theme.fonts.mono,
            fontSize: p.size / 0.6,
            lineHeight: 1,
            color: props.bright ? DIM : SHADE,
            opacity: Math.max(0, p.opacity),
          }}
        >
          {p.ch}
        </span>
      ))}
    </div>
  );
}

/** The cigarette: ▬▬▬ filler with a flickering █ ember, jutting past the art. */
function Cigarette(props: { row: number; col: number; cellW: number; flare: boolean }) {
  const frame = useCurrentFrame();
  const { theme } = useVideo();
  const cellH = props.cellW * 1.17;
  const color = emberColor(frame, props.flare);
  return (
    <div
      style={{
        position: "absolute",
        left: props.col * props.cellW,
        top: props.row * cellH,
        display: "flex",
        fontFamily: theme.fonts.mono,
        fontSize: props.cellW / 0.6,
        lineHeight: 1.17,
      }}
    >
      {(["▬", "▬", "▬"] as const).map((ch, i) => (
        <span key={i} style={{ width: props.cellW, color: DIM }}>
          {ch}
        </span>
      ))}
      <span
        style={{
          width: props.cellW,
          color,
          textShadow: `0 0 ${props.cellW * (props.flare ? 0.9 : 0.45)}px ${color}`,
        }}
      >
        █
      </span>
    </div>
  );
}

const BOT_ROWS = ["╭─────╮", "│ ^_^ │", "│/[+]\\│", "╰─────╯"];

function BotBubble(props: { text: string; fontPx: number }) {
  const { theme } = useVideo();
  const inner = props.text.length + 2;
  const bar = "─".repeat(inner);
  return (
    <div
      style={{
        fontFamily: theme.fonts.mono,
        fontSize: props.fontPx,
        lineHeight: 1.3,
        color: INK,
        whiteSpace: "pre",
        textAlign: "center",
      }}
    >
      {`╭${bar}╮\n│ ${props.text} │\n╰${bar}╯`}
    </div>
  );
}

/** The smug bracket bot: slides in, idles, pops, wobbles and falls. */
function Bot(props: {
  cellW: number;
  mode: "enter" | "idle" | "pop" | "fallen";
  slideFrom?: number;
  bubble?: string;
  bubbleFontPx?: number;
  bubbleBelow?: boolean;
}) {
  const frame = useCurrentFrame();
  const { theme } = useVideo();
  const face = props.mode === "fallen" ? "│ x_x │" : props.mode === "pop" ? "│✸✸✸│" : "│ ^_^ │";
  const rows = [BOT_ROWS[0] ?? "", face, BOT_ROWS[2] ?? "", BOT_ROWS[3] ?? ""];
  const x =
    props.mode === "enter"
      ? interpolate(frame, [12, 42], [props.slideFrom ?? 560, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const wobble =
    props.mode === "pop"
      ? interpolate(frame, [0, 10, 20, 30], [0, -5, 4, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const fallen = props.mode === "fallen";
  const showBubble = props.bubble && frame >= (props.mode === "enter" ? 48 : 4);
  const bubble = showBubble ? (
    <BotBubble text={props.bubble ?? ""} fontPx={props.bubbleFontPx ?? props.cellW} />
  ) : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `translateX(${x}px) rotate(${fallen ? -16 : wobble}deg) translateY(${fallen ? props.cellW * 1.4 : 0}px)`,
        opacity: props.mode === "enter" && frame < 12 ? 0 : 1,
        transformOrigin: "50% 80%",
      }}
    >
      {props.bubbleBelow ? null : bubble}
      <div
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: props.cellW / 0.6,
          lineHeight: 1.3,
          color: INK,
          whiteSpace: "pre",
          textAlign: "center",
        }}
      >
        {rows.join("\n")}
      </div>
      {props.bubbleBelow ? bubble : null}
    </div>
  );
}

/** ✸ confetti burst at the bot's head. Deterministic scatter, fades out. */
function Confetti(props: { centerX: number; centerY: number; cellW: number; t0: number }) {
  const frame = useCurrentFrame();
  const { theme } = useVideo();
  const age = frame - props.t0;
  if (age < 0 || age > 40) return null;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {Array.from({ length: 26 }, (_, i) => {
        const angle = hash(i, 1) * Math.PI * 2;
        const speed = props.cellW * (0.35 + hash(i, 2) * 0.5);
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: props.centerX + Math.cos(angle) * speed * age,
              top: props.centerY + Math.sin(angle) * speed * age - age * props.cellW * 0.12,
              fontFamily: theme.fonts.mono,
              fontSize: props.cellW / 0.6,
              lineHeight: 1,
              color: hash(i, 3) > 0.6 ? EMBER_B : INK,
              opacity: Math.max(0, 1 - age / 40),
            }}
          >
            {hash(i, 4) > 0.4 ? "✸" : hash(i, 5) > 0.5 ? "+" : "·"}
          </span>
        );
      })}
    </div>
  );
}

/** The ━━━━✦ bolt: crosses the stage in exactly 6 frames. */
function Bolt(props: { stageW: number; y: number; cellW: number; t0: number }) {
  const frame = useCurrentFrame();
  const { theme } = useVideo();
  const age = frame - props.t0;
  if (age < 0 || age > 5) return null;
  const boltW = props.cellW * 7;
  const x = -boltW + ((age + 1) / 6) * (props.stageW + boltW);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: props.y,
        fontFamily: theme.fonts.mono,
        fontSize: props.cellW / 0.6,
        lineHeight: 1,
        color: INK,
        whiteSpace: "pre",
      }}
    >
      ━━━━✦
    </div>
  );
}

const CIG_ROW = 5;
const CIG_COL = RIFT_CIG_COLS;

function StageArt(props: {
  closeup: boolean;
  cellW: number;
  reveal?: (index: number) => boolean;
  children?: ReactNode;
}) {
  const rows = props.closeup ? riftCig.slice(2, 10).map((r) => r.slice(2, 22)) : riftCig;
  const cols = props.closeup ? 20 : RIFT_CIG_COLS;
  return (
    <div style={{ position: "relative" }}>
      <ArtGrid rows={rows} cols={cols} cellW={props.cellW} reveal={props.reveal} />
      {props.children}
    </div>
  );
}

export function AnsiScene(props: AnsiProps) {
  const frame = useCurrentFrame();
  const { frame: size, space, theme } = useVideo();
  const box = contentBox(size);
  const beat = props.scene.beat;
  const closeup = props.scene.closeup || beat === "bolt";
  const cols = closeup ? 20 : RIFT_CIG_COLS + 4;
  const rows = closeup ? 8 : riftCig.length;
  const cellW = Math.min(box.width / cols, (box.height * 0.62) / (rows * 1.17));
  const stageW = (closeup ? 20 : RIFT_CIG_COLS) * cellW;

  return (
    <SceneFrame gap={space(4)} style={{ backgroundColor: "#000000" }}>
      <SceneHeading text={props.scene.heading} />
      {beat === "headshot" ? (
        <HeadshotStage cellW={Math.min(box.width / 12, 72)} bubble={props.scene.bubble} />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: space(3),
          }}
        >
          <StageArt
            closeup={closeup}
            cellW={cellW}
            reveal={
              beat === "ember"
                ? (index) => index < (frame - 4) * 14
                : beat === "bot"
                  ? (index) => index < frame * 24
                  : undefined
            }
          >
            {closeup ? null : (
              <>
                <Cigarette row={CIG_ROW} col={CIG_COL} cellW={cellW} flare={beat === "drag" && frame >= 8 && frame <= 38} />
                <Smoke
                  originX={(CIG_COL + 3.4) * cellW}
                  originY={CIG_ROW * cellW * 1.17 - cellW * 0.4}
                  cellW={cellW}
                />
              </>
            )}
            {beat === "drag" && frame >= 8 ? (
              <Smoke
                originX={(CIG_COL + 3.4) * cellW}
                originY={CIG_ROW * cellW * 1.17 - cellW * 0.4}
                cellW={cellW * 1.3}
                count={8}
                period={30}
                rise={cellW * 1.1}
                bright
                start={8}
              />
            ) : null}
            {beat === "bolt" ? (
              <>
                <Bolt stageW={stageW} y={cellW * 4} cellW={cellW * 1.4} t0={10} />
                {frame === 16 ? (
                  <AbsoluteFill style={{ backgroundColor: "#FFFFFF" }} />
                ) : null}
                {frame > 16 ? (
                  <span
                    style={{
                      position: "absolute",
                      right: cellW * 0.5,
                      top: cellW * 3.4,
                      fontFamily: theme.fonts.mono,
                      fontSize: cellW / 0.6,
                      color: EMBER_B,
                    }}
                  >
                    ✸
                  </span>
                ) : null}
              </>
            ) : null}
          </StageArt>
          {beat === "bot" || beat === "drag" ? (
            <div style={{ width: stageW, display: "flex", justifyContent: "flex-end" }}>
              <Bot
                cellW={cellW * 0.85}
                mode={beat === "bot" ? "enter" : "idle"}
                bubble={props.scene.bubble}
                bubbleFontPx={30}
              />
            </div>
          ) : null}
        </div>
      )}
      {props.scene.terminal && (beat === "drag" || beat === "bolt") ? (
        <div
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: cellW / 0.6,
            color: DIM,
            textAlign: "center",
          }}
        >
          <span style={{ color: INK }}>$ </span>
          <TypeReveal text={props.scene.terminal} delay={1.2} charsPerSecond={24} caret />
        </div>
      ) : null}
    </SceneFrame>
  );
}

/** Beat 12–15s: the bot, large — head pops to confetti, body falls as [x_x]. */
function HeadshotStage(props: { cellW: number; bubble?: string }) {
  const frame = useCurrentFrame();
  const popped = frame >= 10;
  const fallen = frame >= 32;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ position: "relative", padding: props.cellW }}>
        <Bot
          cellW={props.cellW}
          mode={fallen ? "fallen" : popped ? "pop" : "idle"}
          bubble={props.bubble}
          bubbleFontPx={44}
          bubbleBelow
        />
        <Confetti
          centerX={props.cellW * 3.5}
          centerY={props.cellW * 1.2}
          cellW={props.cellW * 0.8}
          t0={10}
        />
      </div>
    </div>
  );
}
