/**
 * Applies to `remotion studio` and `remotion render`. scripts/render.ts uses the Node APIs,
 * which ignore this file, so it passes the same settings explicitly (see src/lib/render.ts).
 */
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");
