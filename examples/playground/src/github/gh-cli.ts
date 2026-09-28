/**
 * GitHub backend that shells out to the `gh` CLI (Bun only).
 * With `dryRun` (the default) it prints the commands instead of running them.
 */
import { $ } from "bun";
import type { GitHubBackend } from "../scxml/github-ioprocessor.ts";

export class GhCliBackend implements GitHubBackend {
  constructor(private opts: { dryRun?: boolean; log?: (line: string) => void } = {}) {}

  comment(repo: string, number: number, body: string) {
    return this.gh(["issue", "comment", String(number), "--repo", repo, "--body", body]);
  }

  addLabels(repo: string, number: number, labels: string[]) {
    return this.gh(["issue", "edit", String(number), "--repo", repo, ...labels.flatMap((l) => ["--add-label", l])]);
  }

  close(repo: string, number: number, reason: "completed" | "not_planned") {
    const r = reason === "completed" ? "completed" : "not planned";
    return this.gh(["issue", "close", String(number), "--repo", repo, "--reason", r]);
  }

  reopen(repo: string, number: number) {
    return this.gh(["issue", "reopen", String(number), "--repo", repo]);
  }

  private async gh(args: string[]) {
    const log = this.opts.log ?? console.log;
    const line = ["gh", ...args.map((a) => (/[^\w./#:-]/.test(a) ? JSON.stringify(a) : a))].join(" ");
    if (this.opts.dryRun ?? true) {
      log(`[dry-run] ${line}`);
      return;
    }
    log(`$ ${line}`);
    await $`gh ${args}`.quiet();
  }
}
