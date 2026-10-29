import { Banknote, Landmark, Smartphone, Wallet as WalletIcon, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { PaymentMethod, Wallet, WalletType } from "@/lib/expenses";
import { walletColors, walletForPayment } from "@/lib/wallets";
import { Chips } from "./CategoryChips";

export const walletIcons: Record<WalletType, LucideIcon> = {
  cash: Banknote,
  mvola: Smartphone,
  orange_money: Smartphone,
  airtel_money: Smartphone,
  bank: Landmark,
  other: WalletIcon,
};

/** The pockets a form offers (none: no pockets yet), the last one used and the default one. */
export type PocketChoice = { wallets: Wallet[]; lastUsed?: string; primary?: string };

/** The pocket a new line starts in: the one it has, else what its payment says, else the last one used, else the default one. */
export function startingWallet(choice: PocketChoice | undefined, wallet: string | undefined, payment?: PaymentMethod) {
  if (!choice || choice.wallets.length === 0) return "";
  if (wallet && choice.wallets.some((item) => item.id === wallet)) return wallet;
  return walletForPayment(choice.wallets, payment)?.id ?? choice.lastUsed ?? choice.primary ?? choice.wallets[0].id;
}

/** Pick a pocket, by its colour and icon. */
export function WalletChips({ label, wallets, value, onChange }: { label: string; wallets: Wallet[]; value: string; onChange: (id: string) => void }) {
  return <Chips label={label} value={value} onChange={onChange} options={wallets.map((wallet) => ({ id: wallet.id, name: wallet.name, color: walletColors[wallet.type], Icon: walletIcons[wallet.type] }))} />;
}

/** A pocket type's name ("Espèces", "MVola"…). */
export function useWalletTypeName() {
  const { t } = useTranslation();
  return (type: WalletType) => t(`expenses.pockets.types.${type}`);
}
