import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, HandCoins, Home, Paperclip, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { AckSheet, ExportSheet, LoanSheet, NewLoanSheet, PersonDetail, RepaySheet } from "@/components/Loans";
import { LoanReminderSetting } from "@/components/Loans/LoanReminderSetting";
import type { LoanDraft } from "@/components/Loans/LoanSheet";
import styles from "@/components/Loans/Loans.module.scss";
import { BadgePill } from "@/components/Loans/PersonDetail";
import { Seo } from "@/components/Seo";
import { useHousehold } from "@/hooks/useHousehold";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useLoanPockets } from "@/hooks/useLoanPockets";
import { useHouseholdLoans, useLoanSharing, useLoans } from "@/hooks/useLoans";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { personBadge } from "@/lib/loanLedger";
import { hasProofs } from "@/lib/loanProof";
import { loanStats, personLoans } from "@/lib/loanReport";
import { comparePeople, loanDirections, loanMoney, loansByPerson, loanTotal, loanTotals, personKey, repaidAt, repaidLoans, searchPeople, type Loan, type LoanDirection, type PersonLoans, type Repayment } from "@/lib/loans";
import { rise, stagger } from "@/lib/motion";
import { householdStore } from "@/services/household";
import { householdBook, personalBook, type LoanBook } from "@/services/loanBook";

/** The search shows once the list is longer than this. */
const SEARCH_FROM = 5;

/** The colours of the initials, picked from the name. */
const TONES = ["--cat-document", "--cat-food", "--cat-object", "--cat-vehicle", "--cat-plant", "--cat-parcel", "--cat-list"];
const toneOf = (key: string) => `var(${TONES[[...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TONES.length]})`;

type Scope = "personal" | "household";

/** The household's side of the screen, for a member with "Prêts". */
type HouseholdSide = {
  /** Null before migration 0012: "bientôt disponible". */
  book: LoanBook | null;
  /** Who wrote a loan or a repayment: the member's name, else the one kept on it (an account deleted since). */
  authorOf: (row: Loan | Repayment) => string | undefined;
};

type Editing = ({ kind: "add" } & LoanDraft) | { kind: "edit"; loan: Loan } | null;

const asDirection = (value: unknown): LoanDirection | undefined => (value === "lent" || value === "borrowed" ? value : undefined);

/**
 * "Prêts": the money lent ("On te doit") and borrowed ("Tu dois"), by person,
 * and each person's account. Neither an expense nor an income: nothing here
 * reaches "Mes dépenses". Admin only while tested, hidden from the other
 * plans (no lock, no label); without the feature, loans already written stay
 * visible, read only.
 */
export default function LoansPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { plan, has } = usePlan();
  // Null on the server and at hydration: nothing is shown until the plan is read.
  const known = plan !== null;
  const { loans, isLoading } = useLoans();
  const allowed = has("loans");
  const canRemind = has("reminders");
  // "Foyer": a member of a household, with "Prêts" (lib/householdLoans.ts).
  const info = useHousehold();
  const sharing = useLoanSharing();
  const householdLoans = useHouseholdLoans();
  const members = info?.household?.members;
  const me = info?.userId ?? null;
  const householdReady = (sharing.kind === "ready" || sharing.kind === "soon") && sharing.household;
  const side = useMemo<HouseholdSide | undefined>(() => {
    if (!members) return undefined;
    return {
      book: householdReady ? householdBook(me, members.find((member) => member.userId === me)?.label) : null,
      authorOf: (row) => {
        const { userId, authorName } = row as { userId?: string; authorName?: string };
        return members.find((member) => member.userId === (userId ?? me))?.label ?? authorName;
      },
    };
  }, [members, me, householdReady]);
  const household = allowed ? side : undefined;

  // Fresh when opened, like the household's budget (a member may have left…).
  useEffect(() => {
    if (allowed) void householdStore.refresh();
  }, [allowed]);
  const scope: Scope = household && router.query.scope === "household" ? "household" : "personal";

  return (
    <>
      <Seo title={`${t("loans.title")} · ${t("meta.title")}`} noindex />
      {!known || isLoading ? null : allowed || loans.length > 0 ? (
        <Loans
          loans={scope === "household" ? householdLoans : loans}
          personalLoans={loans}
          readOnly={!allowed || (scope === "household" && !household?.book)}
          planEnded={!allowed}
          canRemind={canRemind}
          scope={scope}
          household={household}
        />
      ) : (
        <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
          <motion.header variants={rise} className={styles.header}>
            <h1>{t("loans.title")}</h1>
            <p>{t("loans.unavailable")}</p>
          </motion.header>
        </motion.div>
      )}
    </>
  );
}

type LoansProps = { loans: Loan[]; personalLoans: Loan[]; readOnly: boolean; planEnded: boolean; canRemind: boolean; scope: Scope; household?: HouseholdSide };

function Loans({ loans, personalLoans, readOnly, planEnded, canRemind, scope, household }: LoansProps) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  // With "Mes dépenses" too: the pocket the money leaves, or comes into.
  const allPockets = useLoanPockets();
  // The household's loans never move the personal pockets.
  const pockets = scope === "personal" ? allPockets : undefined;
  const book = scope === "household" ? (household?.book ?? personalBook) : personalBook;
  const authorOf = scope === "household" ? household?.authorOf : undefined;
  const isDesktop = useIsDesktop();
  const now = useNow(60_000);
  const [search, setSearch] = useState("");
  const [showRepaid, setShowRepaid] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  // The loans being repaid (one, or a person's open ones), by id: kept fresh as the list changes.
  const [repaying, setRepaying] = useState<string[] | null>(null);
  const [acknowledging, setAcknowledging] = useState<Loan | null>(null);
  // "all": every loan; a name: that person's loans, both ways.
  const [exporting, setExporting] = useState<{ person?: string } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const money = (value: number) => loanMoney(value, locale);

  // "?show=": the side picked on the top card; an older "?dir=" without a person meant the same.
  const filter = asDirection(router.query.show) ?? (router.query.person ? undefined : asDirection(router.query.dir));
  const openKey = typeof router.query.person === "string" ? router.query.person : null;
  const openDirection = asDirection(router.query.dir) ?? "lent";
  const sides = useMemo(() => ({ lent: loansByPerson(loans, "lent", now), borrowed: loansByPerson(loans, "borrowed", now) }), [loans, now]);
  const totals = { lent: loanTotals(sides.lent), borrowed: loanTotals(sides.borrowed) };
  const directions = filter ? [filter] : loanDirections;
  const owing = directions.flatMap((direction) => sides[direction].filter((person) => person.open > 0)).sort(comparePeople);
  const shown = owing.length > SEARCH_FROM ? searchPeople(owing, search) : owing;
  const repaid = directions.flatMap((direction) => repaidLoans(loans, direction, now)).sort((a, b) => repaidAt(b) - repaidAt(a));
  const opened = openKey ? sides[openDirection].find((person) => person.key === openKey) : undefined;
  const otherWay = opened ? sides[openDirection === "lent" ? "borrowed" : "lent"].find((person) => person.key === opened.key && person.remaining > 0) : undefined;
  // "?nudge=1": opened from the "Le relancer ?" notification.
  const nudge = router.query.nudge === "1";
  const repayLoans = repaying ? loans.filter((loan) => repaying.includes(loan.id)) : null;
  const ackLoan = acknowledging ? (loans.find((loan) => loan.id === acknowledging.id) ?? null) : null;
  const exported = exporting?.person ? personLoans(loans, exporting.person) : loans;
  const year = new Date(now).getFullYear();
  const statsSides = directions.map((direction) => ({ direction, stats: loanStats(loans, direction, now) })).filter((item) => filter || item.stats.count > 0);
  const pocketName = (id: string) => allPockets?.wallets.find((wallet) => wallet.id === id)?.name;

  const go = (query: { show?: LoanDirection | null; person?: { key: string; direction: LoanDirection } | null; scope?: Scope }) => {
    const show = query.show === undefined ? filter : query.show;
    const person = query.person === undefined ? (opened ? { key: opened.key, direction: openDirection } : null) : query.person;
    const nextScope = query.scope ?? scope;
    void router.replace(
      {
        pathname: router.pathname,
        query: { ...(nextScope === "household" && { scope: nextScope }), ...(show && { show }), ...(person && { person: person.key, ...(person.direction === "borrowed" && { dir: "borrowed" }) }) },
      },
      undefined,
      { shallow: true, scroll: !isDesktop },
    );
  };

  const newButton = !readOnly && (
    <Button size="lg" block icon={<Plus />} onClick={() => setAdding(true)} data-testid="loans-new">
      {t("loans.new.button")}
    </Button>
  );

  const list = (
    <>
      {loans.length > 0 && (
        <motion.div variants={rise} className={styles.summary} data-testid="loans-summary">
          {loanDirections.map((direction) => (
            <button
              key={direction}
              type="button"
              className={styles.summarySide}
              data-direction={direction}
              aria-pressed={filter === direction}
              onClick={() => {
                setSearch("");
                go({ show: filter === direction ? null : direction, person: null });
              }}
              data-testid={`loans-side-${direction}`}
            >
              <span>{t(`loans.summary.${direction}`)}</span>
              <strong data-testid={`loans-total-${direction}`}>{money(totals[direction].total)}</strong>
              <small>
                {totals[direction].people === 0
                  ? t(`loans.summary.nobody.${direction}`)
                  : totals[direction].people === 1
                    ? t("loans.summary.peopleOne")
                    : t("loans.summary.people", { count: totals[direction].people })}
                {totals[direction].late > 0 && (
                  <>
                    {" · "}
                    <em data-testid={`loans-late-${direction}`}>{t("loans.summary.late", { amount: money(totals[direction].late) })}</em>
                  </>
                )}
              </small>
            </button>
          ))}
        </motion.div>
      )}

      {readOnly && scope === "personal" && (
        <motion.p variants={rise} className={styles.hint}>
          {t("loans.readOnly")}
        </motion.p>
      )}

      {loans.length > 0 && newButton && <motion.div variants={rise}>{newButton}</motion.div>}

      {(owing.length > SEARCH_FROM || household || filter) && (
        <motion.div variants={rise} className={styles.toolbar}>
          {owing.length > SEARCH_FROM && (
            <label className={styles.search}>
              <Search size={16} aria-hidden />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("loans.search")} aria-label={t("loans.search")} />
            </label>
          )}
          {filter && (
            <button type="button" className={styles.filterChip} aria-pressed="true" title={t("loans.filter.clear")} onClick={() => go({ show: null, person: null })} data-testid="loans-filter">
              {t(`loans.filter.${filter}`)} <X size={15} aria-hidden />
            </button>
          )}
          {household && (
            <button
              type="button"
              className={styles.filterChip}
              aria-pressed={scope === "household"}
              onClick={() => {
                setSearch("");
                go({ scope: scope === "household" ? "personal" : "household", person: null });
              }}
              data-testid="loans-household"
            >
              <Home size={15} aria-hidden /> {t("loans.household.chip")}
            </button>
          )}
        </motion.div>
      )}
      {scope === "household" && (
        <motion.p variants={rise} className={styles.hint} data-testid="loans-household-hint">
          {household?.book ? t("loans.household.hint") : t("loans.household.soon")}
        </motion.p>
      )}

      {loans.length === 0 ? (
        <motion.div variants={rise}>
          <EmptyState title={t("loans.empty.title")} body={t("loans.empty.body")} action={newButton || undefined} />
        </motion.div>
      ) : (
        <>
          {owing.length === 0 && <motion.p variants={rise} className={styles.hint}>{filter ? t(`loans.empty.${filter}`) : t("loans.allRepaid")}</motion.p>}
          {owing.length > 0 && shown.length === 0 && <motion.p variants={rise} className={styles.hint}>{t("loans.noMatch")}</motion.p>}
          <motion.ul variants={rise} className={styles.people}>
            {shown.map((person) => (
              <PersonCard key={`${person.loans[0].direction}:${person.key}`} person={person} now={now} active={opened === person} onOpen={() => go({ person: { key: person.key, direction: person.loans[0].direction } })} />
            ))}
          </motion.ul>

          {repaid.length > 0 && (
            <motion.div variants={rise} className={styles.repaid}>
              <button type="button" className={styles.fold} aria-expanded={showRepaid} onClick={() => setShowRepaid(!showRepaid)}>
                <span>{t("loans.repaidSection", { count: repaid.length })}</span>
                <ChevronDown size={18} data-open={showRepaid || undefined} />
              </button>
              {showRepaid && (
                <ul className={styles.people}>
                  {repaid.map((loan) => (
                    <li key={loan.id}>
                      <button type="button" className={styles.person} data-repaid onClick={() => go({ person: { key: personKey(loan.person), direction: loan.direction } })}>
                        <span className={styles.text}>
                          <strong>{loan.person}</strong>
                          <small>
                            {t(`loans.directions.${loan.direction}`)} · {t("loans.repaidOn", { date: formatDate(repaidAt(loan), locale) })}
                          </small>
                        </span>
                        <span className={styles.amount}>
                          <strong>{money(loanTotal(loan))}</strong>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}

          <motion.div variants={rise} className={styles.repaid}>
            <button type="button" className={styles.fold} aria-expanded={showStats} onClick={() => setShowStats(!showStats)}>
              <span>{t("loans.stats.title", { year })}</span>
              <ChevronDown size={18} data-open={showStats || undefined} />
            </button>
            {showStats &&
              (statsSides.every((item) => item.stats.count === 0) ? (
                <p className={styles.hint}>{t("loans.stats.empty")}</p>
              ) : (
                statsSides.map(({ direction, stats }) => (
                  <div key={direction} className={styles.stats} data-testid="loans-stats">
                    <div className={styles.statsWide}>
                      <strong>{t(`loans.directions.${direction}`)}</strong>
                    </div>
                    <div>
                      <span>{t(`loans.stats.total.${direction}`)}</span>
                      <strong>{money(stats.totalMga)}</strong>
                    </div>
                    <div>
                      <span>{t(`loans.stats.paid.${direction}`)}</span>
                      <strong>{money(stats.paidMga)}</strong>
                    </div>
                    <div>
                      <span>{t(`loans.stats.remaining.${direction}`)}</span>
                      <strong>{money(stats.remainingMga)}</strong>
                    </div>
                    <div>
                      <span>{t("loans.stats.count")}</span>
                      <strong>{stats.count}</strong>
                    </div>
                    <div className={styles.statsWide}>
                      <span>{t("loans.stats.averageDays")}</span>
                      <strong>
                        {stats.averageDays === null ? t("loans.stats.noneYet") : stats.averageDays === 1 ? t("loans.stats.dayOne") : t("loans.stats.days", { count: stats.averageDays })}
                      </strong>
                    </div>
                    {stats.late.length > 0 && (
                      <>
                        <div className={styles.statsWide}>
                          <span>{t(`loans.stats.late.${direction}`)}</span>
                        </div>
                        <ol>
                          {stats.late.map((person) => (
                            <li key={person.name}>
                              {person.name} · {money(person.lateMga)}
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                ))
              ))}
          </motion.div>

          <motion.div variants={rise}>
            <Button variant="ghost" block icon={<Download />} onClick={() => setExporting({})}>
              {t("loans.export.button")}
            </Button>
          </motion.div>
        </>
      )}

      {!readOnly && canRemind && scope === "personal" && (
        <motion.div variants={rise}>
          <LoanReminderSetting />
        </motion.div>
      )}
    </>
  );

  const detail = opened && (
    <PersonDetail
      key={`${scope}-${openDirection}-${opened.key}`}
      person={opened}
      other={otherWay}
      now={now}
      readOnly={readOnly}
      planEnded={planEnded}
      onBack={() => go({ person: null })}
      onAdd={() => setEditing({ kind: "add", direction: openDirection, person: opened.name, phone: opened.phone })}
      onEdit={(loan) => setEditing({ kind: "edit", loan })}
      onRepay={(chosen) => setRepaying(chosen.map((loan) => loan.id))}
      onExport={() => setExporting({ person: opened.name })}
      onAck={setAcknowledging}
      onOther={otherWay ? () => go({ person: { key: otherWay.key, direction: openDirection === "lent" ? "borrowed" : "lent" } }) : undefined}
      nudge={nudge}
      book={book}
      authorOf={authorOf}
      pocketName={pocketName}
    />
  );

  return (
    <motion.div className={styles.page} data-split={(isDesktop && Boolean(opened)) || undefined} variants={stagger} initial="hidden" animate="show">
      <motion.header variants={rise} className={styles.header}>
        <h1>
          <HandCoins size={28} aria-hidden /> {t("loans.title")}
        </h1>
        <p>{t("loans.subtitle")}</p>
      </motion.header>

      {/* On a computer the person opens next to the list; on a phone, instead of it. */}
      {isDesktop && opened ? (
        <div className={styles.split}>
          <div className={styles.column}>{list}</div>
          <motion.div variants={rise} className={styles.column}>
            {detail}
          </motion.div>
        </div>
      ) : opened ? (
        <motion.div variants={rise}>{detail}</motion.div>
      ) : (
        list
      )}

      <NewLoanSheet
        open={adding}
        onClose={() => setAdding(false)}
        onPick={(direction) => {
          setAdding(false);
          setEditing({ kind: "add", direction });
        }}
        onScan={
          scope === "personal"
            ? () => {
                setAdding(false);
                setEditing({ kind: "add", direction: filter ?? "lent", scan: true });
              }
            : undefined
        }
      />
      <LoanSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        draft={editing?.kind === "add" ? editing : { direction: editing?.loan.direction ?? "lent" }}
        loan={editing?.kind === "edit" ? editing.loan : undefined}
        loans={scope === "household" ? loans : personalLoans}
        pockets={allPockets}
        book={book}
        household={household && { book: household.book }}
      />
      <RepaySheet open={repayLoans !== null && repayLoans.length > 0} onClose={() => setRepaying(null)} loans={repayLoans} pockets={pockets} book={book} />
      <AckSheet open={ackLoan !== null} onClose={() => setAcknowledging(null)} loan={ackLoan} />
      <ExportSheet open={exporting !== null} onClose={() => setExporting(null)} loans={exported} person={exporting?.person} />
    </motion.div>
  );
}

/** A person on the list: their initial, their name, what is left in big, and their pill. */
function PersonCard({ person, now, active, onOpen }: { person: PersonLoans; now: number; active: boolean; onOpen: () => void }) {
  const { t, locale } = useTranslation();
  const direction = person.loans[0].direction;
  return (
    <li>
      <button type="button" className={styles.person} data-active={active || undefined} data-direction={direction} onClick={onOpen} data-testid="loan-person">
        <span className={styles.avatar} style={{ "--tone": toneOf(person.key) } as React.CSSProperties} aria-hidden>
          {person.name.charAt(0).toUpperCase()}
        </span>
        <span className={styles.text}>
          <strong>{person.name}</strong>
          <small>{t(`loans.card.${direction}`)}</small>
          <BadgePill badge={personBadge(person, now)} />
        </span>
        <span className={styles.amount}>
          <strong>{loanMoney(person.remaining, locale)}</strong>
          {person.loans.some(hasProofs) && <Paperclip size={14} className={styles.proofIcon} aria-label={t("loans.proofs.has")} data-testid="loan-has-proofs" />}
        </span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden />
      </button>
    </li>
  );
}
