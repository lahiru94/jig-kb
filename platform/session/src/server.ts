import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import type { KbService } from "@jig/kb-ops";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, Role, ServerMessage } from "./protocol";
import { Session, type AgentDriver, type ExtractionConfig } from "./session";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export interface SessionServerOptions {
  service: KbService;
  users: Role[];
  /** Who a new session starts as. */
  defaultUser?: string;
  agent?: (session: Session) => AgentDriver;
  /** Built web app to serve (platform/web/dist). */
  staticDir?: string;
  extraction?: ExtractionConfig;
}

/** Serves the web app and runs one session per WebSocket connection (design D12). */
export class SessionServer {
  readonly sessions = new Map<string, Session>();
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private seq = 0;

  constructor(private readonly options: SessionServerOptions) {
    this.http = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: this.sessions.size }));
        return;
      }
      const dir = options.staticDir;
      if (!dir) {
        res.writeHead(404).end("no web app configured");
        return;
      }
      const path = normalize(join(dir, url.pathname === "/" ? "index.html" : url.pathname));
      const file = path.startsWith(dir) && existsSync(path) && statSync(path).isFile() ? path : join(dir, "index.html");
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (socket) => this.connect(socket));
  }

  private connect(socket: WebSocket): void {
    const users = this.options.users;
    const user = users.find((u) => u.user === this.options.defaultUser) ?? users[0];
    if (!user) {
      socket.close(1011, "no users configured");
      return;
    }
    const id = `session-${++this.seq}`;
    const send = (message: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const session = new Session({
      id,
      service: this.options.service,
      users,
      user,
      send,
      ...(this.options.agent ? { agent: this.options.agent } : {}),
      ...(this.options.extraction ? { extraction: this.options.extraction } : {}),
    });
    this.sessions.set(id, session);
    socket.on("message", (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data)) as ClientMessage;
      } catch {
        send({ type: "notice", level: "error", text: "messages must be JSON" });
        return;
      }
      void session.handle(message);
    });
    socket.on("close", () => this.sessions.delete(id));
    session.start();
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => {
        const address = this.http.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    return new Promise((resolve) => this.wss.close(() => this.http.close(() => resolve())));
  }
}

/** Users for the session's role switcher: every Actor in the KB, with their roles. */
export function usersFromKb(service: { query: KbService["query"] }, asUser: string): Promise<Role[]> {
  return service.query({ user: asUser, viaAgent: false }, { kind: "Actor" }).then((r) =>
    r.nodes.map((n) => ({ user: n.id, title: n.title, roles: Array.isArray(n.data.roles) ? (n.data.roles as string[]) : [] })),
  );
}
