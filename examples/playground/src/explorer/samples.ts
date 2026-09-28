/** Registry of explorer samples. */
import { fulfillmentSample } from "./fulfillment-sample.ts";
import { gatekeeperSample } from "./gatekeeper-sample.ts";
import type { Sample } from "./sample.ts";
import { supportDeskSample } from "./support-desk-sample.ts";

export type { Sample } from "./sample.ts";

export const samples: Sample[] = [fulfillmentSample, supportDeskSample, gatekeeperSample];

export function sampleById(id: string): Sample | undefined {
  return samples.find((s) => s.id === id);
}
