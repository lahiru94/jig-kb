import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, InteractionEvent, PendingApproval, Role, ServerMessage, ViewSpec } from "../../session/src/protocol";

export interface ChatLine {
  from: "user" | "assistant";
  text: string;
}

export interface Notice {
  level: "info" | "success" | "error";
  text: string;
}

export interface SessionState {
  status: "connecting" | "connected" | "closed";
  sessionId?: string;
  user?: Role;
  users: Role[];
  chat: ChatLine[];
  thinking: boolean;
  views: ViewSpec[];
  approvals: PendingApproval[];
  notices: Notice[];
  progress?: { text: string; nodes?: string[] };
  selection: string[];
  features: { extraction: boolean };
}

const initial: SessionState = {
  status: "connecting",
  users: [],
  chat: [],
  thinking: false,
  views: [],
  approvals: [],
  notices: [],
  selection: [],
  features: { extraction: false },
};

/** Applies one server message to the session state. Pure, so it can be tested on its own. */
export function reduce(state: SessionState, message: ServerMessage): SessionState {
  switch (message.type) {
    case "session":
      return { ...state, status: "connected", sessionId: message.session_id, user: message.user, users: message.available, features: message.features };
    case "user":
      return { ...state, chat: [...state.chat, { from: "user", text: message.text }], thinking: true };
    case "assistant": {
      const last = state.chat[state.chat.length - 1];
      const chat =
        last?.from === "assistant" && state.thinking
          ? [...state.chat.slice(0, -1), { from: "assistant" as const, text: last.text + message.text }]
          : message.text
            ? [...state.chat, { from: "assistant" as const, text: message.text }]
            : state.chat;
      return { ...state, chat, thinking: !message.done };
    }
    case "view": {
      const views = [message.spec, ...state.views.filter((v) => v.view_id !== message.spec.view_id)];
      return { ...state, views };
    }
    case "approval":
      return { ...state, approvals: [message.approval, ...state.approvals.filter((a) => a.request_id !== message.approval.request_id)] };
    case "notice":
      return { ...state, notices: [...state.notices.slice(-4), { level: message.level, text: message.text }] };
    case "progress":
      return { ...state, progress: { text: message.text, ...(message.nodes ? { nodes: message.nodes } : {}) } };
    case "working-set":
      return { ...state, selection: message.selection };
  }
}

/** Connects to the session server and exposes the state plus senders. */
export function useSession(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`) {
  const [state, setState] = useState<SessionState>(initial);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    socket.current = ws;
    ws.onmessage = (e) => setState((s) => reduce(s, JSON.parse(String(e.data)) as ServerMessage));
    ws.onclose = () => setState((s) => ({ ...s, status: "closed" }));
    return () => ws.close();
  }, [url]);

  const send = useCallback((message: ClientMessage) => socket.current?.send(JSON.stringify(message)), []);
  const chat = useCallback((text: string) => send({ type: "chat", text }), [send]);
  const event = useCallback((e: InteractionEvent) => send({ type: "event", event: e }), [send]);
  const switchRole = useCallback((user: string) => send({ type: "switch-role", user }), [send]);
  const runExtraction = useCallback(() => send({ type: "extract" }), [send]);
  const resolveApproval = useCallback(
    (requestId: string) => setState((s) => ({ ...s, approvals: s.approvals.filter((a) => a.request_id !== requestId) })),
    [],
  );
  return { state, chat, event, switchRole, resolveApproval, runExtraction };
}
