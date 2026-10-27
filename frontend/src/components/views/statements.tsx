"use client";

import { AlertTriangle, Building2, CheckCircle2, FileSpreadsheet, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Skeleton, Th, numCls, tdCls } from "@/components/ui";
import { UploadDropzone } from "@/components/upload";
import type { Account } from "@/lib/api";
import { count, fmtDate, inr } from "@/lib/format";
import { useAccounts, useDeleteAccount, useDeleteStatement, useStatements, useUpdateAccount, useWipe } from "@/lib/queries";
import { useApp } from "@/lib/state";

export function StatementsView() {
  const statements = useStatements();
  const accounts = useAccounts();
  const del = useDeleteStatement();
  const wipe = useWipe();
  const list = statements.data ?? [];
  const accts = accounts.data ?? [];

  return (
    <>
      <PageHeader title="Accounts & statements" description="Add statements for any of your accounts and check how each file was read" />
      <div className="space-y-5">
        <UploadDropzone compact />

        <Card title="Your accounts" subtitle="Created automatically from the account number in each statement. Rename them to anything you like." flush>
          <ErrorNote error={accounts.error} />
          {accounts.isLoading ? (
            <div className="space-y-2 p-5"><Skeleton className="h-14" /></div>
          ) : accts.length === 0 ? (
            <EmptyState icon={Building2} title="No accounts yet">Upload a statement and its account is set up for you.</EmptyState>
          ) : (
            <ul className="divide-y divide-grid border-t border-grid">
              {accts.map((a) => <AccountRow key={a.id} a={a} />)}
            </ul>
          )}
        </Card>

        <Card title="Imported statements" subtitle="Payees and categories update automatically as you add more months" flush
          actions={list.length > 0 && (
            <Button size="sm" variant="danger" icon={Trash2} disabled={wipe.isPending}
              onClick={() => confirm("Delete all accounts, statements and transactions? Your payee rules are kept.") && wipe.mutate()}>
              Delete all data
            </Button>
          )}>
          <ErrorNote error={statements.error || del.error || wipe.error} />
          {statements.isLoading ? (
            <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : list.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="No statements yet">Upload CSV or Excel statements above.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <Th className="pl-5">File</Th><Th>Account</Th><Th>Period</Th><Th align="right">Added</Th><Th align="right">Repeats skipped</Th>
                    <Th>Checks</Th><Th className="pr-5"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className={`${tdCls} pl-5`}>
                        <div className="font-medium">{s.filename}</div>
                        <div className="text-xs text-muted">Uploaded {s.uploaded_at ? fmtDate(s.uploaded_at.slice(0, 10)) : ""}</div>
                      </td>
                      <td className={`${tdCls} whitespace-nowrap`}>{s.account_name ?? "—"}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</td>
                      <td className={`${tdCls} ${numCls}`}>{count(s.rows_inserted)}</td>
                      <td className={`${tdCls} ${numCls} text-ink-2`}>{s.rows_duplicate ? count(s.rows_duplicate) : "—"}</td>
                      <td className={`${tdCls} max-w-[340px]`}>
                        <div className="flex flex-wrap gap-1.5">
                          {s.balance_checked > 0 && (s.balance_mismatches === 0
                            ? <Badge tone="good"><CheckCircle2 size={11} aria-hidden /> Balance verified</Badge>
                            : <Badge tone="warn"><AlertTriangle size={11} aria-hidden /> {s.balance_mismatches} balance gaps</Badge>)}
                          {s.reversed_order && <Badge>Newest-first, reordered</Badge>}
                          {s.rows_skipped > 0 && <Badge>{s.rows_skipped} rows skipped</Badge>}
                        </div>
                        {s.warnings.filter((w) => !w.startsWith("Skipped")).map((w) => <p key={w} className="mt-1 text-xs text-warn">{w}</p>)}
                      </td>
                      <td className={`${tdCls} pr-5 text-right`}>
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${s.filename}`} disabled={del.isPending}
                          onClick={() => confirm(`Delete ${s.filename} and its ${s.rows_inserted} transactions?`) && del.mutate(s.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function AccountRow({ a }: { a: Account }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);
  const update = useUpdateAccount();
  const remove = useDeleteAccount();
  const { setAccount } = useApp();
  const router = useRouter();

  const save = () => {
    if (!name.trim() || name.trim() === a.name) return setEditing(false);
    update.mutate({ id: a.id, name: name.trim() }, { onSuccess: () => setEditing(false) });
  };

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Building2 size={17} strokeWidth={1.7} aria-hidden /></div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Input autoFocus aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-64" />
            <Button size="sm" variant="primary" type="submit" disabled={update.isPending}>Save</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setName(a.name); setEditing(false); }}>Cancel</Button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5 font-semibold">
            {a.name}
            <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Rename ${a.name}`} onClick={() => setEditing(true)} className="size-7" />
          </div>
        )}
        <div className="text-xs text-muted">
          {[a.bank, a.kind, a.number, a.holder].filter(Boolean).join(" · ") || "No account details found in the statement"}
        </div>
        <ErrorNote error={update.error || remove.error} />
      </div>
      <div className="text-xs text-ink-2">
        {a.first_date ? `${fmtDate(a.first_date)} – ${fmtDate(a.last_date)}` : "No transactions"}
        <div className="text-muted">{count(a.statements ?? 0)} statements · {count(a.transactions ?? 0)} transactions</div>
      </div>
      <div className="min-w-28 text-right">
        <div className="text-xs text-ink-2">Latest balance</div>
        <div className="tnum font-semibold">{a.balance != null ? inr(a.balance) : "—"}</div>
      </div>
      <div className="flex gap-1">
        <Button size="sm" onClick={() => { setAccount(a.id); router.push("/"); }}>View</Button>
        <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${a.name}`} disabled={remove.isPending}
          onClick={() => confirm(`Delete ${a.name} with all its statements and ${a.transactions ?? 0} transactions?`) && remove.mutate(a.id)} />
      </div>
    </li>
  );
}
