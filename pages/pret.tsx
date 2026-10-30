import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Seo } from "@/components/Seo";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { sharedAsLoan, shareTokenFrom, type LoanShareSnapshot, type SharedLoansResponse } from "@/lib/loanShare";
import { loanMoney, loanNextDue, loanRemaining, loanStatus, loanTotal, scheduleState } from "@/lib/loans";
import { httpClient } from "@/services/httpClient";
import styles from "@/styles/SharedLoan.module.scss";
import { ApiError } from "@/types/api";

type View = { kind: "loading" } | { kind: "missing" } | { kind: "gone" } | { kind: "error" } | { kind: "shown"; snapshot: LoanShareSnapshot };

/**
 * "Ce qu'il reste à rendre": the page a borrower opens from the link the
 * lender sent (/pret?t=<token>), without an account and read only. A static
 * page that reads the token from the address (the APK's export has no
 * dynamic routes); the copy comes from pages/api/loans/share.ts. Kept out of
 * search results.
 */
export default function SharedLoanPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const token = router.isReady ? shareTokenFrom(router.query.t) : null;

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    const show = (next: View) => {
      if (!cancelled) setView(next);
    };
    if (!token) {
      // A link cut short (copied in part…): nothing to ask the server.
      queueMicrotask(() => show({ kind: "missing" }));
      return () => {
        cancelled = true;
      };
    }
    httpClient
      .get<SharedLoansResponse>(`/api/loans/share?t=${encodeURIComponent(token)}`)
      .then((response) => show({ kind: "shown", snapshot: response.snapshot }))
      .catch((error) => show({ kind: error instanceof ApiError && error.status === 404 ? "gone" : "error" }));
    return () => {
      cancelled = true;
    };
  }, [router.isReady, token]);

  return (
    <>
      <Seo title={`${t("loanShare.metaTitle")} · ${t("meta.title")}`} noindex />
      <div className={styles.page}>
        <header className={styles.top}>
          <Logo size={32} />
        </header>
        {view.kind === "loading" && (
          <p className={styles.hint} role="status">
            {t("loanShare.loading")}
          </p>
        )}
        {view.kind === "missing" && <Notice title={t("loanShare.missing.title")} body={t("loanShare.missing.body")} testId="shared-loan-missing" />}
        {view.kind === "gone" && <Notice title={t("loanShare.gone.title")} body={t("loanShare.gone.body")} testId="shared-loan-gone" />}
        {view.kind === "error" && <Notice title={t("loanShare.error.title")} body={t("loanShare.error.body")} testId="shared-loan-error" />}
        {view.kind === "shown" && <Summary snapshot={view.snapshot} />}
        <footer className={styles.footer}>
          <span>{t("loanShare.sentWith")}</span>
          <Link href="/decouvrir">{t("loanShare.discover")}</Link>
        </footer>
      </div>
    </>
  );
}

function Notice({ title, body, testId }: { title: string; body: string; testId: string }) {
  return (
    <section className={styles.card} data-testid={testId}>
      <h1>{title}</h1>
      <p className={styles.hint}>{body}</p>
    </section>
  );
}

function Summary({ snapshot }: { snapshot: LoanShareSnapshot }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const money = (value: number) => loanMoney(value, locale);
  const loans = snapshot.loans.map((loan) => ({ shared: loan, loan: sharedAsLoan(loan) }));
  const left = loans.reduce((sum, item) => sum + loanRemaining(item.loan), 0);
  const next = loans
    .map((item) => loanNextDue(item.loan, now))
    .filter((item) => item !== undefined)
    .sort((a, b) => a.dueAt - b.dueAt)[0];

  return (
    <>
      <section className={styles.card} data-testid="shared-loan">
        <h1>{t("loanShare.title")}</h1>
        <p className={styles.hint}>{t("loanShare.from", { lender: snapshot.lender, name: snapshot.borrower })}</p>
        <div className={styles.total}>
          <span>{t("loanShare.left")}</span>
          <strong data-testid="shared-loan-left">{money(left)}</strong>
          {next && <small>{t("loanShare.next", { amount: money(next.amountMga), date: formatDate(next.dueAt, locale) })}</small>}
        </div>
        <small className={styles.hint}>{t("loanShare.updated", { date: formatDate(snapshot.updatedAt, locale) })}</small>
      </section>

      {loans.map(({ shared, loan }, index) => {
        const status = loanStatus(loan, now);
        const installments = scheduleState(loan, now);
        return (
          <section key={index} className={styles.card} data-status={status} data-testid="shared-loan-card">
            <div className={styles.head}>
              <strong>{money(loanTotal(loan))}</strong>
              {status === "late" && <span className={styles.late}>{t("loans.late")}</span>}
              {status === "repaid" && <span className={styles.repaid}>{t("loans.detail.repaidBadge")}</span>}
            </div>
            <small className={styles.hint}>
              {t("loanShare.lentOn", { date: formatDate(shared.at, locale) })}
              {!installments.length && shared.dueAt !== undefined && ` · ${t("loans.dueOn", { date: formatDate(shared.dueAt, locale) })}`}
            </small>
            {shared.interestMga > 0 && (
              <small className={styles.hint}>
                {[t("loans.detail.principal.lent", { amount: money(shared.amountMga) }), t("loans.detail.interest", { amount: money(shared.interestMga) })].join(" · ")}
              </small>
            )}
            {installments.length > 0 && (
              <ul className={styles.lines} aria-label={t("loans.detail.schedule")}>
                {installments.map((item) => (
                  <li key={item.id}>
                    <span>{t("loans.detail.installment", { amount: money(item.amountMga), date: formatDate(item.dueAt, locale) })}</span>
                    <span className={styles.state} data-status={item.status}>
                      {t(`loans.detail.installmentStatus.${item.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {loan.repayments.length > 0 ? (
              <ul className={styles.lines} aria-label={t("loans.detail.repayments")}>
                {loan.repayments.map((repayment) => (
                  <li key={repayment.id}>
                    <span>{t("loans.detail.repaymentLine", { amount: money(repayment.amountMga), date: formatDate(repayment.at, locale) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <small className={styles.hint}>{t("loanShare.noRepayment")}</small>
            )}
            {status !== "repaid" && <p className={styles.leftOne}>{t("loans.detail.leftOne", { amount: money(loanRemaining(loan)) })}</p>}
          </section>
        );
      })}
      <p className={styles.hint}>{t("loanShare.readOnly")}</p>
    </>
  );
}
