import "./dom";
import { buildView, loadKb, parseNodeFile, type KbNode } from "@jig/kb-core";
import { buildViewSpec } from "@jig/kb-ops";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { InteractionEvent, ViewSpec } from "../../session/src/protocol";
import { casey, edited, governedService } from "../../kb-ops/test/governed";
import { SAMPLE_KB } from "../../kb-ops/test/helpers";
import { ApprovalCard, ViewRenderer } from "../src/views/Views";

let env: Awaited<ReturnType<typeof governedService>>;
const specs: Record<string, ViewSpec> = {};

beforeAll(async () => {
  env = await governedService();
  const s = env.service;
  specs.explorer = (await s.visualize(casey, { scope: { focus: "rule.refund-window", depth: 1 }, view: "explorer", overlays: ["confidence"] })) as unknown as ViewSpec;
  specs.process = (await s.visualize(casey, { scope: { capability: "capability.returns" }, view: "process", overlays: ["conflicts"] })) as unknown as ViewSpec;
  specs.rule = (await s.visualize(casey, { scope: { focus: "rule.refund-window" }, view: "rule-card" })) as unknown as ViewSpec;
  const { delta_id } = await s.propose_delta(casey, {
    title: "Raise the limit",
    rationale: "x",
    changes: [
      {
        op: "modify",
        id: "rule.refund-approval-limit",
        content: edited("rules/refund-approval-limit.md", "statement: Refunds over $500 need a supervisor's approval.", "statement: Refunds over $800 need a supervisor's approval."),
      },
    ],
  });
  specs.impact = { ...((await s.visualize(casey, { scope: { delta: delta_id }, view: "impact" })) as unknown as ViewSpec), approvable: { kind: "delta", id: delta_id } };
  specs.before = { ...((await s.visualize(casey, { scope: { delta: delta_id }, view: "before-after" })) as unknown as ViewSpec), approvable: { kind: "delta", id: delta_id } };
}, 30_000);

afterAll(() => env?.cleanup());
afterEach(cleanup);

function renderSpec(spec: ViewSpec) {
  const events: InteractionEvent[] = [];
  const result = render(<ViewRenderer spec={spec} send={(e) => events.push(e)} />);
  return { ...result, events };
}

describe("view components render from view specs only", () => {
  for (const name of ["explorer", "process", "rule", "impact", "before"]) {
    it(`${name}: every rendered element carries its KB id, and opens its provenance`, () => {
      const spec = specs[name] as ViewSpec;
      const { container, events } = renderSpec(spec);
      const rendered = [...container.querySelectorAll<HTMLElement>(".element[data-kb-id]")];
      expect(rendered.length).toBeGreaterThan(0);
      const specIds = new Set(spec.elements.map((e) => e.id));
      // Nothing on screen that is not in the spec.
      for (const el of rendered) expect(specIds.has(el.dataset.kbId ?? "")).toBe(true);

      const first = rendered.find((el) => !el.classList.contains("group")) as HTMLElement;
      fireEvent.click(within(first).getAllByRole("button")[0] as HTMLElement);
      const panel = container.querySelector<HTMLElement>(`[data-provenance-for="${first.dataset.kbId}"]`);
      expect(panel).not.toBeNull();
      expect(panel?.textContent).toContain(first.dataset.kbId);
      const element = spec.elements.find((e) => e.id === first.dataset.kbId);
      if (element?.provenance) expect(panel?.textContent).toContain(element.provenance.file);
      expect(events[0]).toEqual({ action: "select", target: first.dataset.kbId, view_id: spec.view_id });
    });
  }

  it("rule card shows the statement, the conflict between sources, the owner and where it is enforced", () => {
    renderSpec(specs.rule as ViewSpec);
    expect(screen.getByText("Customers may request a refund within 30 days of delivery.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Sources disagree about refund window for Gold members.");
    expect(screen.getByText("role.head-of-cs")).toBeTruthy();
    expect(screen.getByText(/by jig \(the KB layer\), component\.returns-service/)).toBeTruthy();
  });

  it("before/after highlights the changed field", () => {
    const { container } = renderSpec(specs.before as ViewSpec);
    const row = container.querySelector<HTMLElement>('tr[data-field="statement"]');
    expect(row?.classList.contains("changed")).toBe(true);
    expect(row?.textContent).toContain("Refunds over $500");
    expect(row?.textContent).toContain("Refunds over $800");
  });

  it("impact ripple explains each impacted node with its path", () => {
    const { container } = renderSpec(specs.impact as ViewSpec);
    const action = container.querySelector<HTMLElement>('[data-kb-id="action.issue-refund"]');
    expect(action?.querySelector(".path")?.textContent).toBe("rule.refund-approval-limit -> enforced-on action.issue-refund");
    // Three links away: the refund action, the one-refund-per-order rule, then the finance job that depends on it.
    const job = container.querySelector<HTMLElement>('[data-kb-id="job.nightly-finance"]');
    expect(job?.querySelector(".path")?.textContent).toBe(
      "rule.refund-approval-limit -> enforced-on action.issue-refund <- enforced-on rule.single-refund-per-order <- depends-on job.nightly-finance",
    );
  });
});

describe("overlays on screen", () => {
  it("the conflicts overlay marks the refund window rule", () => {
    const { container } = renderSpec(specs.process as ViewSpec);
    const window = container.querySelector<HTMLElement>('[data-kb-id="rule.refund-window"]');
    expect(window?.querySelector('[data-mark="conflict"]')?.textContent).toBe("Conflict");
    const limit = container.querySelector<HTMLElement>('[data-kb-id="rule.refund-approval-limit"]');
    expect(limit?.querySelector('[data-mark="conflict"]')).toBeNull();
  });

  it("the confidence overlay shows each element's confidence", () => {
    const { container } = renderSpec(specs.explorer as ViewSpec);
    const window = container.querySelector<HTMLElement>('[data-kb-id="rule.refund-window"]');
    expect(window?.querySelector('[data-mark="confidence"]')?.textContent).toBe("Inferred");
  });
});

describe("large subsets on screen", () => {
  it("renders 42 payment rules as one expandable element", () => {
    const nodes: KbNode[] = [...loadKb(SAMPLE_KB).nodes];
    for (let i = 1; i <= 42; i++) {
      const parsed = parseNodeFile(
        `---\nid: rule.payment-${i}\nkind: BusinessRule\ntitle: Payment rule ${i}\nstatement: Rule ${i}.\npart-of: [component.payments-service]\nenforcement: {kb-layer: false}\n---\n`,
        `rules/payment-${i}.md`,
      );
      if (!("message" in parsed)) nodes.push(parsed);
    }
    const spec = buildViewSpec({ view: buildView("big", nodes), viewId: "v-big" }, { scope: { focus: "component.payments-service", depth: 1 }, view: "explorer" }) as unknown as ViewSpec;
    const { container, events } = renderSpec(spec);
    const groups = container.querySelectorAll<HTMLElement>(".element.group");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.textContent).toContain("Payments service: 42 rules");
    expect(container.querySelectorAll('[data-kb-id^="rule.payment-"]')).toHaveLength(0);
    fireEvent.click(within(groups[0] as HTMLElement).getByRole("button"));
    expect(events).toEqual([{ action: "select", target: "group:BusinessRule:component.payments-service", view_id: "v-big" }]);
  });
});

describe("interaction events", () => {
  it("emits a structured suggest-edit event targeting the element", () => {
    const { container, events } = renderSpec(specs.process as ViewSpec);
    const window = container.querySelector<HTMLElement>('[data-kb-id="rule.refund-window"]') as HTMLElement;
    fireEvent.click(within(window).getAllByRole("button")[0] as HTMLElement);
    fireEvent.click(within(window).getByRole("button", { name: "Suggest an edit" }));
    fireEvent.change(within(window).getByLabelText("Your suggested edit"), { target: { value: "Gold members get 45 days" } });
    fireEvent.click(within(window).getByRole("button", { name: "Send" }));
    expect(events.at(-1)).toEqual({ action: "suggest-edit", target: "rule.refund-window", text: "Gold members get 45 days", view_id: (specs.process as ViewSpec).view_id });
  });

  it("ask and comment produce their own events", () => {
    const { container, events } = renderSpec(specs.explorer as ViewSpec);
    const el = container.querySelector<HTMLElement>('[data-kb-id="rule.refund-window"]') as HTMLElement;
    fireEvent.click(within(el).getAllByRole("button")[0] as HTMLElement);
    fireEvent.click(within(el).getByRole("button", { name: "Ask about this" }));
    fireEvent.change(within(el).getByLabelText("Your question"), { target: { value: "Why does this exist?" } });
    fireEvent.click(within(el).getByRole("button", { name: "Send" }));
    expect(events.at(-1)).toMatchObject({ action: "ask", target: "rule.refund-window", text: "Why does this exist?" });
  });

  it("approve and reject buttons appear only on views of something approvable", () => {
    const before = renderSpec(specs.before as ViewSpec);
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    expect(before.events.at(-1)).toMatchObject({ action: "approve", target: (specs.before as ViewSpec).approvable?.id });
    cleanup();
    renderSpec(specs.explorer as ViewSpec);
    expect(screen.queryByRole("button", { name: "Approve change" })).toBeNull();
    cleanup();
    const { approvable: _approvable, ...notApprovable } = specs.before as ViewSpec;
    renderSpec(notApprovable);
    expect(screen.queryByRole("button", { name: "Approve change" })).toBeNull();
  });

  it("the approval card shows the decision reasons and emits approve", () => {
    const events: Array<Omit<InteractionEvent, "view_id">> = [];
    let done = false;
    render(
      <ApprovalCard
        approval={{
          view_id: "card-1",
          request_id: "req-9",
          action: "action.issue-refund",
          title: "Issue a refund",
          inputs: { order_id: "ord-1", amount_cents: 80000 },
          facts: {},
          reasons: [{ source: "rule.refund-approval-limit", kind: "rule", level: 2, reason: "Refunds over $500 need a supervisor's approval." }],
          requested_by: "actor.casey",
        }}
        emit={(e) => events.push(e)}
        onDone={() => (done = true)}
      />,
    );
    expect(screen.getByText("Refunds over $500 need a supervisor's approval.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(events).toEqual([{ action: "approve", target: "req-9" }]);
    expect(done).toBe(true);
  });
});
