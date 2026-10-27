"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SettableKind, type Account, type Dashboard, type EntityDetail, type EntityRow, type Meta, type Params, type Rule, type RuleInput, type Statement, type TxnPage, type UploadResult } from "./api";
import { resolveRange, useApp } from "./state";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta") });
}

/** Date range + search shared by every analytics view. */
export function useScope(): Params & { start: string | null; end: string | null; account: number | null } {
  const { preset, customStart, customEnd, q, account } = useApp();
  const meta = useMeta();
  const { start, end } = resolveRange(preset, meta.data?.last_date ?? null, customStart, customEnd);
  // Ignore a remembered account that has since been deleted.
  const valid = account != null && meta.data?.accounts.some((a) => a.id === account) ? account : null;
  return { start, end, q: q || null, account: valid };
}

export function useAccountNames(): Map<number, string> {
  const meta = useMeta();
  return new Map((meta.data?.accounts ?? []).map((a) => [a.id, a.name]));
}

export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/accounts") });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api<Account>(`/accounts/${id}`, { method: "PATCH", json: { name } }),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: number) => api<void>(`/accounts/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useDashboard() {
  const scope = useScope();
  const meta = useMeta();
  return useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => api<Dashboard>("/dashboard", { params: scope }),
    enabled: !!meta.data?.transactions,
    placeholderData: keepPreviousData,
  });
}

export function useEntities(params: Params) {
  const scope = useScope();
  const meta = useMeta();
  const all = { ...scope, ...params };
  return useQuery({
    queryKey: ["entities", all],
    queryFn: () => api<EntityRow[]>("/entities", { params: all }),
    enabled: !!meta.data?.transactions,
    placeholderData: keepPreviousData,
  });
}

export function useEntityDetail(name: string | null) {
  const { start, end, account } = useScope();
  return useQuery({
    queryKey: ["entity", name, start, end, account],
    queryFn: () => api<EntityDetail>("/entities/detail", { params: { name, start, end, account } }),
    enabled: !!name,
    retry: false,
  });
}

export function useTransactions(params: Params) {
  const scope = useScope();
  const meta = useMeta();
  const all = { ...scope, ...params };
  return useQuery({
    queryKey: ["transactions", all],
    queryFn: () => api<TxnPage>("/transactions", { params: all }),
    enabled: !!meta.data?.transactions,
    placeholderData: keepPreviousData,
  });
}

export function useStatements() {
  return useQuery({ queryKey: ["statements"], queryFn: () => api<Statement[]>("/statements") });
}

export function useRules() {
  return useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/rules") });
}

/** Any write can change every derived view, so refresh everything. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useUpload() {
  const invalidate = useInvalidateAll();
  const { setLastImport } = useApp();
  return useMutation({
    mutationFn: ({ files, accountId, password }: { files: File[]; accountId?: number | null; password?: string }) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (accountId) fd.append("account_id", String(accountId));
      if (password) fd.append("password", password);
      return api<{ results: UploadResult[] }>("/statements", { method: "POST", body: fd });
    },
    onSuccess: (r) => {
      setLastImport(r.results);
      return invalidate();
    },
  });
}

export function useDeleteStatement() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: number) => api<void>(`/statements/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useWipe() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => api<void>("/data", { method: "DELETE" }), onSuccess: invalidate });
}

export function useRename() {
  const qc = useQueryClient();
  const { openEntity } = useApp();
  return useMutation({
    mutationFn: (body: { name: string; new_name?: string | null; category?: string | null; kind?: SettableKind | null }) =>
      api<{ name: string; rules: number; transactions_changed: number }>("/entities/rename", { method: "POST", json: body }),
    onSuccess: (r, vars) => {
      // Follow the payee to its new name first; refreshing while the panel still shows the old name would 404.
      openEntity(r.name);
      qc.removeQueries({ queryKey: ["entity", vars.name] });
      return qc.invalidateQueries();
    },
  });
}

export function useSaveRule() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: RuleInput }) =>
      id ? api<Rule>(`/rules/${id}`, { method: "PUT", json: body }) : api<Rule>("/rules", { method: "POST", json: body }),
    onSuccess: invalidate,
  });
}

export function useDeleteRule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: number) => api<void>(`/rules/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useReorderRules() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (ids: number[]) => api<Rule[]>("/rules/reorder", { method: "POST", json: { ids } }), onSuccess: invalidate });
}

export function useImportRules() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (rules: RuleInput[]) => api<Rule[]>("/rules/import", { method: "POST", json: rules }), onSuccess: invalidate });
}
