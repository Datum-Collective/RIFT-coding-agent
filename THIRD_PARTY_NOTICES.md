# Third-party notices

RIFT includes code adapted from the projects below. Each is used under its own licence, reproduced here.

## koi-screensaver

- Source: https://github.com/erikrjohansson/koi-screensaver
- Author: Erik Johansson (erikrjohansson)
- Licence: MIT
- Used in: `opencode/packages/tui/src/koi/`, the koi pond that fades in behind the home screen after ten quiet seconds.

What was adapted: how koi swim (wandering, turning back from the banks, keeping apart, bursts of speed, a spine that only bends so far), how a koi is drawn from signed distances (tapering body, fins and tail grown out with soft joins, patches, sheen, eyes), the lily pads, flowers, loose petals and ripples, the koi chase scene with its tail-flick swirls, and the idea of fitting each terminal cell with the best two colours. The code was ported from Go to TypeScript, redrawn on 2x2 quadrant pixels instead of 2x3 sextants, scaled for terminal cells, and recoloured to RIFT's palette (the canvas, neutral greys and the azure accent). The intro in which a wordmark breaks into koi was not ported.

Each adapted file says so at its top.

```
MIT License

Copyright (c) 2026 Erik Johansson (erikrjohansson)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
