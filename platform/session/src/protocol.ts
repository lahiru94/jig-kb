/**
 * Messages between the web app and the session server over the WebSocket (design D12).
 * Types only: the web app imports this file too.
 */

export type Level = 1 | 2 | 3;

export interface ViewElement {
  id: string;
  type: "node" | "group";
  kind: string;
  title: string;
  layer?: string;
  depth?: number;
  fields: Record<string, unknown>;
  provenance: { node: string; file: string; claims: Array<{ says?: string; source?: string; confidence?: string }>; confidence: string } | null;
  marks: Record<string, unknown>;
  members?: string[];
  count?: number;
  role?: string;
  path?: string[];
  risk?: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  op?: string;
}

export interface ViewLink {
  from: string;
  to: string;
  type: string;
  path: string;
}

export type ViewType = "explorer" | "process" | "rule-card" | "impact" | "before-after";

/** A view spec as the `visualize` operation returns it. Rendered only by the fixed component catalogue. */
export interface ViewSpec {
  view_id: string;
  view: ViewType;
  title: string;
  elements: ViewElement[];
  links: ViewLink[];
  overlays: string[];
  as_of: string;
  /** Set by the session server when the view is about a delta or a queued request the user may approve. */
  approvable?: { kind: "delta" | "request"; id: string };
}

export interface DecisionReason {
  source: string;
  kind: string;
  level: Level;
  reason: string;
  statement?: string;
}

/** A queued action request, shown with its decision reasons so a person can approve it. */
export interface PendingApproval {
  view_id: string;
  request_id: string;
  action: string;
  title: string;
  inputs: Record<string, unknown>;
  facts: Record<string, unknown>;
  reasons: DecisionReason[];
  requested_by: string;
}

export type InteractionAction = "select" | "ask" | "comment" | "suggest-edit" | "approve" | "reject";

/** A user interaction on a view, sent to the agent as a structured event (kb-visualization spec). */
export interface InteractionEvent {
  action: InteractionAction;
  view_id: string;
  /** KB node id, group id, delta id or request id the user acted on. */
  target: string;
  text?: string;
  /** For `suggest-edit`: a concrete change to one field, saved as a draft delta. */
  edit?: { field: string; value: string };
}

export interface Role {
  user: string;
  title: string;
  roles: string[];
}

export type ClientMessage =
  | { type: "chat"; text: string }
  | { type: "event"; event: InteractionEvent }
  | { type: "switch-role"; user: string }
  | { type: "extract" };

export type ServerMessage =
  | { type: "session"; session_id: string; user: Role; available: Role[]; features: { extraction: boolean } }
  | { type: "assistant"; text: string; done: boolean }
  | { type: "user"; text: string }
  | { type: "view"; spec: ViewSpec }
  | { type: "approval"; approval: PendingApproval }
  | { type: "notice"; level: "info" | "success" | "error"; text: string }
  | { type: "progress"; text: string; nodes?: string[] }
  | { type: "working-set"; views: string[]; selection: string[] };
