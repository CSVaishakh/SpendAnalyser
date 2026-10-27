"use client";

import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FilterBar, PageHeader } from "@/components/shell";
import { Badge, ButtonLink, Button, Card, EmptyState, ErrorNote, Segmented, Select, Skeleton, SortHeader, Th, numCls, tdCls } from "@/components/ui";
import { exportUrl } from "@/lib/api";
import { count, fmtDate, inr, inrExact } from "@/lib/format";
import { useAccountNames, useMeta, useScope, useTransactions } from "@/lib/queries";
import { useApp } from "@/lib/state";

const PAGE_SIZE = 50;
type SortKey = "date" | "entity" | "category" | "channel" | "withdrawal" | "deposit" | "balance";

export function TransactionsView() {
  const { txn, setTxn, openEntity } = useApp();
  const meta = useMeta();
  const scope = useScope();
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({ key: "date", order: "desc" });
  const [page, setPage] = useState(1);
  const [showTransfers, setShowTransfers] = useState(false);
  const filters = {
    direction: txn.direction || null, category: txn.category || null, channel: txn.channel || null, app: txn.app || null,
    transfers: showTransfers ? "include" : "exclude",
  };
  const query = useTransactions({ ...filters, sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const names = useAccountNames();
  const showAccount = scope.account == null && names.size > 1;

  // Any change to what's being listed starts from the first page.
  const filterKey = JSON.stringify([filters, scope, sort]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPage(1), [filterKey]);

  const toggle = (key: SortKey) =>
    setSort((s) => ({ key, order: s.key === key ? (s.order === "desc" ? "asc" : "desc") : ["entity", "category", "channel"].includes(key) ? "asc" : "desc" }));

  const anyFilter = txn.direction || txn.category || txn.channel || txn.app;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every transaction from your statements, with the detected payee and category"
        actions={
          <ButtonLink href={exportUrl("/transactions/export", { ...scope, ...filters })} icon={Download} download>Export CSV</ButtonLink>
        }
      />
      <FilterBar />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Direction" value={txn.direction || "all"} onChange={(v) => setTxn({ direction: v === "all" ? "" : v })}
          options={[{ value: "all", label: "All" }, { value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
        <Select aria-label="Category" value={txn.category} onChange={(e) => setTxn({ category: e.target.value })}>
          <option value="">All categories</option>
          {meta.data?.used_categories.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select aria-label="Payment method" value={txn.channel} onChange={(e) => setTxn({ channel: e.target.value })}>
          <option value="">All payment methods</option>
          {meta.data?.channels.map((c) => <option key={c}>{c}</option>)}
        </Select>
        {(meta.data?.apps.length ?? 0) > 0 && (
          <Select aria-label="Paid with" value={txn.app} onChange={(e) => setTxn({ app: e.target.value })}>
            <option value="">Paid with any app</option>
            {meta.data?.apps.map((a) => <option key={a} value={a}>{a === "Unknown" ? "App unknown" : `Paid with ${a}`}</option>)}
          </Select>
        )}
        {anyFilter && <Button size="sm" variant="ghost" icon={X} onClick={() => setTxn({ direction: "", category: "", channel: "", app: "" })}>Clear</Button>}
        {data && (
          <span className="ml-auto text-xs text-ink-2">
            {count(data.total)} transactions · out <span className="font-medium text-ink">{inr(data.sum_withdrawal)}</span> · in{" "}
            <span className="font-medium text-ink">{inr(data.sum_deposit)}</span>
          </span>
        )}
      </div>
      {data && txn.category !== "Self transfers" && (data.transfers_hidden > 0 || (showTransfers && scope.account == null)) && (
        <p className="-mt-1 mb-3 text-xs text-muted">
          {showTransfers
            ? "Including transfers between your own accounts, so these totals are higher than the Overview's. "
            : `Matches the Overview: ${count(data.transfers_hidden)} transfers between your own accounts (${inr(data.transfers_hidden_amount)} each way) are left out. `}
          <button className="font-medium text-accent hover:underline" onClick={() => setShowTransfers(!showTransfers)}>
            {showTransfers ? "Hide them" : "Show them"}
          </button>
        </p>
      )}
      <ErrorNote error={query.error} />

      <Card flush>
        {query.isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState icon={ArrowLeftRight} title="No transactions match">Try a wider date range or clear the filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <SortHeader label="Date" active={sort.key === "date"} dir={sort.order} onClick={() => toggle("date")} />
                  <SortHeader label="Payee" active={sort.key === "entity"} dir={sort.order} onClick={() => toggle("entity")} />
                  <SortHeader label="Category" active={sort.key === "category"} dir={sort.order} onClick={() => toggle("category")} />
                  <Th>Narration</Th>
                  <SortHeader label="Money out" align="right" active={sort.key === "withdrawal"} dir={sort.order} onClick={() => toggle("withdrawal")} />
                  <SortHeader label="Money in" align="right" active={sort.key === "deposit"} dir={sort.order} onClick={() => toggle("deposit")} />
                  <SortHeader label="Balance" align="right" active={sort.key === "balance"} dir={sort.order} onClick={() => toggle("balance")} />
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="cursor-pointer align-top hover:bg-wash" onClick={() => openEntity(t.entity)}>
                    <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(t.date)}</td>
                    <td className={`${tdCls} max-w-[220px]`}>
                      <div className="truncate font-medium">{t.entity}</div>
                      <div className="truncate text-xs text-muted">
                        {t.channel}
                        {t.payer_app && t.payer_app !== "Unknown" && ` via ${t.payer_app}`}
                        {showAccount && t.account_id != null && ` · ${names.get(t.account_id) ?? ""}`}
                      </div>
                    </td>
                    <td className={tdCls}><Badge tone={t.is_transfer ? "accent" : "neutral"}>{t.category}</Badge></td>
                    <td className={`${tdCls} min-w-[240px] max-w-[420px] break-words text-xs text-ink-2`}>{t.particulars}</td>
                    <td className={`${tdCls} ${numCls} font-medium`}>{t.withdrawal ? inrExact(t.withdrawal) : ""}</td>
                    <td className={`${tdCls} ${numCls} font-medium text-good`}>{t.deposit ? inrExact(t.deposit) : ""}</td>
                    <td className={`${tdCls} ${numCls} text-ink-2`}>{t.balance != null ? inrExact(t.balance) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-grid px-5 py-3 text-xs text-ink-2">
            <span>
              {count((page - 1) * PAGE_SIZE + 1)}–{count(Math.min(page * PAGE_SIZE, data.total))} of {count(data.total)}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" />
              <span>Page {page} of {pages}</span>
              <Button size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" />
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
