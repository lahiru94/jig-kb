import type { KbNode, Scope } from "@jig/kb-core";

/** Settings a binding type needs to reach real systems, for example service base URLs and database URLs. */
export interface ExecutorEnv {
  /** Base URL per service name used in REST binding configs. */
  services: Record<string, string>;
  /** Connection string per database name used in SQL binding configs. */
  databases: Record<string, string>;
  /** Optional fetch implementation (tests inject one). */
  fetch?: typeof fetch;
}

/** A way of reaching a system (design D16). REST and SQL are registered; others plug in without executor changes. */
export interface BindingType {
  name: string;
  /** Calls the system. `params` are already resolved; `scope` is available for templated bodies. */
  call(binding: KbNode, params: Record<string, unknown>, env: ExecutorEnv, scope: Scope): Promise<unknown>;
}

export interface StepRecord {
  name: string;
  kind: string;
  status: "ok" | "failed" | "compensated" | "compensation-failed" | "skipped";
  binding?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/** Everything a step kind needs to run one step. */
export interface StepContext {
  step: Record<string, unknown>;
  scope: Scope;
  env: ExecutorEnv;
  bindings: BindingRegistry;
  getNode(id: string): KbNode | undefined;
}

/** A kind of action step (design D16). The MVP registers only `binding-call`. */
export interface StepKind {
  name: string;
  run(ctx: StepContext): Promise<{ result: unknown; binding?: string; params?: Record<string, unknown> }>;
  /** Undoes a completed step, if the step declares how. */
  compensate?(ctx: StepContext): Promise<{ result: unknown; binding?: string } | undefined>;
}

export class UnknownTypeError extends Error {}

export class BindingRegistry {
  private readonly types = new Map<string, BindingType>();

  register(type: BindingType): this {
    this.types.set(type.name, type);
    return this;
  }

  get(name: string): BindingType {
    const type = this.types.get(name);
    if (!type) throw new UnknownTypeError(`no binding type '${name}' is registered`);
    return type;
  }

  names(): string[] {
    return [...this.types.keys()].sort();
  }

  /** Calls a Binding node through its registered type. */
  call(binding: KbNode, params: Record<string, unknown>, env: ExecutorEnv, scope: Scope): Promise<unknown> {
    return this.get(String(binding.data.binding_type)).call(binding, params, env, scope);
  }
}

export class StepRegistry {
  private readonly kinds = new Map<string, StepKind>();

  register(kind: StepKind): this {
    this.kinds.set(kind.name, kind);
    return this;
  }

  get(name: string): StepKind {
    const kind = this.kinds.get(name);
    if (!kind) throw new UnknownTypeError(`no step kind '${name}' is registered`);
    return kind;
  }

  names(): string[] {
    return [...this.kinds.keys()].sort();
  }
}
