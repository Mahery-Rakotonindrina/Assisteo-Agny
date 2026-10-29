import { useAccount } from "@/lib/account/AccountProvider";

/** The account's name, else its e-mail (the debt acknowledgment, the scan of one). */
export function useAccountName() {
  const { session, email } = useAccount();
  const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((value): value is string => typeof value === "string" && value.trim() !== "");
  return name ?? email ?? "";
}
