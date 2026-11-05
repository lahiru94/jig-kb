/**
 * Demo operations (design D14, task 3.8):
 *   npm run demo -- up      start the sample retailer (Docker Compose), then seed it and the jig runtime
 *   npm run demo -- seed    load the deterministic history into the services, the ERP and the audit log, and snapshot
 *   npm run demo -- reset   return systems, data, audit log and KB to the starting state
 *   npm run demo -- init    set up only the jig runtime (KB repository and audit log), without the sample retailer
 *   npm run demo -- start   run the jig session server (web app on http://localhost:4300)
 *   npm run demo -- down    stop the sample retailer
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "./env";
import { DeltaStore, GitKbRepo, GitKbSource } from "../platform/governance/src/index";
import { Executor } from "../platform/executor/src/index";
import { AuditLog, KbService } from "../platform/kb-ops/src/index";
import { SessionServer, agentAvailable, claudeAgent, usersFromKb } from "../platform/session/src/index";
import { DEFAULT_OPTIONS, generateHistory, type History } from "../sample-org/history/src/generate";
import { loadHistoryIntoAudit } from "../sample-org/history/src/audit";
import { DATABASE_URL, PORTS } from "../sample-org/services/shared/src/index";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const RUNTIME = join(ROOT, ".jig", "runtime");
export const KB_DIR = join(RUNTIME, "kb");
export const AUDIT_FILE = join(RUNTIME, "audit.sqlite");
export const START_TAG = "demo-start";
const COMPOSE = ["compose", "-f", join(ROOT, "sample-org", "docker-compose.yml")];

/** Tables the seed fills, in an order that respects foreign keys. */
export const SEEDED_TABLES = [
  "orders.customers",
  "orders.orders",
  "orders.order_lines",
  "payments.payments",
  "payments.refunds",
  "loyalty.accounts",
  "loyalty.point_events",
  "returns.refunds",
  "warehouse.shipments",
  "notifications.sent",
];

const url = (service: keyof typeof PORTS): string => `http://localhost:${PORTS[service]}`;

async function waitForServices(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const all = await Promise.all((Object.keys(PORTS) as Array<keyof typeof PORTS>).map((s) => fetch(`${url(s)}/health`, { signal: AbortSignal.timeout(1000) })));
      if (all.every((r) => r.ok)) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("the sample retailer did not become healthy in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const tax = (region: string, cents: number): number => Math.round((cents * (region === "eu" ? 2000 : 800)) / 10000);

/** Writes the history straight into the services' tables, and posts sales and refunds to the ERP. */
export async function seedStack(history: History, databaseUrl = DATABASE_URL): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const t of [...SEEDED_TABLES].reverse()) await client.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
    const region = new Map(history.customers.map((c) => [c.customer_id, c.region]));
    for (const c of history.customers) {
      await client.query("INSERT INTO orders.customers (customer_id, name, email, region, created_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6)", [
        c.customer_id, c.name, c.email, c.region, c.created_at, c.last_login_at,
      ]);
      await client.query("INSERT INTO loyalty.accounts (customer_id, tier, points) VALUES ($1,$2,0)", [c.customer_id, c.tier]);
    }
    const tiers = new Map(history.customers.map((c) => [c.customer_id, c.tier]));
    for (const o of history.orders) {
      const subtotal = o.price_cents * o.qty;
      const t = tax(region.get(o.customer_id) ?? "us", subtotal);
      await client.query(
        "INSERT INTO orders.orders (order_id, customer_id, channel, region, status, subtotal_cents, tax_cents, total_cents, placed_at, delivered_at) VALUES ($1,$2,$3,$4,'delivered',$5,$6,$7,$8,$9)",
        [o.order_id, o.customer_id, o.channel, region.get(o.customer_id), subtotal, t, subtotal + t, o.placed_at, o.delivered_at],
      );
      await client.query("INSERT INTO orders.order_lines (order_id, sku, qty, price_cents) VALUES ($1,$2,$3,$4)", [o.order_id, o.sku, o.qty, o.price_cents]);
      await client.query("INSERT INTO payments.payments (order_id, payment_id, amount_cents, status, captured_at) VALUES ($1,$2,$3,'captured',$4)", [
        o.order_id, `pay-${o.order_id}`, subtotal + t, o.placed_at,
      ]);
      const points = Math.floor(subtotal / 100) * (tiers.get(o.customer_id) === "gold" ? 2 : 1);
      await client.query("INSERT INTO loyalty.point_events (customer_id, order_id, kind, points, placed_at, at) VALUES ($1,$2,'earn',$3,$4,$4)", [o.customer_id, o.order_id, points, o.placed_at]);
      await client.query("UPDATE loyalty.accounts SET points = points + $2 WHERE customer_id = $1", [o.customer_id, points]);
      await client.query("INSERT INTO warehouse.shipments (order_id, status, created_at, delivered_at) VALUES ($1,'delivered',$2,$3)", [o.order_id, o.placed_at, o.delivered_at]);
    }
    const orders = new Map(history.orders.map((o) => [o.order_id, o]));
    for (const r of history.refunds) {
      const order = orders.get(r.order_id);
      if (!order) continue;
      await client.query(
        "INSERT INTO returns.refunds (refund_id, order_id, customer_id, type, amount_cents, status, requested_at, completed_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [r.refund_id, r.order_id, order.customer_id, r.type, r.amount_cents, r.status, r.requested_at, r.status === "completed" ? r.requested_at : null, r.approved_by],
      );
      if (r.status !== "completed") continue;
      await client.query("INSERT INTO payments.refunds (refund_id, order_id, amount_cents, created_at) VALUES ($1,$2,$3,$4)", [r.refund_id, r.order_id, r.amount_cents, r.requested_at]);
      await client.query(
        "UPDATE payments.payments SET refunded_cents = refunded_cents + $2, status = CASE WHEN refunded_cents + $2 >= amount_cents THEN 'refunded' ELSE 'partially_refunded' END WHERE order_id = $1",
        [r.order_id, r.amount_cents],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  await seedErp(history);
}

/** Replaces the ERP's postings with the history's sales and completed refunds. */
export async function seedErp(history: History): Promise<void> {
  await fetch(`${url("legacy-erp")}/admin/reset`, { method: "POST" });
  const post = (body: unknown) => fetch(`${url("legacy-erp")}/postings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const o of history.orders) {
    const subtotal = o.price_cents * o.qty;
    await post({ order_id: o.order_id, customer_id: o.customer_id, kind: "sale", amount_cents: subtotal + tax(region(history, o.customer_id), subtotal), at: o.placed_at });
  }
  for (const r of history.refunds.filter((x) => x.status === "completed")) await post({ order_id: r.order_id, kind: "refund", amount_cents: r.amount_cents, at: r.requested_at });
}

function region(history: History, customerId: string): string {
  return history.customers.find((c) => c.customer_id === customerId)?.region ?? "us";
}

/** Copies the seeded tables into a `snapshot` schema, so reset can restore them. */
export async function snapshot(databaseUrl = DATABASE_URL): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS snapshot CASCADE; CREATE SCHEMA snapshot");
    for (const t of SEEDED_TABLES) await client.query(`CREATE TABLE snapshot.${t.replace(".", "__")} AS TABLE ${t}`);
  } finally {
    await client.end();
  }
}

/** Restores the seeded tables from the snapshot. */
export async function restoreSnapshot(databaseUrl = DATABASE_URL): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const t of [...SEEDED_TABLES].reverse()) await client.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
    for (const t of SEEDED_TABLES) await client.query(`INSERT INTO ${t} SELECT * FROM snapshot.${t.replace(".", "__")}`);
    // TRUNCATE ... RESTART IDENTITY rewinds serial counters; move them past the restored rows.
    const serials = await client.query(
      "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE column_default LIKE 'nextval(%' AND table_schema || '.' || table_name = ANY($1)",
      [SEEDED_TABLES],
    );
    for (const row of serials.rows as Array<{ table_schema: string; table_name: string; column_name: string }>) {
      const table = `${row.table_schema}.${row.table_name}`;
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', '${row.column_name}'), COALESCE((SELECT MAX(${row.column_name}) FROM ${table}), 0) + 1, false)`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

/** Creates the jig runtime: a git KB repository from the ground-truth KB (tagged), and a seeded audit log. */
export async function initRuntime(history: History): Promise<void> {
  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });
  GitKbRepo.create(KB_DIR, join(ROOT, "sample-org", "kb"), START_TAG);
  const audit = await AuditLog.open(AUDIT_FILE);
  loadHistoryIntoAudit(history, audit);
}

export async function seed(): Promise<void> {
  const history = generateHistory(DEFAULT_OPTIONS);
  await seedStack(history);
  await snapshot();
  await initRuntime(history);
  console.log(`Seeded ${history.customers.length} customers, ${history.orders.length} orders, ${history.refunds.length} refunds; KB at ${KB_DIR} tagged ${START_TAG}.`);
}

/**
 * Rewinds the jig runtime: the KB repository back to its `demo-start` tag (with every delta branch and
 * record removed), and a fresh audit log with the seeded history. Commit ids stay the same.
 */
export async function resetRuntime(history: History): Promise<void> {
  if (!existsSync(join(KB_DIR, ".git"))) {
    await initRuntime(history);
    return;
  }
  const repo = GitKbRepo.open(KB_DIR);
  repo.resetTo(START_TAG);
  for (const branch of repo.branches("delta/")) repo.deleteBranch(branch);
  rmSync(join(KB_DIR, ".git", "jig"), { recursive: true, force: true });
  rmSync(AUDIT_FILE, { force: true });
  loadHistoryIntoAudit(history, await AuditLog.open(AUDIT_FILE));
}

/** Returns systems, data, audit log and KB to the starting state. */
export async function reset(): Promise<void> {
  const history = generateHistory(DEFAULT_OPTIONS);
  await restoreSnapshot();
  await seedErp(history);
  await resetRuntime(history);
  console.log("Reset: systems, data, audit log and KB are back at the starting state.");
}

/** The executor environment for the sample retailer running locally. */
export function executorEnv() {
  const services = Object.fromEntries((Object.keys(PORTS) as Array<keyof typeof PORTS>).map((s) => [s, url(s)]));
  return { services, databases: { retail: DATABASE_URL } };
}

/** Builds the jig service over the runtime KB and audit log. */
export async function runtimeService(): Promise<KbService> {
  if (!existsSync(KB_DIR)) throw new Error("no runtime KB yet: run `npm run demo -- seed` first");
  const repo = GitKbRepo.open(KB_DIR);
  const store = new DeltaStore(repo);
  const source = new GitKbSource(repo, store);
  const audit = await AuditLog.open(AUDIT_FILE);
  return new KbService({ kb: source, audit, governance: { source, store }, executor: new Executor(executorEnv()) });
}

export async function start(port = Number(process.env.JIG_PORT ?? 4300)): Promise<void> {
  const service = await runtimeService();
  const users = await usersFromKb(service, "actor.jordan");
  const server = new SessionServer({
    service,
    users,
    defaultUser: "actor.casey",
    staticDir: join(ROOT, "platform", "web", "dist"),
    ...(agentAvailable() ? { agent: claudeAgent } : {}),
    extraction: { base: ROOT, roots: ["sample-org/services/returns", "sample-org/services/loyalty", "sample-org/docs/policies"], paceMs: 900 },
  });
  const listening = await server.listen(port);
  console.log(`jig is running on http://localhost:${listening}${agentAvailable() ? "" : " (no API key: the agent is off; views, approvals and extraction still work)"}`);
  setInterval(() => {
    const { drafted } = service.evaluateEvidence();
    for (const d of drafted) console.log(`Evidence: drafted ${d.id} (${d.title})`);
  }, 60_000).unref();
}

async function main(): Promise<void> {
  loadEnv();
  const command = process.argv[2];
  switch (command) {
    case "up":
      execFileSync("docker", [...COMPOSE, "up", "-d", "--build"], { stdio: "inherit" });
      await waitForServices();
      await seed();
      return;
    case "seed":
      await waitForServices(10_000);
      await seed();
      return;
    case "reset":
      await waitForServices(10_000);
      await reset();
      return;
    case "init":
      await initRuntime(generateHistory(DEFAULT_OPTIONS));
      console.log(`Initialised the jig runtime at ${RUNTIME} (no sample retailer: actions will fail until it is up).`);
      return;
    case "start":
      if (!existsSync(join(ROOT, "platform", "web", "dist", "index.html"))) execFileSync("npm", ["run", "build", "-w", "@jig/web"], { stdio: "inherit" });
      await start();
      return;
    case "down":
      execFileSync("docker", [...COMPOSE, "down"], { stdio: "inherit" });
      return;
    default:
      console.log("usage: npm run demo -- up | seed | reset | init | start | down");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
