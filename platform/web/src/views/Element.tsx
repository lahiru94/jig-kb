import { useState } from "react";
import type { InteractionEvent, ViewElement } from "../../../session/src/protocol";

export type Emit = (event: Omit<InteractionEvent, "view_id">) => void;

const KIND_LABEL: Record<string, string> = {
  BusinessRule: "Rule",
  DataEntity: "Data",
  Capability: "Capability",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Badges for overlay marks, in plain language. */
export function Marks({ marks }: { marks: Record<string, unknown> }) {
  const badges: Array<{ key: string; text: string; tone: string }> = [];
  if (Array.isArray(marks.conflicts)) badges.push({ key: "conflict", text: "Conflict", tone: "danger" });
  if (typeof marks.confidence === "string") {
    const text = { inferred: "Inferred", stated: "Stated", verified: "Verified", none: "No source" }[marks.confidence] ?? marks.confidence;
    badges.push({ key: "confidence", text, tone: marks.confidence === "verified" ? "ok" : marks.confidence === "stated" ? "info" : "warn" });
  }
  if (Array.isArray(marks.owner)) badges.push({ key: "owner", text: `Owner: ${(marks.owner as string[]).map((o) => o.split(".")[1]).join(", ")}`, tone: "muted" });
  if (marks.enforcement === "not enforced") badges.push({ key: "enforcement", text: "Not enforced", tone: "danger" });
  else if (Array.isArray(marks.enforcement)) badges.push({ key: "enforcement", text: `Enforced: ${(marks.enforcement as string[]).join(", ")}`, tone: "muted" });
  if (typeof marks.pending === "string") badges.push({ key: "pending", text: { added: "Added", modified: "Changed", removed: "Removed" }[marks.pending] ?? marks.pending, tone: "accent" });
  if (badges.length === 0) return null;
  return (
    <span className="marks">
      {badges.map((b) => (
        <span key={b.key} className={`badge ${b.tone}`} data-mark={b.key}>
          {b.text}
        </span>
      ))}
    </span>
  );
}

/** Provenance and actions for one element: where it came from, and ways to ask, comment or suggest an edit. */
export function Provenance({ element, emit, onClose }: { element: ViewElement; emit: Emit; onClose: () => void }) {
  const [mode, setMode] = useState<"none" | "ask" | "comment" | "suggest-edit">("none");
  const [text, setText] = useState("");
  const p = element.provenance;
  const submit = () => {
    if (mode === "none" || text.trim() === "") return;
    emit({ action: mode, target: element.id, text: text.trim() });
    setText("");
    setMode("none");
  };
  return (
    <div className="provenance" role="dialog" aria-label={`About ${element.title}`} data-provenance-for={element.id}>
      <div className="provenance-head">
        <strong>{element.title}</strong>
        <button className="link" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="provenance-id">
        <code>{element.id}</code>
        {p ? <span> · {p.file}</span> : null}
      </div>
      {p && p.claims.length > 0 ? (
        <ul className="claims">
          {p.claims.map((c, i) => (
            <li key={i}>
              <span className={`badge ${c.confidence === "inferred" ? "warn" : c.confidence === "verified" ? "ok" : "info"}`}>{c.confidence}</span> {c.says}
              <div className="source">{c.source}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{p ? "No claims recorded for this node." : "A summary of several nodes."}</p>
      )}
      <div className="provenance-actions">
        <button onClick={() => setMode("ask")}>Ask about this</button>
        <button onClick={() => setMode("comment")}>Comment</button>
        <button onClick={() => setMode("suggest-edit")}>Suggest an edit</button>
      </div>
      {mode !== "none" ? (
        <div className="provenance-form">
          <textarea
            aria-label={mode === "ask" ? "Your question" : mode === "comment" ? "Your comment" : "Your suggested edit"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "suggest-edit" ? "What should change? The agent drafts it as a proposed change." : ""}
          />
          <button className="primary" onClick={submit}>
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One element on a view. Every element carries its KB id; clicking selects it and opens its provenance. */
export function ElementBox({
  element,
  emit,
  open,
  onOpen,
  children,
}: {
  element: ViewElement;
  emit: Emit;
  open: boolean;
  onOpen: (id: string | null) => void;
  children?: React.ReactNode;
}) {
  const isGroup = element.type === "group";
  return (
    <div className={`element ${isGroup ? "group" : ""} kind-${element.kind}`} data-kb-id={element.id}>
      <button
        className="element-button"
        onClick={() => {
          emit({ action: "select", target: element.id });
          onOpen(open ? null : element.id);
        }}
        aria-expanded={open}
      >
        <span className="element-kind">{isGroup ? "Group" : kindLabel(element.kind)}</span>
        <span className="element-title">{element.title}</span>
        <Marks marks={element.marks} />
        {isGroup ? <span className="muted">Select to show all {element.count}</span> : null}
      </button>
      {children}
      {open && !isGroup ? <Provenance element={element} emit={emit} onClose={() => onOpen(null)} /> : null}
    </div>
  );
}
