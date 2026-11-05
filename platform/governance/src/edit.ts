import { parseDocument } from "yaml";
import { splitFrontmatter } from "@jig/kb-core";
import type { GitKbRepo } from "./git-repo";

/** The current file content of a node on main (or another ref). */
export function nodeFileContent(repo: GitKbRepo, nodeId: string, ref = "main"): { path: string; content: string } | undefined {
  for (const node of repo.nodes(ref)) {
    if (node.id !== nodeId) continue;
    const file = repo.files(ref).find((f) => f.path === node.file);
    return file ? { path: file.path, content: file.content } : undefined;
  }
  return undefined;
}

/**
 * Sets one frontmatter field (given in snake_case or kebab-case) in a node file, keeping the rest of the
 * frontmatter's formatting and the body as they are.
 */
export function setFrontmatterField(content: string, field: string, value: unknown): string {
  const parts = splitFrontmatter(content);
  if (!parts) throw new Error("the file has no frontmatter");
  const doc = parseDocument(parts.frontmatter);
  const key = field.replace(/_/g, "-");
  doc.set(key, value);
  return `---\n${doc.toString().trimEnd()}\n---\n${parts.body}`;
}
