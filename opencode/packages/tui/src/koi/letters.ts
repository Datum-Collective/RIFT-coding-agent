/**
 * Finding the letters of the logo, and dividing them among the koi.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */
import { isInk, type Logo } from "./logo"

export type Lpx = { x: number; y: number }

/** The logo's letter pixels, row by row: its greys, not the backdrop. */
export const inkMask = (logo: Logo) => logo.pixels.map((pixel) => pixel !== undefined && isInk(pixel))

/**
 * Splits a bitmap into its letters, left to right: the pieces whose pixels touch. A dot, an accent
 * or a crumb joins the letter it sits over, or the nearest one.
 */
export function letters(mask: boolean[], w: number, h: number): Lpx[][] {
  const seen = new Array<boolean>(w * h).fill(false)
  let parts: Lpx[][] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x] || seen[y * w + x]) continue
      seen[y * w + x] = true
      const stack: Lpx[] = [{ x, y }]
      const part: Lpx[] = []
      while (stack.length > 0) {
        const q = stack.pop()!
        part.push(q)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = q.x + dx
          const ny = q.y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] && !seen[ny * w + nx]) {
            seen[ny * w + nx] = true
            stack.push({ x: nx, y: ny })
          }
        }
      }
      parts.push(part)
    }
  }

  const span = (part: Lpx[]): [number, number] => {
    let lo = w
    let hi = -1
    for (const q of part) {
      lo = Math.min(lo, q.x)
      hi = Math.max(hi, q.x)
    }
    return [lo, hi]
  }
  while (parts.length > 1) {
    parts.sort((a, b) => a.length - b.length)
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const small = parts[0]!
    const [lo, hi] = span(small)
    let best = -1
    let bestOver = 0
    let bestGap = w
    for (let i = 1; i < parts.length; i++) {
      const [lo2, hi2] = span(parts[i]!)
      const over = Math.min(hi, hi2) - Math.max(lo, lo2) + 1
      const gap = Math.max(lo2 - hi, lo - hi2)
      if (over > bestOver || (bestOver === 0 && gap < bestGap)) {
        best = i
        bestOver = Math.max(over, 0)
        bestGap = gap
      }
    }
    if ((2 * bestOver < hi - lo + 1 && 4 * small.length * parts.length >= total) || best < 0) break
    parts[best]!.push(...small)
    parts = parts.slice(1)
  }
  return parts.sort((a, b) => span(a)[0] - span(b)[0])
}

/**
 * Gives each koi a part of the wordmark, left to right: a letter each, any spare koi to the
 * biggest letters, or neighbouring letters sharing a koi when there are fewer koi than letters.
 */
export function shareOut(ls: Lpx[][], n: number): Lpx[][] {
  if (n < ls.length) {
    const groups: Lpx[][] = Array.from({ length: n }, () => [])
    ls.forEach((letter, i) => groups[Math.floor((i * n) / ls.length)]!.push(...letter))
    return groups
  }
  const count = ls.map(() => 1)
  for (let spare = 0; spare < n - ls.length; spare++) {
    let best = 0
    for (let i = 0; i < ls.length; i++) {
      if (ls[i]!.length * count[best]! > ls[best]!.length * count[i]!) best = i
    }
    count[best]!++
  }
  const groups: Lpx[][] = []
  ls.forEach((letter, i) => {
    const sorted = [...letter].sort((a, b) => a.x - b.x || a.y - b.y)
    for (let c = 0; c < count[i]!; c++) {
      groups.push(sorted.slice(Math.floor((c * sorted.length) / count[i]!), Math.floor(((c + 1) * sorted.length) / count[i]!)))
    }
  })
  return groups
}
