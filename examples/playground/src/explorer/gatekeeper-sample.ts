/** Sample: the GitHub issue gatekeeper, with a fake GitHub and a stream of new issues. */
import { FakeGitHub } from "../scxml/fake-github.ts";
import { GitHubIOProcessor, issuesWebhook } from "../scxml/github-ioprocessor.ts";
import { chartFile, type Sample } from "./sample.ts";

const REPO = "acme/widgets";
const AUTHORS = ["octocat", "mallory", "dhamidi", "eve", "trent", "peggy", "victor"];
const TITLES = ["Crash on startup", "Typo in README", "Feature: dark mode", "Build fails on ARM", "Please add Windows support"];

/** The GitHub processor of the current run, so drive() can feed it webhooks. */
const runs = new WeakMap<object, { gh: FakeGitHub; github: GitHubIOProcessor }>();

export const gatekeeperSample: Sample = {
  id: "gatekeeper",
  title: "GitHub issue gatekeeper",
  description: "One machine and one I/O processor: closes issues from people who aren't on the allowlist.",
  source: async () => chartFile("github-issues.scxml"),
  loader: chartFile,
  ioprocessors(clock) {
    const gh = new FakeGitHub(0);
    const github = new GitHubIOProcessor(gh);
    runs.set(clock, { gh, github });
    return [github];
  },
  data: { backoffMs: 1500 },
  drive(_session, clock) {
    const run = runs.get(clock);
    if (!run) return () => {};
    let n = 0;
    let timer: unknown;
    const next = () => {
      const author = AUTHORS[n % AUTHORS.length]!;
      const issue = run.gh.open(REPO, author, TITLES[n % TITLES.length]!);
      if (n % 5 === 3) run.gh.failNext("close");
      run.github.receiveWebhook("issues", issuesWebhook("opened", REPO, issue.number, author, issue.title));
      n++;
      timer = clock.setTimeout(next, 6000);
    };
    timer = clock.setTimeout(next, 1000);
    return () => clock.clearTimeout(timer);
  },
};
