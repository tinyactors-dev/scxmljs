/**
 * Just enough Markdown for the doc tooling: file discovery, fenced code
 * blocks (with the `<!-- doctest: … -->` directive in front of them),
 * headings → GitHub anchors, and links outside code.
 */
import { Glob } from "bun";
import { IGNORE } from "./config.ts";

export const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

export async function markdownFiles(globs: string[]): Promise<string[]> {
  const ignore = IGNORE.map((p) => new Glob(p));
  const out = new Set<string>();
  for (const pattern of globs)
    for await (const file of new Glob(pattern).scan({ cwd: ROOT, onlyFiles: true })) if (!ignore.some((g) => g.match(file))) out.add(file);
  return [...out].sort();
}

export interface CodeBlock {
  file: string;
  /** 1-based line of the opening fence */
  line: number;
  lang: string;
  info: string;
  code: string;
  /** the `<!-- doctest: … -->` directive right before the fence, if any */
  directive?: string;
}

/** Fenced code blocks, with the directive comment on the last non-blank line before each. */
export function codeBlocks(file: string, text: string): CodeBlock[] {
  const lines = text.split("\n");
  const blocks: CodeBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const [, indent, fence, lang, info] = open;
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length && !lines[j]!.trimStart().startsWith(fence!)) body.push(lines[j++]!.slice(indent!.length));
    let k = i - 1;
    while (k >= 0 && !lines[k]!.trim()) k--;
    const d = k >= 0 ? /^\s*<!--\s*doctest:\s*(.*?)\s*-->\s*$/.exec(lines[k]!) : null;
    blocks.push({ file, line: i + 1, lang: lang!.toLowerCase(), info: info!.trim(), code: body.join("\n"), directive: d?.[1] });
    i = j;
  }
  return blocks;
}

/** The text outside fenced blocks and inline code (for link and heading scanning). */
export function proseLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let fence: string | undefined;
  text.split("\n").forEach((raw, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (m && raw.trimStart().startsWith(fence)) fence = undefined;
      return;
    }
    if (m) {
      fence = m[1];
      return;
    }
    out.push({ line: i + 1, text: raw.replace(/`[^`]*`/g, "``") });
  });
  return out;
}

/** GitHub's anchor for a heading text. */
export function slug(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** All anchors a file defines: headings (with GitHub's -1, -2 suffixes) and explicit `<a id>`/`name`. */
export function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence: string | undefined;
  for (const raw of text.split("\n")) {
    const m = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (m && raw.trimStart().startsWith(fence)) fence = undefined;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      const base = slug(h[1]!);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n ? `${base}-${n}` : base);
    }
    for (const a of raw.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(a[1]!);
  }
  return out;
}

export interface Link {
  line: number;
  url: string;
  image: boolean;
}

/** Inline links and images, reference definitions, and href/src in inline HTML. */
export function links(text: string): Link[] {
  const out: Link[] = [];
  for (const { line, text: t } of proseLines(text)) {
    for (const m of t.matchAll(/(!?)\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
      out.push({ line, url: m[2]!, image: m[1] === "!" });
    const def = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(t);
    if (def) out.push({ line, url: def[1]!, image: false });
    for (const m of t.matchAll(/<(a|img|source)\s[^>]*?(href|src|srcset)="([^"]+)"/g))
      out.push({ line, url: m[3]!.split(/\s/)[0]!, image: m[1] !== "a" });
  }
  return out;
}
