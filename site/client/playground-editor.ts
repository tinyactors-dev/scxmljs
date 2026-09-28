/**
 * The playground's code editor: CodeMirror 6 with XML highlighting, line numbers, auto-indent,
 * tag matching and closing, search, and lint markers. Loaded lazily by playground.ts; colours
 * come from CSS custom properties (site.css), so it follows the site's light/dark theme.
 */
import { indentWithTab } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import type { PlaygroundDiagnostic } from "./diagnostics.ts";

export interface PlaygroundEditor {
  getText(): string;
  /** Replace the whole text (a normal change: it fires onChange). */
  setText(text: string): void;
  setDiagnostics(list: PlaygroundDiagnostic[]): void;
  /** Move the cursor to an offset, scroll it into view and focus the editor. */
  goTo(offset: number): void;
  focus(): void;
}

const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: "var(--pg-hl-tag)" },
  { tag: tags.attributeName, color: "var(--pg-hl-attr)" },
  { tag: tags.attributeValue, color: "var(--pg-hl-string)" },
  { tag: tags.comment, color: "var(--pg-hl-comment)", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.documentMeta], color: "var(--pg-hl-comment)" },
  { tag: tags.character, color: "var(--pg-hl-attr)" },
  { tag: tags.invalid, color: "var(--pg-error)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--pg-editor-bg)", color: "var(--pg-fg)" },
  ".cm-scroller": { fontFamily: "var(--pg-font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--pg-fg)" },
  ".cm-cursor": { borderLeftColor: "var(--pg-fg)" },
  ".cm-gutters": { backgroundColor: "var(--pg-editor-gutter)", color: "var(--pg-fg-subtle)", borderRight: "1px solid var(--pg-border)" },
  ".cm-activeLine": { backgroundColor: "var(--pg-editor-active)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--pg-editor-active)", color: "var(--pg-fg)" },
  "&.cm-focused": { outline: "2px solid var(--pg-accent)", outlineOffset: "-2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--pg-editor-selection) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "var(--pg-editor-match)", outline: "1px solid var(--pg-border-strong)" },
  ".cm-tooltip": { backgroundColor: "var(--pg-surface)", color: "var(--pg-fg)", border: "1px solid var(--pg-border-strong)" },
  ".cm-panels": { backgroundColor: "var(--pg-surface-2)", color: "var(--pg-fg)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--pg-error)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--pg-warning)" },
});

export function createEditor(parent: HTMLElement, text: string, onChange: (text: string) => void): PlaygroundEditor {
  const view = new EditorView({
    doc: text,
    parent,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      xml(),
      syntaxHighlighting(highlight),
      lintGutter(),
      theme,
      EditorView.lineWrapping,
      // tabindex: axe (scrollable-region-focusable) doesn't count a contenteditable as focusable; it already is
      EditorView.contentAttributes.of({ "aria-label": "SCXML source (Escape, then Tab, leaves the editor)", tabindex: "0" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
  return {
    getText: () => view.state.doc.toString(),
    setText(t) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
    },
    setDiagnostics(list) {
      const len = view.state.doc.length;
      const diagnostics: Diagnostic[] = list.map((d) => {
        const from = Math.min(Math.max(0, d.from), len);
        return { from, to: Math.min(Math.max(from, d.to), len), severity: d.severity, message: d.message, source: d.code };
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    goTo(offset) {
      const at = Math.min(Math.max(0, offset), view.state.doc.length);
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
      view.focus();
    },
    focus: () => view.focus(),
  };
}
