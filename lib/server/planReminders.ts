import { activePlan, soldPlans, type CustomPlan, type PlanName, type SoldPlanId, type Subscription } from "@/lib/plans";
import type { PushLocale } from "./reminderPush";

// Reminds subscribers that their plan ends (pure: the cron route does the
// I/O). Three moments per period: three days before, the last day, and
// just after it ended. A renewal without a gap moves the end, so no reminder.

const DAY_MS = 24 * 3600 * 1000;

export type PlanNoticeStage = "soon" | "last" | "ended";
/** `name`: a plan created from the Admin, by its own name (its `plan` is then the built-in one just below). */
export type PlanNotice = { email: string; plan: SoldPlanId; name?: PlanName; endsAt: number; stage: PlanNoticeStage };

const isSold = (plan: string): plan is SoldPlanId => (soldPlans as readonly string[]).includes(plan);

/** The reminders due now, one per e-mail at most (`created`: the plans created from the Admin). */
export function dueNotices(rows: Subscription[], now: number, created: readonly CustomPlan[] = []): PlanNotice[] {
  const named = (plan: string) => {
    const found = created.find((entry) => entry.id === plan);
    return found ? { plan: found.after, name: found.name } : isSold(plan) ? { plan } : null;
  };
  const byEmail = new Map<string, Subscription[]>();
  for (const row of rows) byEmail.set(row.email, [...(byEmail.get(row.email) ?? []), row]);

  const notices: PlanNotice[] = [];
  for (const [email, list] of byEmail) {
    const current = activePlan(list, now, created);
    if (isSold(current.plan) && current.endsAt !== null) {
      const left = current.endsAt - now;
      const plan = named(current.custom ?? current.plan) ?? { plan: current.plan };
      if (left <= DAY_MS) notices.push({ email, ...plan, endsAt: current.endsAt, stage: "last" });
      else if (left <= 3 * DAY_MS) notices.push({ email, ...plan, endsAt: current.endsAt, stage: "soon" });
      continue;
    }
    if (current.plan !== "free") continue;
    // Ended within the last day: the latest paid period that just stopped.
    const ended = list
      .flatMap((row) => {
        const plan = row.endsAt === null ? null : named(row.plan);
        return plan ? [{ ...plan, end: Date.parse(row.endsAt!) }] : [];
      })
      .filter(({ end }) => end <= now && end > now - DAY_MS)
      .sort((a, b) => b.end - a.end)[0];
    if (ended) {
      const { end, ...plan } = ended;
      notices.push({ email, ...plan, endsAt: end, stage: "ended" });
    }
  }
  return notices;
}

/** Marks a reminder as sent, so each moment is sent once: "plan:reminded:…". */
export const noticeKey = (notice: PlanNotice) => `plan:reminded:${notice.email}:${notice.endsAt}:${notice.stage}`;

const names: Record<SoldPlanId, string> = { lite: "Lite", premium: "Premium", pro: "Pro" };

/** The push's words, with the last day included (Madagascar time). */
export function noticeMessage(notice: PlanNotice, locale: PushLocale) {
  const lastDay = new Date(notice.endsAt - 1).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Indian/Antananarivo",
  });
  const plan = notice.name ? (notice.name[locale] || notice.name.fr) : names[notice.plan];
  if (locale === "en") {
    if (notice.stage === "soon") return { title: `Your ${plan} plan ends soon`, body: `It stops after ${lastDay}. Renew it to keep your perks.` };
    if (notice.stage === "last") return { title: `Last day of your ${plan} plan`, body: `It stops after ${lastDay}. Renew it now to keep your perks.` };
    return { title: `Your ${plan} plan has ended`, body: "Renew it to get your perks back." };
  }
  if (notice.stage === "soon") return { title: `Ton offre ${plan} se termine bientôt`, body: `Elle s’arrête après le ${lastDay}. Renouvelle-la pour garder tes avantages.` };
  if (notice.stage === "last") return { title: `Dernier jour de ton offre ${plan}`, body: `Elle s’arrête après le ${lastDay}. Renouvelle-la dès maintenant pour garder tes avantages.` };
  return { title: `Ton offre ${plan} est terminée`, body: "Renouvelle-la pour retrouver tes avantages." };
}
