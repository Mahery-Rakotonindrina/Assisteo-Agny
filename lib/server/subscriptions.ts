import { activePlan, type ActivePlan, type PaidPlanId, type Subscription } from "@/lib/plans";
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
});

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(`subscriptions: ${error.message}`);
  return data as T;
}

/** Every recorded subscription, newest first. */
export async function listSubscriptions() {
  return check<Row[]>(await table().select("*").order("created_at", { ascending: false }).limit(5000)).map(fromRow);
}

export async function addSubscriptions(inputs: SubscriptionInput[]) {
  return check<Row[]>(await table().insert(inputs.map(toRow)).select("*")).map(fromRow);
}

export async function updateSubscription(id: string, input: SubscriptionInput) {
  return fromRow(check<Row>(await table().update(toRow(input)).eq("id", id).select("*").single()));
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
