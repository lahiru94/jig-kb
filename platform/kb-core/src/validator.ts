import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { Environment } from "@marcbachmann/cel-js";
import { Ajv2019, type ErrorObject, type ValidateFunction } from "ajv/dist/2019.js";
import addFormatsModule from "ajv-formats";
import { buildCedarSchema, collectPolicies } from "./cedar-schema";
import { kindInfo } from "./kinds";
import type { KbNode, LoadIssue } from "./loader";
import { loadJsonSchema, loadSchemaMeta, type SchemaMeta } from "./schema-meta";

/** One validation problem, reported against a file (design D4). */
export interface ValidationError {
  file: string;
  /** Node id, when the file parsed far enough to have one. */
  node?: string;
  /** Field path in frontmatter (kebab-case), for example `fields[1].type`. */
  field?: string;
  message: string;
  schemaVersion: string;
}

export interface ValidationReport {
  valid: boolean;
  schemaVersion: string;
  errors: ValidationError[];
}

// ajv-formats ships as CommonJS; its default export is the plugin function.
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;

const kebab = (s: string): string => s.replace(/_/g, "-");

function fieldPath(segments: Array<string | number>): string {
  return segments
    .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : `${i === 0 ? "" : "."}${kebab(seg)}`))
    .join("");
}

function pointerToSegments(pointer: string): Array<string | number> {
  return pointer
    .split("/")
    .slice(1)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p.replace(/~1/g, "/").replace(/~0/g, "~")));
}

/** CEL type for a KB field type (see platform/kb-core/README.md). */
function celTypeFor(fieldType: string): string {
  switch (fieldType) {
    case "int":
      return "int";
    case "decimal":
      return "double";
    case "bool":
      return "bool";
    case "timestamp":
      return "google.protobuf.Timestamp";
    case "list":
      return "list";
    default:
      return "string";
  }
}

export class KbValidator {
  readonly meta: SchemaMeta;
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(meta: SchemaMeta = loadSchemaMeta()) {
    this.meta = meta;
    const ajv = new Ajv2019({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = loadJsonSchema();
    ajv.addSchema(schema, "jig");
    for (const kind of meta.nodeKinds) {
      const validate = ajv.getSchema(`jig#/$defs/${kind}`);
      if (validate) this.validators.set(kind, validate);
    }
  }

  /** Validates a whole KB: load issues, each node, graph links, Cedar policies and CEL derivations. */
  validate(nodes: readonly KbNode[], loadIssues: readonly LoadIssue[] = []): ValidationReport {
    const version = this.meta.version;
    const errors: ValidationError[] = loadIssues.map((i) => ({ file: i.file, message: i.message, schemaVersion: version }));
    const byId = new Map<string, KbNode>();
    for (const node of nodes) {
      const prior = byId.get(node.id);
      if (prior && node.id) {
        errors.push(this.err(node, `duplicate id '${node.id}' (also defined in ${prior.file})`, ["id"]));
      } else byId.set(node.id, node);
    }
    const validKinds: KbNode[] = [];
    for (const node of nodes) {
      const before = errors.length;
      this.checkNode(node, byId, errors);
      if (errors.length === before || kindInfo(node.kind)) validKinds.push(node);
    }
    this.checkCedar(validKinds.filter((n) => kindInfo(n.kind)), byId, errors);
    this.checkCel(nodes, errors);
    return { valid: errors.length === 0, schemaVersion: version, errors };
  }

  private err(node: KbNode, message: string, field?: Array<string | number>): ValidationError {
    const e: ValidationError = { file: node.file, message, schemaVersion: this.meta.version };
    if (node.id) e.node = node.id;
    if (field && field.length > 0) e.field = fieldPath(field);
    return e;
  }

  private checkNode(node: KbNode, byId: Map<string, KbNode>, errors: ValidationError[]): void {
    const info = kindInfo(node.kind);
    const validate = this.validators.get(node.kind);
    if (!info || !validate) {
      errors.push(this.err(node, node.kind ? `unknown kind '${node.kind}'` : "missing kind", ["kind"]));
      return;
    }
    if (node.id && !node.id.startsWith(`${info.prefix}.`)) {
      errors.push(this.err(node, `id '${node.id}' must start with '${info.prefix}.' for kind ${node.kind}`, ["id"]));
    }

    // Graph-level link checks first, so that disallowed link slots get a precise message.
    const disallowedSlots = new Set<string>();
    for (const [key, value] of Object.entries(node.data)) {
      const sources = this.meta.linkSources.get(key);
      if (!sources) continue;
      const slot = this.meta.slotsOf(node.kind).get(key);
      if (!slot) {
        disallowedSlots.add(key);
        const targets = this.targetKinds(value, byId);
        const allowedFrom = [...sources].sort().join(", ") || "no kind";
        errors.push(
          this.err(
            node,
            `link '${kebab(key)}' cannot connect ${node.kind} to ${targets.join(", ") || "anything"}: it is only allowed from ${allowedFrom}`,
            [key],
          ),
        );
        continue;
      }
    }
    this.checkLinksIn(node, node.kind, node.data, [], byId, errors, disallowedSlots);

    // JSON Schema checks, skipping errors already reported more precisely above or below.
    if (!validate(node.data)) {
      for (const e of validate.errors ?? []) this.reportSchemaError(node, e, disallowedSlots, errors);
    }
    this.checkClaimsAndConflicts(node, errors);
    if (node.kind === "DataEntity") this.checkDataEntity(node, errors);
  }

  private targetKinds(value: unknown, byId: Map<string, KbNode>): string[] {
    const ids = Array.isArray(value) ? value : [value];
    return [...new Set(ids.filter((v): v is string => typeof v === "string").map((id) => byId.get(id)?.kind ?? id))];
  }

  /** Walks a node (or nested object) and checks every link value it holds against the schema. */
  private checkLinksIn(
    node: KbNode,
    className: string,
    obj: Record<string, unknown>,
    path: Array<string | number>,
    byId: Map<string, KbNode>,
    errors: ValidationError[],
    skip: Set<string>,
  ): void {
    const slots = this.meta.slotsOf(className);
    for (const [key, value] of Object.entries(obj)) {
      if (path.length === 0 && skip.has(key)) continue;
      const slot = slots.get(key);
      if (!slot) continue;
      if (slot.linkTargets) {
        const ids = Array.isArray(value) ? value : [value];
        ids.forEach((id, index) => {
          if (typeof id !== "string") return;
          const fieldSegs = Array.isArray(value) ? [...path, key, index] : [...path, key];
          const target = byId.get(id);
          if (!target) {
            errors.push(this.err(node, `${node.id || node.file} links to missing node '${id}' via '${kebab(key)}'`, fieldSegs));
            return;
          }
          const allowed = slot.linkTargets ?? [];
          if (!allowed.includes("*") && !allowed.includes(target.kind)) {
            errors.push(
              this.err(
                node,
                `link '${kebab(key)}' cannot connect ${node.kind} to ${target.kind} ('${id}'); allowed targets: ${allowed.join(", ")}`,
                fieldSegs,
              ),
            );
          }
        });
      } else if (slot.range && this.meta.isClass(slot.range) && slot.range !== "Any") {
        const items = Array.isArray(value) ? value : [value];
        items.forEach((item, index) => {
          if (item === null || typeof item !== "object" || Array.isArray(item)) return;
          const segs = Array.isArray(value) ? [...path, key, index] : [...path, key];
          this.checkLinksIn(node, slot.range as string, item as Record<string, unknown>, segs, byId, errors, skip);
        });
      }
    }
  }

  private reportSchemaError(node: KbNode, e: ErrorObject, disallowedSlots: Set<string>, errors: ValidationError[]): void {
    const segs = pointerToSegments(e.instancePath);
    if (e.keyword === "additionalProperties") {
      const extra = (e.params as { additionalProperty: string }).additionalProperty;
      if (segs.length === 0 && disallowedSlots.has(extra)) return;
      errors.push(this.err(node, `unknown field '${kebab(extra)}' for ${node.kind}`, [...segs, extra]));
      return;
    }
    if (e.keyword === "required") {
      const missing = (e.params as { missingProperty: string }).missingProperty;
      // Claims and data-entity fields get clearer messages from dedicated checks.
      if (segs[0] === "claims" && missing === "source") return;
      if (segs[0] === "fields" && missing === "type") return;
      errors.push(this.err(node, `missing required field '${kebab(missing)}'`, [...segs, missing]));
      return;
    }
    // anyOf errors from nullable slots repeat their branch errors; report the first branch only.
    if (e.keyword === "anyOf") return;
    if (e.keyword === "type" && (e.params as { type: string }).type === "null") return;
    errors.push(this.err(node, `${fieldPath(segs) || "frontmatter"} ${e.message ?? "is invalid"}`, segs));
  }

  private checkClaimsAndConflicts(node: KbNode, errors: ValidationError[]): void {
    const claims = Array.isArray(node.data.claims) ? (node.data.claims as Array<Record<string, unknown>>) : [];
    claims.forEach((claim, index) => {
      if (claim && typeof claim === "object" && (claim.source === undefined || claim.source === "")) {
        errors.push(this.err(node, `claim ${index} has no source`, ["claims", index, "source"]));
      }
    });
    const conflicts = Array.isArray(node.data.conflicts) ? (node.data.conflicts as Array<Record<string, unknown>>) : [];
    conflicts.forEach((conflict, index) => {
      if (!conflict || typeof conflict !== "object") return;
      const refs = Array.isArray(conflict.claims) ? (conflict.claims as unknown[]) : [];
      refs.forEach((ref, i) => {
        if (typeof ref !== "number" || ref < 0 || ref >= claims.length) {
          errors.push(this.err(node, `conflict ${index} refers to claim ${String(ref)}, which does not exist`, ["conflicts", index, "claims", i]));
        }
      });
      if (new Set(refs).size !== refs.length) {
        errors.push(this.err(node, `conflict ${index} lists the same claim twice`, ["conflicts", index, "claims"]));
      }
      if (conflict.status === "resolved") {
        if (typeof conflict.chosen !== "number" || !refs.includes(conflict.chosen)) {
          errors.push(this.err(node, `resolved conflict ${index} must name a chosen claim from its claims`, ["conflicts", index, "chosen"]));
        }
        if (typeof conflict.resolved_by !== "string" || conflict.resolved_by === "") {
          errors.push(this.err(node, `resolved conflict ${index} must record who resolved it`, ["conflicts", index, "resolved_by"]));
        }
      } else if (conflict.status === "open" && conflict.chosen !== undefined) {
        errors.push(this.err(node, `open conflict ${index} must not have a chosen claim`, ["conflicts", index, "chosen"]));
      }
    });
  }

  private checkDataEntity(node: KbNode, errors: ValidationError[]): void {
    const fields = Array.isArray(node.data.fields) ? (node.data.fields as Array<Record<string, unknown>>) : [];
    const names = new Set<string>();
    fields.forEach((field, index) => {
      if (!field || typeof field !== "object") return;
      const name = typeof field.name === "string" ? field.name : `#${index}`;
      names.add(name);
      if (field.type === undefined) {
        errors.push(this.err(node, `field '${name}' of ${node.id} has no type`, ["fields", index, "type"]));
      }
      if (field.type === "enum" && (!Array.isArray(field.values) || field.values.length === 0)) {
        errors.push(this.err(node, `enum field '${name}' of ${node.id} must list its values`, ["fields", index, "values"]));
      }
      if (field.type === "ref" && typeof field.ref !== "string") {
        errors.push(this.err(node, `ref field '${name}' of ${node.id} must name the entity it refers to`, ["fields", index, "ref"]));
      }
    });
    const identity = Array.isArray(node.data.identity) ? (node.data.identity as unknown[]) : [];
    identity.forEach((name, index) => {
      if (typeof name === "string" && !names.has(name)) {
        errors.push(this.err(node, `identity field '${name}' is not one of the fields of ${node.id}`, ["identity", index]));
      }
    });
  }

  private checkCedar(nodes: readonly KbNode[], byId: Map<string, KbNode>, errors: ValidationError[]): void {
    const { policies, errors: parseErrors } = collectPolicies(nodes);
    for (const e of parseErrors) {
      const node = byId.get(e.nodeId);
      if (node) errors.push(this.err(node, e.message, [this.policySlot(node)]));
    }
    if (policies.length === 0) return;
    const schema = buildCedarSchema(nodes) as cedar.Schema;
    for (const policy of policies) {
      const answer = cedar.validate({
        validationSettings: { mode: "strict" },
        schema,
        policies: { staticPolicies: { [policy.id]: policy.text } },
      });
      const node = byId.get(policy.nodeId);
      if (!node) continue;
      if (answer.type === "failure") {
        for (const e of answer.errors) errors.push(this.err(node, `Cedar schema error: ${e.message}`, [this.policySlot(node)]));
        continue;
      }
      for (const e of answer.validationErrors) {
        errors.push(this.err(node, `Cedar policy does not validate against the KB: ${e.error.message}`, [this.policySlot(node)]));
      }
    }
  }

  private policySlot(node: KbNode): string {
    if (node.kind === "BusinessRule") return "check";
    if (node.kind === "Permission") return "condition";
    return "policy_text";
  }

  private checkCel(nodes: readonly KbNode[], errors: ValidationError[]): void {
    for (const node of nodes) {
      if (node.kind !== "Derivation" || typeof node.data.expression !== "string") continue;
      const env = new Environment();
      const inputs = Array.isArray(node.data.inputs) ? (node.data.inputs as Array<Record<string, unknown>>) : [];
      for (const input of inputs) {
        if (typeof input.name === "string" && typeof input.type === "string") env.registerVariable(input.name, celTypeFor(input.type));
      }
      try {
        const result = env.check(node.data.expression);
        if (!result.valid) {
          errors.push(this.err(node, `CEL expression does not type-check: ${result.error?.message ?? "invalid"}`, ["expression"]));
        }
      } catch (error) {
        errors.push(this.err(node, `CEL expression does not parse: ${(error as Error).message}`, ["expression"]));
      }
    }
  }
}

/** Whether the KB layer can enforce a rule itself (it has an executable check). */
export function isEnforceableByKb(rule: KbNode): boolean {
  return rule.kind === "BusinessRule" && typeof rule.data.check === "string" && rule.data.check.trim() !== "";
}
