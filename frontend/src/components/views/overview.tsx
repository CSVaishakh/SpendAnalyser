"use client";

import { Repeat, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { BalanceChart, BarList, ColumnChart, MonthlyCashflowChart } from "@/components/charts";
import { FilterBar, PageHeader } from "@/components/shell";
import { Badge, ButtonLink, Card, ErrorNote, Legend, Skeleton, Stat, Th, numCls, tdCls } from "@/components/ui";
import { UploadDropzone, UploadResultRow } from "@/components/upload";
import { count, deltaPct, fmtDate, inr, inrExact, pct, signedInr } from "@/lib/format";
import { useAccountNames, useDashboard, useMeta, useScope } from "@/lib/queries";
import { useApp } from "@/lib/state";

export function OverviewView() {
  const meta = useMeta();
  const dash = useDashboard();
  const { openEntity, setTxn, setAccount, setPayeeKind } = useApp();
  const names = useAccountNames();
  const scope = useScope();
  const router = useRouter();

  if (meta.isLoading) return <PageSkeleton />;
  if (meta.error) return <><PageHeader title="Overview" /><ErrorNote error={meta.error} /></>;
  if (!meta.data?.transactions) {
    return (
      <>
        <PageHeader title="Welcome" description="Upload a bank statement to see where your money goes. Everything stays on this machine." />
        <UploadDropzone />
      </>
    );
  }

  const d = dash.data;
  const k = d?.kpis;
  const prev = k?.previous;
  const drill = (patch: Parameters<typeof setTxn>[0]) => {
    setTxn({ direction: "out", category: "", channel: "", app: "", ...patch });
    router.push("/transactions");
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="Cashflow, balances and who you pay"
        actions={<ButtonLink href="/statements" icon={Upload}>Add statement</ButtonLink>}
      />
      <ImportBanner />
      <FilterBar />
      <ErrorNote error={dash.error} />

      {!d || !k ? <PageSkeleton bare /> : (
        <div className="space-y-4" style={{ opacity: dash.isPlaceholderData ? 0.6 : 1, transition: "opacity .15s" }}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Money in" swatch="in" value={inr(k.income)} delta={deltaPct(k.income, prev?.income)} sub={`${count(k.credits)} credits`} />
            <Stat label="Money out" swatch="out" value={inr(k.spend)} delta={deltaPct(k.spend, prev?.spend)} upIsGood={false} sub={`${count(k.debits)} debits`} />
            <Stat label="Net cashflow" value={signedInr(k.net)} tone={k.net >= 0 ? "good" : "bad"}
              sub={k.savings_rate != null ? `${pct(Math.abs(k.savings_rate))} of income ${k.net >= 0 ? "kept" : "overspent"}` : undefined} />
            <Stat label="Closing balance" hero value={k.closing_balance != null ? inr(k.closing_balance) : "—"}
              sub={k.opening_balance != null ? `from ${inr(k.opening_balance)}` : undefined} />
            <Stat label="Average monthly spend" value={inr(k.avg_monthly_spend)} sub={`income ${inr(k.avg_monthly_income)}/mo`} />
            <Stat label="Payees" value={count(k.payees)} sub={`${count(k.transactions)} transactions`} />
          </div>
          {k.moved_between_accounts > 0 && (
            <p className="-mt-1 text-xs text-muted">
              {inr(k.moved_between_accounts)} moved between your own accounts is left out of money in and money out.{" "}
              <button className="font-medium text-accent hover:underline" onClick={() => drill({ category: "Self transfers", direction: "" })}>
                See these transfers
              </button>
            </p>
          )}
          {prev && <p className="-mt-1 text-xs text-muted">Changes compare with {fmtDate(prev.start)} – {fmtDate(prev.end)}.</p>}

          <Card title="Monthly cashflow" subtitle="Money in and money out per month" actions={<Legend items={[{ label: "Money in", color: "in" }, { label: "Money out", color: "out" }]} />}>
            <MonthlyCashflowChart data={d.monthly} />
          </Card>

          {scope.account == null && d.accounts.length > 1 && (
            <Card title="Accounts" subtitle="Balances in this range. Select an account to see only its activity." flush>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr><Th className="pl-5">Account</Th><Th align="right">Opening</Th><Th align="right">Money in</Th><Th align="right">Money out</Th><Th align="right" className="pr-5">Closing</Th></tr></thead>
                  <tbody>
                    {d.accounts.map((a) => (
                      <tr key={a.account_id} className="cursor-pointer hover:bg-wash" onClick={() => setAccount(a.account_id)}>
                        <td className={`${tdCls} pl-5`}>
                          <div className="font-medium">{names.get(a.account_id) ?? "Account"}</div>
                          <div className="text-xs text-muted">{fmtDate(a.first_date)} – {fmtDate(a.last_date)}</div>
                        </td>
                        <td className={`${tdCls} ${numCls} text-ink-2`}>{inr(a.opening)}</td>
                        <td className={`${tdCls} ${numCls}`}>{inr(a.income)}</td>
                        <td className={`${tdCls} ${numCls}`}>{inr(a.spend)}</td>
                        <td className={`${tdCls} ${numCls} pr-5 font-semibold`}>{inr(a.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={`${tdCls} pl-5 font-semibold`}>All accounts</td>
                      <td className={`${tdCls} ${numCls} text-ink-2`}>{k.opening_balance != null ? inr(k.opening_balance) : "—"}</td>
                      <td className={`${tdCls} text-right text-xs text-muted`} colSpan={2}>includes transfers between accounts</td>
                      <td className={`${tdCls} ${numCls} pr-5 font-semibold`}>{k.closing_balance != null ? inr(k.closing_balance) : "—"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {d.balance.length > 1 && (
            <Card
              title={scope.account == null && d.accounts.length > 1 ? "Total balance" : "Account balance"}
              subtitle={scope.account == null && d.accounts.length > 1 ? "Sum of all your accounts at the end of each day" : "End-of-day balance as reported by the bank"}
            >
              <BalanceChart data={d.balance} accountNames={names} />
            </Card>
          )}

          <Card title="People vs businesses" subtitle="Who your money went to. Select a group to review its payees; mark any shop you know as a business there.">
            <div className="grid gap-6 lg:grid-cols-3">
              <div>
                <BarList items={d.kinds} onSelect={(name) => {
                  const k = d.kinds.find((x) => x.name === name)?.kind;
                  if (k === "person" || k === "business" || k === "cash" || k === "unknown") { setPayeeKind(k); router.push("/payees"); }
                }} />
              </div>
              <div>
                <h3 className="mb-1 px-2 text-xs font-semibold text-ink-2">Top people</h3>
                <BarList items={d.top_people} onSelect={openEntity} limit={6} emptyText="No payments to people." />
              </div>
              <div>
                <h3 className="mb-1 px-2 text-xs font-semibold text-ink-2">Top businesses</h3>
                <BarList items={d.top_businesses} onSelect={openEntity} limit={6} emptyText="No payments to businesses." />
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top payees" subtitle="Who received the most from you. Select one for details.">
              <BarList items={d.top_payees} onSelect={openEntity} />
            </Card>
            <Card title="Spending by category" subtitle="Select a category to see its transactions">
              <BarList items={d.categories} onSelect={(category) => drill({ category })} />
            </Card>
            <Card title="Where money came from" subtitle="Largest sources of incoming money">
              <BarList items={d.top_sources} color="in" onSelect={openEntity} emptyText="No money came in during this range." />
            </Card>
            <Card title="Payment methods" subtitle="Outgoing money by channel">
              <BarList items={d.channels} onSelect={(channel) => drill({ channel })} />
            </Card>
            <Card title="Payment apps" subtitle="UPI payments by the app you paid with, read from the note each app leaves. Select one for its payments.">
              <BarList items={d.apps} onSelect={(app) => drill({ app, channel: "UPI" })} emptyText="No UPI payments in this range." />
              <p className="mt-2 px-2 text-xs text-muted">
                Google Pay is inferred from its default “UPI” note. Unknown means the bank printed no note.
              </p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3" title="Recurring payments" subtitle="Paid most months at a steady amount: rent, EMIs, SIPs, subscriptions" flush>
              {d.recurring.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead><tr><Th className="pl-5">Payee</Th><Th align="right">Per month</Th><Th align="right">Months</Th><Th className="pr-5">Next expected</Th></tr></thead>
                    <tbody>
                      {d.recurring.map((r) => (
                        <tr key={r.name} className="cursor-pointer hover:bg-wash" onClick={() => openEntity(r.name)}>
                          <td className={`${tdCls} pl-5`}>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted">{r.category}</div>
                          </td>
                          <td className={`${tdCls} ${numCls} font-medium`}>{inr(r.monthly_amount)}</td>
                          <td className={`${tdCls} ${numCls}`}>{r.months}</td>
                          <td className={`${tdCls} whitespace-nowrap pr-5 text-ink-2`}>~{fmtDate(r.next_expected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-5 py-3 text-xs text-muted">
                    Total committed: <span className="font-medium text-ink">{inr(d.recurring.reduce((a, r) => a + r.monthly_amount, 0))}</span> a month
                  </p>
                </div>
              ) : (
                <p className="flex items-center gap-2 px-5 pb-5 text-sm text-muted"><Repeat size={15} aria-hidden /> Not enough months of data to spot recurring payments yet.</p>
              )}
            </Card>
            <Card className="lg:col-span-2" title="Spending by weekday" subtitle="Total outgoing money per day of the week">
              <ColumnChart data={d.weekday} xKey="day" yKey="amount" tipTitle={(x) => String(x.day)}
                tipRows={(x) => [{ label: "Spent", value: inr(Number(x.amount)) }, { label: "Payments", value: String(x.count) }]} />
            </Card>
          </div>

          <Card title="Largest payments" subtitle="The ten biggest single debits in this range" flush>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th className="pl-5">Date</Th><Th>Payee</Th><Th>Category</Th><Th>Narration</Th><Th align="right" className="pr-5">Amount</Th></tr></thead>
                <tbody>
                  {d.largest.map((t) => (
                    <tr key={t.id} className="cursor-pointer hover:bg-wash" onClick={() => openEntity(t.entity)}>
                      <td className={`${tdCls} whitespace-nowrap pl-5`}>{fmtDate(t.date)}</td>
                      <td className={`${tdCls} font-medium`}>{t.entity}</td>
                      <td className={tdCls}><Badge>{t.category}</Badge></td>
                      <td className={`${tdCls} max-w-[380px] truncate text-xs text-ink-2`} title={t.particulars}>{t.particulars}</td>
                      <td className={`${tdCls} ${numCls} pr-5 font-medium`}>{inrExact(t.withdrawal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function ImportBanner() {
  const { lastImport, setLastImport } = useApp();
  if (!lastImport?.length) return null;
  return (
    <div className="mb-5 space-y-2">
      {lastImport.map((r, i) => <UploadResultRow key={i} r={r} />)}
      <button className="text-xs text-ink-2 underline-offset-2 hover:underline" onClick={() => setLastImport(null)}>Dismiss</button>
    </div>
  );
}

function PageSkeleton({ bare }: { bare?: boolean }) {
  return (
    <div className="space-y-4">
      {!bare && <Skeleton className="h-8 w-48" />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[98px]" />)}</div>
      <Skeleton className="h-[340px]" />
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    </div>
  );
}
