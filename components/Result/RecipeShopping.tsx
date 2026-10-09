import Link from "next/link";
import { useState } from "react";
import { ListChecks, ListPlus, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useLists } from "@/hooks/useLists";
import { useTranslation } from "@/hooks/useTranslation";
import { haptics } from "@/services/device";
import { listProgress, listStore } from "@/services/listStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Food.module.scss";

/** The recipe's ingredients into "Mes listes": a new shopping list, or one already going. */
export function RecipeShopping({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { lists } = useLists();
  const [choosing, setChoosing] = useState(false);
  const recipe = entry.analysis.recipe;
  if (!recipe) return null;

  const made = lists.find((list) => list.scanId === entry.id);
  // Shopping lists still in use, the latest first.
  const ongoing = lists
    .filter((list) => list.kind === "shopping" && list.id !== made?.id)
    .filter((list) => {
      const { done, total } = listProgress(list);
      return total === 0 || done < total;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  const createList = async () => {
    haptics.success();
    await listStore.addFromRecipe(entry, t("food.shoppingTitle", { name: recipe.name }));
    setChoosing(false);
    toast(t("lists.added"));
  };

  const addTo = async (id: string, title: string) => {
    haptics.success();
    const added = await listStore.addItems(id, recipe.ingredients);
    setChoosing(false);
    toast(t("food.addedTo", { count: added, list: title }));
  };

  if (made) {
    return (
      <p className={styles.shoppingNote}>
        <ListChecks size={15} /> {t("food.shoppingMade", { list: made.title })}{" "}
        <Link href={{ pathname: "/lists", query: { open: made.id } }}>{t("lists.open")}</Link>
      </p>
    );
  }

  if (!choosing) {
    return (
      <Button
        variant="secondary"
        icon={<ShoppingBasket />}
        onClick={() => (ongoing.length > 0 ? setChoosing(true) : void createList())}
        block
      >
        {t("food.toShopping")}
      </Button>
    );
  }

  return (
    <div className={styles.chooser} role="group" aria-label={t("food.toShopping")}>
      <p>{t("food.chooseList")}</p>
      <Button icon={<ListPlus />} onClick={() => void createList()} block>
        {t("food.newShoppingList")}
      </Button>
      {ongoing.map((list) => (
        <Button key={list.id} variant="secondary" icon={<ShoppingBasket />} onClick={() => void addTo(list.id, list.title)} block>
          {list.title}
        </Button>
      ))}
      <Button variant="ghost" onClick={() => setChoosing(false)} block>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
