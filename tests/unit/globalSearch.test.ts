import { describe, expect, it, vi } from "vitest";
import { mockAnalysis } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import {
  addRecent,
  excerptOf,
  expenseDomain,
  foldKeep,
  garageItems,
  healthItems,
  homeItems,
  listItems,
  loanItems,
  normalize,
  parcelItems,
  plantItems,
  queryWords,
  readRecent,
  scanMatcher,
  scanSources,
  searchSources,
  seeAllHref,
  type SearchItem,
  type SearchSource,
} from "@/lib/globalSearch";
import { matchesSearch } from "@/lib/parcels";
import type { Appointment } from "@/lib/appointments";
import type { HealthProfile } from "@/lib/healthProfiles";
import type { HealthSpend } from "@/lib/healthSpending";
import type { HistoryEntry } from "@/types/history";

const fmt = { date: (at: number) => `d${at}` };
const item = (key: string, parts: SearchItem["parts"], extra: Partial<SearchItem> = {}): SearchItem => ({ key, title: key, parts, href: `/x?open=${key}`, ...extra });
const one = (domain: SearchSource["domain"], items: SearchItem[]): SearchSource[] => [{ domain, items }];
const keys = (sources: SearchSource[], query: string) => searchSources(sources, query).flatMap((result) => result.hits.map((hit) => hit.key));

const entry = (id: string, analysis: Partial<Analysis>, extra: Partial<HistoryEntry> = {}): HistoryEntry =>
  ({ id, createdAt: 1000, mode: "auto", thumbnail: "", preview: "", analysis: { ...mockAnalysis("document", "fr"), ...analysis }, meta: { model: "m", demo: true, durationMs: 0 }, ...extra }) as HistoryEntry;

describe("global search: comparing", () => {
  it("ignores accents and capitals", () => {
    expect(normalize("  Électricité   JIRAMA ")).toBe("electricite jirama");
    expect(keys(one("scans", [item("a", ["Facture d’Électricité"])]), "electricite")).toEqual(["a"]);
    expect(keys(one("scans", [item("a", ["facture electricite"])]), "ÉLECTRICITÉ")).toEqual(["a"]);
  });

  it("keeps the same length when folding (so an excerpt lines up)", () => {
    for (const text of ["Électricité", "ça va à Antananarivo", "ŒUF", "a b"]) expect(foldKeep(text).length).toBe(text.length);
  });

  it("needs every word, in any order", () => {
    const sources = one("scans", [item("a", ["Facture JIRAMA de mars"]), item("b", ["Facture JIRAMA d’avril"])]);
    expect(keys(sources, "jirama mars")).toEqual(["a"]);
    expect(keys(sources, "mars jirama")).toEqual(["a"]);
    expect(keys(sources, "jirama")).toHaveLength(2);
    expect(keys(sources, "jirama mai")).toEqual([]);
  });

  it("finds a word inside another", () => {
    expect(keys(one("scans", [item("a", ["pharmacie du centre"])]), "pharma")).toEqual(["a"]);
  });

  it("finds nothing for an empty or too short query", () => {
    const sources = one("scans", [item("a", ["abc"])]);
    expect(searchSources(sources, "")).toEqual([]);
    expect(searchSources(sources, "   ")).toEqual([]);
    expect(searchSources(sources, "a")).toEqual([]);
  });

  it("splits a query on any spaces", () => {
    expect(queryWords("  Riz  Marché ")).toEqual(["riz", "marche"]);
  });
});

describe("global search: amounts", () => {
  it("finds an amount written without spaces in a text with spaces", () => {
    expect(keys(one("scans", [item("a", ["Total à payer : 45 000 Ar"])]), "45000")).toEqual(["a"]);
    expect(keys(one("scans", [item("a", ["Total : 45 000 Ar"])]), "45000")).toEqual(["a"]);
    expect(keys(one("scans", [item("a", ["Total : 1.500.000 Ar"])]), "1500000")).toEqual(["a"]);
    expect(keys(one("scans", [item("a", ["Total : 1 500 000 Ar"])]), "1500000")).toEqual(["a"]);
  });

  it("finds an amount with spaces too", () => {
    expect(keys(one("scans", [item("a", ["45 000 Ar"])]), "45 000")).toEqual(["a"]);
  });

  it("finds a stored amount", () => {
    const sources = one("loans", [item("a", ["Rado"], { amounts: [45000] }), item("b", ["Hery"], { amounts: [450] })]);
    expect(keys(sources, "45000")).toEqual(["a"]);
    expect(keys(sources, "45 000")).toEqual(["a"]);
  });

  it("combines a word and an amount", () => {
    const sources = one("loans", [item("a", ["Rado"], { amounts: [45000] }), item("b", ["Rado"], { amounts: [10000] })]);
    expect(keys(sources, "rado 45000")).toEqual(["a"]);
  });

  it("does not mix two numbers into one", () => {
    expect(keys(one("scans", [item("a", ["12 345 et 6 789"])]), "123456789")).toEqual([]);
  });
});

describe("global search: results", () => {
  const many = Array.from({ length: 12 }, (_, index) => item(`k${index}`, ["jirama"], { at: index }));

  it("counts everything and shows the first five, the latest first", () => {
    const [result] = searchSources(one("scans", many), "jirama");
    expect(result.count).toBe(12);
    expect(result.hits.map((hit) => hit.key)).toEqual(["k11", "k10", "k9", "k8", "k7"]);
  });

  it("groups by domain, in the order of the sources, leaving out the empty ones", () => {
    const sources: SearchSource[] = [
      { domain: "scans", items: [item("s", ["riz"])] },
      { domain: "lists", items: [item("l", ["pain"])] },
      { domain: "loans", items: [item("p", ["riz"])] },
    ];
    expect(searchSources(sources, "riz").map((result) => result.domain)).toEqual(["scans", "loans"]);
  });

  it("puts the found word in bold in a short excerpt", () => {
    const long = `${"mot ".repeat(40)}Facture JIRAMA de mars ${"fin ".repeat(40)}`;
    const [result] = searchSources(one("scans", [item("a", ["Titre", long])]), "jirama");
    const excerpt = result.hits[0].excerpt!;
    expect(excerpt.filter((part) => part.bold).map((part) => part.text)).toEqual(["JIRAMA"]);
    expect(excerpt.map((part) => part.text).join("").length).toBeLessThan(long.length / 2);
    expect(excerpt[0].text).toBe("…");
  });

  it("bolds every word found, and finds past an accent", () => {
    const segments = excerptOf(["Facture d’Électricité de mars"], ["electricite", "mars"])!;
    expect(segments.filter((part) => part.bold).map((part) => part.text)).toEqual(["Électricité", "mars"]);
  });

  it("has no excerpt when only an amount matched", () => {
    const [result] = searchSources(one("loans", [item("a", ["Rado"], { amounts: [45000] })]), "45000");
    expect(result.hits[0].excerpt).toBeUndefined();
  });

  it("stays quick with thousands of scans", () => {
    const thousands = Array.from({ length: 5000 }, (_, index) => item(`s${index}`, [`Scan numéro ${index}`, "Un long résumé sur un sujet sans importance ".repeat(5)], { at: index }));
    const sources = one("scans", thousands);
    searchSources(sources, "numero 4999");
    const started = performance.now();
    const [result] = searchSources(sources, "numero 4999");
    expect(result.count).toBe(1);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("does not fold the texts again when only the query changes", () => {
    const sources = one("scans", Array.from({ length: 3000 }, (_, index) => item(`s${index}`, [`Scan numéro ${index}`, "Un long résumé sur un sujet sans importance"])));
    searchSources(sources, "numero 1");
    const fold = vi.spyOn(String.prototype, "normalize");
    // A query that finds nothing builds no excerpt: what is folded is the query itself.
    searchSources(sources, "zzzz");
    searchSources(sources, "qqqq");
    const calls = fold.mock.calls.length;
    fold.mockRestore();
    // Only the queries' own letters are folded: a pass over the texts would be over 100 000 calls.
    expect(calls).toBeLessThan(50);
  });

  it("folds again when the data change (a new list of items)", () => {
    expect(searchSources(one("scans", [item("a", ["Électricité"])]), "electricite")).toHaveLength(1);
    expect(searchSources(one("scans", [item("b", ["Eau"])]), "electricite")).toHaveLength(0);
  });
});

describe("global search: scans, papers and health", () => {
  const card = entry("card", { title: "Carte d’identité", summary: "CNI de Rado", document: { type: "id", dates: [], expiresOn: null, isInsurance: false, paper: "id_card" } as unknown as Analysis["document"] });
  const photo = entry("photo", { title: "Zébu au marché", summary: "Un zébu", document: null, tags: ["zébu"] }, { transcript: { text: "texte lu sur la photo : tsaramaso", at: 1 } });
  const recipe = entry("recipe", { title: "Ordonnance", summary: "Soins", document: null, medicine: { kind: "prescription", unreadable: null, items: [{ name: "Amoxicilline", strength: "500 mg", dose: "matin et soir", timesPerDay: 2, durationDays: 7, precautions: [], contraindications: [] }] } as unknown as Analysis["medicine"] });
  const sources = scanSources([card, photo, recipe, entry("gone", { title: "Supprimé" }, { deletedAt: 5 })], fmt);

  it("puts each scan in one place only", () => {
    expect(sources.papers.map((found) => found.key)).toEqual(["card"]);
    expect(sources.health.map((found) => found.key)).toEqual(["recipe"]);
    expect(sources.scans.map((found) => found.key)).toEqual(["photo"]);
  });

  it("finds by title, text read, tag and medicine", () => {
    expect(keys(one("scans", sources.scans), "zebu")).toEqual(["photo"]);
    expect(keys(one("scans", sources.scans), "tsaramaso")).toEqual(["photo"]);
    expect(keys(one("papers", sources.papers), "cni rado")).toEqual(["card"]);
    expect(keys(one("health", sources.health), "amoxicilline")).toEqual(["recipe"]);
  });

  it("never finds a deleted scan", () => {
    expect(keys([...one("scans", sources.scans)], "supprime")).toEqual([]);
  });

  it("opens the scan", () => {
    expect(sources.scans[0].href).toBe("/result?id=photo");
  });

  it("finds a bill's amount corrected by the user", () => {
    const bill = scanSources([entry("bill", { title: "Facture", document: null }, { expense: { amountMga: 45000 } })], fmt);
    expect(keys(one("scans", bill.scans), "45000")).toEqual(["bill"]);
  });

  it("copes with an older scan lacking fields", () => {
    const old = entry("old", { title: "Vieux scan" });
    delete (old.analysis as Partial<Analysis>).tags;
    delete (old.analysis as Partial<Analysis>).facts;
    expect(() => scanSources([old], fmt)).not.toThrow();
  });
});

describe("global search: the history's own filter (Voir tout)", () => {
  const scans = [
    entry("a", { title: "Facture d'Électricité", summary: "JIRAMA, mars 2026", tags: ["eau"] }),
    entry("b", { title: "Facture JIRAMA", summary: "avril", tags: [] }, { transcript: { text: "Électricité du mois de mars", at: 1 } }),
    entry("c", { title: "Photo de zébu", summary: "au marché", tags: ["zébu"] }),
  ];
  const found = (query: string) => scans.filter(scanMatcher(query)).map((scan) => scan.id);

  it("finds the same scans as the search screen: no accents, no capitals, every word", () => {
    expect(found("electricite")).toEqual(["a", "b"]);
    expect(found("jirama mars")).toEqual(["a", "b"]);
    expect(found("JIRAMA MARS electricite")).toEqual(["a", "b"]);
    expect(found("zebu")).toEqual(["c"]);
    expect(found("jirama zebu")).toEqual([]);
  });

  it("gives what the search screen gives, query by query", () => {
    const split = scanSources(scans, fmt);
    const viaScreen = [...split.scans, ...split.papers];
    for (const query of ["electricite", "jirama mars", "mois de mars", "zebu"]) {
      expect(found(query).sort()).toEqual(searchSources(one("scans", viaScreen), query).flatMap((result) => result.hits.map((hit) => hit.key)).sort());
    }
  });

  it("keeps every scan for an empty query", () => {
    expect(found("")).toEqual(["a", "b", "c"]);
    expect(found("   ")).toEqual(["a", "b", "c"]);
  });

  it("parcels' own search already ignores accents and wants every word", () => {
    expect(matchesSearch(["Dédouanement Toamasina", "DHL", 45000], "dedouanement dhl 45000")).toBe(true);
    expect(matchesSearch(["Dédouanement Toamasina"], "dedouanement shein")).toBe(false);
  });
});

describe("global search: the other sources", () => {
  it("parcels: every info", () => {
    const parcel = {
      id: "p1",
      title: "Robe",
      client: "Miora",
      info: { status: "shipped", carrier: "DHL", trackingNumber: "JD0146", seller: "Shein", items: [{ name: "Robe rouge", variant: "taille M" }], lastEvent: { description: "Arrivé à Tana", location: "Ivato", at: "" } },
      scanIds: [],
      timeline: [{ event: { description: "Dédouanement", location: "Toamasina", at: "" } }],
      createdAt: 1,
      updatedAt: 2,
      priceMga: 45000,
      fees: [{ id: "f", label: "Douane", amountMga: 12000 }],
    } as unknown as Parameters<typeof parcelItems>[0][number];
    const sources = one("parcels", parcelItems([parcel], fmt));
    for (const query of ["dhl", "jd0146", "shein", "rouge", "taille", "ivato", "dedouanement", "douane", "miora", "45000", "12000"]) expect(keys(sources, query)).toEqual(["p1"]);
    expect(sources[0].items[0].href).toBe("/parcels?open=p1");
  });

  it("lists and their articles, not the deleted ones", () => {
    const lists = [
      { id: "l1", title: "Courses", kind: "shopping", items: [{ id: "i", text: "Riz", quantity: "5 kg", priceMga: 3500, done: false }], createdAt: 1, updatedAt: 2 },
      { id: "l2", title: "Courses vieilles", kind: "shopping", items: [], createdAt: 1, updatedAt: 2, deletedAt: 3 },
    ] as unknown as Parameters<typeof listItems>[0];
    const sources = one("lists", listItems(lists, fmt));
    expect(keys(sources, "riz")).toEqual(["l1"]);
    expect(keys(sources, "3500")).toEqual(["l1"]);
    expect(keys(sources, "courses")).toEqual(["l1"]);
  });

  it("loans: person, note and amount", () => {
    const loans = [{ id: "n1", direction: "lent", person: "Rado", note: "pour le loyer", amountMga: 150000, at: 5, repayments: [], updatedAt: 5 }] as unknown as Parameters<typeof loanItems>[0];
    const sources = one("loans", loanItems(loans, fmt));
    expect(keys(sources, "rado")).toEqual(["n1"]);
    expect(keys(sources, "loyer")).toEqual(["n1"]);
    expect(keys(sources, "150000")).toEqual(["n1"]);
    expect(sources[0].items[0].href).toBe("/loans?person=rado&dir=lent");
  });

  it("health: appointments, relatives and spending, not the removed ones", () => {
    const appointments = [
      { id: "a1", at: 9, who: "Dr Rakoto", place: "Clinique Ravoahangy", note: "contrôle", createdAt: 1, updatedAt: 1 },
      { id: "a2", at: 9, who: "Dr Supprimé", place: "", note: "", createdAt: 1, updatedAt: 1, deletedAt: 2 },
    ] as Appointment[];
    const profiles = [{ id: "r1", name: "Maman", relation: "parent", card: { allergies: "pénicilline" }, createdAt: 1, updatedAt: 3 }] as unknown as HealthProfile[];
    const spends = [{ id: "s1", at: 7, amountMga: 12500, kind: "pharmacy", note: "sirop", createdAt: 1, updatedAt: 1 }] as HealthSpend[];
    const sources = one("health", healthItems({ appointments, profiles, spends }, { relation: (relation) => `rel-${relation}`, spend: (kind) => `kind-${kind}`, person: () => undefined }, fmt));
    expect(keys(sources, "rakoto")).toEqual(["appt:a1"]);
    expect(keys(sources, "ravoahangy")).toEqual(["appt:a1"]);
    expect(keys(sources, "supprime")).toEqual([]);
    expect(keys(sources, "maman")).toEqual(["profile:r1"]);
    expect(keys(sources, "penicilline")).toEqual(["profile:r1"]);
    expect(keys(sources, "sirop")).toEqual(["spend:s1"]);
    expect(keys(sources, "12500")).toEqual(["spend:s1"]);
    expect(keys(sources, "kind-pharmacy")).toEqual(["spend:s1"]);
    expect(sources[0].items.find((found) => found.key === "appt:a1")?.href).toBe("/sante?appt=a1");
    expect(sources[0].items.find((found) => found.key === "profile:r1")?.href).toBe("/sante?pour=r1");
  });

  it("health: works without any data", () => {
    expect(healthItems({ appointments: null, profiles: undefined, spends: [] }, { relation: String, spend: String, person: () => undefined }, fmt)).toEqual([]);
  });

  it("garage: name, plate, services and costs", () => {
    const vehicles = [
      { id: "v1", name: "La Corolla", kind: "car", make: "Toyota", plate: "1234 TAA", year: 2008, advice: [{ task: "Vidange", interval: "5000 km" }], maintenance: [{ id: "m", at: 1, kind: "oil", garage: "Garage Ankorondrano", note: "filtre", costMga: 85000 }], fuel: [], expenses: [], odometer: [], scanIds: [], noticeDays: 5, createdAt: 1, updatedAt: 2 },
    ] as unknown as Parameters<typeof garageItems>[0];
    const sources = one("garage", garageItems(vehicles, fmt));
    for (const query of ["corolla", "toyota", "1234 taa", "2008", "vidange", "ankorondrano", "filtre", "85000"]) expect(keys(sources, query)).toEqual(["v1"]);
  });

  it("plants and the home", () => {
    const plants = [{ id: "pl1", name: "Basilic", species: "Ocimum basilicum", notes: "près de la fenêtre", place: "indoor", waterEveryDays: 3, scanIds: [], checks: [], createdAt: 1, updatedAt: 1 }] as unknown as Parameters<typeof plantItems>[0];
    const things = [{ id: "h1", name: "Réfrigérateur", store: "Jumbo", serial: "SN-998", note: "garantie 2 ans", room: "kitchen", priceMga: 1200000, scanIds: [], createdAt: 1, updatedAt: 1 }] as unknown as Parameters<typeof homeItems>[0];
    expect(keys(one("plants", plantItems(plants, fmt)), "ocimum")).toEqual(["pl1"]);
    expect(keys(one("plants", plantItems(plants, fmt)), "fenetre")).toEqual(["pl1"]);
    for (const query of ["refrigerateur", "jumbo", "sn-998", "garantie", "1200000"]) expect(keys(one("home", homeItems(things, fmt)), query)).toEqual(["h1"]);
  });

  it("expenses: the result of their own search, opened in the right place", () => {
    const result = {
      count: 2,
      total: 45000,
      groups: [
        {
          month: "2026-10",
          hits: [
            { key: "manual:e1", flow: "expense", origin: "manual", at: new Date(2026, 9, 12).getTime(), amountMga: 45000, label: "JIRAMA", category: "jirama", excluded: false, recordId: "e1" },
            { key: "bill:b1", flow: "expense", origin: "bills", at: new Date(2026, 9, 3).getTime(), amountMga: 20000, label: "Facture", category: "jirama", excluded: false },
          ],
        },
      ],
    } as Parameters<typeof expenseDomain>[0];
    const domain = expenseDomain(result, { title: (hit) => hit.label ?? "", sub: (hit) => String(hit.amountMga) })!;
    expect(domain.count).toBe(2);
    expect(domain.hits[0]).toMatchObject({ title: "JIRAMA", href: "/expenses?open=e1" });
    expect(domain.hits[1].href).toBe("/expenses?month=2026-10&tab=month&focus=bill%3Ab1");
    expect(expenseDomain({ count: 0, total: 0, groups: [] }, { title: () => "", sub: () => "" })).toBeNull();
  });
});

describe("global search: see all", () => {
  it("fills the search of the screens that have one", () => {
    expect(seeAllHref("scans", " jirama mars ")).toBe("/history?q=jirama+mars");
    expect(seeAllHref("parcels", "dhl")).toBe("/parcels?q=dhl");
  });

  it("opens the others without a query", () => {
    expect(seeAllHref("loans", "rado")).toBe("/loans");
    expect(seeAllHref("health", "rado")).toBe("/sante");
    expect(seeAllHref("home", "rado")).toBe("/inventory");
  });
});

describe("global search: recent searches", () => {
  it("keeps five at most, the latest first", () => {
    let list: string[] = [];
    for (const query of ["un un", "deux", "trois", "quatre", "cinq", "six six"]) list = addRecent(list, query);
    expect(list).toEqual(["six six", "cinq", "quatre", "trois", "deux"]);
  });

  it("moves a repeated search up, whatever its accents and capitals", () => {
    const list = addRecent(["jirama", "Électricité", "riz"], "electricite");
    expect(list).toEqual(["electricite", "jirama", "riz"]);
  });

  it("ignores a query too short, and cleans spaces", () => {
    expect(addRecent(["riz"], "a")).toEqual(["riz"]);
    expect(addRecent([], "  jirama   mars ")).toEqual(["jirama mars"]);
  });

  it("reads a damaged storage as nothing", () => {
    expect(readRecent(null)).toEqual([]);
    expect(readRecent("pas du json")).toEqual([]);
    expect(readRecent('{"a":1}')).toEqual([]);
    expect(readRecent('["riz", 3, "", "pain"]')).toEqual(["riz", "pain"]);
    expect(readRecent(JSON.stringify(["a1", "b1", "c1", "d1", "e1", "f1"]))).toHaveLength(5);
  });
});
