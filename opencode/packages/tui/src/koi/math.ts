/**
 * Small maths helpers the pond leans on.
 *
 * Adapted from koi-screensaver by Erik Johansson (MIT licence). See THIRD_PARTY_NOTICES.md.
 */

/** The IEEE remainder Go's `math.Remainder` gives and JavaScript's `%` does not: the result is in [-y/2, y/2]. */
export const remainder = (x: number, y: number) => x - y * Math.round(x / y)

/** The signed angle from `from` to `to`, the short way round, in [-pi, pi]. */
export const angleTo = (from: number, to: number) => remainder(to - from, 2 * Math.PI)

/** Eases 0 to 1 gently at both ends. */
export function smooth(value: number) {
  const v = Math.min(1, Math.max(0, value))
  return v * v * (3 - 2 * v)
}
