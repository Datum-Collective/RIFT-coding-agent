/**
 * Where the banner is on the screen, for the idle koi pond: the logo breaks up into koi starting
 * from the cells it is actually in, wherever the layout has put it.
 *
 * The pond also hides the banner while it is out, since the logo has become the koi. The banner
 * does that itself: it stops drawing its rows but keeps its size, so nothing round it moves, and
 * nothing on the screen has to be recognised and cleared afterwards.
 */
import { createSignal } from "solid-js"

const [hidden, setHidden] = createSignal(false)

/** What is read of the banner's box: its position on the screen. */
type Box = { x: number; y: number }

let current: Box | undefined

export const logoAnchor = {
  /** Whether the banner is being kept off the screen. */
  hidden,
  /** Hides the banner, or shows it again. */
  hide(value: boolean) {
    setHidden(value)
  },
  /** The banner has been put on the screen. */
  set(box: Box) {
    current = box
  },
  /** The banner has gone from it. Only takes effect if no other banner has taken its place. */
  clear(box: Box) {
    if (current === box) current = undefined
  },
  /** The cell the banner's top left corner is in, or nothing if it is not on the screen. */
  read(): { col: number; row: number } | undefined {
    return current ? { col: Math.round(current.x), row: Math.round(current.y) } : undefined
  },
}
