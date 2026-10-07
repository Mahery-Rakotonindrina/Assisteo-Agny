import type { Locale } from "@/i18n.config";
import { mockAnalysis } from "@/lib/ai/mock";
import type { HistoryEntry } from "@/types/history";

// Example scans shown to new users: a real photo (public/examples, see
// scripts/generate-examples.mjs) with the matching demo analysis. They open
// as read-only results and are never stored in the history.

export const exampleIds = ["food", "document", "vehicle", "object"] as const;
export type ExampleId = (typeof exampleIds)[number];

export function isExampleId(value: unknown): value is ExampleId {
  return typeof value === "string" && (exampleIds as readonly string[]).includes(value);
}

export const exampleImage = (id: ExampleId) => `/examples/${id}.jpg`;

export function exampleEntry(id: ExampleId, locale: Locale): HistoryEntry {
  const image = exampleImage(id);
  return {
    id: `example-${id}`,
    createdAt: 0,
    mode: id,
    thumbnail: image,
    preview: image,
    analysis: mockAnalysis(id, locale),
    meta: { model: "example", demo: false, durationMs: 0 },
  };
}
