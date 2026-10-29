import { activePlan, activeSubscription, type ActivePlan, type FeatureDiff, type PaidPlanId, type QuotaOverrides, type Subscription } from "@/lib/plans";
import { isSchemaMissing, knownMissing, MigrationNeededError, noteFound, noteMissing } from "./schemaMissing";
import { accountsEnabled, supabaseAdmin } from "./supabaseAdmin";

// Subscriptions recorded by the owner in /admin (supabase/migrations/0005).
// Only the server reads them, with the service role.

type Row = {
  id: string;
  email: string;
  plan: PaidPlanId;
  starts_at: string;
  ends_at: string | null;
  amount_mga: number | null;
  payment_method: string | null;
  payment_ref: string | null;
  note: string | null;
  created_at: string;
  // Migration 0011; absent before it.
  features?: FeatureDiff | null;
  quotas?: QuotaOverrides | null;
};

export type SubscriptionInput = Omit<Subscription, "id" | "createdAt">;

const table = () => supabaseAdmin().from("subscriptions");

const fromRow = (row: Row): Subscription => ({
  id: row.id,
  email: row.email,
  plan: row.plan,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  amountMga: row.amount_mga,
  paymentMethod: row.payment_method,
  paymentRef: row.payment_ref,
  note: row.note,
  createdAt: row.created_at,
  features: row.features ?? null,
  quotas: row.quotas ?? null,
});

const toRow = (input: SubscriptionInput) => ({
  email: input.email.trim().toLowerCase(),
  plan: input.plan,
  starts_at: input.startsAt,
  ends_at: input.endsAt,
  amount_mga: input.amountMga,
  payment_method: input.paymentMethod,
  payment_ref: input.paymentRef,
  note: input.note,
  // Sent only when given: a save without them works before migration 0011.
  ...(input.features !== undefined && { features: input.features }),
  ...(input.quotas !== undefined && { quotas: input.quotas }),
});

function check<T>({ data, error }: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (error) throw Object.assign(new Error(`subscriptions: ${error.message}`), { code: error.code });
  return data as T;
}

/** The columns of migration 0011 (a subscription's own features and limits). */
const OWN = "columns";

/**
 * A write with a subscription's own settings. Before migration 0011, it goes
 * through without them when none is set, and is refused otherwise (rather
 * than saved without what the admin set).
 */
async function writeOwn<T>(inputs: SubscriptionInput[], write: (rows: ReturnType<typeof toRow>[]) => PromiseLike<T>): Promise<T> {
  try {
    return await write(inputs.map(toRow));
  } catch (error) {
    if (!isSchemaMissing(error)) throw error;
    await noteMissing(OWN, error);
    if (inputs.some((input) => input.features || input.quotas)) throw new MigrationNeededError("0011_subscription_features");
    return write(inputs.map((input) => toRow({ ...input, features: undefined, quotas: undefined })));
  }
}

/** Every recorded subscription, newest first. */
export async function listSubscriptions() {
  return check<Row[]>(await table().select("*").order("created_at", { ascending: false }).limit(5000)).map(fromRow);
}

/** Every row of one e-mail (empty without accounts). */
export async function subscriptionsForEmail(email: string) {
  if (!accountsEnabled) return [];
  return check<Row[]>(await table().select("*").eq("email", email.toLowerCase())).map(fromRow);
}

export async function getSubscription(id: string) {
  const row = check<Row | null>(await table().select("*").eq("id", id).maybeSingle());
  return row ? fromRow(row) : null;
}

export async function addSubscriptions(inputs: SubscriptionInput[]) {
  return writeOwn(inputs, async (rows) => check<Row[]>(await table().insert(rows).select("*")).map(fromRow));
}

export async function updateSubscription(id: string, input: SubscriptionInput) {
  return writeOwn([input], async ([row]) => fromRow(check<Row>(await table().update(row).eq("id", id).select("*").single())));
}

/** Whether a subscription can hold its own features and limits (migration 0011 applied). */
export async function ownSettingsReady() {
  if (!accountsEnabled) return false;
  try {
    check(await table().select("features, quotas").limit(1));
    noteFound(OWN);
    return true;
  } catch (error) {
    if (!isSchemaMissing(error)) throw error;
    await noteMissing(OWN, error);
    return false;
  }
}

/** Sets the own features of several subscriptions ("only new subscriptions": those running keep what they have). */
export async function setSubscriptionFeatures(updates: Array<{ id: string; features: FeatureDiff | null }>) {
  for (const { id, features } of updates) check(await table().update({ features }).eq("id", id));
}

export async function deleteSubscription(id: string) {
  check(await table().delete().eq("id", id));
}

/**
 * Stops an email's access now: what runs ends now, what was planned later
 * is cut to nothing. The rows stay, as the record of what was paid.
 */
export async function stopSubscriptions(email: string, now = new Date()) {
  const at = now.getTime();
  const rows = check<Row[]>(await table().select("*").eq("email", email.toLowerCase()));
  await Promise.all(
    rows
      .filter((row) => row.ends_at === null || Date.parse(row.ends_at) > at)
      .map(async (row) =>
        check(await table().update({ ends_at: Date.parse(row.starts_at) > at ? row.starts_at : now.toISOString() }).eq("id", row.id)),
      ),
  );
}

/**
 * Reads with the columns of migration 0011 when they exist, else without
 * them (noted once, then skipped for a while): the plan alone, as before.
 */
type Read = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
async function selectOwn<T>(columns: string, read: (columns: string) => Read): Promise<T> {
  if (!knownMissing(OWN)) {
    const result = (await read(`${columns}, features, quotas`)) as { data: T | null; error: { message: string; code?: string } | null };
    if (!result.error) return result.data as T;
    if (!isSchemaMissing(result.error)) return check(result);
    await noteMissing(OWN, result.error);
  }
  return check((await read(columns)) as { data: T | null; error: { message: string; code?: string } | null });
}

/** The subscriptions of these e-mails, in one read (the reminder cron). */
export async function subscriptionRowsForEmails(emails: string[]) {
  if (emails.length === 0 || !accountsEnabled) return [];
  const lower = emails.map((email) => email.toLowerCase());
  return selectOwn<Array<Pick<Row, "email" | "plan" | "starts_at" | "ends_at" | "features">>>("email, plan, starts_at, ends_at", (columns) =>
    table().select(columns).in("email", lower),
  );
}

export type Access = {
  current: ActivePlan;
  /** The subscription whose own settings apply now; null on free. */
  subscription: Pick<Subscription, "id" | "features" | "quotas"> | null;
};

/** The plan an e-mail has right now and its running subscription's own settings, in one read. */
export async function accessForEmail(email: string | null | undefined, now = Date.now()): Promise<Access> {
  if (!email || !accountsEnabled) return { current: { plan: "free", endsAt: null }, subscription: null };
  const rows = (
    await selectOwn<Array<Pick<Row, "id" | "plan" | "starts_at" | "ends_at" | "features" | "quotas">>>("id, plan, starts_at, ends_at", (columns) =>
      table().select(columns).eq("email", email.toLowerCase()),
    )
  ).map((row) => ({ id: row.id, plan: row.plan, startsAt: row.starts_at, endsAt: row.ends_at, features: row.features ?? null, quotas: row.quotas ?? null }));
  const running = activeSubscription(rows, now);
  return { current: activePlan(rows, now), subscription: running && { id: running.id, features: running.features, quotas: running.quotas } };
}

/** The plan an e-mail has right now; free when signed out or without accounts. */
export async function planForEmail(email: string | null | undefined, now = Date.now()): Promise<ActivePlan> {
  if (!email || !accountsEnabled) return { plan: "free", endsAt: null };
  const rows = check<Array<Pick<Row, "plan" | "starts_at" | "ends_at">>>(
    await table().select("plan, starts_at, ends_at").eq("email", email.toLowerCase()),
  );
  return activePlan(
    rows.map((row) => ({ plan: row.plan, startsAt: row.starts_at, endsAt: row.ends_at })),
    now,
  );
}
