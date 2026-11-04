import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Check, MailPlus } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { planName } from "@/lib/customPlans";
import type { FamilySeatAction, FamilySeatsResponse } from "@/lib/familySeats";
import { spring } from "@/lib/motion";
import { authHeaders } from "@/services/account";
import { httpClient } from "@/services/httpClient";
import { planStore } from "@/services/plan";
import styles from "./FamilyInvitation.module.scss";

type Invitation = NonNullable<FamilySeatsResponse["invitation"]>;

// Asked once per app opening, for a signed-in account (not once per screen).
let asked = false;

/**
 * "Ana t'invite dans sa famille (offre Premium)": a bottom window (with its
 * backdrop, like the other sheets) opened once per app opening for a person
 * with an invitation to a family seat waiting. Nothing stays on the screen
 * after it: it never hides a screen's buttons. Accept or decline use the same
 * API as "Mon offre" (pages/api/family-seats.ts), where the invitation also
 * stays; until accepted, it gives nothing. "Plus tard" closes the window until
 * the next opening.
 */
export function FamilyInvitation() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { plan, fresh } = usePlan();
  const signedIn = Boolean(plan?.signedIn);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn || !fresh || asked) return;
    asked = true;
    // An older server, or accounts off: no invitation to show.
    void authHeaders()
      .then((headers) => httpClient.get<FamilySeatsResponse>("/api/family-seats", { headers }))
      .then((state) => setInvitation(state.invitation ?? null))
      .catch(() => undefined);
  }, [signedIn, fresh]);

  const answer = async (action: FamilySeatAction, done: string) => {
    setBusy(true);
    try {
      await httpClient.post<FamilySeatsResponse>("/api/family-seats", action, { headers: await authHeaders() });
      setInvitation(null);
      toast(done);
      // The plan changes with the seat.
      if (action.action === "accept") await planStore.refresh();
    } catch {
      toast(t("plans.family.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const shown = signedIn && invitation !== null && !hidden;
  return (
    <AnimatePresence>
      {shown && (
        <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="family-invitation-title"
            data-testid="family-invitation-banner"
            initial={{ y: 60 }}
            animate={{ y: 0 }}
            exit={{ y: 60 }}
            transition={spring}
          >
            <p id="family-invitation-title" className={styles.title}>
              <MailPlus size={20} aria-hidden /> {t("plans.family.banner", { owner: invitation.owner, plan: planName(invitation.plan, t, locale, plan) })}
            </p>
            <p className={styles.hint}>{t("plans.family.invitationHint")}</p>
            <div className={styles.actions}>
              <Button size="lg" block icon={<Check />} disabled={busy} onClick={() => void answer({ action: "accept" }, t("plans.family.accepted"))} data-testid="family-banner-accept">
                {t("plans.family.accept")}
              </Button>
              <Button size="lg" block variant="secondary" disabled={busy} onClick={() => void answer({ action: "decline" }, t("plans.family.declined"))} data-testid="family-banner-decline">
                {t("plans.family.decline")}
              </Button>
              <Button size="lg" block variant="ghost" disabled={busy} onClick={() => setHidden(true)} data-testid="family-banner-later">
                {t("plans.family.later")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
