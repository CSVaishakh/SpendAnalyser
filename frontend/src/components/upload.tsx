"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CopyCheck, FileUp, Loader2, Lock, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import type { UploadResult } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useMeta, useUpload } from "@/lib/queries";
import { Button, ErrorNote, Input, Select } from "./ui";

const ACCEPT = ".csv,.xls,.xlsx,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Row = { file: File; result: UploadResult };

export function UploadDropzone({ compact = false, onDone }: { compact?: boolean; onDone?: (r: UploadResult[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  // Results stay paired with their File so a locked statement can be retried with a password.
  const [rows, setRows] = useState<Row[]>([]);
  const upload = useUpload();
  const meta = useMeta();
  const accounts = meta.data?.accounts ?? [];

  const send = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    upload.mutate(
      { files: list, accountId },
      {
        onSuccess: (r) => {
          setRows(r.results.map((result, i) => ({ file: list[i], result })));
          onDone?.(r.results);
        },
      },
    );
  };

  const unlock = (row: Row, password: string) =>
    upload.mutateAsync({ files: [row.file], accountId, password }).then((r) => {
      setRows((prev) => prev.map((x) => (x === row ? { file: row.file, result: r.results[0] } : x)));
      return r.results[0];
    });

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        className={clsx(
          "flex flex-col items-center justify-center rounded-xl border-[1.5px] border-dashed text-center transition-colors",
          compact ? "px-4 py-6" : "px-6 py-12",
          over ? "border-accent bg-wash" : "border-axis bg-surface",
        )}
      >
        <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-ink-2">
          {upload.isPending ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <FileUp size={20} strokeWidth={1.7} aria-hidden />}
        </div>
        <p className="font-semibold">{upload.isPending ? "Reading your statement…" : "Drop account statements here"}</p>
        <p className="mt-1 max-w-md text-sm text-ink-2">
          CSV, XLS or XLSX from net banking or email, for any number of accounts. Password-protected files are fine; you&apos;ll
          be asked for the password. Each file is matched to its account and overlapping statements are de-duplicated.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {accounts.length > 0 && (
            <Select aria-label="Account for these files" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Detect account automatically</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>Add to {a.name}</option>)}
            </Select>
          )}
          <Button variant="primary" onClick={() => input.current?.click()} disabled={upload.isPending}>
            Choose files
          </Button>
        </div>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="mt-3 space-y-2">
        <ErrorNote error={upload.error} />
        {rows.map((row, i) => <UploadResultRow key={`${row.file.name}-${i}`} r={row.result} onUnlock={(pw) => unlock(row, pw)} />)}
      </div>
    </div>
  );
}

export function UploadResultRow({ r, onUnlock }: { r: UploadResult; onUnlock?: (password: string) => Promise<UploadResult> }) {
  const locked = r.status === "password_required";
  const Icon = locked ? Lock : r.status === "error" ? XCircle : r.status === "duplicate" ? CopyCheck : r.warnings.length ? AlertTriangle : CheckCircle2;
  const tone = locked ? "text-warn" : r.status === "error" ? "text-bad" : r.status === "duplicate" ? "text-ink-2" : r.warnings.length ? "text-warn" : "text-good";
  return (
    <div className="flex gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
      <Icon size={18} className={clsx("mt-0.5 shrink-0", tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="break-all font-medium">{r.filename}</div>
        {r.account_name && (r.status === "imported" || r.status === "duplicate") && (
          <div className="text-ink-2">
            {r.account_created ? "New account: " : "Account: "}<span className="font-medium text-ink">{r.account_name}</span>
            {r.account_how && <span className="text-muted"> ({r.account_how})</span>}
          </div>
        )}
        {r.status === "imported" && (
          <div className="text-ink-2">
            Imported {r.inserted.toLocaleString("en-IN")} transactions, {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
            {r.transfers_linked > 0 && ` · ${r.transfers_linked} transfers between your accounts matched`}
            {r.duplicates > 0 && ` · ${r.duplicates} already imported`}
            {r.reversed_order && " · newest-first order corrected"}
            {r.balance_checked > 0 && !r.balance_mismatches && " · running balance verified"}
          </div>
        )}
        {r.message && r.status !== "imported" && <div className={locked && r.wrong_password ? "text-bad" : "text-ink-2"}>{r.message}</div>}
        {locked && onUnlock && <PasswordForm onUnlock={onUnlock} />}
        {r.warnings.map((w) => <div key={w} className="text-warn">{w}</div>)}
      </div>
    </div>
  );
}

function PasswordForm({ onUnlock }: { onUnlock: (password: string) => Promise<UploadResult> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!password) return;
        setBusy(true);
        try {
          await onUnlock(password);
        } finally {
          setBusy(false);
          setPassword("");
        }
      }}
    >
      <Input type="password" autoComplete="off" autoFocus aria-label="Statement password" placeholder="Statement password"
        value={password} onChange={(e) => setPassword(e.target.value)} className="h-8 w-56" />
      <Button size="sm" variant="primary" type="submit" disabled={!password || busy}>{busy ? "Unlocking…" : "Unlock"}</Button>
      <span className="text-xs text-muted">Used only to open this file; never saved.</span>
    </form>
  );
}
