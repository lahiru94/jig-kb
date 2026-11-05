import { useState } from "react";
import type { PendingApproval, ViewElement, ViewSpec } from "../../../session/src/protocol";
import { ElementBox, Marks, kindLabel, type Emit } from "./Element";

interface ViewProps {
  spec: ViewSpec;
  emit: Emit;
}

function useOpen(): [string | null, (id: string | null) => void] {
  return useState<string | null>(null);
}

function Box({ el, emit, open, setOpen, children }: { el: ViewElement; emit: Emit; open: string | null; setOpen: (id: string | null) => void; children?: React.ReactNode }) {
  return (
    <ElementBox element={el} emit={emit} open={open === el.id} onOpen={setOpen}>
      {children}
    </ElementBox>
  );
}

/** Neighbourhood explorer: columns by distance from the focus, with the links between what is shown. */
export function Explorer({ spec, emit }: ViewProps) {
  const [open, setOpen] = useOpen();
  const columns = new Map<number, ViewElement[]>();
  for (const el of spec.elements) {
    const depth = el.type === "group" ? 9 : (el.depth ?? 1);
    columns.set(depth, [...(columns.get(depth) ?? []), el]);
  }
  const sorted = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="explorer">
      {sorted.map(([depth, els]) => (
        <section key={depth} className="column" aria-label={depth === 0 ? "Focus" : depth === 9 ? "Collapsed groups" : `${depth} link${depth === 1 ? "" : "s"} away`}>
          <h4>{depth === 0 ? "Focus" : depth === 9 ? "Collapsed" : `${depth} link${depth === 1 ? "" : "s"} away`}</h4>
          {els.map((el) => (
            <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen} />
          ))}
        </section>
      ))}
      <details className="links">
        <summary>{spec.links.length} connections</summary>
        <ul>
          {spec.links.map((l, i) => (
            <li key={i} data-link={`${l.from} ${l.type} ${l.to}`}>
              <code>{l.from}</code> {l.type} <code>{l.to}</code>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Process flow: steps in order, with the rules that apply and the systems involved. */
export function ProcessFlow({ spec, emit }: ViewProps) {
  const [open, setOpen] = useOpen();
  const by = (role: string) => spec.elements.filter((e) => e.role === role);
  const steps = by("step").sort((a, b) => Number(a.fields.order ?? 99) - Number(b.fields.order ?? 99));
  return (
    <div className="process">
      <div className="lanes">
        {by("lane").map((el) => (
          <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen} />
        ))}
      </div>
      <ol className="steps">
        {steps.map((el) => (
          <li key={el.id}>
            <Box el={el} emit={emit} open={open} setOpen={setOpen} />
          </li>
        ))}
      </ol>
      <div className="process-columns">
        <section aria-label="Rules">
          <h4>Rules that apply</h4>
          {by("rule").map((el) => (
            <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen}>
              {typeof el.fields.statement === "string" ? <p className="statement">{el.fields.statement}</p> : null}
            </Box>
          ))}
        </section>
        <section aria-label="Actions and systems">
          <h4>Actions and systems</h4>
          {[...by("action"), ...by("system")].map((el) => (
            <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen} />
          ))}
        </section>
      </div>
    </div>
  );
}

/** Rule card: the rule in plain language, its sources, conflicts, owner and where it is enforced. */
function EditStatement({ ruleId, statement, emit }: { ruleId: string; statement: string; emit: Emit }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(statement);
  if (!editing) {
    return (
      <button className="link" onClick={() => setEditing(true)}>
        Edit statement
      </button>
    );
  }
  return (
    <div className="provenance-form">
      <textarea aria-label="New statement" value={value} onChange={(e) => setValue(e.target.value)} />
      <button
        className="primary"
        onClick={() => {
          emit({ action: "suggest-edit", target: ruleId, edit: { field: "statement", value } });
          setEditing(false);
        }}
      >
        Save as draft change
      </button>
      <button onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
}

export function RuleCard({ spec, emit }: ViewProps) {
  const [open, setOpen] = useOpen();
  const rule = spec.elements.find((e) => e.role === "rule");
  if (!rule) return <p className="muted">No rule in this view.</p>;
  const claims = (rule.fields.claims ?? []) as Array<{ says: string; source: string; confidence: string }>;
  const conflicts = (rule.fields.conflicts ?? []) as Array<{ about: string; claims: number[]; status: string }>;
  const enforcement = rule.fields.enforcement as { kb_layer: boolean; components: string[] } | undefined;
  return (
    <div className="rule-card" data-kb-id={rule.id}>
      <p className="statement big">{String(rule.fields.statement ?? "")}</p>
      <EditStatement ruleId={rule.id} statement={String(rule.fields.statement ?? "")} emit={emit} />
      {conflicts
        .filter((c) => c.status === "open")
        .map((c, i) => (
          <div key={i} className="conflict-banner" role="alert">
            <strong>Sources disagree about {c.about}.</strong>
            <ul>
              {c.claims.map((n) => (
                <li key={n}>
                  {claims[n]?.says} <span className="source">({claims[n]?.source})</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      <h4>What we know, and from where</h4>
      <ul className="claims">
        {claims.map((c, i) => (
          <li key={i}>
            <span className={`badge ${c.confidence === "inferred" ? "warn" : c.confidence === "verified" ? "ok" : "info"}`}>{c.confidence}</span> {c.says}
            <div className="source">{c.source}</div>
          </li>
        ))}
      </ul>
      <dl className="facts">
        <dt>Owner</dt>
        <dd>{((rule.fields.owner ?? []) as string[]).join(", ") || "Nobody"}</dd>
        <dt>Enforced</dt>
        <dd>
          {enforcement && (enforcement.kb_layer || enforcement.components.length > 0)
            ? [...(enforcement.kb_layer ? ["by jig (the KB layer)"] : []), ...enforcement.components].join(", ")
            : "Nowhere (a gap)"}
        </dd>
        <dt>Checked automatically</dt>
        <dd>{rule.fields.has_check ? "Yes" : "No"}</dd>
      </dl>
      <h4>Connected</h4>
      <div className="related">
        {spec.elements
          .filter((e) => e.role === "related")
          .map((el) => (
            <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen} />
          ))}
      </div>
      <button className="link" onClick={() => setOpen(open === rule.id ? null : rule.id)}>
        Ask or suggest a change
      </button>
      {open === rule.id ? <ElementBox element={rule} emit={emit} open onOpen={setOpen} /> : null}
    </div>
  );
}

function ApproveBar({ spec, emit }: ViewProps) {
  const [comment, setComment] = useState("");
  if (!spec.approvable) return null;
  const target = spec.approvable.id;
  return (
    <div className="approve-bar">
      <input aria-label="Comment (optional)" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="primary" onClick={() => emit({ action: "approve", target, ...(comment ? { text: comment } : {}) })}>
        Approve change
      </button>
      <button onClick={() => emit({ action: "reject", target, ...(comment ? { text: comment } : {}) })}>Reject</button>
    </div>
  );
}

/** Impact ripple: what a change touches, nearest first, with the path that explains each one. */
export function ImpactRipple({ spec, emit }: ViewProps) {
  const [open, setOpen] = useOpen();
  const changed = spec.elements.filter((e) => e.role === "changed");
  const impacted = spec.elements.filter((e) => e.role === "impacted");
  const rings = new Map<number, ViewElement[]>();
  for (const el of impacted) rings.set(el.depth ?? 1, [...(rings.get(el.depth ?? 1) ?? []), el]);
  return (
    <div className="impact">
      <section aria-label="Changed">
        <h4>Changed</h4>
        {changed.map((el) => (
          <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen} />
        ))}
      </section>
      {[...rings.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, els]) => (
          <section key={depth} aria-label={`Ring ${depth}`} className="ring">
            <h4>{depth === 1 ? "Directly affected" : `${depth} steps away`}</h4>
            {els.map((el) => (
              <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen}>
                <div className="risk" title={`Risk ${el.risk}`}>
                  <span style={{ width: `${Math.round((el.risk ?? 0) * 100)}%` }} />
                </div>
                <p className="path">{(el.path ?? []).join(" ")}</p>
                {el.fields.mode === "described" ? <span className="badge muted">Not operated by jig</span> : null}
              </Box>
            ))}
          </section>
        ))}
      <ApproveBar spec={spec} emit={emit} />
    </div>
  );
}

const HIDDEN = new Set(["id", "kind", "claims", "conflicts"]);

function fieldText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Before and after: each changed node side by side, with what changed highlighted. */
export function BeforeAfter({ spec, emit }: ViewProps) {
  const [open, setOpen] = useOpen();
  return (
    <div className="before-after">
      {spec.elements.map((el) => {
        const keys = [...new Set([...Object.keys(el.before ?? {}), ...Object.keys(el.after ?? {})])].filter((k) => !HIDDEN.has(k));
        return (
          <Box key={el.id} el={el} emit={emit} open={open} setOpen={setOpen}>
            <table className="diff">
              <thead>
                <tr>
                  <th />
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const before = fieldText(el.before?.[k]);
                  const after = fieldText(el.after?.[k]);
                  return (
                    <tr key={k} className={before !== after ? "changed" : ""} data-field={k}>
                      <th>{k.replace(/_/g, " ")}</th>
                      <td>{el.before ? before : <em>new</em>}</td>
                      <td>{el.after ? after : <em>removed</em>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        );
      })}
      <ApproveBar spec={spec} emit={emit} />
    </div>
  );
}

/** A queued action request with the reasons it is waiting, so a person can approve it here. */
export function ApprovalCard({ approval, emit, onDone }: { approval: PendingApproval; emit: Emit; onDone: () => void }) {
  return (
    <div className="approval-card" data-request-id={approval.request_id}>
      <h4>Needs your approval: {approval.title}</h4>
      <p className="muted">Requested by {approval.requested_by}</p>
      <ul className="reasons">
        {approval.reasons.map((r, i) => (
          <li key={i} data-source={r.source}>
            <strong>{r.reason}</strong>
            {r.statement && r.statement !== r.reason ? <div className="muted">{r.statement}</div> : null}
            <div className="source">{r.source}</div>
          </li>
        ))}
      </ul>
      <dl className="facts">
        {Object.entries(approval.inputs).map(([k, v]) => (
          <div key={k}>
            <dt>{k.replace(/_/g, " ")}</dt>
            <dd>{fieldText(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="approve-bar">
        <button
          className="primary"
          onClick={() => {
            emit({ action: "approve", target: approval.request_id });
            onDone();
          }}
        >
          Approve
        </button>
        <button
          onClick={() => {
            emit({ action: "reject", target: approval.request_id });
            onDone();
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export const VIEW_COMPONENTS: Record<ViewSpec["view"], (props: ViewProps) => React.ReactElement> = {
  explorer: Explorer,
  process: ProcessFlow,
  "rule-card": RuleCard,
  impact: ImpactRipple,
  "before-after": BeforeAfter,
};

/** Renders a view spec with its component, and binds events to the view's id. */
export function ViewRenderer({ spec, send }: { spec: ViewSpec; send: (e: Parameters<Emit>[0] & { view_id: string }) => void }) {
  const Component = VIEW_COMPONENTS[spec.view];
  const emit: Emit = (e) => send({ ...e, view_id: spec.view_id });
  return (
    <article className={`view view-${spec.view}`} data-view-id={spec.view_id}>
      <header>
        <span className="element-kind">{spec.view.replace("-", " ")}</span>
        <h3>{spec.title}</h3>
        <span className="muted as-of">as of {spec.as_of.slice(0, 12)}</span>
      </header>
      <Component spec={spec} emit={emit} />
    </article>
  );
}

export { Marks, kindLabel };
