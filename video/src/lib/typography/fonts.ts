/**
 * Fonts ship in public/fonts so a render never depends on the machine's system fonts or the
 * network. loadFont holds the render (delayRender) until each face is ready.
 */
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

const FACES = [
  { family: "Inter", file: "Inter-400.woff2", weight: "400" },
  { family: "Inter", file: "Inter-500.woff2", weight: "500" },
  { family: "Inter", file: "Inter-600.woff2", weight: "600" },
  { family: "Inter", file: "Inter-700.woff2", weight: "700" },
  { family: "Inter", file: "Inter-800.woff2", weight: "800" },
  { family: "JetBrains Mono", file: "JetBrainsMono-400.woff2", weight: "400" },
  { family: "JetBrains Mono", file: "JetBrainsMono-500.woff2", weight: "500" },
  { family: "JetBrains Mono", file: "JetBrainsMono-700.woff2", weight: "700" },
] as const;

// loadFont registers each face and holds rendering until it has loaded.
for (const face of FACES) {
  void loadFont({
    family: face.family,
    url: staticFile(`fonts/${face.file}`),
    weight: face.weight,
  });
}
