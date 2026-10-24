// Walking and follow-through for creatures drawn with Canvas.shape. Creatures are posed in their own body coordinates
// (u forward, v down, w toward their right side) and mapped to pixels by a view, so legs, joints and turns are worked
// out once here instead of in every scene.
import { cap, type Part } from "./canvas"
import { TAU, clamp, smoothstep, type RGB } from "./math"

// A walking creature's animation state. phase counts strides: advance it by distance walked over stride length and
// planted feet stay put on the ground. go eases between standing (0) and walking (1), turn eases facing from 1 (right)
// to -1 (left) through a three-quarter view, and lag is a springy follow-through that overshoots as the creature
// starts, stops and turns, for tails, ears, manes and heads to trail by.
export interface Gait {
  phase: number
  go: number
  turn: number
  lag: number
  lagV: number
}

export function gait(face = 1, phase = 0): Gait {
  return { phase, go: 0, turn: face, lag: 0, lagV: 0 }
}

// Moves a gait on by `strides` (distance over stride length) in dt creature seconds, turning toward face (1 or -1) at
// `rate` (2 swings it right round in a creature second).
export function stepGait(g: Gait, strides: number, dt: number, face: number, rate = 3) {
  g.phase += strides
  g.go = clamp(g.go + (strides > 0 ? dt : -dt) * 2.5, 0, 1)
  const before = g.turn
  g.turn = face > g.turn ? Math.min(face, g.turn + dt * rate) : Math.max(face, g.turn - dt * rate)
  // The spring chases the walking pace and is kicked by turning, then rings down.
  const target = g.go + Math.abs(g.turn - before) / Math.max(dt, 1e-6) * 0.15
  g.lagV += ((target - g.lag) * 40 - g.lagV * 5) * dt
  g.lag += g.lagV * dt
}

// How a creature is seen at turn t: along scales its length (1 side-on facing right, -1 facing left) and across its
// width, which shows as it turns to face the viewer on the way round.
export function view(turn: number): [along: number, across: number] {
  const a = ((1 - turn) * Math.PI) / 2
  return [Math.cos(a), Math.sin(a)]
}

// One foot's place in the stride: how far it reaches ahead of its hip (1 at touchdown, -1 at lift-off) and how high it
// is lifted (0 on the ground). It is planted for the first `duty` of each cycle, sliding back exactly as fast as the
// body moves on, then swings forward. A creature whose stride (distance per cycle) is d keeps feet planted with a
// reach of d * duty / 2.
export function stride(phase: number, offset = 0, duty = 0.6): [reach: number, lift: number] {
  const p = (((phase + offset) % 1) + 1) % 1
  if (p < duty) return [1 - (2 * p) / duty, 0]
  const q = (p - duty) / (1 - duty)
  return [-1 + 2 * smoothstep(0, 1, q), Math.sin(Math.PI * q)]
}

// How high the body rides: 1 over each planted leg, 0 between, twice a stride.
export function bob(phase: number, duty = 0.6) {
  return 0.5 + 0.5 * Math.cos(TAU * 2 * (phase - duty / 2))
}

// The middle joint of a two-segment limb of lengths a and b from (ax, ay) to (bx, by). bend 1 puts it on the side of
// the line's left normal, behind a leg hanging from a creature facing +x (a hock or a bird's ankle); -1 in front (a
// knee or elbow). Out of reach, the limb straightens toward the tip.
export function joint(ax: number, ay: number, bx: number, by: number, a: number, b: number, bend: number): [number, number] {
  const dx = bx - ax
  const dy = by - ay
  const d = Math.hypot(dx, dy) || 1e-6
  const r = clamp(d, Math.abs(a - b) + 1e-6, a + b - 1e-6)
  const along = (a * a - b * b + r * r) / (2 * r)
  const h = Math.sqrt(Math.max(0, a * a - along * along)) * bend
  return [ax + (dx / d) * along - (dy / d) * h, ay + (dy / d) * along + (dx / d) * h]
}

// A tapered two-segment limb in body coordinates, mapped to pixels by P: root radius r0, joint r1, tip r2.
export function limb(P: (u: number, v: number) => [number, number], ax: number, ay: number, bx: number, by: number, a: number, b: number, bend: number, r0: number, r1: number, r2: number, color: RGB): Part[] {
  const [jx, jy] = joint(ax, ay, bx, by, a, b, bend)
  return [cap(...P(ax, ay), ...P(jx, jy), r0, r1, color), cap(...P(jx, jy), ...P(bx, by), r1, r2, color)]
}

// Body coordinates to pixels: u along the creature, v down, w across it toward its right side, all in units of S pixels.
// along and across are its view (see view), and len(u, w) the on-screen half-length in pixels of a part u long and w
// wide, for ellipses that foreshorten as the creature turns.
export type Body = ((u: number, v: number, w?: number) => [number, number]) & { S: number; along: number; across: number; len: (u: number, w: number) => number }

// A creature's body coordinates seen at turn (see view): x, y is where it stands in pixels and S its size in pixels.
export function body(x: number, y: number, S: number, turn: number): Body {
  const [along, across] = view(turn)
  const P = (u: number, v: number, w = 0): [number, number] => [x + (u * along - w * across) * S, y + v * S]
  return Object.assign(P, { S, along, across, len: (u: number, w: number) => (u * Math.abs(along) + w * across) * S })
}

// A quadruped's legs on its far or near side, walking in diagonal pairs. Hips sit `fore` ahead of and `hind` behind
// the middle, `top` above the ground and `w` either side; a and b are the proportions of the upper and lower leg,
// reach and lift how far a foot travels (see stride), and r the leg's radii at the hip, joint and foot. Front knees
// bend forward and hocks back. paw adds a hoof or paw that long, in its own color.
export function quadruped(P: Body, g: Gait, far: boolean, o: { fore: number; hind: number; top: number; w: number; a: number; b: number; reach: number; lift: number; r: [number, number, number]; color: RGB; paw?: [number, RGB] }): Part[] {
  const S = P.S
  const [r0, r1, r2] = o.r
  // Standing, legs are a little bent; a and b only set the proportions.
  const k = ((o.top - r2) * 1.06) / (o.a + o.b)
  const along = view(g.turn)[0]
  const legs: [number, number, number][] = [
    [o.fore, o.w, 0],
    [-o.hind, -o.w, 0],
    [o.fore, -o.w, 0.5],
    [-o.hind, o.w, 0.5],
  ]
  return legs
    .filter(([, w]) => w * along < 0 === far)
    .flatMap(([u, w, offset]) => {
      const [reach, lift] = stride(g.phase, offset)
      const fu = u + reach * o.reach * g.go
      const fv = -lift * o.lift * g.go - r2
      const Q = (a: number, b: number) => P(a, b, w)
      const parts = limb(Q, u, -o.top, fu, fv, o.a * k, o.b * k, u > 0 ? -1 : 1, r0 * S, r1 * S, r2 * S, o.color)
      return o.paw ? [...parts, cap(...Q(fu, fv), ...Q(fu + o.paw[0], fv + r2 * 0.1), r2 * 1.15 * S, r2 * S, o.paw[1])] : parts
    })
}

// A chain of tapered capsules through points along a curve, for tails and necks: path(t) for t 0..1 in pixels.
export function chain(path: (t: number) => [number, number], n: number, r0: number, r1: number, color: RGB): Part[] {
  return Array.from({ length: n }, (_, i) => cap(...path(i / n), ...path((i + 1) / n), r0 + (r1 - r0) * (i / n), r0 + (r1 - r0) * ((i + 1) / n), color))
}
