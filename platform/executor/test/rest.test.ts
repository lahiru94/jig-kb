import { parseNodeFile, type KbNode } from "@jig/kb-core";
import { describe, expect, it } from "vitest";
import { BindingCallError, restBinding } from "../src/index";

function node(text: string): KbNode {
  const parsed = parseNodeFile(text, "n.md");
  if ("message" in parsed) throw new Error(parsed.message);
  return parsed;
}

describe("REST binding type", () => {
  const binding = node(
    "---\nid: binding.post\nkind: Binding\ntitle: Post\nbinding-type: rest\nbinds-to: [component.x]\nconfig:\n  service: svc\n  method: POST\n  path: /things/{thing_id}/notes\n  body:\n    amount: $input.amount\n    ref: $run.id\n    who: $fact.who\n---\n",
  );

  it("fills the path, resolves the body template and returns the JSON response", async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as unknown as typeof fetch;
    const env = { services: { svc: "http://svc.local/" }, databases: {}, fetch: fakeFetch };
    const scope = { input: { amount: 5 }, fact: { who: "w" }, context: {}, run: { id: "req-1" } };
    const result = await restBinding.call(binding, { thing_id: "a b" }, env, scope);
    expect(result).toEqual({ ok: true });
    expect(seen[0]?.url).toBe("http://svc.local/things/a%20b/notes");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ amount: 5, ref: "req-1", who: "w" });
  });

  it("raises a binding error with the status on a failed response", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 409 })) as unknown as typeof fetch;
    const env = { services: { svc: "http://svc.local" }, databases: {}, fetch: fakeFetch };
    const call = restBinding.call(binding, { thing_id: "t" }, env, { input: {}, fact: {}, context: {} });
    await expect(call).rejects.toBeInstanceOf(BindingCallError);
    await expect(call).rejects.toThrow("409: nope");
  });

  it("refuses an unconfigured service or a missing path parameter", async () => {
    const env = { services: {}, databases: {} };
    await expect(restBinding.call(binding, { thing_id: "t" }, env, { input: {}, fact: {}, context: {} })).rejects.toThrow("no URL configured for service 'svc'");
    const env2 = { services: { svc: "http://svc.local" }, databases: {} };
    await expect(restBinding.call(binding, {}, env2, { input: {}, fact: {}, context: {} })).rejects.toThrow("missing path parameter 'thing_id'");
  });
});
