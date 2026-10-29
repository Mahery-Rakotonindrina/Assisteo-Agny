import { formatAriary } from "@/lib/format";
import type { ExpenseSummary, ExpenseSummaryRequest } from "./schema";

// The demo review's extra findings (demo mode), from the optional totals:
// the money set aside, the pockets and the activity. Older apps don't send
// them: the review stays as it was.

const MAX_FINDINGS = 5;

export function withSavingsDemo(summary: ExpenseSummary, input: ExpenseSummaryRequest): ExpenseSummary {
  const fr = input.locale === "fr";
  const money = (value: number) => formatAriary(value, input.locale);
  const extra: string[] = [];
  const saved = input.savedThisMonth ?? 0;
  const tontine = input.tontinePaid ?? 0;
  if (saved > 0 && tontine > 0)
    extra.push(
      fr
        ? `Tu as mis ${money(saved)} de côté et versé ${money(tontine)} à ta tontine ce mois-ci, bravo.`
        : `You put ${money(saved)} aside and paid ${money(tontine)} into your tontine this month, well done.`,
    );
  else if (saved > 0) extra.push(fr ? `Tu as mis ${money(saved)} de côté ce mois-ci, bravo.` : `You put ${money(saved)} aside this month, well done.`);
  else if (tontine > 0) extra.push(fr ? `Tu as versé ${money(tontine)} à ta tontine ce mois-ci.` : `You paid ${money(tontine)} into your tontine this month.`);
  if (input.pocketsStart !== undefined && input.pocketsEnd !== undefined) {
    const going = input.dayOfMonth !== null;
    extra.push(
      fr
        ? `Dans tes poches : ${money(input.pocketsStart)} au début du mois, ${money(input.pocketsEnd)} ${going ? "aujourd'hui" : "à la fin"}.`
        : `In your pockets: ${money(input.pocketsStart)} at the start of the month, ${money(input.pocketsEnd)} ${going ? "today" : "at the end"}.`,
    );
  }
  const profit = input.activityProfit ?? 0;
  if (profit > 0) extra.push(fr ? `Ton activité de revente a rapporté ${money(profit)}.` : `Your reselling brought in ${money(profit)}.`);
  else if (profit < 0) extra.push(fr ? `Ton activité de revente est en perte de ${money(-profit)}.` : `Your reselling lost ${money(-profit)}.`);
  return { ...summary, findings: [...summary.findings, ...extra].slice(0, MAX_FINDINGS) };
}
