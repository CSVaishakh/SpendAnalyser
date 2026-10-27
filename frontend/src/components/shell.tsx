"use client";

import clsx from "clsx";
import { ArrowLeftRight, BarChart3, FileSpreadsheet, LayoutDashboard, Moon, Search, Sun, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import { useMeta, useScope } from "@/lib/queries";
import { PRESETS, useApp, type Preset } from "@/lib/state";
import { EntityDrawer } from "./entity-drawer";
import { Input, Select } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/payees", label: "Payees", icon: Users },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/statements", label: "Statements", icon: FileSpreadsheet },
  { href: "/rules", label: "Rules", icon: Wand2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { theme, toggleTheme } = useApp();
  const meta = useMeta();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-[15px] font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-page"><BarChart3 size={16} aria-hidden /></span>
          Spend Analyser
        </Link>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                <Icon size={16} strokeWidth={1.8} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 px-2">
          {meta.data && meta.data.transactions > 0 && (
            <div className="text-xs text-muted">
              <div className="font-medium text-ink-2">{meta.data.transactions.toLocaleString("en-IN")} transactions</div>
              {fmtDate(meta.data.first_date)} – {fmtDate(meta.data.last_date)}
            </div>
          )}
          <button onClick={toggleTheme} className="flex items-center gap-2 text-xs text-ink-2 hover:text-ink">
            {theme === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="flex items-center gap-2 font-semibold"><BarChart3 size={16} aria-hidden /> Spend Analyser</span>
            <button onClick={toggleTheme} aria-label="Toggle theme" className="p-1 text-ink-2">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
            {NAV.map(({ href, label }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href} className={clsx("whitespace-nowrap rounded-md px-2.5 py-1 text-[13px]", active ? "bg-surface-2 font-semibold" : "text-ink-2")}>
                  {label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 md:px-8 md:py-7">{children}</main>
      </div>
      <EntityDrawer />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Date range + search, shared by Overview, Payees and Transactions. */
export function FilterBar({ children }: { children?: ReactNode }) {
  const { preset, setPreset, customStart, customEnd, setCustom, q, setQ, setAccount } = useApp();
  const meta = useMeta();
  const scope = useScope();
  const [draft, setDraft] = useState(q);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(q), [q]); // follow restores and resets from elsewhere
  useEffect(() => {
    if (draft.trim() === q) return;
    const id = setTimeout(() => setQ(draft.trim()), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {(meta.data?.accounts.length ?? 0) > 1 && (
        <Select aria-label="Account" value={scope.account ?? ""} onChange={(e) => setAccount(e.target.value ? Number(e.target.value) : null)}
          className="max-w-[15rem] font-medium">
          <option value="">All accounts</option>
          {meta.data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
      <Select aria-label="Date range" value={preset} onChange={(e) => {
        const p = e.target.value as Preset;
        if (p === "custom") setCustom(scope.start ?? meta.data?.first_date ?? "", scope.end ?? meta.data?.last_date ?? "");
        else setPreset(p);
      }}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
      {preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From" value={customStart} min={meta.data?.first_date ?? undefined} max={customEnd || undefined}
            onChange={(e) => setCustom(e.target.value, customEnd)} className="w-[9.5rem]" />
          <span className="text-muted">–</span>
          <Input type="date" aria-label="To" value={customEnd} min={customStart || undefined} max={meta.data?.last_date ?? undefined}
            onChange={(e) => setCustom(customStart, e.target.value)} className="w-[9.5rem]" />
        </div>
      ) : (
        <span className="text-xs text-muted">
          {scope.start ? `${fmtDate(scope.start)} – ${fmtDate(scope.end)}` : meta.data?.first_date ? `${fmtDate(meta.data.first_date)} – ${fmtDate(meta.data.last_date)}` : ""}
        </span>
      )}
      <label className="relative ml-auto w-full sm:w-72">
        <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <span className="sr-only">Search</span>
        <Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search payee, narration, UPI ID…" className="w-full pl-8" />
      </label>
      {children}
    </div>
  );
}
