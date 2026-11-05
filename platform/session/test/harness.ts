import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DeltaStore, GitKbRepo, GitKbSource } from "@jig/governance";
import type { NodeChange } from "@jig/kb-core";
import { AuditLog, KbService } from "@jig/kb-ops";
import { SessionServer, type AgentDriver, type ExtractionConfig, type Role, type Session } from "../src/index";

export const SAMPLE_KB = fileURLToPath(new URL("../../../sample-org/kb", import.meta.url));
export const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export const USERS: Role[] = [
  { user: "actor.casey", title: "Casey (customer service agent)", roles: ["role.cs-agent"] },
  { user: "actor.morgan", title: "Morgan (customer service supervisor)", roles: ["role.cs-supervisor"] },
  { user: "actor.alex", title: "Alex (Head of Customer Service)", roles: ["role.head-of-cs"] },
  { user: "actor.jordan", title: "Jordan (Chief Operating Officer)", roles: ["role.executive"] },
];

/** Builds the web app once if it has not been built. */
export function ensureWebBuilt(): void {
  if (!existsSync(join(WEB_DIST, "index.html"))) execFileSync("npm", ["run", "build", "-w", "@jig/web"], { stdio: "ignore" });
}

/** A session server over a fresh git copy of the sample KB, optionally with extra nodes committed on main. */
export async function startServer(agent?: (session: Session) => AgentDriver, extra: NodeChange[] = [], extraction?: ExtractionConfig) {
  const root = mkdtempSync(join(tmpdir(), "jig-session-"));
  const repo = GitKbRepo.create(join(root, "kb"), SAMPLE_KB, "demo-start");
  if (extra.length > 0) repo.advanceMain(repo.commitChanges(repo.head(), [repo.head()], extra, "Test nodes"));
  const store = new DeltaStore(repo);
  const source = new GitKbSource(repo, store);
  const audit = await AuditLog.open();
  const service = new KbService({ kb: source, audit, governance: { source, store } });
  const server = new SessionServer({
    service,
    users: USERS,
    defaultUser: "actor.casey",
    staticDir: WEB_DIST,
    ...(agent ? { agent } : {}),
    ...(extraction ? { extraction } : {}),
  });
  const port = await server.listen(0);
  return {
    server,
    service,
    store,
    audit,
    url: `http://localhost:${port}`,
    close: async () => {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A scripted stand-in for the Claude agent: maps phrases to actions on the session. */
export function scriptedAgent(script: (input: string, session: Session) => Promise<string>): (session: Session) => AgentDriver {
  return () => ({
    async *respond(input: string, session: Session) {
      yield await script(input, session);
    },
  });
}
