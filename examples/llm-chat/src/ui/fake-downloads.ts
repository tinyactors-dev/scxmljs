/**
 * Fake downloads for the page's download UI, so every state can be seen and tested without the
 * network: `/demos/llm-chat/?fake-downloads` (the page imports this module only then).
 *
 * It is a PackageLoader, plugged in where the real one (tools/wasm.ts `loadPackage`) would be:
 * the package.scxml machines, the workspace, the client charts and the page all run as for real;
 * only the bytes are made up (sizes from tools/packages.ts), in real time. Once "installed", the
 * real tools are stood in for by the simulated ones (the page sets that up). Nothing is fetched.
 *
 * Variants (the parameter's value, comma separated):
 *   fast     10× faster (the site test uses it)
 *   cached   coreutils comes "from the browser's cache"
 *   fail     Python fails at 40% the first time ("network error (fake)"); trying again works
 */
import { PACKAGES, type PackageDownload, type PackageLoader, SDK } from "../tools/packages.ts";

export interface FakeOptions {
  fast: boolean;
  cached: boolean;
  fail: boolean;
}

export function fakeOptions(param: string): FakeOptions {
  const words = new Set(param.split(",").map((w) => w.trim()));
  return { fast: words.has("fast"), cached: words.has("cached"), fail: words.has("fail") };
}

export function fakeLoader(options: FakeOptions): PackageLoader {
  const installed = new Set<string>();
  let failedOnce = false;
  const tick = options.fast ? 20 : 100;
  const bytesPerTick = (options.fast ? 80 : 8) * 1024 * 1024 * (tick / 1000);

  return (key, { onProgress, signal }) =>
    new Promise<void>((resolve, reject) => {
      const info = key === "sdk" ? SDK : PACKAGES[key];
      if (!info) return reject(new Error(`no package ${key}`));
      const p: PackageDownload = {
        ...info,
        phase: "resolving",
        cached: false,
        shared: false,
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
      };
      const report = () => onProgress?.({ ...p });
      if (installed.has(key) || (options.cached && key === "coreutils")) {
        installed.add(key);
        Object.assign(p, { phase: "ready", cached: true, totalBytes: 0, percent: 100 });
        report();
        return resolve();
      }
      report();
      let step = 0;
      const timer = setInterval(() => {
        step++;
        if (p.phase === "resolving" && step >= 3) {
          Object.assign(p, { phase: "downloading", totalBytes: p.approxBytes, percent: 0 });
        } else if (p.phase === "downloading") {
          p.downloadedBytes = Math.min(p.approxBytes, p.downloadedBytes + bytesPerTick);
          p.percent = Math.round((p.downloadedBytes / p.approxBytes) * 100);
          if (options.fail && key === "python" && !failedOnce && p.percent >= 40) {
            failedOnce = true;
            clearInterval(timer);
            return reject(new Error("network error (fake)"));
          }
          if (p.downloadedBytes >= p.approxBytes) {
            p.phase = "loading";
            step = 0;
          }
        } else if (p.phase === "loading" && step >= 6) {
          clearInterval(timer);
          installed.add(key);
          p.phase = "ready";
          report();
          return resolve();
        }
        report();
      }, tick);
      signal?.addEventListener("abort", () => {
        clearInterval(timer);
        reject(new Error("cancelled"));
      });
    });
}
