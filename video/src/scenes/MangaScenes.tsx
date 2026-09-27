/**
 * The manga scene: a paper page of 1–3 ink panels read right-to-left,
 * top-to-bottom, with a slow camera (push, pan, still, deterministic shake).
 * Panel artwork is composed from the shared cast (Ant rig) and FX kit, driven
 * entirely by the spec: art keys pick the staging, balloons carry the words.
 */
import type { CSSProperties } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Ant } from "../components/Manga/Ant";
import { Balloon, Sfx, type BalloonTail } from "../components/Manga/Balloon";
import { Dirt, GlintStar, Grain, ImpactLines, SpeedLines, ToneRect } from "../components/Manga/Fx";
import { Panel } from "../components/Manga/Panel";
import { SceneFrame } from "../components/Layout/SceneFrame";
import { useVideo } from "../lib/context";
import { contentBox } from "../styles/scale";
import type { SceneOf } from "../spec/schema";

type MangaProps = { scene: SceneOf<"manga"> };
type Art = SceneOf<"manga">["panels"][number]["art"];

const INK = "#161616";
const PAPER = "#FFFFFF";
const RED = "#D42B1E";
const GUTTER = 14;

const WEIGHT: Record<Art, number> = {
  standup: 1.7,
  glint: 1,
  sprint: 2.6,
  whisper: 1,
  rewire: 1,
  rename: 1,
  pillar: 1,
  cavein: 1,
  aftermath: 1.5,
  verdict: 1,
  ship: 1,
  nightdesk: 1,
  errors: 2.2,
  duck: 1,
  blast: 1.6,
  sunrise: 1,
  sleep: 1,
};

function cameraStyle(camera: SceneOf<"manga">["camera"], frame: number, frames: number): CSSProperties {
  if (camera === "shake") {
    return {
      transform: `translate(${Math.sin(frame * 1.9) * 14}px, ${Math.cos(frame * 2.6) * 11}px) rotate(${Math.sin(frame * 2.2) * 0.7}deg)`,
    };
  }
  if (camera === "pan") {
    const x = interpolate(frame, [0, frames], [2, -2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { transform: `translateX(${x}%) scale(1.05)` };
  }
  if (camera === "still") return {};
  const s = interpolate(frame, [0, frames], [1, 1.08], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { transform: `scale(${s})` };
}

export function MangaScene(props: MangaProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { frame: size, theme } = useVideo();
  const box = contentBox(size);
  const panels = props.scene.panels;
  const frames = Math.round(props.scene.durationInSeconds * fps);
  const allInvert = panels.length === 1 && (panels[0]?.invert ?? false);
  const row = panels.length === 3;
  // Page margins double as camera headroom: the camera never crops past them.
  const pad = Math.round(Math.min(box.width, box.height) * 0.045);
  const inner = { width: box.width - pad * 2, height: box.height - pad * 2 };

  return (
    <SceneFrame
      justify="center"
      style={{ backgroundColor: allInvert ? "#000000" : theme.palette.background }}
    >
      <div style={{ width: box.width, height: box.height, overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", padding: pad, boxSizing: "border-box" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: row ? "row-reverse" : "column",
              gap: GUTTER,
              ...cameraStyle(props.scene.camera, frame, frames),
            }}
          >
            {panels.map((panel, i) => (
              <PanelArt key={i} scene={props.scene} index={i} box={inner} />
            ))}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

function PanelArt(props: { scene: SceneOf<"manga">; index: number; box: { width: number; height: number } }) {
  const panel = props.scene.panels[props.index]!;
  const count = props.scene.panels.length;
  const gapTotal = GUTTER * (count - 1);
  let w = props.box.width;
  let h = props.box.height;
  if (count === 3) {
    w = (props.box.width - gapTotal) / 3;
  } else if (count === 2) {
    const weights = props.scene.panels.map((p) => WEIGHT[p.art]);
    const total = weights.reduce((a, b) => a + b, 0);
    h = ((props.box.height - gapTotal) * (weights[props.index] ?? 1)) / total;
  }
  const fontPx = Math.min(56, Math.max(30, Math.min(w, h) * 0.11));
  return (
    <Panel invert={panel.invert} label={panel.label} style={{ width: count === 3 ? w : "100%", height: count === 3 ? "100%" : h, flex: count === 1 ? 1 : undefined }}>
      <ArtBody art={panel.art} w={w} fontPx={fontPx} />
      {panel.balloons.map((b, bi) => (
        <div key={bi} style={spot(panel.art, bi, w)}>
          <Balloon text={b.text} tail={b.tail as BalloonTail} whisper={b.whisper} fontPx={fontPx} />
        </div>
      ))}
      {panel.sfx ? (
        <div style={sfxSpot(panel.art)}>
          <Sfx text={panel.sfx} fontPx={panel.art === "cavein" ? w / 4 : fontPx * 3.4} invert={panel.invert} />
        </div>
      ) : null}
      <Grain opacity={0.08} />
    </Panel>
  );
}

function spot(art: Art, index: number, w: number): CSSProperties {
  const base: CSSProperties = { position: "absolute", display: "flex" };
  const spots: Record<string, CSSProperties> = {
    "standup-0": { right: "4%", top: "5%", width: "46%", justifyContent: "flex-end" },
    "verdict-0": { left: "4%", top: "6%", width: "52%" },
    "verdict-1": { right: "4%", bottom: "5%", width: "52%", justifyContent: "flex-end" },
    "whisper-0": { left: "0%", right: "0%", top: "12%", justifyContent: "center" },
    "pillar-0": { left: "0%", right: "0%", bottom: "4%", justifyContent: "center" },
    "nightdesk-0": { right: "4%", top: "6%", width: "44%", justifyContent: "flex-end" },
    "errors-0": { left: "6%", top: "5%", width: "56%" },
    "duck-0": { left: "0%", right: "0%", top: "10%", justifyContent: "center" },
    "sunrise-0": { left: "8%", bottom: "8%", width: "56%" },
  };
  return { ...base, ...(spots[`${art}-${index}`] ?? { left: "6%", top: "6%", width: "60%" }), width: spots[`${art}-${index}`]?.width ?? Math.min(w * 0.6, 560) };
}

function sfxSpot(art: Art): CSSProperties {
  if (art === "cavein") return { position: "absolute", left: 0, right: 0, top: "30%", display: "flex", justifyContent: "center" };
  if (art === "glint") return { position: "absolute", left: "6%", top: "8%" };
  return { position: "absolute", left: 0, right: 0, top: "10%", display: "flex", justifyContent: "center" };
}

/** Panel artwork: pure vector staging per art key. viewBox crops with slice. */
function ArtBody(props: { art: Art; w: number; fontPx: number }) {
  const { art, w } = props;
  if (art === "cavein") {
    return (
      <svg viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block" }}>
        <rect width="800" height="800" fill="#000000" />
        <ImpactLines cx={400} cy={330} r0={90} r1={390} ink="#FFFFFF" />
        <ToneRect x={0} y={620} w={800} h={180} ink="#FFFFFF" opacity={0.16} gap={16} dot={4} />
        <Dirt w={800} h={800} ink="#FFFFFF" />
        <g stroke="#FFFFFF" strokeWidth={10} strokeLinecap="round">
          <path d="M120 620 L260 520 L300 560" fill="none" />
          <path d="M680 640 L560 540 L520 580" fill="none" />
        </g>
      </svg>
    );
  }
  if (art === "ship") {
    return (
      <div style={{ width: "100%", height: "100%", backgroundColor: PAPER, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 900, fontSize: Math.min(120, w * 0.13), color: RED, letterSpacing: "-0.02em" }}>
          Ship the ticket.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width={104} height={110} viewBox="20 0 170 200">
            <Ant pose="run" expression="happy" ink={INK} paper={PAPER} />
          </svg>
          <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 44, color: INK }}>— RIFT</div>
        </div>
      </div>
    );
  }
  const tall = art === "rewire" || art === "rename" || art === "pillar";
  const vb = art === "sleep" ? "0 0 800 800" : tall ? "0 0 300 900" : "0 0 800 500";
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block" }}>
      <rect x={-200} y={-200} width={tall ? 700 : 1200} height={tall ? 1300 : 900} fill={PAPER} />
      {art === "standup" && <StandupArt />}
      {art === "glint" && <GlintArt />}
      {art === "sprint" && <SprintArt />}
      {art === "whisper" && <WhisperArt />}
      {art === "rewire" && <RewireArt />}
      {art === "rename" && <RenameArt />}
      {art === "pillar" && <PillarArt />}
      {art === "aftermath" && <AftermathArt />}
      {art === "verdict" && <VerdictArt />}
      {art === "nightdesk" && <NightdeskArt />}
      {art === "errors" && <ErrorsArt />}
      {art === "duck" && <DuckArt />}
      {art === "blast" && <BlastArt />}
      {art === "sunrise" && <SunriseArt />}
      {art === "sleep" && <SleepArt />}
    </svg>
  );
}

function floorLine(y: number, x1 = 40, x2 = 760) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth={6} strokeLinecap="round" />;
}

const NIGHT = "#0D1626";
const NIGHT2 = "#16263F";
const PHOS = "#62D39A";
const CREAM = "#EDEAE0";
const DAWN = "#F2A541";
const DAWN_DEEP = "#E8843C";
const LEAF = "#3E8E4D";

function StandupArt() {
  return (
    <g>
      <ToneRect x={560} y={0} w={240} h={200} />
      {floorLine(430)}
      <g transform="translate(200 190) scale(1.35)">
        <Ant queen expression="normal" ink={INK} paper={PAPER} />
      </g>
      {[
        { x: 470, s: 0.85, e: "happy" as const },
        { x: 590, s: 0.85, e: "happy" as const },
        { x: 700, s: 0.8, e: "normal" as const },
      ].map((a, i) => (
        <g key={i} transform={`translate(${a.x} 250) scale(${a.s})`}>
          <Ant expression={a.e} ink={INK} paper={PAPER} />
        </g>
      ))}
      {/* ticket leaves held high */}
      <g stroke={INK} strokeWidth={5} fill={PAPER}>
        <ellipse cx={500} cy={170} rx={34} ry={20} transform="rotate(-24 500 170)" />
        <ellipse cx={620} cy={160} rx={34} ry={20} transform="rotate(18 620 160)" />
      </g>
    </g>
  );
}

function GlintArt() {
  return (
    <g>
      <ToneRect x={0} y={0} w={800} h={500} opacity={0.2} gap={14} dot={3.6} />
      <g transform="translate(430 130) scale(2.1)">
        <Ant kevin expression="narrow" blink={false} ink={INK} paper={PAPER} />
      </g>
      <GlintStar x={620} y={150} s={26} />
      <GlintStar x={180} y={330} s={16} />
      <g stroke={INK} strokeWidth={6} strokeLinecap="round" opacity={0.8}>
        <line x1={60} y1={420} x2={220} y2={400} />
        <line x1={60} y1={460} x2={200} y2={452} />
      </g>
    </g>
  );
}

function SprintArt() {
  return (
    <g>
      <SpeedLines w={800} h={500} />
      <ToneRect x={0} y={380} w={800} h={120} opacity={0.3} />
      {floorLine(430)}
      <g transform="translate(300 190) scale(1.5)">
        <Ant kevin pose="run" expression="determined" blink={false} ink={INK} paper={PAPER} />
      </g>
      {/* giant red REFACTOR leaf */}
      <g transform="rotate(-14 560 180)">
        <path
          d="M440 180 Q560 90 690 160 Q610 260 440 180 Z"
          fill={RED}
          stroke={INK}
          strokeWidth={7}
          strokeLinejoin="round"
        />
        <line x1={460} y1={180} x2={660} y2={168} stroke={PAPER} strokeWidth={5} strokeLinecap="round" />
        <text x={565} y={196} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={900} fontSize={44} fill={PAPER} transform="rotate(2 565 196)">
          REFACTOR
        </text>
      </g>
    </g>
  );
}

function WhisperArt() {
  return (
    <g>
      <ToneRect x={600} y={300} w={200} h={200} opacity={0.25} />
      {floorLine(430, 60, 420)}
      <g transform="translate(120 260) scale(0.85)">
        <Ant expression="normal" ink={INK} paper={PAPER} />
      </g>
      <g stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.7}>
        <path d="M300 300 Q340 280 380 292" strokeDasharray="2 14" />
      </g>
    </g>
  );
}

function RewireArt() {
  return (
    <g>
      <ToneRect x={0} y={0} w={300} h={300} opacity={0.22} />
      {/* tunnel arches */}
      <g stroke={INK} strokeWidth={6} fill="none" opacity={0.85}>
        <path d="M30 880 L30 200 Q150 120 270 200 L270 880" />
        <path d="M60 880 L60 240 Q150 175 240 240" opacity={0.5} />
      </g>
      {/* tangled wires */}
      <g stroke={INK} strokeWidth={5} fill="none" strokeLinecap="round">
        <path d="M40 420 Q120 380 150 460 Q180 540 260 470" />
        <path d="M40 500 Q140 540 170 470 Q200 400 260 450" />
        <path d="M150 460 L150 330" />
      </g>
      <GlintStar x={150} y={310} s={14} />
      <GlintStar x={230} y={490} s={10} />
      <g transform="translate(60 560) scale(1.15)">
        <Ant kevin pose="stand" expression="determined" blink={false} ink={INK} paper={PAPER} />
      </g>
      {/* wrench */}
      <g stroke={INK} strokeWidth={9} strokeLinecap="round" fill="none" transform="rotate(24 210 640)">
        <line x1={210} y1={700} x2={210} y2={600} />
        <path d="M192 600 A20 20 0 1 1 228 600" />
      </g>
    </g>
  );
}

function RenameArt() {
  const sign = (y: number, old: string, young: string, key: number) => (
    <g key={key}>
      <rect x={40} y={y} width={220} height={120} fill={PAPER} stroke={INK} strokeWidth={6} />
      <text x={150} y={y + 48} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={34} fill={INK} textDecoration="line-through">
        {old}
      </text>
      <text x={150} y={y + 96} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={900} fontSize={36} fill={INK}>
        {young}
      </text>
    </g>
  );
  return (
    <g>
      <ToneRect x={0} y={640} w={300} h={260} opacity={0.25} />
      {floorLine(830, 30, 270)}
      {sign(120, "pantry", "cache", 0)}
      {sign(280, "nursery", "pods", 1)}
      <g transform="translate(70 560) scale(1.1)">
        <Ant kevin pose="proud" expression="happy" blink={false} ink={INK} paper={PAPER} />
      </g>
      {/* brush */}
      <g transform="rotate(-30 190 560)">
        <line x1={190} y1={640} x2={190} y2={540} stroke={INK} strokeWidth={10} strokeLinecap="round" />
        <polygon points="178,540 202,540 196,505 184,505" fill={INK} />
      </g>
    </g>
  );
}

function PillarArt() {
  return (
    <g>
      <ToneRect x={180} y={0} w={120} h={400} opacity={0.22} />
      {floorLine(830, 30, 270)}
      {/* the legacy pillar, cracking */}
      <g>
        <rect x={95} y={180} width={110} height={640} fill={PAPER} stroke={INK} strokeWidth={8} />
        <text x={150} y={520} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={900} fontSize={40} fill={INK} transform="rotate(-90 150 520)">
          legacy
        </text>
        <g stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none">
          <path d="M95 420 L130 450 L115 490" />
          <path d="M205 350 L175 390 L190 430" />
        </g>
      </g>
      <g transform="translate(-30 560) scale(1.15)">
        <Ant kevin pose="run" expression="determined" blink={false} ink={INK} paper={PAPER} flip />
      </g>
      <ImpactLines cx={150} cy={430} r0={40} r1={130} ink={INK} count={10} />
    </g>
  );
}

function AftermathArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={500} fill={PAPER} />
      <ToneRect x={0} y={0} w={800} h={500} opacity={0.3} gap={14} dot={3.6} />
      {/* rubble */}
      <g fill={PAPER} stroke={INK} strokeWidth={6} strokeLinejoin="round">
        <polygon points="80,430 170,400 220,440 120,460" />
        <polygon points="600,440 700,410 750,450 640,465" />
      </g>
      {floorLine(445, 40, 760)}
      <g transform="translate(90 210) scale(1.05)">
        <Ant expression="dazed" dusty ink={INK} paper={PAPER} />
      </g>
      <g transform="translate(330 230) scale(0.95)">
        <Ant expression="knocked" dusty ink={INK} paper={PAPER} flip />
      </g>
      <g transform="translate(560 215) scale(1)">
        <Ant expression="dazed" dusty ink={INK} paper={PAPER} />
      </g>
    </g>
  );
}

function VerdictArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={500} fill={PAPER} />
      <ToneRect x={520} y={0} w={280} h={500} opacity={0.2} />
      {floorLine(430, 40, 760)}
      <g transform="translate(120 150) scale(1.45)">
        <Ant queen expression="deadpan" blink={false} ink={INK} paper={PAPER} />
      </g>
      <g transform="translate(520 230) scale(0.95)">
        <Ant kevin expression="normal" sweat ink={INK} paper={PAPER} />
      </g>
    </g>
  );
}

function NightdeskArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={500} fill={NIGHT} />
      <GlintStar x={90} y={70} s={7} fill={CREAM} />
      <GlintStar x={200} y={140} s={5} fill={CREAM} />
      <GlintStar x={60} y={220} s={5} fill={CREAM} />
      {/* rain window */}
      <g>
        <rect x={590} y={30} width={160} height={150} fill={NIGHT2} stroke={CREAM} strokeWidth={6} />
        <circle cx={712} cy={72} r={19} fill={CREAM} opacity={0.9} />
        <g stroke={CREAM} strokeWidth={4} strokeLinecap="round" opacity={0.55}>
          <line x1={606} y1={100} x2={592} y2={136} />
          <line x1={636} y1={100} x2={622} y2={136} />
          <line x1={666} y1={100} x2={652} y2={136} />
          <line x1={696} y1={100} x2={682} y2={136} />
          <line x1={726} y1={100} x2={712} y2={136} />
          <line x1={621} y1={142} x2={607} y2={172} />
          <line x1={651} y1={142} x2={637} y2={172} />
          <line x1={681} y1={142} x2={667} y2={172} />
          <line x1={711} y1={142} x2={697} y2={172} />
        </g>
      </g>
      {/* desk */}
      <rect x={0} y={400} width={800} height={100} fill={NIGHT2} />
      <line x1={0} y1={400} x2={800} y2={400} stroke={CREAM} strokeWidth={5} />
      {/* lamp pool */}
      <ellipse cx={250} cy={400} rx={210} ry={60} fill={CREAM} opacity={0.14} />
      {/* terminal */}
      <g>
        <rect x={330} y={180} width={330} height={220} fill="#05080F" stroke={CREAM} strokeWidth={6} />
        <rect x={330} y={180} width={330} height={34} fill={CREAM} opacity={0.16} />
        <g fill={PHOS}>
          <text x={352} y={252} fontFamily="monospace" fontWeight={700} fontSize={34}>{">_ build"}</text>
          <rect x={352} y={270} width={220} height={14} />
          <rect x={352} y={296} width={150} height={14} opacity={0.7} />
          <rect x={352} y={322} width={260} height={14} opacity={0.45} />
          <rect x={352} y={348} width={90} height={22} />
        </g>
      </g>
      {/* ant at the keyboard */}
      <g transform="translate(120 190) scale(1.15)">
        <Ant expression="determined" blink={false} ink={CREAM} paper={NIGHT} />
      </g>
      {/* coffee stack */}
      <g stroke={CREAM} strokeWidth={5} fill="none" strokeLinecap="round">
        <polygon points="690,400 730,400 724,360 696,360" />
        <polygon points="700,356 736,356 730,322 706,322" />
        <polygon points="710,318 742,318 737,290 715,290" />
        <path d="M712 270 Q706 250 716 236" />
        <path d="M730 272 Q736 254 728 240" />
      </g>
    </g>
  );
}

function ErrorsArt() {
  const popup = (x: number, y: number, r: number, key: number) => (
    <g key={key} transform={`rotate(${r} ${x} ${y})`}>
      <rect x={x} y={y} width={250} height={150} fill={PAPER} stroke={INK} strokeWidth={7} />
      <rect x={x} y={y} width={250} height={36} fill={INK} />
      <text x={x + 125} y={y + 100} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={900} fontSize={52} fill={INK}>
        ERROR!
      </text>
    </g>
  );
  return (
    <g>
      <SpeedLines w={800} h={500} />
      <ToneRect x={0} y={360} w={800} h={140} opacity={0.25} />
      {floorLine(430)}
      {popup(60, 60, -6, 0)}
      {popup(490, 50, 5, 1)}
      {popup(540, 260, 8, 2)}
      {popup(20, 250, -8, 3)}
      {/* clock */}
      <g transform="translate(400 90)">
        <circle r={44} fill={PAPER} stroke={INK} strokeWidth={7} />
        <line x1={0} y1={0} x2={0} y2={-28} stroke={INK} strokeWidth={7} strokeLinecap="round" />
        <line x1={0} y1={0} x2={24} y2={8} stroke={INK} strokeWidth={7} strokeLinecap="round" />
      </g>
      <g transform="translate(300 190) scale(1.25)">
        <Ant expression="dazed" sweat blink={false} ink={INK} paper={PAPER} />
      </g>
      <g stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none">
        <path d="M190 220 Q170 260 185 300" />
        <path d="M610 220 Q630 260 615 300" />
      </g>
    </g>
  );
}

function DuckArt() {
  return (
    <g>
      {floorLine(430, 60, 740)}
      <ToneRect x={560} y={280} w={240} h={220} opacity={0.2} />
      {/* the duck */}
      <g transform="translate(540 250)">
        <ellipse cx={0} cy={40} rx={62} ry={48} fill={PAPER} stroke={INK} strokeWidth={7} />
        <circle cx={38} cy={-18} r={30} fill={PAPER} stroke={INK} strokeWidth={7} />
        <polygon points="64,-24 92,-14 64,-4" fill={PAPER} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        <circle cx={44} cy={-24} r={5} fill={INK} />
        <path d="M-50 20 Q-70 40 -52 58" stroke={INK} strokeWidth={6} fill="none" strokeLinecap="round" />
      </g>
      <g transform="translate(130 220) scale(1.05)">
        <Ant pose="run" expression="determined" blink={false} ink={INK} paper={PAPER} />
      </g>
      <g fontFamily="Inter, sans-serif" fontWeight={900} fontSize={64} fill={INK}>
        <text x={330} y={200}>?</text>
        <text x={380} y={150} fontSize={84}>?</text>
      </g>
    </g>
  );
}

function BlastArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={220} fill={DAWN} />
      <rect x={0} y={220} width={800} height={140} fill={DAWN_DEEP} />
      <rect x={0} y={360} width={800} height={140} fill={PAPER} />
      <circle cx={400} cy={330} r={110} fill={PAPER} stroke={INK} strokeWidth={7} />
      <ImpactLines cx={400} cy={300} r0={120} r1={330} ink={PAPER} count={20} />
      {/* collapsing error shards */}
      <g fill={NIGHT} opacity={0.9}>
        <polygon points="120,120 190,100 170,170 100,160" />
        <polygon points="640,140 710,160 680,220 620,190" />
        <polygon points="90,330 150,320 130,380" />
        <polygon points="660,330 720,320 700,390" />
      </g>
      <g transform="translate(300 170) scale(1.35)">
        <Ant pose="proud" expression="determined" blink={false} ink={INK} paper={PAPER} />
      </g>
      {floorLine(445, 180, 620)}
    </g>
  );
}

function SunriseArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={500} fill="#FFF3DC" />
      <circle cx={400} cy={250} r={120} fill={DAWN} stroke={INK} strokeWidth={7} />
      <ImpactLines cx={400} cy={250} r0={140} r1={330} ink={DAWN} count={18} />
      {/* anthill */}
      <path d="M120 500 Q400 300 680 500 Z" fill={NIGHT} />
      <ellipse cx={330} cy={470} rx={26} ry={14} fill="#FFF3DC" />
      <ellipse cx={470} cy={478} rx={20} ry={11} fill="#FFF3DC" />
      {/* birds */}
      <g stroke={INK} strokeWidth={5} fill="none" strokeLinecap="round">
        <path d="M150 130 Q168 118 186 130 Q204 118 222 130" />
        <path d="M580 100 Q596 90 612 100 Q628 90 644 100" />
      </g>
      <g transform="translate(330 300) scale(0.7)">
        <Ant expression="happy" ink={CREAM} paper={NIGHT} />
      </g>
    </g>
  );
}

function SleepArt() {
  return (
    <g>
      <rect x={0} y={0} width={800} height={800} fill="#F7F3E8" />
      <ToneRect x={0} y={560} w={800} h={240} opacity={0.2} />
      {/* keyboard */}
      <g fill={PAPER} stroke={INK} strokeWidth={5}>
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={150 + (i % 6) * 84} y={590 + Math.floor(i / 6) * 70} width={68} height={54} rx={8} />
        ))}
      </g>
      {/* sleeping ant under a leaf blanket */}
      <g transform="translate(300 250) scale(1.3)">
        <Ant pose="prone" expression="happy" blink={false} ink={INK} paper={PAPER} />
      </g>
      <path
        d="M330 420 Q460 360 590 420 L560 500 Q460 460 360 500 Z"
        fill={LEAF}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <line x1={360} y1={462} x2={560} y2={442} stroke={PAPER} strokeWidth={5} strokeLinecap="round" />
      <g fontFamily="Inter, sans-serif" fontWeight={900} fontStyle="italic" fill={INK}>
        <text x={120} y={430} fontSize={60}>Z</text>
        <text x={165} y={345} fontSize={80}>Z</text>
        <text x={215} y={245} fontSize={100}>Z</text>
      </g>
      <text x={400} y={100} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={900} fontSize={64} fill={INK}>
        Ship it before sunrise.
      </text>
      <text x={400} y={152} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={38} fill={PHOS} stroke={INK} strokeWidth={1}>
        — RIFT
      </text>
    </g>
  );
}

export type { Art };
