// Small birds startled into the air by a click: they burst up from cover, climb, and fly off together.
import { cap, ell, type Part } from "./canvas"
import { TAU, rand } from "./math"

export interface Flier {
  x: number
  y: number
  vx: number
  vy: number
  phase: number
}

export function startle(birds: Flier[], x: number, y: number, count: number) {
  const dir = Math.random() < 0.5 ? -1 : 1
  for (let i = 0; i < count; i++) birds.push({ x: x + rand(-0.03, 0.03), y: y + rand(-0.01, 0.01), vx: dir * rand(0.1, 0.18), vy: -rand(0.12, 0.2), phase: Math.random() * TAU })
}

// Moves the birds by dt scene seconds, the pace of the scenes' other fliers; they level off as they climb and are
// dropped once they leave the screen.
export function flyAway(birds: Flier[], dt: number, A: number) {
  for (const b of birds) {
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.vy *= Math.exp(-dt * 0.4)
    b.phase += dt * 20
  }
  return birds.filter((b) => b.y > -0.1 && b.x > -0.1 && b.x < A + 0.1)
}

// One bird as parts for Canvas.shape: a body and two beating wings, size in pixels.
export function bird(b: Flier, H: number, size: number, color: [number, number, number]): Part[] {
  const x = b.x * H
  const y = b.y * H
  const flap = Math.sin(b.phase)
  return [
    ell(x, y, 0.3 * size, 0.13 * size, 0, color),
    cap(x, y, x - size, y - size * (0.15 + flap * 0.55), 0.12 * size, 0.04 * size, color),
    cap(x, y, x + size, y - size * (0.15 + flap * 0.55), 0.12 * size, 0.04 * size, color),
  ]
}
