/**
 * A small seedable random source, so a scene can be reproduced exactly in a test and the same seed
 * always gives the same koi, or the same black hole.
 */
export type Random = {
  /** A float in [0, 1). */
  float: () => number
  /** A whole number in [0, limit). */
  int: (limit: number) => number
}

export function random(seed: number): Random {
  let state = seed >>> 0
  const float = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (limit: number) => Math.floor(float() * limit)
  return { float, int }
}
