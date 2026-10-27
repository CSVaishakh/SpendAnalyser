"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UploadResult } from "./api";
import { parseISODate, toISODate } from "./format";

export type Preset = "all" | "30d" | "3m" | "6m" | "12m" | "fy" | "pfy" | "custom";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30d", label: "Last 30 days" },
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "fy", label: "Current FY" },
  { id: "pfy", label: "Previous FY" },
  { id: "custom", label: "Custom range" },
];

export type TxnFilters = { direction: "" | "in" | "out"; category: string; channel: string; app: string };
export type PayeeKind = "" | "person" | "business" | "cash" | "unknown";

type AppState = {
  preset: Preset;
  customStart: string;
  customEnd: string;
  q: string;
  account: number | null;
  setAccount: (id: number | null) => void;
  setPreset: (p: Preset) => void;
  setCustom: (start: string, end: string) => void;
  setQ: (q: string) => void;
  txn: TxnFilters;
  setTxn: (t: Partial<TxnFilters>) => void;
  payeeKind: PayeeKind;
  setPayeeKind: (k: PayeeKind) => void;
  entity: string | null;
  openEntity: (name: string) => void;
  closeEntity: () => void;
  theme: "light" | "dark" | null;
  toggleTheme: () => void;
  lastImport: UploadResult[] | null;
  setLastImport: (r: UploadResult[] | null) => void;
};

const Ctx = createContext<AppState | null>(null);
const STORE_KEY = "spend.view";

function load<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [view, setView] = useState({ preset: "all" as Preset, customStart: "", customEnd: "", q: "", account: null as number | null });
  const [txn, setTxnState] = useState<TxnFilters>({ direction: "", category: "", channel: "", app: "" });
  const [entity, setEntity] = useState<string | null>(null);
  const [payeeKind, setPayeeKind] = useState<PayeeKind>("");
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [lastImport, setLastImport] = useState<UploadResult[] | null>(null);

  useEffect(() => {
    // Restore after hydration so server and client render the same first frame.
    const saved = load(STORE_KEY, view);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(saved);
    const t = document.documentElement.dataset.theme;
    setTheme(t === "dark" || t === "light" ? t : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(view));
    } catch {}
  }, [view]);

  const toggleTheme = useCallback(() => {
    const current =
      document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("spend.theme", next);
    } catch {}
    setTheme(next);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ...view,
      setPreset: (preset) => setView((v) => ({ ...v, preset })),
      setCustom: (customStart, customEnd) => setView((v) => ({ ...v, preset: "custom", customStart, customEnd })),
      setQ: (q) => setView((v) => ({ ...v, q })),
      setAccount: (account) => setView((v) => ({ ...v, account })),
      txn,
      setTxn: (t) => setTxnState((prev) => ({ ...prev, ...t })),
      payeeKind,
      setPayeeKind,
      entity,
      openEntity: setEntity,
      closeEntity: () => setEntity(null),
      theme,
      toggleTheme,
      lastImport,
      setLastImport,
    }),
    [view, txn, entity, theme, toggleTheme, lastImport, payeeKind],
  );

  return (
    <QueryClientProvider client={client}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </QueryClientProvider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <Providers>");
  return v;
}

/** Resolve the selected preset into concrete dates, anchored to the latest transaction rather than today
 *  (statements are historical, so "last 3 months" means the last 3 months of data). */
export function resolveRange(
  preset: Preset,
  lastDate: string | null,
  customStart: string,
  customEnd: string,
): { start: string | null; end: string | null } {
  if (preset === "custom") return { start: customStart || null, end: customEnd || null };
  if (preset === "all" || !lastDate) return { start: null, end: null };
  const last = parseISODate(lastDate);
  const back = (months: number) => new Date(last.getFullYear(), last.getMonth() - months, last.getDate() + 1);
  const fyStartYear = last.getMonth() >= 3 ? last.getFullYear() : last.getFullYear() - 1;
  switch (preset) {
    case "30d":
      return { start: toISODate(new Date(last.getFullYear(), last.getMonth(), last.getDate() - 29)), end: lastDate };
    case "3m":
      return { start: toISODate(back(3)), end: lastDate };
    case "6m":
      return { start: toISODate(back(6)), end: lastDate };
    case "12m":
      return { start: toISODate(back(12)), end: lastDate };
    case "fy":
      return { start: `${fyStartYear}-04-01`, end: lastDate };
    case "pfy":
      return { start: `${fyStartYear - 1}-04-01`, end: `${fyStartYear}-03-31` };
  }
}
