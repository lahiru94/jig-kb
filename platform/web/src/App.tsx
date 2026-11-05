import { useEffect, useRef, useState } from "react";
import { useSession } from "./socket";
import { ApprovalCard, ViewRenderer } from "./views/Views";

export function App() {
  const { state, chat, event, switchRole, resolveApproval, runExtraction } = useSession();
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [state.chat]);
  useEffect(() => {
    setTab(0);
  }, [state.views.length]);
  const view = state.views[tab];

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">jig</span>
        <span className={`status ${state.status}`} data-status={state.status}>
          {state.status === "connected" ? "Connected" : state.status === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
        {state.features.extraction ? (
          <button className="extract" onClick={runExtraction} disabled={state.status !== "connected"}>
            Run extraction
          </button>
        ) : null}
        <label className="role">
          Signed in as{" "}
          <select aria-label="Signed in as" value={state.user?.user ?? ""} onChange={(e) => switchRole(e.target.value)}>
            {state.users.map((u) => (
              <option key={u.user} value={u.user}>
                {u.title}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className="panes">
        <section className="chat" aria-label="Conversation">
          <div className="log" ref={log}>
            {state.chat.length === 0 ? <p className="muted hint">Ask about how the business works, or what a change would affect.</p> : null}
            {state.chat.map((line, i) => (
              <div key={i} className={`line ${line.from}`}>
                {line.text}
              </div>
            ))}
            {state.thinking ? <div className="line assistant thinking">…</div> : null}
          </div>
          {state.progress ? <div className="progress">{state.progress.text}</div> : null}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) chat(draft.trim());
              setDraft("");
            }}
          >
            <textarea
              aria-label="Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message the agent"
            />
            <button className="primary" type="submit" disabled={state.status !== "connected"}>
              Send
            </button>
          </form>
        </section>
        <section className="viewpane" aria-label="Views">
          {state.approvals.map((a) => (
            <ApprovalCard key={a.request_id} approval={a} emit={(e) => event({ ...e, view_id: a.view_id })} onDone={() => resolveApproval(a.request_id)} />
          ))}
          {state.views.length > 1 ? (
            <nav className="tabs" aria-label="Views shown">
              {state.views.map((v, i) => (
                <button key={v.view_id} className={i === tab ? "active" : ""} onClick={() => setTab(i)}>
                  {v.title}
                </button>
              ))}
            </nav>
          ) : null}
          {view ? <ViewRenderer spec={view} send={event} /> : <div className="empty muted">Views the agent shows appear here.</div>}
          <div className="notices" aria-live="polite">
            {state.notices.map((n, i) => (
              <div key={i} className={`notice ${n.level}`}>
                {n.text}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
