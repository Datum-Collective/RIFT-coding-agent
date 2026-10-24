# build123d rules

Checked against build123d 0.13. If `pip show build123d` says otherwise, trust the installed version over this sheet.

## Style

- Use the algebra API (`Box(...) - Cylinder(...)`, `Pos(...) * shape`), not `BuildPart` context managers, in new files. In an existing file, keep the style it already uses.
- Declare the frame in a comment first: which axis is up, where the origin sits.
- Put every dimension in a named variable at the top of the file. Never repeat a number.
- End with `result = <final solid>`. `check.py` reads `result`.
- Standard hardware (screws, nuts, bearings): use `bd_warehouse`. Model real threads only when threads are the deliverable.
- Parts that must stay separate: `Compound([a, b])`, not `a + b`.

## Traps that produce a wrong part with no error

| Trap | Rule |
|---|---|
| Primitives are centred on the origin | `Cylinder(r, h)` spans -h/2..h/2. Pass `align=(Align.CENTER, Align.CENTER, Align.MIN)` when you place by its base. `Pos(x, y, -1) * Cylinder(h=12)` in a 10 mm plate is a blind hole, not a through hole. |
| Extrude then position | Build the shape at the origin first, then `Pos(...)`/`Rot(...)`. A shift equal to an extrude depth means this bug. |
| Cut tool flush with a face | Coincident faces fail in OpenCascade. Make the tool overshoot 1-2 mm on each end. |
| Fillet before cuts | Every boolean invalidates edge selectors. Fillet and chamfer last. |
| Hard-coded edge coordinates | Select by property: `edges().filter_by(Axis.Z)`, `filter_by(lambda e: e.length > 30)` (`length` is a property, not a call, in 0.13). |
| `Plane.XZ` | Its normal is -Y. `Plane.ZX` has +Y. Check the normal before extruding or cutting with either. |
| `extrude(sketch, n)` | Goes 0..n along the plane normal. It is not centred; use `both=True` for symmetric. |
| Sweep profile not perpendicular to the path | The result is a flat ribbon. Put the profile on the plane normal to the path tangent at its start. |
| Symmetric geometry rebuilt by hand | Use `mirror(shape, Plane.YZ)`. Rebuilding drifts. |
| Fused bodies that only touch | Tangent or face-touching bodies stay separate solids. Overlap them by 0.2-0.5 mm. If the spec is physically impossible this way, add the overlap and say `DEFENSIVE CORRECTION:` in the report. |
| Loops of `Hole`, `fillet` or booleans | Slow and fragile. Batch: `Locations(*points)`, or fuse the tools once and cut once. |
| 3D booleans for a 2D outline | Subtract in a sketch (`Rectangle(...) - Circle(...)`), then extrude once. |

## Tools in the kit

`rift_cad.py` records what each step did; `check.py verify` reports it.

```python
import sys; sys.path.insert(0, "<kit>")
from rift_cad import measure, cut, fillet
body = measure("body", Box(W, D, H))        # records the feature's bounding box before merging
body = cut(body, hole_tool, "mounting hole") # MISSED_CUT if no material was removed
result = fillet(body, body.edges().filter_by(Axis.Z), R, "corners")  # retries R/2, R/4, R/8; FILLET_FAILED if none work
```

## Repairing

- Fix the first failure only, then re-run. Do not change several things at once.
- A dimension off target: `new = old + 0.7 * (target - measured)`. The 70% step avoids overshooting.
- Never delete a requested feature to make an error go away. Move it, resize it, overlap it, or report that it cannot be built.
- A fillet that still fails at R/8 is a kernel limit. Reduce the requirement or ask; do not loop.
