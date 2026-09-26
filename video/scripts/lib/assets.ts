import { existsSync } from "node:fs";
import path from "node:path";
import type { VideoSpec } from "../../src/spec/schema";
import { assetRefs } from "../../src/spec/validate";

/** Files the spec references that are not in public/. Rendering refuses to start with any. */
export function missingAssets(spec: VideoSpec, publicDir: string) {
  return assetRefs(spec).filter(
    (ref) => !existsSync(path.join(publicDir, ref.src)),
  );
}
