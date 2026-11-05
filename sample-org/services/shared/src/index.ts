import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import pg from "pg";

/** Fixed local ports for the sample retailer's services (Docker Compose maps the same ports). */
export const PORTS = {
  storefront: 4101,
  orders: 4102,
  payments: 4103,
  returns: 4104,
  loyalty: 4105,
  tax: 4106,
  notifications: 4107,
  warehouse: 4108,
  "legacy-erp": 4109,
} as const;

export type ServiceName = keyof typeof PORTS;

export function serviceUrl(name: ServiceName): string {
  const envName = `${name.toUpperCase().replace(/-/g, "_")}_URL`;
  return process.env[envName] ?? `http://localhost:${PORTS[name]}`;
}

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://jig:jig@localhost:54329/retail";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Json = Record<string, unknown>;

export interface Request {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
}

export type Handler = (req: Request) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:([a-z_]+)/g, (_m, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "body must be a JSON object");
  return parsed as Json;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload ?? null));
}

/** A tiny JSON-over-HTTP service: routes like "GET /orders/:order_id". */
export function createService(name: string, routes: Record<string, Handler>): { listen(port: number): Promise<Server> } {
  const table: Route[] = Object.entries(routes).map(([spec, handler]) => {
    const [method, path] = spec.split(" ") as [string, string];
    return { method, ...compile(path), handler };
  });
  table.push({ method: "GET", ...compile("/health"), handler: () => ({ service: name, ok: true }) });
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      for (const route of table) {
        if (route.method !== req.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1] ?? "")));
        try {
          const result = await route.handler({ params, query: url.searchParams, body: await readBody(req) });
          send(res, req.method === "POST" ? 201 : 200, result);
        } catch (error) {
          if (error instanceof HttpError) send(res, error.status, { error: error.message });
          else {
            console.error(`[${name}]`, error);
            send(res, 500, { error: (error as Error).message });
          }
        }
        return;
      }
      send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
    })();
  });
  return {
    listen: (port) => new Promise((resolve) => server.listen(port, () => resolve(server))),
  };
}

/** Calls another service and returns its JSON response, throwing HttpError on failure. */
export async function call<T = Json>(service: ServiceName, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${serviceUrl(service)}${path}`, init);
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? response.statusText;
    throw new HttpError(response.status, `${service}: ${message}`);
  }
  return payload as T;
}

let pool: pg.Pool | undefined;

/** Shared Postgres pool. Each service keeps its tables in its own schema and uses qualified table names. */
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  return pool;
}

export async function migrate(schema: string, ddl: string): Promise<void> {
  await db().query(`CREATE SCHEMA IF NOT EXISTS ${schema}; ${ddl}`);
}

export function requireString(body: Json, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new HttpError(400, `'${key}' is required`);
  return value;
}

export function requireInt(body: Json, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new HttpError(400, `'${key}' must be an integer`);
  return value;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
