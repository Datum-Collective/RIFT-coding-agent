// What a frame draws over its scene's cached background (see Canvas.touched): boxes [x0, y0, x1, y1, ...] in pixels,
// inclusive. Shared helpers that draw into a scene's hdr from outside the Canvas record their boxes through the buffer.
const lists = new WeakMap<Float32Array, number[]>()

export function trackTouched(hdr: Float32Array, list: number[]) {
  lists.set(hdr, list)
}

// Adds a box to the touched list of the canvas that owns hdr, if any.
export function touch(hdr: Float32Array, x0: number, y0: number, x1: number, y1: number) {
  const list = lists.get(hdr)
  if (list) addBox(list, x0, y0, x1, y1)
}

// Adds a box to a list. A box within a pixel of the last one grows that one instead, so per-pixel loops (add, blend)
// leave one box rather than thousands.
export function addBox(list: number[], x0: number, y0: number, x1: number, y1: number) {
  const n = list.length
  if (n && x0 >= list[n - 4] - 1 && y0 >= list[n - 3] - 1 && x1 <= list[n - 2] + 1 && y1 <= list[n - 1] + 1) {
    list[n - 4] = Math.min(list[n - 4], x0)
    list[n - 3] = Math.min(list[n - 3], y0)
    list[n - 2] = Math.max(list[n - 2], x1)
    list[n - 1] = Math.max(list[n - 1], y1)
    return
  }
  list.push(x0, y0, x1, y1)
}
