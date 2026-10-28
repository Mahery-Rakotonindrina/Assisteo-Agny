import {
  Baby,
  Briefcase,
  Bus,
  Car,
  Church,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Heart,
  Home,
  Music,
  Package,
  PiggyBank,
  Plane,
  ShoppingBasket,
  Smartphone,
  Star,
  Store,
  Tag,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import type { BuiltInCategory, CustomIcon, IncomeKind } from "@/lib/expenses";
import styles from "./Expenses.module.scss";

export const categoryIcons: Record<CustomIcon, LucideIcon> = { tag: Tag, heart: Heart, home: Home, gift: Gift, star: Star, baby: Baby, church: Church, plane: Plane };

const builtInIcons: Record<BuiltInCategory, LucideIcon> = {
  market: ShoppingBasket,
  jirama: Zap,
  rent: Home,
  transport: Bus,
  phone: Smartphone,
  school: GraduationCap,
  health: HeartPulse,
  family: Users,
  online: Package,
  car: Car,
  leisure: Music,
  savings: PiggyBank,
  other: Tag,
};

export const incomeIcons: Record<IncomeKind, LucideIcon> = { salary: Briefcase, sales: Store, family: Users, other: HandCoins };

/** A category's icon: the built-in one, or the one the user picked. */
export function iconOf(category: { id: string; icon?: CustomIcon }): LucideIcon {
  if (category.icon) return categoryIcons[category.icon] ?? Tag;
  return builtInIcons[category.id as BuiltInCategory] ?? Tag;
}

type Chip = { id: string; name: string; color?: string; Icon: LucideIcon };

/** Big round choices with an icon (a category, where an income comes from): one is picked. */
export function Chips({ label, value, options, onChange }: { label: string; value: string; options: Chip[]; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className={styles.chipField}>
      <span id={id}>{label}</span>
      <div className={styles.chips} role="radiogroup" aria-labelledby={id}>
        {options.map(({ id: option, name, color, Icon }) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={styles.chip}
            style={color ? ({ "--tone": color } as React.CSSProperties) : undefined}
            onClick={() => onChange(option)}
          >
            <Icon size={18} aria-hidden />
            <span>{name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
