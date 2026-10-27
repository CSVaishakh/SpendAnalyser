"use client";

import { ArrowDown, ArrowUp, Download, Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Select, Skeleton, Th, tdCls } from "@/components/ui";
import type { Rule, RuleInput } from "@/lib/api";
import { useDeleteRule, useImportRules, useMeta, useReorderRules, useRules, useSaveRule } from "@/lib/queries";

const EMPTY: RuleInput = { field: "any", match_mode: "contains", pattern: "", set_entity: "", set_category: "", set_kind: null };
const FIELD_LABEL = { any: "Narration or payee", particulars: "Narration", entity: "Detected payee" } as const;
const MODE_LABEL = { contains: "contains", exact: "is exactly", regex: "matches regex" } as const;

export function RulesView() {
  const rules = useRules();
  const meta = useMeta();
  const save = useSaveRule();
  const del = useDeleteRule();
  const reorder = useReorderRules();
  const imp = useImportRules();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<RuleInput>(EMPTY);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = rules.data ?? [];

  const startEdit = (r?: Rule) => {
    save.reset();
    setEditing(r ? r.id : "new");
    setForm(r ? { field: r.field, match_mode: r.match_mode, pattern: r.pattern, set_entity: r.set_entity ?? "", set_category: r.set_category ?? "", set_kind: r.set_kind ?? null } : EMPTY);
  };
  const submit = () =>
    save.mutate(
      { id: editing === "new" || editing === null ? undefined : editing, body: { ...form, set_entity: form.set_entity || null, set_category: form.set_category || null, set_kind: form.set_kind || null } },
      { onSuccess: () => setEditing(null) },
    );
  const move = (i: number, by: number) => {
    const ids = list.map((r) => r.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorder.mutate(ids);
  };
  const exportRules = () => {
    const data = list.map(({ field, match_mode, pattern, set_entity, set_category, set_kind }) => ({ field, match_mode, pattern, set_entity, set_category, set_kind }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "spend-rules.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importRules = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error();
      imp.mutate(parsed);
    } catch {
      alert("That file isn't a rules export.");
    }
  };

  const formRow = (
    <tr className="bg-surface-2/60">
      <td colSpan={5} className="px-5 py-4">
        <div className="grid gap-2 md:grid-cols-[auto_auto_minmax(0,1fr)]">
          <Select aria-label="Match against" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as RuleInput["field"] })}>
            {Object.entries(FIELD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select aria-label="Match type" value={form.match_mode} onChange={(e) => setForm({ ...form, match_mode: e.target.value as RuleInput["match_mode"] })}>
            {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Input aria-label="Pattern" autoFocus placeholder={form.match_mode === "regex" ? "e.g. ^LANDLORD|vijayan\\.p@" : "e.g. vijayan.p@oksbi"} value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <Input aria-label="Set payee to" placeholder="Set payee to (optional)" list="rule-entities" value={form.set_entity ?? ""} onChange={(e) => setForm({ ...form, set_entity: e.target.value })} />
          <Input aria-label="Set category to" placeholder="Set category to (optional)" list="rule-categories" value={form.set_category ?? ""} onChange={(e) => setForm({ ...form, set_category: e.target.value })} />
          <Select aria-label="Mark as" value={form.set_category?.trim().toLowerCase() === "cash" ? "cash" : form.set_kind ?? ""}
            disabled={form.set_category?.trim().toLowerCase() === "cash"} title={form.set_category?.trim().toLowerCase() === "cash" ? "The Cash category always means type Cash" : undefined}
            onChange={(e) => setForm({ ...form, set_kind: (e.target.value || null) as RuleInput["set_kind"] })}>
            <option value="">Type unchanged</option>
            <option value="business">Mark as business</option>
            <option value="person">Mark as person</option>
            <option value="cash">Mark as cash</option>
          </Select>
          <div className="flex gap-2">
            <Button variant="primary" onClick={submit} disabled={!form.pattern.trim() || (!form.set_entity && !form.set_category && !form.set_kind) || save.isPending}>
              {save.isPending ? "Saving…" : "Save rule"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
        <div className="mt-2"><ErrorNote error={save.error} /></div>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Rules"
        description="Fix payee names and categories once; they're applied to every past and future statement"
        actions={
          <>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>Import</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { importRules(e.target.files?.[0]); e.target.value = ""; }} />
            <Button icon={Download} onClick={exportRules} disabled={!list.length}>Export</Button>
            <Button variant="primary" icon={Plus} onClick={() => startEdit()}>New rule</Button>
          </>
        }
      />
      <datalist id="rule-entities">{meta.data?.entities.map((e) => <option key={e} value={e} />)}</datalist>
      <datalist id="rule-categories">{meta.data?.categories.map((c) => <option key={c} value={c} />)}</datalist>
      <ErrorNote error={rules.error || del.error || reorder.error || imp.error} />

      <Card flush subtitle={<>Rules run top to bottom and the first match wins. Renaming a payee from its detail panel adds a rule here.</>} title="Your rules">
        {rules.isLoading ? (
          <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : list.length === 0 && editing === null ? (
          <EmptyState icon={Wand2} title="No rules yet" action={<Button icon={Plus} onClick={() => startEdit()}>New rule</Button>}>
            Rules rename payees (for example, a UPI ID to a person&apos;s name) or move transactions into a category of your choice.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr><Th className="pl-5">#</Th><Th>When</Th><Th>Then</Th><Th>Matches</Th><Th className="pr-5"><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {editing === "new" && formRow}
                {list.map((r, i) =>
                  editing === r.id ? <Fragment key={r.id}>{formRow}</Fragment> : (
                    <tr key={r.id} className="hover:bg-wash">
                      <td className={`${tdCls} pl-5 text-muted`}>{i + 1}</td>
                      <td className={tdCls}>
                        <span className="text-ink-2">{FIELD_LABEL[r.field]} {MODE_LABEL[r.match_mode]}</span>{" "}
                        <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{r.pattern}</code>
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap gap-1.5">
                          {r.set_entity && <Badge tone="accent">Payee: {r.set_entity}</Badge>}
                          {r.set_category && <Badge>Category: {r.set_category}</Badge>}
                          {r.set_kind && <Badge tone={r.set_kind === "business" ? "accent" : r.set_kind === "cash" ? "good" : "neutral"}>{{ business: "Business", person: "Person", cash: "Cash" }[r.set_kind]}</Badge>}
                        </div>
                      </td>
                      <td className={`${tdCls} tnum ${r.hits ? "" : "text-warn"}`}>{r.hits ? `${r.hits} transactions` : "No matches"}</td>
                      <td className={`${tdCls} whitespace-nowrap pr-5 text-right`}>
                        <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} />
                        <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="Move down" disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(i, 1)} />
                        <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit rule" onClick={() => startEdit(r)} />
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete rule" onClick={() => del.mutate(r.id)} />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
