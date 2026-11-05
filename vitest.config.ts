import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./scripts/env";

// Tests that need the agent (or other settings) read them from .env, like the demo does.
loadEnv();

const platform = fileURLToPath(new URL("./platform", import.meta.url));
const sampleOrg = fileURLToPath(new URL("./sample-org", import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@jig\/(.*)$/, replacement: `${platform}/$1/src/index.ts` },
      { find: "@sample/shared", replacement: `${sampleOrg}/services/shared/src/index.ts` },
    ],
  },
  test: {
    include: ["platform/*/test/**/*.test.ts", "platform/*/test/**/*.test.tsx", "scripts/**/*.test.ts", "sample-org/**/test/**/*.test.ts"],
    passWithNoTests: false,
  },
});
