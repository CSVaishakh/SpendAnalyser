"use client";

import { Repeat, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtDate, inr, inrExact, pct, signedInr } from "@/lib/format";
import type { SettableKind } from "@/lib/api";
import { useAccountNames, useEntityDetail, useMeta, useRename } from "@/lib/queries";
import { useApp } from "@/lib/state";
import { EntityMonthlyChart } from "./charts";
import { Badge, Button, ErrorNote, Input, Legend, Skeleton, Th, numCls, tdCls } from "./ui";

export function EntityDrawer() {
  const { entity, closeEntity } = useApp();
  const detail = useEntityDetail(entity);
  const meta = useMeta();
  const rename = useRename();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<SettableKind | "">("");
  const panel = useRef<HTMLDivElement>(null);
  const names = useAccountNames();
  const d = detail.data;

  useEffect(() => {
    if (d) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(d.name);
      setCategory(d.category);
      setKind(d.kind === "person" || d.kind === "business" || d.kind === "cash" ? d.kind : "");
    }
  }, [d]);

  useEffect(() => {
    if (!entity) return;
    // Keep the "Saved" note when this open was caused by our own rename.
    if (!rename.isPending && rename.data?.name !== entity) rename.reset();
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeEntity();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  if (!entity) return null;
  const s = d?.stats;
  const currentKind = d && (d.kind === "person" || d.kind === "business" || d.kind === "cash") ? d.kind : "";
  const cashLocked = category.trim().toLowerCase() === "cash";
  const dirty = d && (name.trim() !== d.name || category.trim() !== d.category || (!(category.trim().toLowerCase() === "cash") && kind !== currentKind));

  const save = () => {
    if (!d) return;
    const newName = name.trim() !== d.name ? name.trim() : null;
    const newCat = category.trim() !== d.category ? category.trim() : null;
    // The Cash category fixes the type, so never send a type alongside it.
    rename.mutate({ name: d.name, new_name: newName, category: newCat, kind: !cashLocked && kind && kind !== currentKind ? kind : null });
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={closeEntity} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="entity-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[680px] flex-col border-l border-line bg-surface shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-ink-2">{d ? `${{ person: "Person", business: "Business", self: "Own account", cash: "Cash", bank: "Bank", unknown: "Unclassified" }[d.kind]}${d.kind_reason ? ` (${d.kind_reason})` : ""} · ${d.category} · ${Object.keys(d.channels).join(", ")}` : "Payee"}</p>
            <h2 id="entity-title" className="truncate text-xl font-semibold tracking-tight">{entity}</h2>
          </div>
          <Button variant="ghost" icon={X} onClick={closeEntity} aria-label="Close" />
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <ErrorNote error={detail.error} />
          {detail.isLoading && <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
          {d && s && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Mini label="Total paid" value={s.paid ? inrExact(s.paid) : "—"} />
                <Mini label="Payments" value={s.payments || "—"} />
                <Mini label="Average payment" value={s.payments ? inrExact(s.avg_payment) : "—"} />
                <Mini label="Total received" value={s.received ? inrExact(s.received) : "—"} />
                <Mini label="Net" value={signedInr(s.net)} />
                <Mini label="Share of your spending" value={s.paid ? pct(s.share_of_spend) : "—"} />
                <Mini label="Largest payment" value={s.largest_payment ? inrExact(s.largest_payment) : "—"} />
                <Mini label="Typical gap" value={s.typical_gap_days == null ? "—" : s.typical_gap_days < 1 ? "Same day" : `${Math.round(s.typical_gap_days)} days`} />
                <Mini label="Active" value={`${fmtDate(s.first_date)} – ${fmtDate(s.last_date)}`} small />
              </div>

              {d.recurring && (
                <div className="flex items-start gap-2.5 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2.5 text-sm">
                  <Repeat size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <div>
                    <span className="font-medium">Recurring payment</span> of about {inr(d.recurring.monthly_amount)} a month, usually around day{" "}
                    {d.recurring.typical_day}. Next expected around {fmtDate(d.recurring.next_expected)}.
                  </div>
                </div>
              )}

              {d.by_account.length > 1 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">By account</h3>
                  <div className="overflow-hidden rounded-lg border border-line">
                    <table className="w-full text-[13px]">
                      <tbody>
                        {d.by_account.map((a) => (
                          <tr key={a.account_id ?? 0} className="border-t border-grid first:border-t-0">
                            <td className="px-3 py-2 font-medium">{a.account_id != null ? names.get(a.account_id) ?? "Account" : "Account"}</td>
                            <td className="px-3 py-2 text-right text-ink-2">{a.count} transactions</td>
                            <td className={`px-3 py-2 ${numCls}`}>{a.paid ? `paid ${inr(a.paid)}` : ""}</td>
                            <td className={`px-3 py-2 ${numCls} text-good`}>{a.received ? `received ${inr(a.received)}` : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">By month</h3>
                  {s.received > 0 && s.paid > 0 && <Legend items={[{ label: "Paid", color: "out" }, { label: "Received", color: "in" }]} />}
                </div>
                <EntityMonthlyChart data={d.monthly} showReceived={s.received > 0} />
              </section>

              <section className="rounded-lg border border-line p-4">
                <h3 className="text-sm font-semibold">Rename, merge, recategorise or set the type</h3>
                <p className="mt-0.5 text-xs text-ink-2">
                  Applies to every transaction from this payee, including future uploads. Use an existing payee&apos;s name to merge the two.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input aria-label="Payee name" value={name} onChange={(e) => setName(e.target.value)} list="entity-names" className="min-w-40 flex-[2]" />
                  <Input aria-label="Category" value={category} onChange={(e) => {
                    setCategory(e.target.value);
                  }} list="category-names" className="min-w-36 flex-1" />
                  <select aria-label="Person, business or cash" value={cashLocked ? "cash" : kind} disabled={cashLocked}
                    title={cashLocked ? "Fixed: payees in the Cash category are always Cash" : undefined}
                    onChange={(e) => setKind(e.target.value as SettableKind | "")}
                    className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm disabled:opacity-70">
                    {!kind && <option value="">Person, business or cash?</option>}
                    <option value="person">Person</option>
                    <option value="business">Business</option>
                    <option value="cash">Cash</option>
                  </select>
                  <Button variant="primary" disabled={!dirty || !name.trim() || rename.isPending} onClick={save}>
                    {rename.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
                <datalist id="entity-names">{meta.data?.entities.map((e) => <option key={e} value={e} />)}</datalist>
                <datalist id="category-names">{meta.data?.categories.map((c) => <option key={c} value={c} />)}</datalist>
                <div className="mt-2"><ErrorNote error={rename.error} /></div>
                {rename.isSuccess && <p className="mt-2 text-xs text-good">Saved. {rename.data.transactions_changed} transactions updated.</p>}
              </section>

              {(d.counterparties.length > 0 || d.auto_names.length > 1) && (
                <section className="space-y-2 text-sm">
                  {d.counterparties.length > 0 && (
                    <div>
                      <h3 className="mb-1 text-xs font-semibold text-ink-2">UPI IDs and accounts</h3>
                      <div className="flex flex-wrap gap-1.5">{d.counterparties.map((c) => <Badge key={c}>{c}</Badge>)}</div>
                    </div>
                  )}
                  {d.auto_names.length > 1 && (
                    <div>
                      <h3 className="mb-1 text-xs font-semibold text-ink-2">Merged from</h3>
                      <div className="flex flex-wrap gap-1.5">{d.auto_names.map((c) => <Badge key={c}>{c}</Badge>)}</div>
                    </div>
                  )}
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold">How it appears on your statement</h3>
                <ul className="space-y-1">
                  {d.variants.map((v) => (
                    <li key={v.text} className="flex gap-2 font-mono text-xs text-ink-2">
                      <span className="tnum w-8 shrink-0 text-right font-sans font-semibold text-ink">{v.count}×</span>
                      <span className="break-all">{v.text}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Transactions ({d.transactions.length})</h3>
                <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
                  <table className="w-full text-[13px]">
                    <thead><tr><Th>Date</Th><Th>{names.size > 1 ? "Account" : "Channel"}</Th><Th align="right">Paid</Th><Th align="right">Received</Th><Th align="right">Balance</Th></tr></thead>
                    <tbody>
                      {d.transactions.map((t) => (
                        <tr key={t.id} title={t.particulars} className="hover:bg-wash">
                          <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(t.date)}</td>
                          <td className={`${tdCls} text-ink-2`}>{names.size > 1 && t.account_id != null ? names.get(t.account_id) : t.channel}</td>
                          <td className={`${tdCls} ${numCls}`}>{t.withdrawal ? inrExact(t.withdrawal) : ""}</td>
                          <td className={`${tdCls} ${numCls} text-good`}>{t.deposit ? inrExact(t.deposit) : ""}</td>
                          <td className={`${tdCls} ${numCls} text-ink-2`}>{t.balance != null ? inrExact(t.balance) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-ink-2">{label}</div>
      <div className={small ? "mt-0.5 text-[13px] font-semibold" : "mt-0.5 truncate text-base font-semibold"}>{value}</div>
    </div>
  );
}
