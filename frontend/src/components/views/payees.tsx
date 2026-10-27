"use client";

import { Download, Users } from "lucide-react";
import { useState } from "react";
import { FilterBar, PageHeader } from "@/components/shell";
import { Badge, ButtonLink, Card, EmptyState, ErrorNote, Meter, Segmented, Select, Skeleton, SortHeader, numCls, tdCls } from "@/components/ui";
import { exportUrl, type EntityRow, type SettableKind } from "@/lib/api";
import { count, fmtDate, inr, inrExact, pct, signedInr } from "@/lib/format";
import { useAccountNames, useEntities, useMeta, useRename, useScope } from "@/lib/queries";
import { useApp, type PayeeKind } from "@/lib/state";

type Dir = "out" | "in" | "all";
type SortKey = keyof EntityRow | "total";

const COLUMNS: { key: SortKey; label: string; align?: "right"; dirs?: Dir[] }[] = [
  { key: "name", label: "Payee" },
  { key: "kind", label: "Type" },
  { key: "category", label: "Category" },
  { key: "paid", label: "Paid", align: "right", dirs: ["out", "all"] },
  { key: "payments", label: "Payments", align: "right", dirs: ["out", "all"] },
  { key: "avg_payment", label: "Average", align: "right", dirs: ["out"] },
  { key: "received", label: "Received", align: "right", dirs: ["in", "all"] },
  { key: "receipts", label: "Credits", align: "right", dirs: ["in"] },
  { key: "net", label: "Net", align: "right", dirs: ["all"] },
  { key: "months_active", label: "Months", align: "right" },
  { key: "last_date", label: "Last seen" },
];

export function PayeesView() {
  const [dir, setDir] = useState<Dir>("out");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey | null; order: "asc" | "desc" }>({ key: null, order: "desc" });
  const { openEntity } = useApp();
  const meta = useMeta();
  const scope = useScope();
  const { payeeKind, setPayeeKind } = useApp();
  const params = { direction: dir === "all" ? null : dir, category: category || null, kind: payeeKind || null, sort: sort.key, order: sort.order };
  const ents = useEntities(params);
  const rows = ents.data ?? [];
  const cols = COLUMNS.filter((c) => !c.dirs || c.dirs.includes(dir));
  const shareKey = dir === "in" ? "share_in" : "share_out";
  const maxShare = Math.max(...rows.map((r) => r[shareKey]), 0.0001);
  const defaultKey: SortKey = dir === "in" ? "received" : dir === "out" ? "paid" : "total";
  const activeKey = sort.key ?? defaultKey;

  const toggle = (key: SortKey) =>
    setSort((s) => ({ key, order: (s.key ?? defaultKey) === key ? (s.order === "desc" ? "asc" : "desc") : key === "name" || key === "category" ? "asc" : "desc" }));

  const totals = rows.reduce((a, r) => ({ paid: a.paid + r.paid, received: a.received + r.received }), { paid: 0, received: 0 });

  return (
    <>
      <PageHeader
        title="Payees"
        description="Everyone you paid or received money from, with totals for the selected range"
        actions={
          <ButtonLink href={exportUrl("/entities/export", { ...scope, ...params, sort: null, order: null })} icon={Download} download>Export CSV</ButtonLink>
        }
      />
      <FilterBar />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Direction" value={dir} onChange={(v) => { setDir(v); setSort({ key: null, order: "desc" }); }}
          options={[{ value: "out", label: "Paid to" }, { value: "in", label: "Received from" }, { value: "all", label: "All" }]} />
        <Segmented<PayeeKind> label="Payee type" value={payeeKind} onChange={setPayeeKind}
          options={[{ value: "", label: "Everyone" }, { value: "person", label: "People" }, { value: "business", label: "Businesses" }, { value: "cash", label: "Cash" }, { value: "unknown", label: "Unclassified" }]} />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {meta.data?.used_categories.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <span className="ml-auto text-xs text-ink-2">
          {count(rows.length)} payees
          {dir !== "in" && ` · paid ${inr(totals.paid)}`}
          {dir !== "out" && ` · received ${inr(totals.received)}`}
        </span>
      </div>
      <ErrorNote error={ents.error} />

      <Card flush>
        {ents.isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No payees match">Try a wider date range or clear the search.</EmptyState>
        ) : (
          <div className="max-h-[calc(100dvh-260px)] overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <SortHeader key={c.key} label={c.label} align={c.align} active={activeKey === c.key} dir={sort.order} onClick={() => toggle(c.key)} />
                  ))}
                  {dir !== "all" && <SortHeader label="Share" align="right" active={false} dir="desc" onClick={() => toggle(dir === "in" ? "received" : "paid")} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.name} className="cursor-pointer hover:bg-wash" onClick={() => openEntity(e.name)}>
                    {cols.map((c) => <Cell key={c.key} col={c.key} e={e} />)}
                    {dir !== "all" && (
                      <td className={`${tdCls} ${numCls}`}>
                        <span className="inline-flex items-center gap-2">
                          {pct(e[shareKey])}
                          <Meter value={e[shareKey] / maxShare} color={dir === "in" ? "in" : "out"} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Cell({ col, e }: { col: SortKey; e: EntityRow }) {
  const names = useAccountNames();
  switch (col) {
    case "name":
      return (
        <td className={`${tdCls} max-w-[300px]`}>
          <div className="truncate font-medium">{e.name}</div>
          <div className="truncate text-xs text-muted">
            {[e.counterparties[0], names.size > 1 && (e.accounts.length > 1 ? `${e.accounts.length} accounts` : names.get(e.accounts[0]))]
              .filter(Boolean).join(" · ")}
          </div>
        </td>
      );
    case "kind":
      return <td className={tdCls} onClick={(ev) => ev.stopPropagation()}><KindPicker e={e} /></td>;
    case "category":
      return <td className={tdCls}><Badge>{e.category}</Badge></td>;
    case "paid":
      return <td className={`${tdCls} ${numCls} font-medium`}>{e.paid ? inrExact(e.paid) : "—"}</td>;
    case "received":
      return <td className={`${tdCls} ${numCls} font-medium`}>{e.received ? inrExact(e.received) : "—"}</td>;
    case "avg_payment":
      return <td className={`${tdCls} ${numCls}`}>{e.avg_payment ? inr(e.avg_payment) : "—"}</td>;
    case "net":
      return <td className={`${tdCls} ${numCls} ${e.net > 0 ? "text-good" : ""}`}>{signedInr(e.net)}</td>;
    case "last_date":
      return <td className={`${tdCls} whitespace-nowrap text-ink-2`}>{fmtDate(e.last_date)}</td>;
    default:
      return <td className={`${tdCls} ${numCls}`}>{String(e[col as keyof EntityRow] || "—")}</td>;
  }
}

/** Inline Person/Business switch so a long payee list can be reviewed quickly. Saving pins a rule for this payee. */
function KindPicker({ e }: { e: EntityRow }) {
  const rename = useRename();
  if (e.category === "Cash") {
    return <span className="inline-flex h-7 items-center rounded-md border border-good/30 bg-good/10 px-2 text-xs font-medium text-good" title="Fixed: payees in the Cash category are always Cash">Cash</span>;
  }
  if (!["person", "business", "cash", "unknown"].includes(e.kind)) return <span className="text-xs text-muted">{e.kind === "self" ? "Own account" : "Bank"}</span>;
  return (
    <select
      aria-label={`Type of ${e.name}`}
      value={e.kind === "unknown" ? "" : e.kind}
      disabled={rename.isPending}
      title={e.kind_reason ? `Why: ${e.kind_reason}` : undefined}
      onChange={(ev) => ev.target.value && rename.mutate({ name: e.name, kind: ev.target.value as SettableKind })}
      className={`h-7 rounded-md border px-1.5 text-xs font-medium ${
        e.kind === "business" ? "border-accent/30 bg-accent/10 text-accent"
          : e.kind === "person" ? "border-line bg-surface-2 text-ink-2"
          : e.kind === "cash" ? "border-good/30 bg-good/10 text-good"
          : "border-warn/30 bg-warn/10 text-warn"
      }`}
    >
      {e.kind === "unknown" && <option value="">Unclassified</option>}
      <option value="person">Person</option>
      <option value="business">Business</option>
      <option value="cash">Cash</option>
    </select>
  );
}
