"use client";

import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Group } from "@/lib/api";
import { fmtDate, fmtDayMonth, fmtMonth, inr, inrCompact, inrExact, pct, signedInr } from "@/lib/format";
import { useApp } from "@/lib/state";

type Tokens = Record<"in" | "out" | "grid" | "axis" | "muted" | "ink2" | "surface" | "wash", string>;
const FALLBACK: Tokens = { in: "#2a78d6", out: "#eb6834", grid: "#e6e5df", axis: "#c3c2b7", muted: "#7d7b75", ink2: "#52514e", surface: "#fcfcfb", wash: "rgba(42,120,214,.07)" };

/** Chart colours resolved from CSS tokens; re-read when the theme flips. */
export function useTokens(): Tokens {
  const { theme } = useApp();
  const [t, setT] = useState<Tokens>(FALLBACK);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const v = (n: string) => s.getPropertyValue(n).trim();
      setT({ in: v("--in"), out: v("--out"), grid: v("--grid"), axis: v("--axis"), muted: v("--muted"), ink2: v("--ink-2"), surface: v("--surface"), wash: v("--wash") });
    };
    read();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [theme]);
  return t;
}

const axisTick = (t: Tokens) => ({ fill: t.muted, fontSize: 11 });

function TipBox({ title, rows, footer }: { title: ReactNode; rows: { label: string; value: string; color?: string }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg border border-axis bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5 text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tnum font-medium text-ink">{r.value}</span>
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-grid pt-1 text-ink">{footer}</div>}
    </div>
  );
}

type TipProps = { active?: boolean; payload?: readonly { payload?: Record<string, number | string> }[]; label?: string | number };

export function MonthlyCashflowChart({ data, height = 280 }: { data: { month: string; income: number; spend: number; net: number }[]; height?: number }) {
  const t = useTokens();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey="month" tickFormatter={(m) => fmtMonth(m)} tick={axisTick(t)} axisLine={{ stroke: t.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tickFormatter={inrCompact} tick={axisTick(t)} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          cursor={{ fill: t.wash }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? (
              <TipBox
                title={fmtMonth(String(payload[0].payload!.month), true)}
                rows={[
                  { label: "Money in", value: inr(Number(payload[0].payload!.income)), color: t.in },
                  { label: "Money out", value: inr(Number(payload[0].payload!.spend)), color: t.out },
                ]}
                footer={<span className="flex justify-between gap-4"><span>Net</span><span className="tnum font-semibold">{signedInr(Number(payload[0].payload!.net))}</span></span>}
              />
            ) : null
          }
        />
        <Bar dataKey="income" name="Money in" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="spend" name="Money out" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ data, height = 240, accountNames }: {
  data: { date: string; balance: number; by_account?: Record<string, number> }[]; height?: number; accountNames?: Map<number, string>;
}) {
  const t = useTokens();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="balFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={t.in} stopOpacity={0.14} />
            <stop offset="100%" stopColor={t.in} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey="date" tickFormatter={fmtDayMonth} tick={axisTick(t)} axisLine={{ stroke: t.axis }} tickLine={false} minTickGap={40} />
        <YAxis tickFormatter={inrCompact} tick={axisTick(t)} axisLine={false} tickLine={false} width={56} domain={["auto", "auto"]} />
        <Tooltip
          cursor={{ stroke: t.axis, strokeWidth: 1 }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? (
              <TipBox
                title={fmtDate(String(payload[0].payload!.date))}
                rows={[
                  { label: accountNames && accountNames.size > 1 ? "Total balance" : "Balance", value: inrExact(Number(payload[0].payload!.balance)), color: t.in },
                  ...(accountNames && accountNames.size > 1
                    ? Object.entries((payload[0].payload as unknown as { by_account: Record<string, number> }).by_account ?? {}).map(([id, v]) => ({
                        label: accountNames.get(Number(id)) ?? "Account", value: inr(v),
                      }))
                    : []),
                ]}
              />
            ) : null
          }
        />
        <Area type="linear" dataKey="balance" stroke={t.in} strokeWidth={2} fill="url(#balFill)"
          activeDot={{ r: 4.5, fill: t.in, stroke: t.surface, strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ColumnChart({ data, xKey, yKey, color = "out", height = 220, xFormat, tipTitle, tipRows }: {
  data: Record<string, string | number>[]; xKey: string; yKey: string; color?: "in" | "out"; height?: number;
  xFormat?: (v: string) => string; tipTitle: (d: Record<string, string | number>) => string;
  tipRows: (d: Record<string, string | number>) => { label: string; value: string }[];
}) {
  const t = useTokens();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey={xKey} tickFormatter={xFormat} tick={axisTick(t)} axisLine={{ stroke: t.axis }} tickLine={false} minTickGap={6} />
        <YAxis tickFormatter={inrCompact} tick={axisTick(t)} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          cursor={{ fill: t.wash }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? <TipBox title={tipTitle(payload[0].payload!)} rows={tipRows(payload[0].payload!)} /> : null
          }
        />
        <Bar dataKey={yKey} fill={color === "in" ? t.in : t.out} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EntityMonthlyChart({ data, showReceived }: { data: { month: string; paid: number; received: number; count: number }[]; showReceived: boolean }) {
  const t = useTokens();
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey="month" tickFormatter={(m) => fmtMonth(m)} tick={axisTick(t)} axisLine={{ stroke: t.axis }} tickLine={false} minTickGap={8} />
        <YAxis tickFormatter={inrCompact} tick={axisTick(t)} axisLine={false} tickLine={false} width={52} />
        <Tooltip
          cursor={{ fill: t.wash }}
          content={({ active, payload }: TipProps) =>
            active && payload?.length ? (
              <TipBox
                title={fmtMonth(String(payload[0].payload!.month), true)}
                rows={[
                  { label: "Paid", value: inr(Number(payload[0].payload!.paid)), color: t.out },
                  ...(showReceived ? [{ label: "Received", value: inr(Number(payload[0].payload!.received)), color: t.in }] : []),
                  { label: "Transactions", value: String(payload[0].payload!.count) },
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="paid" fill={t.out} radius={[4, 4, 0, 0]} maxBarSize={22} />
        {showReceived && <Bar dataKey="received" fill={t.in} radius={[4, 4, 0, 0]} maxBarSize={22} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars in HTML: labels never clip, every row is a real button, and values align in a column. */
export function BarList({ items, color = "out", onSelect, limit, emptyText = "Nothing in this range." }: {
  items: Group[]; color?: "in" | "out"; onSelect?: (name: string) => void; limit?: number; emptyText?: string;
}) {
  const rows = limit ? items.slice(0, limit) : items;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((r) => {
        const content = (
          <>
            <span className="min-w-0 truncate text-left text-[13px] text-ink">{r.name}</span>
            <span className="relative h-2.5 min-w-0 overflow-hidden rounded-[3px]" aria-hidden>
              <span className={clsx("absolute inset-y-0 left-0 rounded-r-[4px]", color === "in" ? "bg-in" : "bg-out")} style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%` }} />
            </span>
            <span className="tnum text-right text-[13px] font-medium">{inr(r.amount)}</span>
            <span className="tnum hidden text-right text-xs text-muted sm:block">{pct(r.share)}</span>
          </>
        );
        const cls = "grid w-full grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_6.5rem_3.25rem]";
        return (
          <li key={r.name}>
            {onSelect ? (
              <button className={clsx(cls, "hover:bg-wash")} onClick={() => onSelect(r.name)} title={`${r.name}: ${inrExact(r.amount)} across ${r.count} transactions`}>
                {content}
              </button>
            ) : (
              <div className={cls} title={`${r.count} transactions`}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
