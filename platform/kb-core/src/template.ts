/** Values placeholders may refer to: `$input.x`, `$fact.x`, `$context.x`, `$run.id`, `$step.<name>.<field>`. */
export interface Scope {
  input: Record<string, unknown>;
  fact: Record<string, unknown>;
  context: Record<string, unknown>;
  run?: Record<string, unknown>;
  step?: Record<string, Record<string, unknown>>;
}

function lookup(scope: Scope, path: string): unknown {
  const [root, ...rest] = path.split(".");
  let value: unknown = (scope as unknown as Record<string, unknown>)[root ?? ""];
  for (const key of rest) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Replaces `$a.b` placeholders anywhere inside a value (strings that are exactly a placeholder). */
export function resolveTemplate(value: unknown, scope: Scope): unknown {
  if (typeof value === "string" && /^\$[a-z_]+(\.[A-Za-z0-9_-]+)+$/.test(value)) return lookup(scope, value.slice(1));
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, scope));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveTemplate(v, scope);
    return out;
  }
  return value;
}

