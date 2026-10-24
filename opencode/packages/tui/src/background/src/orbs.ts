// The sun and moon discs a scene's layout() paints, [cx, cy, r, ...] in pixels, per scene buffer (see Canvas.orbs):
// round shapes that the engine keeps smooth wedge glyphs off, since they would turn the disc into a polygon, and that
// stars don't shine through.
const lists = new WeakMap<Float32Array, number[]>()

export function trackOrbs(hdr: Float32Array, list: number[]) {
  lists.set(hdr, list)
}

export function addOrb(hdr: Float32Array, cx: number, cy: number, r: number) {
  lists.get(hdr)?.push(cx, cy, r)
}

// Whether (x, y) lies on an orb of hdr's canvas, or within margin pixels of one.
export function onOrb(hdr: Float32Array, x: number, y: number, margin = 1) {
  const list = lists.get(hdr)
  if (!list) return false
  for (let i = 0; i < list.length; i += 3) if ((x - list[i]) ** 2 + (y - list[i + 1]) ** 2 <= (list[i + 2] + margin) ** 2) return true
  return false
}
