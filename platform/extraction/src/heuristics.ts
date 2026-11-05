import type { Candidate, ExtractionPass, SourceFile } from "./types";

export function slugify(text: string, max = 6): string {
  return text
    .toLowerCase()
    .replace(/[`'"’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP.has(w))
    .slice(0, max)
    .join("-");
}

const STOP = new Set(["when", "otherwise", "may", "can", "the", "a", "an", "of", "to", "is", "are", "and", "or", "in", "on", "for", "this", "that", "it", "be", "as", "at", "by", "with", "if", "we", "our", "they", "their", "its"]);

export function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const isCode = (path: string): boolean => /\.(ts|js|mjs|tsx)$/.test(path) && !/(^|\/)test\//.test(path);
/** Shared libraries hold infrastructure, not business rules. */
const isSharedLibrary = (path: string): boolean => /(^|\/)(shared|lib|common)\//.test(path);
const isDoc = (path: string): boolean => path.endsWith(".md") && !/(^|\/)(kb|README)/i.test(path) && !path.toUpperCase().endsWith("PLANTED.MD");

/** The component a code file belongs to: `services/<name>/…` becomes `component.<name>-service`; other top folders keep their name. */
export function componentFor(path: string): string | undefined {
  const service = /(?:^|\/)services\/([a-z0-9-]+)\//.exec(path);
  if (service?.[1] === "shared") return undefined;
  if (service) return `component.${service[1]}-service`;
  const top = /(?:^|\/)([a-z0-9-]+)\/src\//.exec(path);
  return top ? `component.${top[1]}` : undefined;
}

function title(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim().replace(/[.:]$/, "");
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

const SQL_TYPES: Record<string, string> = { TEXT: "string", VARCHAR: "string", INTEGER: "int", INT: "int", BIGINT: "int", SERIAL: "int", BOOLEAN: "bool", TIMESTAMPTZ: "timestamp", TIMESTAMP: "timestamp", DATE: "date", NUMERIC: "decimal" };

/** Pass 1: components from the code layout, and data entities (typed fields, identity) from table definitions. */
export const inventoryPass: ExtractionPass = {
  name: "inventory",
  async run(files) {
    const out = new Map<string, Candidate>();
    for (const file of files.filter((f) => isCode(f.path))) {
      const component = componentFor(file.path);
      if (component && !out.has(component)) {
        const name = component.slice("component.".length);
        out.set(component, {
          id: component,
          kind: "Component",
          title: name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
          fields: { mode: "described" },
          claims: [{ says: `Code lives in ${file.path.split("/src/")[0]}`, source: `code:${file.path.split("/src/")[0]}`, confidence: "inferred" }],
          pass: "inventory",
        });
      }
      const lines = file.content.split("\n");
      lines.forEach((line, i) => {
        const m = /CREATE TABLE IF NOT EXISTS (?:([a-z_]+)\.)?([a-z_]+)\s*\(/i.exec(line);
        if (!m) return;
        const table = m[2] ?? "";
        const fields: Array<Record<string, unknown>> = [];
        const identity: string[] = [];
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
          const col = /^\s*([a-z_]+)\s+([A-Z]+)/.exec(lines[j] ?? "");
          if (/^\s*\);/.test(lines[j] ?? "")) {
            end = j;
            break;
          }
          if (!col) continue;
          fields.push({ name: col[1], type: SQL_TYPES[col[2] ?? ""] ?? "string" });
          if (/PRIMARY KEY/.test(lines[j] ?? "")) identity.push(col[1] ?? "");
        }
        const name = singular(table).replace(/_/g, "-");
        const id = `entity.${name}`;
        if (out.has(id) || fields.length === 0) return;
        out.set(id, {
          id,
          kind: "DataEntity",
          title: title(name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())),
          fields: { fields, identity: identity.length > 0 ? identity : [String(fields[0]?.name)], ...(component ? { part_of: [component] } : {}) },
          claims: [{ says: `Stored in table ${m[1] ? `${m[1]}.` : ""}${table}`, source: `code:${file.path}#L${i + 1}-L${end + 1}`, confidence: "inferred" }],
          pass: "inventory",
        });
      });
    }
    return [...out.values()];
  },
};

const RULE_WORDS = /\b(definition|always|only|never|must|cannot|can't|cut-off|cutoff|per order|wait|above|below|before|after|limit|window|at most|at least)\b/i;

function commentAbove(lines: string[], index: number): { text: string; start: number } | undefined {
  const parts: string[] = [];
  let start = index;
  for (let j = index - 1; j >= 0; j--) {
    const m = /^\s*\/\/\s?(.*)$/.exec(lines[j] ?? "");
    if (!m) break;
    parts.unshift(m[1] ?? "");
    start = j;
  }
  return parts.length > 0 ? { text: parts.join(" ").trim(), start } : undefined;
}

/** Pass 2: rule candidates from code: commented constants, rule-like comments, guarded refusals and literal branches. */
export const rulesPass: ExtractionPass = {
  name: "rules",
  async run(files) {
    const out: Candidate[] = [];
    const taken = new Set<string>();
    const add = (file: SourceFile, start: number, end: number, statement: string, says: string): void => {
      const key = `${file.path}:${start}`;
      if (taken.has(key)) return;
      for (let l = start; l <= end; l++) taken.add(`${file.path}:${l}`);
      const component = componentFor(file.path);
      const base = slugify(statement) || `line-${start}`;
      let id = `rule.${base}`;
      for (let n = 2; out.some((c) => c.id === id); n++) id = `rule.${base}-${n}`;
      out.push({
        id,
        kind: "BusinessRule",
        title: title(statement),
        fields: { statement, enforcement: { kb_layer: false, ...(component ? { components: [component] } : {}) }, ...(component ? { implemented_by: [component] } : {}) },
        claims: [{ says, source: `code:${file.path}#L${start}${end > start ? `-L${end}` : ""}`, confidence: "inferred" }],
        pass: "rules",
      });
    };
    for (const file of files.filter((f) => isCode(f.path) && !isSharedLibrary(f.path))) {
      const lines = file.content.split("\n");
      lines.forEach((line, i) => {
        const n = i + 1;
        // A named constant with a comment explaining it.
        const constant = /^\s*(?:const|var|let)\s+([A-Z][A-Z0-9_]+)\s*=\s*(.+?);?\s*(\/\/.*)?$/.exec(line);
        if (constant) {
          const comment = commentAbove(lines, i);
          const inline = constant[3]?.replace(/^\/\/\s*/, "");
          const explanation = comment?.text ?? inline;
          if (explanation) add(file, comment ? comment.start + 1 : n, n, explanation, `${explanation} (${constant[1]} = ${constant[2]?.trim()})`);
          return;
        }
        // A comment that reads like a rule or a definition.
        const comment = /^\s*\/\/\s?(.*)$/.exec(line);
        if (comment && RULE_WORDS.test(comment[1] ?? "") && !/^\s*\/\//.test(lines[i - 1] ?? "")) {
          const block = [comment[1] ?? ""];
          let j = i + 1;
          while (/^\s*\/\//.test(lines[j] ?? "")) block.push((/^\s*\/\/\s?(.*)$/.exec(lines[j] ?? "")?.[1] ?? "").trim()), j++;
          const text = block.join(" ").replace(/^Note:\s*/i, "").trim();
          if (!/^(const|var|let)\s/.test((lines[j] ?? "").trim())) add(file, n, j, text, text);
          return;
        }
        // A guarded refusal: if (...) throw ... "message".
        const refusal = /if\s*\((.+)\)\s*throw new \w+\(\s*\d*\s*,?\s*[`'"](.+?)[`'"]/.exec(line);
        if (refusal) {
          const message = (refusal[2] ?? "").replace(/\$\{[^}]+\}/g, "").replace(/\s+/g, " ").trim();
          add(file, n, n, `Refused when ${message}`, `Refuses the request when ${refusal[1]?.trim()} (${message})`);
          return;
        }
        // A function that returns one of two literal values depending on a literal comparison.
        const branch = /return\s+(\w+)\s*===?\s*["'](\w+)["']\s*\?\s*([\w."']+)\s*:\s*([\w."']+)/.exec(line);
        if (branch) {
          const fn = /function\s+(\w+)/.exec(lines[i - 1] ?? "")?.[1] ?? "value";
          const statement = `${fn}: ${branch[3]} when ${branch[1]} is "${branch[2]}", otherwise ${branch[4]}`;
          add(file, fn === "value" ? n : n - 1, n, statement, statement);
        }
      });
    }
    return out;
  },
};

const DOC_RULE = /\b(may|must|need|needs|cannot|can't|should|within \d+ (?:days|hours)|up to|at least|at most|every \w+day)\b/i;

/** Pass 3: rule statements from business documents, cited by section. */
export const documentsPass: ExtractionPass = {
  name: "documents",
  async run(files) {
    const out: Candidate[] = [];
    for (const file of files.filter((f) => isDoc(f.path))) {
      let section = "";
      let heading = "";
      const paragraphs = file.content.split(/\n\s*\n/);
      for (const para of paragraphs) {
        const h = /^#{2,3}\s+(.*)$/m.exec(para.trim());
        if (h && para.trim().startsWith("#")) {
          heading = (h[1] ?? "").trim();
          const num = /^(\d+)\./.exec(heading);
          section = num ? (num[1] ?? "") : slugify(heading, 8);
          continue;
        }
        if (!heading) continue;
        const text = para.replace(/[*_`]/g, "").replace(/^\s*[-\d.]+\s+/gm, "").replace(/\s+/g, " ").trim();
        const sentences = text.split(/(?<=\.)\s+/).filter((s) => DOC_RULE.test(s));
        if (sentences.length === 0) continue;
        const statement = sentences.join(" ");
        const base = slugify(heading.replace(/^\d+\.\s*/, "")) || "statement";
        let id = `rule.${base}`;
        for (let n = 2; out.some((c) => c.id === id); n++) id = `rule.${base}-${n}`;
        out.push({
          id,
          kind: "BusinessRule",
          title: title(heading.replace(/^\d+\.\s*/, "")),
          fields: { statement, enforcement: { kb_layer: false } },
          claims: [{ says: statement, source: `doc:${file.path}${section ? `#${section}` : ""}`, confidence: "stated" }],
          pass: "documents",
        });
      }
    }
    return out;
  },
};

export const HEURISTIC_PASSES: readonly ExtractionPass[] = [inventoryPass, rulesPass, documentsPass];
