import { useEffect, useState, type FormEvent } from "react";
import { LogOut, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { SeatEmailSchema, type FamilySeatAction, type FamilySeatsResponse } from "@/lib/familySeats";
import { authHeaders } from "@/services/account";
import { httpClient } from "@/services/httpClient";
import { planStore } from "@/services/plan";
import { ApiError } from "@/types/api";
import styles from "./FamilySeats.module.scss";

/** The message of a refused action (the server's error code). */
function failureKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : null;
  switch (code) {
    case "seats_full":
      return "plans.family.full";
    case "seat_taken":
      return "plans.family.taken";
    case "seat_self":
      return "plans.family.self";
    case "plan_required":
      return "plans.family.noSeats";
    case "migration_needed":
      return "plans.family.unavailable";
    case "invalid_request":
      return "plans.family.invalid";
    default:
      return "plans.family.failed";
  }
}

/**
 * "Partager mon offre avec ma famille" in "Mon offre": the subscriber adds
 * or removes people by e-mail; an invited person sees whose plan it is and
 * may leave. The server checks everything (pages/api/family-seats.ts); the
 * plan's features reach the person through /api/plan.
 */
export function FamilySeats() {
  const { t } = useTranslation();
  const toast = useToast();
  const { plan } = usePlan();
  const signedIn = Boolean(plan?.signedIn);
  const [state, setState] = useState<FamilySeatsResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    authHeaders()
      .then((headers) => httpClient.get<FamilySeatsResponse>("/api/family-seats", { headers }))
      .then((next) => {
        if (!live) return;
        setState(next);
        setUnavailable(false);
      })
      .catch((error: unknown) => {
        // Before migration 0016, or an older server: nothing to show but a short note to a subscriber.
        if (live) setUnavailable(error instanceof ApiError && error.code === "migration_needed");
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  const act = async (action: FamilySeatAction, done: string) => {
    setBusy(true);
    try {
      setState(await httpClient.post<FamilySeatsResponse>("/api/family-seats", action, { headers: await authHeaders() }));
      toast(done);
      if (action.action === "leave") await planStore.refresh();
      return true;
    } catch (error) {
      toast(t(failureKey(error)), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = SeatEmailSchema.safeParse(email);
    if (!parsed.success) return toast(t("plans.family.invalid"), "error");
    if (await act({ action: "add", email: parsed.data }, t("plans.family.added", { email: parsed.data }))) setEmail("");
  };

  if (!signedIn || !plan) return null;
  const sharing = state !== null && (state.seats > 0 || state.members.length > 0 || state.reason === "trial");
  const owner = plan.familySeat?.owner ?? state?.joined?.owner ?? null;

  return (
    <>
      {state?.joined && owner && (
        <div className={styles.card} data-testid="family-joined">
          <p className={styles.text}>
            <Users size={16} aria-hidden /> {t("plans.family.joined", { owner })}
          </p>
          {leaving ? (
            <div className={styles.row}>
              <Button variant="danger" icon={<LogOut />} disabled={busy} onClick={() => void act({ action: "leave" }, t("plans.family.left")).then(() => setLeaving(false))}>
                {t("plans.family.leaveConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setLeaving(false)}>
                {t("plans.family.cancel")}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" icon={<LogOut />} onClick={() => setLeaving(true)}>
              {t("plans.family.leave")}
            </Button>
          )}
        </div>
      )}

      {unavailable && plan.plan !== "free" && <p className={styles.hint}>{t("plans.family.unavailable")}</p>}

      {sharing && state && (
        <section className={styles.card} aria-label={t("plans.family.title")} data-testid="family-seats">
          <div className={styles.head}>
            <strong>
              <Users size={16} aria-hidden /> {t("plans.family.title")}
            </strong>
            {state.seats > 0 && <span data-testid="family-count">{t("plans.family.count", { used: Math.min(state.members.length, state.seats), seats: state.seats })}</span>}
          </div>
          <p className={styles.hint}>{state.reason === "trial" ? t("plans.family.trial") : state.seats > 0 ? t("plans.family.hint") : t("plans.family.noSeats")}</p>

          {state.members.length > 0 && (
            <ul className={styles.members}>
              {state.members.map((member, index) => (
                <li key={member.id} data-inactive={index >= state.seats ? "" : undefined}>
                  <span>
                    {member.email}
                    {index >= state.seats && <small>{t("plans.family.inactive")}</small>}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    icon={<X />}
                    aria-label={t("plans.family.removeLabel", { email: member.email })}
                    disabled={busy}
                    onClick={() => void act({ action: "remove", id: member.id }, t("plans.family.removed", { email: member.email }))}
                  />
                </li>
              ))}
            </ul>
          )}

          {state.seats > state.members.length && (
            <form className={styles.add} onSubmit={(event) => void add(event)}>
              <label className={styles.input}>
                <span className="visually-hidden">{t("plans.family.emailLabel")}</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value.slice(0, 254))}
                  placeholder={t("plans.family.emailLabel")}
                  data-testid="family-email"
                />
              </label>
              <Button type="submit" icon={<UserPlus />} disabled={busy || !email.trim()} data-testid="family-add">
                {t("plans.family.add")}
              </Button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
