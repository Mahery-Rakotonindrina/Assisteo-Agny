import type { Analysis } from "@/lib/ai/schema";

/**
 * The text shared from a result: the summary, the facts, the suggestions and
 * the recipe. A prescription or a medicine box carries the medical warning
 * (`medicineDisclaimer`) right after the summary, so it never travels without it.
 */
export function analysisShareLines(analysis: Analysis, medicineDisclaimer: string): string[] {
  return [
    analysis.summary,
    ...(analysis.medicine ? ["", medicineDisclaimer] : []),
    "",
    ...analysis.facts.map((fact) => `• ${fact.label}: ${fact.value}`),
    "",
    ...analysis.suggestions.map((suggestion) => `→ ${suggestion.title}: ${suggestion.detail}`),
    ...(analysis.recipe
      ? [
          "",
          `🍳 ${analysis.recipe.name}`,
          ...analysis.recipe.ingredients.map((ingredient) => `- ${ingredient.quantity} ${ingredient.name}`),
          "",
          ...analysis.recipe.steps.map((step, index) => `${index + 1}. ${step}`),
        ]
      : []),
  ];
}
