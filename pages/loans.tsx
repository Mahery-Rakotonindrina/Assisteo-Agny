import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, HandCoins, Plus, Search } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { AckSheet, ExportSheet, LoanSheet, PersonDetail, RepaySheet } from "@/components/Loans";
import styles from "@/components/Loans/Loans.module.scss";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Seo } from "@/components/Seo";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useLoans } from "@/hooks/useLoans";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { loanStats, personLoans } from "@/lib/loanReport";
import { loanMoney, loansByPerson, loanTotal, loanTotals, personKey, repaidAt, repaidLoans, searchPeople, type Loan, type LoanDirection } from "@/lib/loans";
import { rise, stagger } from "@/lib/motion";

/** The search shows once the list is longer than this. */
const SEARCH_FROM = 5;

type Editing = { kind: "add"; person?: string; phone?: string } | { kind: "edit"; loan: Loan } | null;

/**
 * "Prêts": the money lent ("On me doit") and borrowed ("Je dois"), by person.
 * Neither an expense nor an income: nothing here reaches "Mes dépenses".
 * Admin only while tested, hidden from the other plans (no lock, no label);
 * without the feature, loans already written stay visible, read only.
 */
export default function LoansPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { plan, has } = usePlan();
  // Null on the server and at hydration: nothing is shown until the plan is read.
  const known = plan !== null;
  const { loans, isLoading } = useLoans();
  const allowed = has("loans");

  return (
    <>
      <Seo title={`${t("loans.title")} · ${t("meta.title")}`} noindex />
      {!known || isLoading ? null : allowed || loans.length > 0 ? (
        <Loans loans={loans} readOnly={!allowed} direction={router.query.dir === "borrowed" ? "borrowed" : "lent"} />
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

function Loans({ loans, readOnly, direction }: { loans: Loan[]; readOnly: boolean; direction: LoanDirection }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const now = useNow(60_000);
  const [search, setSearch] = useState("");
  const [showRepaid, setShowRepaid] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [repaying, setRepaying] = useState<Loan | null>(null);
  const [acknowledging, setAcknowledging] = useState<Loan | null>(null);
  // "all": every loan; a name: that person's loans, both ways.
  const [exporting, setExporting] = useState<{ person?: string } | null>(null);
  const [showStats, setShowStats] = useState(false);
  const money = (value: number) => loanMoney(value, locale);

  const people = useMemo(() => loansByPerson(loans, direction, now), [loans, direction, now]);
  const totals = loanTotals(people);
  const owing = people.filter((person) => person.open > 0);
  const shown = owing.length > SEARCH_FROM ? searchPeople(owing, search) : owing;
  const repaid = repaidLoans(loans, direction, now);
  const openKey = typeof router.query.person === "string" ? router.query.person : null;
  const opened = openKey ? people.find((person) => person.key === openKey) : undefined;
  // The loan being repaid, kept fresh as the list changes.
  const repayLoan = repaying ? (loans.find((loan) => loan.id === repaying.id) ?? null) : null;
  const ackLoan = acknowledging ? (loans.find((loan) => loan.id === acknowledging.id) ?? null) : null;
  const exported = exporting?.person ? personLoans(loans, exporting.person) : loans;
  const stats = useMemo(() => loanStats(loans, direction, now), [loans, direction, now]);
  const year = new Date(now).getFullYear();

  const go = (query: { dir?: LoanDirection; person?: string | null }) => {
    const dir = query.dir ?? direction;
    const person = query.person === undefined ? openKey : query.person;
    void router.replace({ pathname: router.pathname, query: { ...(dir === "borrowed" && { dir }), ...(person && { person }) } }, undefined, { shallow: true, scroll: !isDesktop });
  };

  const list = (
    <>
      <motion.div variants={rise}>
        <SegmentedControl
          ariaLabel={t("loans.directionLabel")}
          value={direction}
          onChange={(dir) => {
            setSearch("");
            go({ dir, person: null });
          }}
          options={[
            { value: "lent", label: t("loans.directions.lent") },
            { value: "borrowed", label: t("loans.directions.borrowed") },
          ]}
        />
      </motion.div>

      {readOnly && (
        <motion.p variants={rise} className={styles.hint}>
          {t("loans.readOnly")}
        </motion.p>
      )}

      {owing.length > 0 && (
        <motion.div variants={rise} className={styles.summary} data-testid="loans-summary">
          <span>{t(`loans.summary.${direction}`)}</span>
          <strong data-testid="loans-total">{money(totals.total)}</strong>
          <small>
            {totals.people === 1 ? t("loans.summary.peopleOne") : t("loans.summary.people", { count: totals.people })}
            {totals.late > 0 && (
              <>
                {" · "}
                <em data-testid="loans-late">{t("loans.summary.late", { amount: money(totals.late) })}</em>
              </>
            )}
          </small>
        </motion.div>
      )}

      {!readOnly && (
        <motion.div variants={rise}>
          <Button size="lg" block icon={<Plus />} onClick={() => setEditing({ kind: "add" })}>
            {t(`loans.add.${direction}`)}
          </Button>
        </motion.div>
      )}

      {loans.length > 0 && (
        <motion.div variants={rise}>
          <Button variant="ghost" block icon={<Download />} onClick={() => setExporting({})}>
            {t("loans.export.button")}
          </Button>
        </motion.div>
      )}

      {owing.length === 0 && repaid.length === 0 ? (
        <motion.div variants={rise}>
          <EmptyState title={t(`loans.empty.${direction}.title`)} body={t(`loans.empty.${direction}.body`)} />
        </motion.div>
      ) : (
        <>
          {owing.length > SEARCH_FROM && (
            <motion.label variants={rise} className={styles.search}>
              <Search size={16} />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("loans.search")} aria-label={t("loans.search")} />
            </motion.label>
          )}
          {owing.length === 0 && <motion.p variants={rise} className={styles.hint}>{t(`loans.allRepaid.${direction}`)}</motion.p>}
          {owing.length > 0 && shown.length === 0 && <motion.p variants={rise} className={styles.hint}>{t("loans.noMatch")}</motion.p>}
          <motion.ul variants={rise} className={styles.people}>
            {shown.map((person) => (
              <li key={person.key}>
                <button type="button" className={styles.person} data-active={person.key === openKey || undefined} onClick={() => go({ person: person.key })}>
                  <span className={styles.avatar} aria-hidden>
                    {person.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.text}>
                    <strong>{person.name}</strong>
                    <small>
                      {person.open === 1 ? t("loans.openOne") : t("loans.open", { count: person.open })}
                      {person.next?.scheduled
                        ? ` · ${t("loans.nextDue", { amount: money(person.next.amountMga), date: formatDate(person.next.dueAt, locale) })}`
                        : person.nextDue !== undefined && ` · ${t("loans.dueOn", { date: formatDate(person.nextDue, locale) })}`}
                    </small>
                  </span>
                  <span className={styles.amount}>
                    <strong>{money(person.remaining)}</strong>
                    {person.late && <span className={styles.lateBadge}>{t("loans.late")}</span>}
                  </span>
                  <ChevronRight size={18} className={styles.chevron} />
                </button>
              </li>
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
                      <button type="button" className={styles.person} data-repaid onClick={() => go({ person: personKey(loan.person) })}>
                        <span className={styles.text}>
                          <strong>{loan.person}</strong>
                          <small>{t("loans.repaidOn", { date: formatDate(repaidAt(loan), locale) })}</small>
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
        </>
      )}

      {loans.length > 0 && (
        <motion.div variants={rise} className={styles.repaid}>
          <button type="button" className={styles.fold} aria-expanded={showStats} onClick={() => setShowStats(!showStats)}>
            <span>{t("loans.stats.title", { year })}</span>
            <ChevronDown size={18} data-open={showStats || undefined} />
          </button>
          {showStats &&
            (stats.count === 0 ? (
              <p className={styles.hint}>{t("loans.stats.empty")}</p>
            ) : (
              <div className={styles.stats} data-testid="loans-stats">
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
            ))}
        </motion.div>
      )}
    </>
  );

  const detail = opened && (
    <PersonDetail
      key={`${direction}-${opened.key}`}
      person={opened}
      now={now}
      readOnly={readOnly}
      onBack={() => go({ person: null })}
      onAdd={() => setEditing({ kind: "add", person: opened.name, phone: opened.phone })}
      onEdit={(loan) => setEditing({ kind: "edit", loan })}
      onRepay={setRepaying}
      onExport={() => setExporting({ person: opened.name })}
      onAck={setAcknowledging}
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

      <LoanSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        draft={{ direction, person: editing?.kind === "add" ? editing.person : undefined, phone: editing?.kind === "add" ? editing.phone : undefined }}
        loan={editing?.kind === "edit" ? editing.loan : undefined}
        loans={loans}
      />
      <RepaySheet open={repayLoan !== null} onClose={() => setRepaying(null)} loan={repayLoan} />
      <AckSheet open={ackLoan !== null} onClose={() => setAcknowledging(null)} loan={ackLoan} />
      <ExportSheet open={exporting !== null} onClose={() => setExporting(null)} loans={exported} person={exporting?.person} />
    </motion.div>
  );
}
