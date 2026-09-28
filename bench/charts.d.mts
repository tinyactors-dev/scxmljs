/** Deterministic chart generators for the benchmarks (see charts.mjs). */
export function generatedChart(n: number, fanout?: number): string;
export function hotLoopChart(): string;
export function eventlessLoopChart(limit: number): string;
