import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, ChevronDown, Copy, Mail, Pencil, Plus, RefreshCw, Save, Search, Square, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge, PlanIcon } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate, toDateInput } from "@/lib/format";
import { easeOut, rise, spring } from "@/lib/motion";
import { activePlan, durations, paidPlans, periodEnd, type ActivePlan, type Duration, type PaidPlanId, type Subscription } from "@/lib/plans";
import type { AdminSubscriptionsResponse } from "@/pages/api/admin/subscriptions";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import { AdminCharts } from "./AdminCharts";
import styles from "./AdminSubscriptions.module.scss";

const timestamp = () => Date.now();
const DAY_MS = 24 * 3600 * 1000;
const SOON_MS = 7 * DAY_MS;
export const paymentMethods = ["mvola", "orange", "airtel", "cash", "bank", "other"] as const;

type Status = "soon" | "active" | "offered" | "upcoming" | "ended";
const statusOrder: Status[] = ["soon", "active", "offered", "upcoming", "ended"];

type Person = {
  email: string;
  current: ActivePlan;
  status: Status;
  rows: Subscription[];
  nextStart: number | null;
  /** The plan shown: the running one, else the latest recorded. */
  shown: PaidPlanId;
};

/** The list filters: everyone, one plan running, or no plan running (ended or not started). */
type Filter = "all" | PaidPlanId | "inactive";

function people(rows: Subscription[], now: number): Person[] {
  const byEmail = new Map<string, Subscription[]>();
  for (const row of rows) byEmail.set(row.email, [...(byEmail.get(row.email) ?? []), row]);
  return [...byEmail.entries()]
    .map(([email, list]) => {
      const current = activePlan(list, now);
      const starts = list.map((row) => Date.parse(row.startsAt)).filter((start) => start > now);
      const nextStart = starts.length ? Math.min(...starts) : null;
      const status: Status =
        current.plan === "free" ? (nextStart ? "upcoming" : "ended") : current.endsAt === null ? "offered" : current.endsAt - now < SOON_MS ? "soon" : "active";
      const sorted = [...list].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
      return { email, current, status, rows: sorted, nextStart, shown: current.plan === "free" ? sorted[0].plan : current.plan };
    })
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.email.localeCompare(b.email));
}

/** The last day included of an exclusive end. */
const lastDay = (end: number) => end - 1;

// ---- Form -------------------------------------------------------------------

type Draft = {
  /** Editing an existing record. */
  id?: string;
  /** Several e-mails when adding (one payment for a family), one when editing. */
  emails: string;
  plan: PaidPlanId;
  start: string;
  /** Exact start kept while its day is unchanged (renewals, edits). */
  startAt?: string;
  duration: Duration | "custom";
  /** Last day included, for a custom period. */
  end: string;
  endAt?: string | null;
  amount: string;
  method: string;
  ref: string;
  note: string;
};

const midnight = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const splitEmails = (value: string) => [...new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];

function newDraft(now: number, patch: Partial<Draft> = {}): Draft {
  return { emails: "", plan: "lite", start: toDateInput(now), duration: "month", end: "", amount: "", method: "mvola", ref: "", note: "", ...patch };
}

function draftFor(row: Subscription): Draft {
  const end = row.endsAt === null ? null : Date.parse(row.endsAt);
  return {
    id: row.id,
    emails: row.email,
    plan: row.plan,
    start: toDateInput(Date.parse(row.startsAt)),
    startAt: row.startsAt,
    duration: end === null ? "none" : "custom",
    end: end === null ? "" : toDateInput(lastDay(end)),
    endAt: row.endsAt,
    amount: row.amountMga === null ? "" : String(row.amountMga),
    method: row.paymentMethod ?? "",
    ref: row.paymentRef ?? "",
    note: row.note ?? "",
  };
}

/** The period of a draft as ISO dates, or null when the end comes first. */
function period(draft: Draft, now: number): { startsAt: string; endsAt: string | null } | null {
  const start =
    draft.startAt && toDateInput(Date.parse(draft.startAt)) === draft.start
      ? new Date(draft.startAt)
      : draft.start === toDateInput(now)
        ? new Date(now)
        : midnight(draft.start);
  let end: Date | null;
  if (draft.duration !== "custom") end = periodEnd(start, draft.duration);
  else if (draft.endAt && toDateInput(lastDay(Date.parse(draft.endAt))) === draft.end) end = new Date(draft.endAt);
  else if (draft.end) end = new Date(midnight(draft.end).getTime() + DAY_MS);
  else return null;
  if (end && end <= start) return null;
  return { startsAt: start.toISOString(), endsAt: end?.toISOString() ?? null };
}

// ---- Card -------------------------------------------------------------------

/** Who pays for what: subscriptions recorded by hand, the payment being made outside the app. */
export function AdminSubscriptions({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [failure, setFailure] = useState<"error" | "disabled" | null>(null);
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [now, setNow] = useState(timestamp);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminSubscriptionsResponse>("/api/admin/subscriptions", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (cancelled) return;
        setRows(result.subscriptions);
        setFailure(null);
        setNow(timestamp());
      })
      .catch((error) => {
        if (!cancelled) setFailure(error instanceof ApiError && error.status === 503 ? "disabled" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, version]);

  const reload = () => setVersion((value) => value + 1);

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast(done);
      reload();
      return true;
    } catch {
      toast(t("admin.error"), "error");
      return false;
    }
  };

  if (failure) {
    return (
      <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
        <Header />
        <p className={styles.error}>{failure === "disabled" ? t("admin.subs.disabled") : t("admin.error")}</p>
      </motion.section>
    );
  }
  if (!rows) return <div className={styles.card} aria-busy />;

  const list = people(rows, now);
  const needle = query.trim().toLowerCase();
  const running = list.filter((person) => person.current.plan !== "free");
  const matchesFilter = (person: Person) =>
    filter === "all" ? true : filter === "inactive" ? person.current.plan === "free" : person.current.plan === filter;
  const visible = list.filter((person) => matchesFilter(person) && (!needle || person.email.includes(needle)));
  const soon = list.filter((person) => person.status === "soon").length;
  const thisMonth = toDateInput(now).slice(0, 7);
  const cashedThisMonth = rows.filter((row) => toDateInput(Date.parse(row.createdAt)).slice(0, 7) === thisMonth).reduce((total, row) => total + (row.amountMga ?? 0), 0);
  // Per plan: who has it now, and what came in for it this month.
  const perPlan = paidPlans.map((plan) => ({
    plan,
    count: running.filter((person) => person.current.plan === plan).length,
    cashed: rows
      .filter((row) => row.plan === plan && toDateInput(Date.parse(row.createdAt)).slice(0, 7) === thisMonth)
      .reduce((total, row) => total + (row.amountMga ?? 0), 0),
  }));
  const inactive = list.length - running.length;

  const describe = (person: Person) => {
    const { current } = person;
    if (person.status === "upcoming" && person.nextStart) return t("admin.subs.startsOn", { date: formatDate(person.nextStart, locale) });
    if (person.status === "ended") {
      const ends = person.rows.map((row) => (row.endsAt ? Date.parse(row.endsAt) : 0));
      return t("admin.subs.endedOn", { date: formatDate(lastDay(Math.max(...ends)), locale) });
    }
    if (current.endsAt === null) return t("admin.subs.noEnd");
    const days = Math.ceil((current.endsAt - now) / DAY_MS);
    return person.status === "soon"
      ? t("admin.subs.endsIn", { days, date: formatDate(lastDay(current.endsAt), locale) })
      : t("admin.subs.until", { date: formatDate(lastDay(current.endsAt), locale) });
  };

  // A reminder to renew, written for the subscriber: by e-mail, or copied for WhatsApp / SMS.
  const reminder = (person: Person) => {
    const plan = t(`plans.names.${person.shown}`);
    const ended = person.current.plan === "free";
    const end = person.current.endsAt ?? Math.max(...person.rows.map((row) => (row.endsAt ? Date.parse(row.endsAt) : 0)));
    const values = { plan, date: formatDate(lastDay(end), locale), link: `${typeof window === "undefined" ? "" : window.location.origin}/plans` };
    return {
      subject: t(ended ? "admin.subs.remind.subjectEnded" : "admin.subs.remind.subject", values),
      body: t(ended ? "admin.subs.remind.bodyEnded" : "admin.subs.remind.body", values),
    };
  };
  const copyReminder = async (person: Person) => {
    try {
      await navigator.clipboard.writeText(reminder(person).body);
      toast(t("admin.subs.remind.copied"));
    } catch {
      toast(t("admin.error"), "error");
    }
  };

  const renew = (person: Person) => {
    const last = person.rows[0];
    const coveredUntil = person.current.endsAt;
    const startAt = coveredUntil && coveredUntil > now ? new Date(coveredUntil).toISOString() : undefined;
    setDraft(
      newDraft(now, {
        emails: person.email,
        plan: person.current.plan === "free" ? last.plan : person.current.plan,
        start: startAt ? toDateInput(coveredUntil!) : toDateInput(now),
        startAt,
        amount: last.amountMga === null ? "" : String(last.amountMga),
        method: last.paymentMethod ?? "mvola",
      }),
    );
  };

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
      <Header />

      <div className={styles.summary}>
        <div>
          <strong>{running.length}</strong>
          <span>{t("admin.subs.active")}</span>
        </div>
        <div data-tone={soon ? "warn" : undefined}>
          <strong>{soon}</strong>
          <span>{t("admin.subs.soon")}</span>
        </div>
        <div>
          <strong>{formatAriary(cashedThisMonth, locale)}</strong>
          <span>{t("admin.subs.cashedThisMonth")}</span>
        </div>
      </div>
      <div className={styles.plans}>
        {perPlan.map(({ plan, count, cashed }) => (
          <button
            key={plan}
            type="button"
            className={styles.planTile}
            data-plan={plan}
            aria-pressed={filter === plan}
            onClick={() => setFilter(filter === plan ? "all" : plan)}
          >
            <span className={styles.planTileHead}>
              <PlanIcon plan={plan} size={15} /> {t(`plans.names.${plan}`)}
            </span>
            <strong>{count}</strong>
            <small>{plan === "unlimited" ? t("admin.subs.adminRole") : t("admin.subs.cashed", { amount: formatAriary(cashed, locale) })}</small>
          </button>
        ))}
      </div>

      <AdminCharts rows={rows} counts={perPlan} now={now} />

      <Button icon={<Plus />} block onClick={() => setDraft(newDraft(now))}>
        {t("admin.subs.add")}
      </Button>

      {list.length > 0 && (
        <label className={styles.search}>
          <Search size={16} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("admin.subs.search")} aria-label={t("admin.subs.search")} />
        </label>
      )}

      {list.length > 0 && (
        <div className={styles.filters} role="group" aria-label={t("admin.subs.filter")}>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("admin.subs.filters.all")} <span>{list.length}</span>
          </button>
          {perPlan
            .filter(({ count }) => count > 0)
            .map(({ plan, count }) => (
              <button key={plan} type="button" data-plan={plan} aria-pressed={filter === plan} onClick={() => setFilter(plan)}>
                <PlanIcon plan={plan} size={13} /> {t(`plans.names.${plan}`)} <span>{count}</span>
              </button>
            ))}
          {inactive > 0 && (
            <button type="button" aria-pressed={filter === "inactive"} onClick={() => setFilter("inactive")}>
              {t("admin.subs.filters.inactive")} <span>{inactive}</span>
            </button>
          )}
        </div>
      )}

      {list.length === 0 && <p className={styles.empty}>{t("admin.subs.empty")}</p>}
      {list.length > 0 && visible.length === 0 && <p className={styles.empty}>{t("admin.subs.noMatch")}</p>}

      <ul className={styles.people}>
        {visible.map((person) => {
          const open = openEmail === person.email;
          return (
            <li key={person.email} className={styles.person} data-status={person.status} data-plan={person.shown}>
              <button type="button" className={styles.personSummary} onClick={() => setOpenEmail(open ? null : person.email)} aria-expanded={open}>
                <span className={styles.personText}>
                  <strong>{person.email}</strong>
                  <small>{describe(person)}</small>
                </span>
                <PlanBadge plan={person.shown} />
                <ChevronDown size={16} className={open ? styles.chevronOpen : styles.chevron} />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    className={styles.more}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: easeOut }}
                  >
                    <div className={styles.moreInner}>
                      <div className={styles.personActions}>
                        <Button size="md" variant="secondary" icon={<RefreshCw />} onClick={() => renew(person)}>
                          {t("admin.subs.renew")}
                        </Button>
                        {person.status !== "offered" && person.shown !== "unlimited" && (
                          <>
                            <a
                              className={styles.remind}
                              href={`mailto:${person.email}?subject=${encodeURIComponent(reminder(person).subject)}&body=${encodeURIComponent(reminder(person).body)}`}
                            >
                              <Mail size={15} /> {t("admin.subs.remind.email")}
                            </a>
                            <button type="button" className={styles.remind} onClick={() => void copyReminder(person)}>
                              <Copy size={15} /> {t("admin.subs.remind.copy")}
                            </button>
                          </>
                        )}
                        {person.current.plan !== "free" && (
                          <ConfirmButton
                            icon={<Square />}
                            label={t("admin.subs.stop")}
                            confirm={t("admin.subs.stopConfirm")}
                            onConfirm={() =>
                              void run(
                                () => httpClient.patch("/api/admin/subscriptions", { action: "stop", email: person.email }, { headers }),
                                t("admin.subs.stopped"),
                              )
                            }
                          />
                        )}
                      </div>
                      <ol className={styles.history}>
                        {person.rows.map((row) => (
                          <li key={row.id} data-plan={row.plan}>
                            <div>
                              <PlanBadge plan={row.plan} />
                              <strong>
                                {formatDate(Date.parse(row.startsAt), locale)} →{" "}
                                {row.endsAt ? formatDate(lastDay(Date.parse(row.endsAt)), locale) : t("admin.subs.noEndShort")}
                              </strong>
                              <small>
                                {[
                                  row.amountMga !== null ? formatAriary(row.amountMga, locale) : t("admin.subs.free"),
                                  row.paymentMethod && t(`admin.subs.methods.${row.paymentMethod}`),
                                  row.paymentRef,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                              {row.note && <small className={styles.note}>{row.note}</small>}
                            </div>
                            <span className={styles.rowActions}>
                              <button type="button" onClick={() => setDraft(draftFor(row))} aria-label={t("admin.subs.edit")}>
                                <Pencil size={15} />
                              </button>
                              <ConfirmIcon
                                label={t("admin.subs.delete")}
                                onConfirm={() =>
                                  void run(() => httpClient.delete(`/api/admin/subscriptions?id=${encodeURIComponent(row.id)}`, { headers }), t("admin.subs.deleted"))
                                }
                              />
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      <SubscriptionSheet
        draft={draft}
        now={now}
        onClose={() => setDraft(null)}
        onSave={async (body, editing) => {
          const ok = await run(
            () =>
              editing
                ? httpClient.put("/api/admin/subscriptions", body, { headers })
                : httpClient.post("/api/admin/subscriptions", body, { headers }),
            editing ? t("admin.saved") : t("admin.subs.added"),
          );
          if (ok) setDraft(null);
        }}
      />
    </motion.section>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className={styles.title}>
        <Users size={18} /> {t("admin.subs.title")}
      </h2>
      <p className={styles.subtitle}>{t("admin.subs.subtitle")}</p>
      <p className={styles.subtitle}>{t("admin.subs.remind.auto")}</p>
    </div>
  );
}

function ConfirmButton({ icon, label, confirm, onConfirm }: { icon: ReactNode; label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button size="md" variant={armed ? "danger" : "ghost"} icon={icon} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirm : label}
    </Button>
  );
}

function ConfirmIcon({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={armed ? styles.armed : undefined} onClick={() => (armed ? onConfirm() : setArmed(true))} aria-label={label} title={label}>
      <Trash2 size={15} />
    </button>
  );
}

// ---- Sheet ------------------------------------------------------------------

type SaveBody = Record<string, unknown>;

const noSubscribe = () => () => {};

function SubscriptionSheet({
  draft,
  now,
  onClose,
  onSave,
}: {
  draft: Draft | null;
  now: number;
  onClose: () => void;
  onSave: (body: SaveBody, editing: boolean) => Promise<void>;
}) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{draft && <SheetForm key={draft.id ?? "new"} initial={draft} now={now} onClose={onClose} onSave={onSave} />}</AnimatePresence>,
    document.body,
  );
}

function SheetForm({ initial, now, onClose, onSave }: { initial: Draft; now: number; onClose: () => void; onSave: (body: SaveBody, editing: boolean) => Promise<void> }) {
  const { t, locale } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const editing = Boolean(draft.id);
  const emails = splitEmails(draft.emails);
  const badEmail = emails.find((email) => !EMAIL.test(email));
  const range = period(draft, now);
  const valid = emails.length > 0 && (!editing || emails.length === 1) && !badEmail && range !== null;
  const amount = draft.amount.replace(/\D/g, "");

  const save = async () => {
    if (!valid || !range) return;
    setSaving(true);
    const fields = {
      plan: draft.plan,
      ...range,
      amountMga: amount ? Number(amount) : null,
      paymentMethod: draft.method || null,
      paymentRef: draft.ref || null,
      note: draft.note || null,
    };
    await onSave(editing ? { ...fields, id: draft.id, email: emails[0] } : { ...fields, emails }, editing);
    setSaving(false);
  };

  return (
    <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form
        className={styles.sheet}
        data-plan={draft.plan}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={styles.top}>
          <h2 id="subscription-title">{editing ? t("admin.subs.editTitle") : t("admin.subs.addTitle")}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("common.cancel")}>
            <X size={18} />
          </button>
        </div>

        <Field label={editing ? t("admin.subs.email") : t("admin.subs.emails")} hint={editing ? undefined : t("admin.subs.emailsHint")}>
          <input
            type={editing ? "email" : "text"}
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            value={draft.emails}
            onChange={(event) => set("emails", event.target.value)}
            placeholder="rado@example.com"
          />
        </Field>
        {badEmail && <p className={styles.error}>{t("admin.subs.badEmail", { email: badEmail })}</p>}

        <ChoiceGroup label={t("admin.subs.plan")}>
          <div className={styles.chips}>
            {paidPlans.map((plan) => (
              <button key={plan} type="button" data-plan={plan} aria-pressed={draft.plan === plan} onClick={() => set("plan", plan)}>
                <PlanIcon plan={plan} size={14} /> {t(`plans.names.${plan}`)}
              </button>
            ))}
          </div>
        </ChoiceGroup>
        {draft.plan === "unlimited" && (
          <p className={styles.adminWarning} data-plan="unlimited">
            {t("admin.subs.adminHint")}
          </p>
        )}

        <div className={styles.grid}>
          <Field label={t("admin.subs.start")}>
            <input type="date" value={draft.start} onChange={(event) => event.target.value && set("start", event.target.value)} />
          </Field>
          {draft.duration === "custom" && (
            <Field label={t("admin.subs.end")}>
              <input type="date" value={draft.end} min={draft.start} onChange={(event) => set("end", event.target.value)} />
            </Field>
          )}
        </div>
        <ChoiceGroup label={t("admin.subs.duration")}>
          <div className={styles.chips}>
            {[...durations, "custom" as const].map((duration) => (
              <button key={duration} type="button" aria-pressed={draft.duration === duration} onClick={() => set("duration", duration)}>
                {t(`admin.subs.durations.${duration}`)}
              </button>
            ))}
          </div>
        </ChoiceGroup>
        {range ? (
          <p className={styles.period}>
            <CalendarClock size={15} />{" "}
            {range.endsAt
              ? t("admin.subs.periodUntil", { date: formatDate(lastDay(Date.parse(range.endsAt)), locale) })
              : t("admin.subs.noEnd")}
          </p>
        ) : (
          <p className={styles.error}>{t("admin.subs.badPeriod")}</p>
        )}

        <h3 className={styles.group}>{t("admin.subs.payment")}</h3>
        <div className={styles.grid}>
          <Field label={t("admin.subs.amount")}>
            <input inputMode="numeric" value={amount} onChange={(event) => set("amount", event.target.value)} placeholder="5000" />
          </Field>
          <Field label={t("admin.subs.method")}>
            <select value={draft.method} onChange={(event) => set("method", event.target.value)}>
              <option value="">—</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {t(`admin.subs.methods.${method}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("admin.subs.ref")} hint={t("admin.subs.refHint")}>
          <input value={draft.ref} onChange={(event) => set("ref", event.target.value.slice(0, 120))} />
        </Field>
        <Field label={t("admin.subs.note")}>
          <input value={draft.note} onChange={(event) => set("note", event.target.value.slice(0, 500))} placeholder={t("admin.subs.notePlaceholder")} />
        </Field>

        <div className={styles.actions}>
          <Button type="submit" block icon={<Save />} disabled={!valid || saving}>
            {emails.length > 1 && !editing ? t("admin.subs.saveMany", { count: emails.length }) : t("admin.save")}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}

/** Like Field, for a row of buttons: a label element would press the first one. */
function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
