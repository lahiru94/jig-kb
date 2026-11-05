import { parseNodeFile, type KbNode } from "@jig/kb-core";
import { describe, expect, it } from "vitest";
import { Executor, UnknownTypeError, defaultRegistries, type BindingType } from "../src/index";

function node(text: string): KbNode {
  const parsed = parseNodeFile(text, "n.md");
  if ("message" in parsed) throw new Error(parsed.message);
  return parsed;
}

const echoBinding = node("---\nid: binding.echo\nkind: Binding\ntitle: Echo\nbinding-type: echo\nbinds-to: [component.x]\nconfig: {prefix: hello}\n---\n");
const action = node(
  "---\nid: action.say\nkind: Action\ntitle: Say\nresource: entity.x\nmode: connected\ninputs:\n  - name: who\n    type: string\nsteps:\n  - name: say\n    kind: binding-call\n    binding: binding.echo\n    with: {who: $input.who}\n---\n",
);
const nodes = new Map([echoBinding, action].map((n) => [n.id, n]));
const env = { services: {}, databases: {} };
const scope = { input: { who: "world" }, fact: {}, context: {} };

describe("binding and step registries", () => {
  it("registers REST and SQL binding types and the binding-call step kind by default", () => {
    const { bindings, steps } = defaultRegistries();
    expect(bindings.names()).toEqual(["rest", "sql"]);
    expect(steps.names()).toEqual(["binding-call"]);
  });

  it("runs an action through a newly registered binding type without changing the executor core", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const echo: BindingType = {
      name: "echo",
      async call(binding, params) {
        calls.push(params);
        return { said: `${String((binding.data.config as { prefix: string }).prefix)} ${String(params.who)}` };
      },
    };
    const registries = defaultRegistries();
    registries.bindings.register(echo);
    const result = await new Executor(env, registries).run(action, scope, (id) => nodes.get(id));
    expect(result).toEqual({
      status: "executed",
      steps: [{ name: "say", kind: "binding-call", status: "ok", binding: "binding.echo", params: { who: "world" }, result: { said: "hello world" } }],
    });
    expect(calls).toEqual([{ who: "world" }]);
  });

  it("fails a step whose binding type is not registered", async () => {
    const result = await new Executor(env).run(action, scope, (id) => nodes.get(id));
    expect(result.status).toBe("failed");
    expect(result.steps[0]).toMatchObject({ status: "failed", error: "no binding type 'echo' is registered" });
    expect(() => defaultRegistries().steps.get("emit-event")).toThrow(UnknownTypeError);
  });
});
