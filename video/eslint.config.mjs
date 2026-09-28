import { config } from "@remotion/eslint-config-flat";

export default [
  ...config,
  {
    // Specs and tests describe scene transitions as data; the rule mistakes the `transition`
    // key for a CSS transition. Components are still checked.
    files: ["src/spec/**", "src/data/**", "**/*.test.ts"],
    rules: { "@remotion/non-pure-animation": "off" },
  },
];
