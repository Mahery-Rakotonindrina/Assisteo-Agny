import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { IdCard, Search, UserRound } from "lucide-react";
import { AdminAccountCard } from "@/components/AdminAccountCard";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import shared from "@/components/AdminSubscriptions/AdminSubscriptions.module.scss";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, toDateInput } from "@/lib/format";
import { rise } from "@/lib/motion";
import type { AdminAccount, AdminAccountsResponse } from "@/pages/api/admin/accounts";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";

/** Everyone, those with a plan running, those without, the admins. */
const filters = ["all", "paying", "free", "admins"] as const;
type Filter = (typeof filters)[number];
const PAGE = 50;

const timestamp = () => Date.now();

const matches = (account: AdminAccount, filter: Filter) =>
  filter === "all"
    ? true
    : filter === "admins"
      ? account.plan === "unlimited"
      : filter === "free"
        ? account.plan === "free"
        : account.plan !== "free" && account.plan !== "unlimited";

/** Every account, not only the subscribers: when they signed up, came back, and their plan. */
export function AdminAccounts({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [failure, setFailure] = useState<"error" | "disabled" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [now, setNow] = useState(timestamp);
  const [cardEmail, setCardEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminAccountsResponse>("/api/admin/accounts", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (cancelled) return;
        setAccounts(result.accounts);
        setNow(timestamp());
      })
      .catch((error) => {
        if (!cancelled) setFailure(error instanceof ApiError && error.status === 503 ? "disabled" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const header = (
    <div>
      <h2 className={shared.title}>
        <UserRound size={18} /> {t("admin.accounts.title")}
      </h2>
      <p className={shared.subtitle}>{t("admin.accounts.subtitle")}</p>
    </div>
  );
  if (failure) {
    return (
      <motion.section variants={rise} initial="hidden" animate="show" className={shared.card}>
        {header}
        <p className={shared.error}>{failure === "disabled" ? t("admin.subs.disabled") : t("admin.error")}</p>
      </motion.section>
    );
  }
  if (!accounts) return <div className={shared.card} aria-busy />;

  const thisMonth = toDateInput(now).slice(0, 7);
  const newThisMonth = accounts.filter((account) => toDateInput(Date.parse(account.createdAt)).slice(0, 7) === thisMonth).length;
  const withPlan = accounts.filter((account) => account.plan !== "free").length;
  const needle = query.trim().toLowerCase();
  const visible = accounts.filter((account) => matches(account, filter) && (!needle || (account.email ?? "").includes(needle)));
  const counts = Object.fromEntries(filters.map((value) => [value, accounts.filter((account) => matches(account, value)).length])) as Record<Filter, number>;

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={shared.card}>
      {header}

      <div className={shared.summary}>
        <div>
          <strong>{accounts.length}</strong>
          <span>{t("admin.accounts.total")}</span>
        </div>
        <div>
          <strong>{newThisMonth}</strong>
          <span>{t("admin.accounts.newThisMonth")}</span>
        </div>
        <div>
          <strong>{withPlan}</strong>
          <span>{t("admin.accounts.withPlan")}</span>
        </div>
      </div>

      {accounts.length > 0 && (
        <label className={shared.search}>
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
            placeholder={t("admin.subs.search")}
            aria-label={t("admin.subs.search")}
          />
        </label>
      )}

      {accounts.length > 0 && (
        <div className={shared.filters} role="group" aria-label={t("admin.subs.filter")}>
          {filters
            .filter((value) => value === "all" || counts[value] > 0)
            .map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setShown(PAGE);
                }}
              >
                {t(`admin.accounts.filters.${value}`)} <span>{counts[value]}</span>
              </button>
            ))}
        </div>
      )}

      {accounts.length === 0 && <p className={shared.empty}>{t("admin.accounts.empty")}</p>}
      {accounts.length > 0 && visible.length === 0 && <p className={shared.empty}>{t("admin.subs.noMatch")}</p>}

      <ul className={shared.people}>
        {visible.slice(0, shown).map((account) => (
          <li key={account.id} className={shared.person} data-plan={account.plan === "free" ? undefined : account.plan}>
            <div className={shared.personSummary}>
              <span className={shared.personText}>
                <strong>{account.email ?? t("admin.accounts.noEmail")}</strong>
                <small>
                  {[
                    t("admin.accounts.joined", { date: formatDate(Date.parse(account.createdAt), locale) }),
                    account.lastSignInAt ? t("admin.accounts.seen", { date: formatDate(Date.parse(account.lastSignInAt), locale) }) : t("admin.accounts.neverSeen"),
                    account.providers.filter((provider) => provider !== "email").join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              {account.plan !== "free" && <PlanBadge plan={account.plan} />}
              {account.email && (
                <Button size="md" variant="ghost" icon={<IdCard />} onClick={() => setCardEmail(account.email)} aria-label={`${t("admin.card.open")} · ${account.email}`}>
                  {t("admin.card.open")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {visible.length > shown && (
        <Button variant="ghost" block onClick={() => setShown(shown + PAGE)}>
          {t("admin.accounts.more", { count: visible.length - shown })}
        </Button>
      )}
      <AdminAccountCard token={token} email={cardEmail} onClose={() => setCardEmail(null)} />
    </motion.section>
  );
}
