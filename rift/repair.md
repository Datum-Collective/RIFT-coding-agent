An OpenCode update broke RIFT. Repair RIFT so it works on the new release.

The failure log is in /tmp/rift-failure.log. `opencode/` holds the new release with as much of RIFT as applied.

Rules:
- Change only files under `rift/`. `opencode/` is generated and is thrown away after you finish.
- Do not change `rift/check.sh`, `rift/sync.sh`, `rift/repair.sh`, `rift/regress.py`, `rift/known-differences.txt`, or anything in a `test` folder. They define what working means. If a test is genuinely obsolete, say so and stop.
- A patch in `rift/patches/` applies to upstream's file with paths starting `opencode/`. To fix one, restate the same intent against the new upstream file, keeping it as small as you can.
- A file that collides with an upstream one must become a patch, or be renamed.
- Prefer upstream's new way of doing a thing over forcing the old way.

Finish with a short summary of what upstream changed and what you did.
