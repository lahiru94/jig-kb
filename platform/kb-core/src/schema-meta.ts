import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** Location of the LinkML source and generated artifacts (design D4). */
export const SCHEMA_DIR = fileURLToPath(new URL("../../../schema/", import.meta.url));

interface RawSlot {
  range?: string;
  multivalued?: boolean;
  annotations?: Record<string, unknown>;
}

interface RawClass {
  is_a?: string;
  abstract?: boolean;
  slots?: string[];
  attributes?: Record<string, RawSlot | null>;
  slot_usage?: Record<string, RawSlot | null>;
}

interface RawSchema {
  version: string;
  slots: Record<string, RawSlot | null>;
  classes: Record<string, RawClass | null>;
}

/** A slot as seen from one class: its range and, for links, the allowed target kinds. */
export interface SlotMeta {
  name: string;
  range: string | undefined;
  multivalued: boolean;
  /** Allowed target kinds for link slots; `["*"]` means any kind. Undefined for non-links. */
  linkTargets: string[] | undefined;
}

export interface SchemaMeta {
  version: string;
  /** Concrete node kinds (non-abstract subclasses of Node). */
  nodeKinds: string[];
  /** Slots available on each class, including inherited ones and attributes. */
  slotsOf(className: string): Map<string, SlotMeta>;
  /** All link slot names on node kinds, with the kinds allowed to use each. */
  linkSources: Map<string, Set<string>>;
  isClass(name: string): boolean;
}

function linkTargetsOf(slot: RawSlot | null | undefined): string[] | undefined {
  const annotations = slot?.annotations;
  if (!annotations || annotations.link !== true) return undefined;
  const targets = typeof annotations.targets === "string" ? annotations.targets : "*";
  return targets.split(/\s+/).filter(Boolean);
}

export function loadSchemaMeta(path = `${SCHEMA_DIR}jig.yaml`): SchemaMeta {
  const raw = parseYaml(readFileSync(path, "utf8")) as RawSchema;
  const classes = raw.classes;
  const cache = new Map<string, Map<string, SlotMeta>>();

  function ancestors(name: string): string[] {
    const chain: string[] = [];
    let current: string | undefined = name;
    while (current) {
      chain.unshift(current);
      current = classes[current]?.is_a;
    }
    return chain;
  }

  function slotsOf(className: string): Map<string, SlotMeta> {
    const cached = cache.get(className);
    if (cached) return cached;
    const out = new Map<string, SlotMeta>();
    for (const name of ancestors(className)) {
      const cls = classes[name];
      if (!cls) continue;
      for (const slotName of cls.slots ?? []) {
        const slot = raw.slots[slotName];
        out.set(slotName, {
          name: slotName,
          range: slot?.range,
          multivalued: slot?.multivalued === true,
          linkTargets: linkTargetsOf(slot),
        });
      }
      for (const [attrName, attr] of Object.entries(cls.attributes ?? {})) {
        out.set(attrName, {
          name: attrName,
          range: attr?.range,
          multivalued: attr?.multivalued === true,
          linkTargets: linkTargetsOf(attr),
        });
      }
    }
    cache.set(className, out);
    return out;
  }

  const nodeKinds = Object.entries(classes)
    .filter(([name, cls]) => !cls?.abstract && name !== "Node" && ancestors(name)[0] === "Node")
    .map(([name]) => name)
    .sort();

  const linkSources = new Map<string, Set<string>>();
  for (const kind of nodeKinds) {
    for (const slot of slotsOf(kind).values()) {
      if (!slot.linkTargets) continue;
      const sources = linkSources.get(slot.name) ?? new Set<string>();
      sources.add(kind);
      linkSources.set(slot.name, sources);
    }
  }
  // Link slots defined at schema level but not used by any node kind are still known links.
  for (const [name, slot] of Object.entries(raw.slots)) {
    if (linkTargetsOf(slot) && !linkSources.has(name)) linkSources.set(name, new Set());
  }

  return {
    version: raw.version,
    nodeKinds,
    slotsOf,
    linkSources,
    isClass: (name) => name in classes,
  };
}

export function loadJsonSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(`${SCHEMA_DIR}generated/jig.schema.json`, "utf8")) as Record<string, unknown>;
}

export function loadJsonLdContext(): Record<string, unknown> {
  return JSON.parse(readFileSync(`${SCHEMA_DIR}generated/jig.context.jsonld`, "utf8")) as Record<string, unknown>;
}
