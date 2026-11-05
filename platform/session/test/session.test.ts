import type { NodeChange } from "@jig/kb-core";
import { afterEach, describe, expect, it } from "vitest";
import { Session, type ServerMessage, type ViewSpec } from "../src/index";
import { USERS, scriptedAgent, startServer } from "./harness";

let env: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

async function session(agentInputs: string[] = [], extra: NodeChange[] = []) {
  env = await startServer(undefined, extra);
  const messages: ServerMessage[] = [];
  const s = new Session({
    id: "s1",
    service: env.service,
    users: USERS,
    user: USERS[0] as (typeof USERS)[number],
    send: (m) => messages.push(m),
    agent: scriptedAgent(async (input) => {
      agentInputs.push(input);
      return "ok";
    }),
  });
  return { s, messages, service: env.service };
}

const views = (messages: ServerMessage[]): ViewSpec[] => messages.flatMap((m) => (m.type === "view" ? [m.spec] : []));
const notices = (messages: ServerMessage[]): string[] => messages.flatMap((m) => (m.type === "notice" ? [m.text] : []));

describe("interaction events and edits", () => {
  it("sends a suggest-edit event to the agent as a structured event targeting the rule", async () => {
    const inputs: string[] = [];
    const { s } = await session(inputs);
    const view = await s.visualize({ scope: { focus: "rule.refund-window" }, view: "rule-card" });
    await s.handle({ type: "event", event: { action: "suggest-edit", view_id: view.view_id, target: "rule.refund-window", text: "Gold members get 45 days" } });
    expect(inputs).toEqual([`[view event] suggest-edit on rule.refund-window in ${view.view_id}: "Gold members get 45 days"`]);
    expect(s.workingSet.selection).toEqual(["rule.refund-window"]);
  });

  it("saves an edit made in a view as a draft delta, leaving the main KB unchanged until approval", async () => {
    const { s, messages, service } = await session();
    const view = await s.visualize({ scope: { focus: "rule.refund-window" }, view: "rule-card" });
    await s.handle({
      type: "event",
      event: { action: "suggest-edit", view_id: view.view_id, target: "rule.refund-window", edit: { field: "statement", value: "Customers may request a refund within 30 days of delivery, or 45 for Gold members." } },
    });
    const current = await service.query({ user: "actor.casey", viaAgent: false }, { focus: "rule.refund-window", depth: 0 });
    expect(current.nodes[0]?.data.statement).toBe("Customers may request a refund within 30 days of delivery.");
    const beforeAfter = views(messages).at(-1);
    expect(beforeAfter?.view).toBe("before-after");
    const changed = beforeAfter?.elements[0];
    expect(changed?.after?.statement).toBe("Customers may request a refund within 30 days of delivery, or 45 for Gold members.");
    expect(notices(messages).at(-1)).toMatch(/Saved as a draft change \(delta-.*\)\. The KB is unchanged until it is approved\./);
    // A draft has no approve buttons.
    expect(beforeAfter?.approvable).toBeUndefined();
  });

  it("refuses an approval that does not come from a view showing what is approved", async () => {
    const { s, messages, service } = await session();
    // A structural edit (not wording only), so it waits for a person.
    const draft = await service.draftEdit({ user: "actor.casey", viaAgent: true }, "component.legacy-erp", "mode", "connected");
    await service.propose_delta({ user: "actor.casey", viaAgent: true }, { delta_id: draft.delta_id, propose: true });
    s.user = USERS[2] as (typeof USERS)[number]; // Alex
    const explorer = await s.visualize({ scope: { focus: "rule.refund-approval-limit", depth: 1 }, view: "explorer" });
    await s.handle({ type: "event", event: { action: "approve", view_id: explorer.view_id, target: draft.delta_id } });
    expect(notices(messages).at(-1)).toBe("Approvals can only be given from a view that shows what is being approved.");
    expect(service.deltaRecord(draft.delta_id)?.status).toBe("proposed");

    const beforeAfter = await s.visualize({ scope: { delta: draft.delta_id }, view: "before-after" });
    expect(views(messages).at(-1)?.approvable).toEqual({ kind: "delta", id: draft.delta_id });
    await s.handle({ type: "event", event: { action: "approve", view_id: beforeAfter.view_id, target: draft.delta_id } });
    expect(notices(messages).at(-1)).toBe(`Approved ${draft.delta_id}: applied.`);
    expect(service.deltaRecord(draft.delta_id)?.status).toBe("applied");
  });

  it("expands a collapsed group when it is selected", async () => {
    const rules: NodeChange[] = Array.from({ length: 42 }, (_, i) => ({
      op: "add",
      id: `rule.payment-${i + 1}`,
      content: `---\nid: rule.payment-${i + 1}\nkind: BusinessRule\ntitle: Payment rule ${i + 1}\nstatement: Rule ${i + 1}.\npart-of: [component.payments-service]\nenforcement: {kb-layer: false}\n---\n`,
    }));
    const { s, messages } = await session([], rules);
    const view = await s.visualize({ scope: { focus: "component.payments-service", depth: 1 }, view: "explorer" });
    const group = view.elements.find((e) => e.type === "group");
    expect(group?.title).toBe("Payments service: 42 rules");
    await s.handle({ type: "event", event: { action: "select", view_id: view.view_id, target: group?.id ?? "" } });
    const redrawn = views(messages).at(-1);
    expect(redrawn?.view_id).toBe(view.view_id);
    expect(redrawn?.elements.filter((e) => e.id.startsWith("rule.payment-"))).toHaveLength(42);
    expect(redrawn?.elements.some((e) => e.type === "group")).toBe(false);
  });
});
