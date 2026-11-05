import { resolveTemplate, type KbNode, type Scope } from "@jig/kb-core";
import pg from "pg";
import type { BindingType, ExecutorEnv, StepKind } from "./registry";

export class BindingCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function config(binding: KbNode): Record<string, unknown> {
  return (binding.data.config ?? {}) as Record<string, unknown>;
}

/** Fills `{name}` placeholders in a path from params. */
function fillPath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) throw new BindingCallError(`missing path parameter '${key}'`);
    return encodeURIComponent(String(value));
  });
}

/**
 * REST binding type. Config: `service` (a name resolved through the executor env), `method`, `path`
 * with `{param}` placeholders, and an optional `body` whose `$input`/`$fact`/`$context`/`$run` placeholders
 * are resolved; step and fact params override body fields of the same name.
 */
export const restBinding: BindingType = {
  name: "rest",
  async call(binding, params, env: ExecutorEnv, scope: Scope) {
    const cfg = config(binding);
    const service = String(cfg.service ?? "");
    const base = env.services[service];
    if (!base) throw new BindingCallError(`no URL configured for service '${service}' (binding ${binding.id})`);
    const method = String(cfg.method ?? "GET").toUpperCase();
    const url = `${base.replace(/\/$/, "")}${fillPath(String(cfg.path ?? "/"), params)}`;
    const init: RequestInit = { method, headers: { "content-type": "application/json" } };
    if (method !== "GET") {
      const body = { ...((resolveTemplate(cfg.body ?? {}, { ...scope, input: { ...scope.input, ...params } }) ?? {}) as Record<string, unknown>) };
      init.body = JSON.stringify(body);
    }
    const response = await (env.fetch ?? fetch)(url, init);
    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = (payload as { error?: string } | null)?.error ?? response.statusText;
      throw new BindingCallError(`${binding.id}: ${method} ${url} failed with ${response.status}: ${message}`, response.status);
    }
    return payload;
  },
};

const pools = new Map<string, pg.Pool>();

/**
 * SQL binding type. Config: `database` (a name resolved through the executor env), `query` with `$1`…
 * placeholders, and `params`, the names of the parameters to bind in order. Returns the first row,
 * with all rows under `rows`.
 */
export const sqlBinding: BindingType = {
  name: "sql",
  async call(binding, params, env: ExecutorEnv) {
    const cfg = config(binding);
    const database = String(cfg.database ?? "");
    const url = env.databases[database];
    if (!url) throw new BindingCallError(`no connection configured for database '${database}' (binding ${binding.id})`);
    let pool = pools.get(url);
    if (!pool) {
      pool = new pg.Pool({ connectionString: url, max: 3 });
      pools.set(url, pool);
    }
    const names = Array.isArray(cfg.params) ? (cfg.params as unknown[]).map(String) : [];
    const values = names.map((n) => params[n] ?? null);
    const result = await pool.query(String(cfg.query ?? ""), values);
    return { ...(result.rows[0] ?? {}), rows: result.rows };
  },
};

/** Closes database pools opened by SQL bindings (for tests and shutdown). */
export async function closeSqlPools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

function stepParams(raw: unknown, scope: Scope): Record<string, unknown> {
  return (resolveTemplate(raw ?? {}, scope) ?? {}) as Record<string, unknown>;
}

/** The `binding-call` step kind: calls one binding, with an optional compensating binding. */
export const bindingCallStep: StepKind = {
  name: "binding-call",
  async run({ step, scope, env, bindings, getNode }) {
    const id = String(step.binding ?? "");
    const binding = getNode(id);
    if (!binding) throw new BindingCallError(`step '${String(step.name)}' uses unknown binding '${id}'`);
    const params = stepParams(step.with, scope);
    return { result: await bindings.call(binding, params, env, scope), binding: id, params };
  },
  async compensate({ step, scope, env, bindings, getNode }) {
    const compensation = step.compensate as { binding?: string; with?: unknown } | undefined;
    if (!compensation?.binding) return undefined;
    const binding = getNode(compensation.binding);
    if (!binding) throw new BindingCallError(`compensation uses unknown binding '${compensation.binding}'`);
    return { result: await bindings.call(binding, stepParams(compensation.with, scope), env, scope), binding: compensation.binding };
  },
};
