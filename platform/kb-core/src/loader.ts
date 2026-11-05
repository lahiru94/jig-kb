import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { MODE_KINDS } from "./kinds";

/** A KB node as loaded from one Markdown file (design D3). Frontmatter keys are snake_case in `data`. */
export interface KbNode {
  id: string;
  kind: string;
  title: string;
  /** Frontmatter with keys normalised to snake_case, plus slots filled from fenced body blocks. */
  data: Record<string, unknown>;
  /** Markdown body with the fenced cedar/cel blocks left in place. */
  body: string;
  /** Path relative to the KB root, using forward slashes. */
  file: string;
}

export interface LoadIssue {
  file: string;
  message: string;
}

export interface LoadResult {
  nodes: KbNode[];
  issues: LoadIssue[];
}

/** Free-form maps whose keys are user data and must not be renamed. */
const FREE_FORM_KEYS = new Set(["config", "with"]);

/** Body blocks that fill a slot, by node kind. */
const BLOCK_SLOTS: Record<string, { lang: string; slot: string }> = {
  BusinessRule: { lang: "cedar", slot: "check" },
  Policy: { lang: "cedar", slot: "policy_text" },
  Derivation: { lang: "cel", slot: "expression" },
};

export function toSnake(key: string): string {
  return key.replace(/-/g, "_");
}

function normaliseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseKeys);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const snake = toSnake(key);
      out[snake] = FREE_FORM_KEYS.has(snake) ? inner : normaliseKeys(inner);
    }
    return out;
  }
  return value;
}

/** Returns the contents of every ```<lang> fenced block in a Markdown body. */
export function fencedBlocks(body: string, lang: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp("^```" + lang + "[^\\S\\n]*\\n([\\s\\S]*?)^```[^\\S\\n]*$", "gm");
  for (const match of body.matchAll(pattern)) blocks.push((match[1] ?? "").trimEnd());
  return blocks;
}

export function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const match = /^---[^\S\n]*\n([\s\S]*?)\n---[^\S\n]*(?:\n|$)([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

/** Parses one node file. Returns an issue instead of throwing when the file is malformed. */
export function parseNodeFile(text: string, file: string): KbNode | LoadIssue {
  const parts = splitFrontmatter(text);
  if (!parts) return { file, message: "missing YAML frontmatter (the file must start with ---)" };
  let raw: unknown;
  try {
    // Dates stay strings so that frontmatter round-trips exactly into schema validation.
    raw = parseYaml(parts.frontmatter, { schema: "core" });
  } catch (error) {
    return { file, message: `invalid YAML frontmatter: ${(error as Error).message}` };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { file, message: "frontmatter must be a YAML mapping" };
  }
  const data = normaliseKeys(raw) as Record<string, unknown>;
  const kind = typeof data.kind === "string" ? data.kind : "";
  // A missing mode defaults to described (design D16).
  if (MODE_KINDS.has(kind) && data.mode === undefined) data.mode = "described";
  const blockSlot = BLOCK_SLOTS[kind];
  if (blockSlot && data[blockSlot.slot] === undefined) {
    const blocks = fencedBlocks(parts.body, blockSlot.lang);
    if (blocks.length > 0) data[blockSlot.slot] = blocks.join("\n\n");
  }
  return {
    id: typeof data.id === "string" ? data.id : "",
    kind,
    title: typeof data.title === "string" ? data.title : "",
    data,
    body: parts.body,
    file,
  };
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listMarkdown(path));
    else if (entry.endsWith(".md") && entry.toLowerCase() !== "readme.md") out.push(path);
  }
  return out;
}

/** Loads every node file under `root`, in a stable (sorted) order. */
export function loadKb(root: string): LoadResult {
  const nodes: KbNode[] = [];
  const issues: LoadIssue[] = [];
  for (const path of listMarkdown(root)) {
    const file = relative(root, path).split(sep).join("/");
    const result = parseNodeFile(readFileSync(path, "utf8"), file);
    if ("message" in result) issues.push(result);
    else nodes.push(result);
  }
  return { nodes, issues };
}
