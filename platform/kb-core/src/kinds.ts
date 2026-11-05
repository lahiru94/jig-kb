/** Node kinds and their file conventions (design D3): id `<prefix>.<slug>`, file `<dir>/<slug>.md`. */
export type Layer = "real-world" | "digital" | "operational";

export interface KindInfo {
  kind: string;
  prefix: string;
  dir: string;
  layer: Layer;
}

const table: Array<[kind: string, prefix: string, dir: string, layer: Layer]> = [
  ["Goal", "goal", "goals", "real-world"],
  ["Constraint", "constraint", "constraints", "real-world"],
  ["Capability", "capability", "capabilities", "real-world"],
  ["Process", "process", "processes", "real-world"],
  ["Step", "step", "steps", "real-world"],
  ["BusinessRule", "rule", "rules", "real-world"],
  ["Term", "term", "terms", "real-world"],
  ["Actor", "actor", "actors", "real-world"],
  ["Role", "role", "roles", "real-world"],
  ["Decision", "decision", "decisions", "real-world"],
  ["System", "system", "systems", "digital"],
  ["Component", "component", "components", "digital"],
  ["Interface", "interface", "interfaces", "digital"],
  ["DataEntity", "entity", "entities", "digital"],
  ["Job", "job", "jobs", "digital"],
  ["Agent", "agent", "agents", "digital"],
  ["Action", "action", "actions", "operational"],
  ["Binding", "binding", "bindings", "operational"],
  ["Derivation", "derivation", "derivations", "operational"],
  ["Policy", "policy", "policies", "operational"],
  ["Permission", "permission", "permissions", "operational"],
];

export const KINDS: readonly KindInfo[] = table.map(([kind, prefix, dir, layer]) => ({ kind, prefix, dir, layer }));

const byKind = new Map(KINDS.map((k) => [k.kind, k]));
const byPrefix = new Map(KINDS.map((k) => [k.prefix, k]));
const byDir = new Map(KINDS.map((k) => [k.dir, k]));

export function kindInfo(kind: string): KindInfo | undefined {
  return byKind.get(kind);
}

export function kindForPrefix(prefix: string): KindInfo | undefined {
  return byPrefix.get(prefix);
}

export function kindForDir(dir: string): KindInfo | undefined {
  return byDir.get(dir);
}

/** Kinds that carry an operating mode (design D16). */
export const MODE_KINDS: ReadonlySet<string> = new Set(["System", "Component", "Action"]);
