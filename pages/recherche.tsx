import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Car, FolderLock, HandCoins, HeartPulse, History, House, ListChecks, Package, Search, Sprout, Wallet, X, type LucideIcon } from "lucide-react";
import { Seo } from "@/components/Seo";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useExpenses, useKeptExpenses } from "@/hooks/useExpenses";
import { useHealthSpending } from "@/hooks/useHealthSpending";
import { useHistory } from "@/hooks/useHistory";
import { useHomeItems } from "@/hooks/useHomeItems";
import { useKeptLoans, useLoans } from "@/hooks/useLoans";
import { useLists, useSharedLists } from "@/hooks/useLists";
import { useNow } from "@/hooks/useNow";
import { useParcels } from "@/hooks/useParcels";
import { usePlan } from "@/hooks/usePlan";
import { usePlants } from "@/hooks/usePlants";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicles } from "@/hooks/useVehicles";
import { searchExpenses } from "@/lib/expenseSearch";
import type { IncomeKind } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import {
  expenseDomain,
  garageItems,
  healthItems,
  homeItems,
  listItems,
  loanItems,
  MIN_QUERY,
  normalize,
  parcelItems,
  plantItems,
  scanSources,
  searchDomains,
  searchSources,
  seeAllHref,
  type DomainResult,
  type SearchDomain,
  type SearchSource,
  type Segment,
} from "@/lib/globalSearch";
import { rise, stagger } from "@/lib/motion";
import { recentSearches } from "@/services/recentSearches";
import { useSettings } from "@/lib/settings/SettingsProvider";
import styles from "@/styles/Search.module.scss";

const icons: Record<SearchDomain, LucideIcon> = {
  scans: History,
  papers: FolderLock,
  parcels: Package,
  lists: ListChecks,
  expenses: Wallet,
  loans: HandCoins,
  health: HeartPulse,
  garage: Car,
  plants: Sprout,
  home: House,
};

/** How long typing pauses before searching. */
const TYPING_DELAY = 200;
/** "Rechercher": one bar that looks everywhere on the device, with no server and no AI. */
export default function SearchPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const now = useNow(60_000);
  const { has } = usePlan();
  const { settings } = useSettings();
  const { entries } = useHistory();
  const { parcels } = useParcels();
  const { lists: personalLists } = useLists();
  const { lists: sharedLists } = useSharedLists();
  const { loans } = useLoans();
  const { vehicles } = useVehicles();
  const { plants } = usePlants();
  const { items: things } = useHomeItems();
  const { spends } = useHealthSpending();
  const { records } = useExpenses();
  const sources = useExpenseSources();
  const { categoryName } = useExpenseLabels(records);
  // What the plan doesn't give isn't looked in. Kept expenses and loans stay reachable, like their shortcuts.
  const keptExpenses = useKeptExpenses(!has("expenses"));
  const keptLoans = useKeptLoans(!has("loans"));

  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // Typing pauses before the search runs; "?q=" fills the bar.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query), TYPING_DELAY);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    // Read on the device once mounted (never on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(recentSearches.read());
  }, []);
  const preset = router.isReady && typeof router.query.q === "string" ? router.query.q : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (preset) setQuery(preset);
  }, [preset]);

  // Booleans, not `has` itself (a new function each render): the sources are rebuilt only when the data or the plan change.
  const canLoans = has("loans") || keptLoans;
  const canGarage = has("garage");
  const canPlants = has("plants");
  const canHome = has("inventory");
  const canExpenses = has("expenses") || keptExpenses;

  const date = useMemo(() => ({ date: (at: number) => formatDate(at, locale) }), [locale]);
  const personName = useMemo(() => {
    const names = new Map((settings.healthProfiles ?? []).map((profile) => [profile.id, profile.name]));
    return (profileId?: string) => (profileId ? names.get(profileId) : undefined);
  }, [settings.healthProfiles]);

  // The sources are read from what each screen already keeps; the texts of a source are folded once per change of its data (lib/globalSearch.ts).
  const built = useMemo<SearchSource[]>(() => {
    const scans = scanSources(entries, date);
    const health = [...scans.health, ...healthItems({ appointments: settings.appointments, profiles: settings.healthProfiles, spends, vaccines: settings.vaccines, pharmacy: settings.pharmacy }, { relation: (relation) => t(`health.profiles.relations.${relation}`), spend: (kind) => t(`health.spending.kinds.${kind}`), person: personName }, date)];
    const all: SearchSource[] = [
      { domain: "scans", items: scans.scans },
      { domain: "papers", items: scans.papers },
      { domain: "parcels", items: parcelItems(parcels, date) },
      { domain: "lists", items: listItems([...personalLists, ...sharedLists], date) },
      { domain: "loans", items: canLoans ? loanItems(loans, date) : [] },
      { domain: "health", items: health },
      { domain: "garage", items: canGarage ? garageItems(vehicles, date) : [] },
      { domain: "plants", items: canPlants ? plantItems(plants, date) : [] },
      { domain: "home", items: canHome ? homeItems(things, date) : [] },
    ];
    return all;
  }, [entries, parcels, personalLists, sharedLists, loans, vehicles, plants, things, spends, settings.appointments, settings.healthProfiles, settings.vaccines, settings.pharmacy, date, canLoans, canGarage, canPlants, canHome, personName, t]);

  const results = useMemo<DomainResult[]>(() => {
    if (normalize(asked).length < MIN_QUERY) return [];
    const found = searchSources(built, asked);
    if (canExpenses) {
      const spent = expenseDomain(searchExpenses(records, sources, asked, now, { category: categoryName, income: (kind: IncomeKind) => t(`expenses.incomes.${kind}`) }), {
        title: (hit) => (hit.origin === "fees" ? t("expenses.feesLabel") : hit.label || (hit.flow === "income" ? t(`expenses.incomes.${hit.category as IncomeKind}`) : categoryName(hit.category))),
        sub: (hit) => `${formatDate(hit.at, locale)} · ${hit.flow === "income" ? "+" : ""}${formatAriary(hit.amountMga, locale)}`,
      });
      if (spent) found.push(spent);
    }
    return found.sort((a, b) => searchDomains.indexOf(a.domain) - searchDomains.indexOf(b.domain));
  }, [asked, built, canExpenses, records, sources, now, categoryName, locale, t]);

  const remember = (value: string) => {
    setRecent(recentSearches.add(value));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAsked(query);
    remember(query);
  };
  const ready = normalize(asked).length >= MIN_QUERY;

  return (
    <>
      <Seo title={`${t("search.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("search.title")}</h1>
          <p>{t("search.lead")}</p>
        </motion.header>

        <motion.form variants={rise} role="search" className={styles.bar} onSubmit={submit}>
          <Search size={20} aria-hidden />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.field")}
            enterKeyHint="search"
            autoComplete="off"
            autoFocus
          />
          {query && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              aria-label={t("search.clear")}
            >
              <X size={16} />
            </button>
          )}
        </motion.form>

        {!ready ? (
          <motion.div variants={rise} className={styles.start}>
            {recent.length > 0 ? (
              <section aria-labelledby="recent-title">
                <div className={styles.recentHead}>
                  <h2 id="recent-title">{t("search.recent")}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setRecent([]);
                      recentSearches.clear();
                    }}
                  >
                    {t("search.clearRecent")}
                  </button>
                </div>
                <ul className={styles.recent}>
                  {recent.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(item);
                          setAsked(item);
                          input.current?.focus();
                        }}
                      >
                        <History size={14} aria-hidden /> {item}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className={styles.hint}>{t("search.hint")}</p>
            )}
            <p className={styles.hint}>{t("search.hintAmount")}</p>
          </motion.div>
        ) : results.length === 0 ? (
          <motion.p variants={rise} className={styles.none} role="status">
            {t("search.none", { query: asked.trim() })}
          </motion.p>
        ) : (
          <div className={styles.results}>
            <p className="visually-hidden" role="status">
              {t("search.found", { count: results.reduce((sum, result) => sum + result.count, 0) })}
            </p>
            {results.map((result) => {
              const Icon = icons[result.domain] ?? BookOpen;
              return (
                <motion.section key={result.domain} variants={rise} className={styles.group} aria-labelledby={`search-${result.domain}`}>
                  <div className={styles.groupHead}>
                    <Icon size={18} aria-hidden />
                    <h2 id={`search-${result.domain}`}>{t(`search.domains.${result.domain}`)}</h2>
                    <span className={styles.count}>{result.count}</span>
                  </div>
                  <ul className={styles.hits}>
                    {result.hits.map((hit) => (
                      <li key={hit.key}>
                        <Link href={hit.href} className={styles.hit} onClick={() => remember(asked)}>
                          <strong>{hit.title}</strong>
                          {hit.sub && <small>{hit.sub}</small>}
                          {hit.excerpt && <Excerpt segments={hit.excerpt} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {result.count > result.hits.length && (
                    <Link href={seeAllHref(result.domain, asked)} className={styles.all} onClick={() => remember(asked)}>
                      {t("search.seeAll", { count: result.count })} <ArrowRight size={14} aria-hidden />
                    </Link>
                  )}
                </motion.section>
              );
            })}
          </div>
        )}
      </motion.div>
    </>
  );
}

/** A short piece of text with what was found in bold. */
function Excerpt({ segments }: { segments: Segment[] }) {
  return (
    <span className={styles.excerpt}>
      {segments.map((segment, index) => (segment.bold ? <b key={index}>{segment.text}</b> : <span key={index}>{segment.text}</span>))}
    </span>
  );
}
