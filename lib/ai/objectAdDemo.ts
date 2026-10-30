import type { ObjectAd, ObjectAdRequest } from "./schema";

// Demo mode (no AI key on the server, end-to-end tests): a sample ad for the
// object of the scan, its price following the condition picked.

const prices: Record<ObjectAdRequest["condition"], [number, number, number]> = {
  new: [150_000, 180_000, 210_000],
  veryGood: [120_000, 140_000, 160_000],
  good: [90_000, 110_000, 130_000],
  worn: [50_000, 70_000, 90_000],
  toRepair: [20_000, 30_000, 45_000],
};

export function mockObjectAd(input: Pick<ObjectAdRequest, "condition" | "place" | "locale" | "malagasy">, title: string): ObjectAd {
  const [priceLow, price, priceHigh] = prices[input.condition];
  const fr = input.locale === "fr";
  const place = input.place ? (fr ? ` À voir à ${input.place}.` : ` To see in ${input.place}.`) : "";
  return {
    title: fr ? `${title} à vendre` : `${title} for sale`,
    text: fr
      ? `Je vends ${title.toLowerCase()}, bien entretenu. L’état est visible sur la photo.${place} Écris-moi pour plus de détails. (Annonce d’exemple, mode démo.)`
      : `Selling ${title.toLowerCase()}, well looked after. The condition shows on the photo.${place} Message me for details. (Sample ad, demo mode.)`,
    price,
    priceLow,
    priceHigh,
    keywords: fr ? ["occasion", "à vendre", "madagascar"] : ["second hand", "for sale", "madagascar"],
    textMg: input.malagasy ? `Amidiko ity ${title.toLowerCase()} ity, voakarakara tsara.${input.place ? ` Hita ao ${input.place}.` : ""} Antsoy aho raha liana. (Ohatra, mode démo.)` : null,
  };
}
