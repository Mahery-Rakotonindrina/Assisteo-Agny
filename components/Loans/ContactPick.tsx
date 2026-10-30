import { useState, useSyncExternalStore } from "react";
import { BookUser } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import type { PickedContact } from "@/lib/contactPick";
import { contactPicker, pickContact } from "@/services/contactPicker";
import { haptics } from "@/services/device";
import styles from "./Loans.module.scss";

const noSubscribe = () => () => {};

/** Whether this phone has a contact picker; false while server-rendering (no hydration mismatch). */
export function useContactPicker() {
  return useSyncExternalStore(noSubscribe, () => contactPicker() !== null, () => false);
}

/**
 * "Choisir dans mes contacts": one tap, the phone's own picker, and `onPick`
 * gets the name and number chosen. Not shown where there is no picker.
 */
export function ContactPickButton({ onPick, label, variant = "secondary", testId = "loan-contact" }: { onPick: (contact: PickedContact) => void; label?: string; variant?: "secondary" | "ghost"; testId?: string }) {
  const { t } = useTranslation();
  const available = useContactPicker();
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  const pick = async () => {
    haptics.tap();
    setBusy(true);
    const contact = await pickContact();
    setBusy(false);
    if (contact) onPick(contact);
  };
  return (
    <Button type="button" className={styles.contactPick} variant={variant} icon={<BookUser />} onClick={() => void pick()} disabled={busy} data-testid={testId}>
      {label ?? t("loans.contacts.pick")}
    </Button>
  );
}
