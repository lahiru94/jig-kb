import type { KbNode, Scope } from "@jig/kb-core";
import { bindingCallStep, restBinding, sqlBinding } from "./builtin";
import { BindingRegistry, StepRegistry, type ExecutorEnv, type StepRecord } from "./registry";

export interface ExecutionResult {
  status: "executed" | "failed";
  steps: StepRecord[];
  error?: string;
}

/** Registries with the built-in binding types (REST, SQL) and step kind (binding-call). */
export function defaultRegistries(): { bindings: BindingRegistry; steps: StepRegistry } {
  return {
    bindings: new BindingRegistry().register(restBinding).register(sqlBinding),
    steps: new StepRegistry().register(bindingCallStep),
  };
}

/**
 * Runs an action's steps in order through the registered step kinds (design D16). If a step fails,
 * completed steps are compensated in reverse order and the action is reported failed, with every
 * step's outcome. The executor knows nothing about any business capability.
 */
export class Executor {
  readonly bindings: BindingRegistry;
  readonly steps: StepRegistry;

  constructor(
    readonly env: ExecutorEnv,
    registries = defaultRegistries(),
  ) {
    this.bindings = registries.bindings;
    this.steps = registries.steps;
  }

  /** Calls a binding directly, for fact gathering. */
  callBinding(binding: KbNode, params: Record<string, unknown>, scope: Scope): Promise<unknown> {
    return this.bindings.call(binding, params, this.env, scope);
  }

  async run(action: KbNode, scope: Scope, getNode: (id: string) => KbNode | undefined): Promise<ExecutionResult> {
    const declared = (Array.isArray(action.data.steps) ? action.data.steps : []) as Array<Record<string, unknown>>;
    const records: StepRecord[] = [];
    const done: Array<{ step: Record<string, unknown>; record: StepRecord }> = [];
    const stepResults: Record<string, Record<string, unknown>> = {};
    const scopeNow = (): Scope => ({ ...scope, step: stepResults });
    for (const step of declared) {
      const name = String(step.name);
      const kindName = String(step.kind ?? "binding-call");
      const record: StepRecord = { name, kind: kindName, status: "ok" };
      try {
        const kind = this.steps.get(kindName);
        const { result, binding, params } = await kind.run({ step, scope: scopeNow(), env: this.env, bindings: this.bindings, getNode });
        if (binding) record.binding = binding;
        if (params) record.params = params;
        record.result = result;
        stepResults[name] = (result ?? {}) as Record<string, unknown>;
        records.push(record);
        done.push({ step, record });
      } catch (error) {
        record.status = "failed";
        record.error = (error as Error).message;
        records.push(record);
        for (const remaining of declared.slice(declared.indexOf(step) + 1)) {
          records.push({ name: String(remaining.name), kind: String(remaining.kind ?? "binding-call"), status: "skipped" });
        }
        await this.compensate(done, scopeNow(), getNode);
        return { status: "failed", steps: records, error: record.error };
      }
    }
    return { status: "executed", steps: records };
  }

  private async compensate(
    done: Array<{ step: Record<string, unknown>; record: StepRecord }>,
    scope: Scope,
    getNode: (id: string) => KbNode | undefined,
  ): Promise<void> {
    for (const { step, record } of [...done].reverse()) {
      const kind = this.steps.get(record.kind);
      if (!kind.compensate) continue;
      try {
        const undone = await kind.compensate({ step, scope, env: this.env, bindings: this.bindings, getNode });
        if (undone) record.status = "compensated";
      } catch (error) {
        record.status = "compensation-failed";
        record.error = (error as Error).message;
      }
    }
  }
}
