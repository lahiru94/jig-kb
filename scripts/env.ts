import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Loads `.env` from the repository root, if there is one. Variables already set in the environment win. */
export function loadEnv(): void {
  const file = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}
