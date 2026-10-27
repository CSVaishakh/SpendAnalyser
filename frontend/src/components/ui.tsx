"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Card({ title, subtitle, actions, children, className, flush }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={clsx("min-w-0 rounded-xl border border-line bg-surface shadow-card", !flush && "p-5", className)}>
      {(title || actions) && (
        <header className={clsx("mb-4 flex items-start justify-between gap-3", flush && "px-5 pt-5")}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; icon?: LucideIcon;
};
export function Button({ variant = "secondary", size = "md", icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-ink text-page hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface hover:bg-surface-2",
        variant === "ghost" && "hover:bg-surface-2",
        variant === "danger" && "border border-line bg-surface text-bad hover:bg-bad/10",
        !children && (size === "sm" ? "w-8 px-0" : "w-9 px-0"),
        className,
      )}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.8} aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, icon: Icon, children, download }: { href: string; icon?: LucideIcon; children: ReactNode; download?: boolean }) {
  const cls = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2";
  const inner = <>{Icon && <Icon size={16} strokeWidth={1.8} aria-hidden />}{children}</>;
  return download ? <a href={href} download className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx("h-9 min-w-0 rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted", className)}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx("h-9 min-w-0 rounded-lg border border-line bg-surface px-2.5 text-sm", className)}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-7 rounded-md px-2.5 text-[13px] transition-colors",
            value === o.value ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: {
  children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "accent"; className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-px text-[11px] font-medium",
        tone === "neutral" && "border-line bg-surface-2 text-ink-2",
        tone === "good" && "border-good/25 bg-good/10 text-good",
        tone === "bad" && "border-bad/25 bg-bad/10 text-bad",
        tone === "warn" && "border-warn/25 bg-warn/10 text-warn",
        tone === "accent" && "border-accent/25 bg-accent/10 text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function KindBadge({ kind, reason }: { kind: string; reason?: string | null }) {
  const label = { person: "Person", business: "Business", self: "Own account", cash: "Cash", bank: "Bank", unknown: "Unclassified" }[kind] ?? kind;
  return (
    <Badge tone={kind === "business" ? "accent" : kind === "unknown" ? "warn" : "neutral"} className="shrink-0">
      <span title={reason ? `Why: ${reason}` : undefined}>{label}</span>
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function Swatch({ color }: { color: "in" | "out" }) {
  return <span className={clsx("inline-block size-2.5 shrink-0 rounded-[3px]", color === "in" ? "bg-in" : "bg-out")} aria-hidden />;
}

export function Legend({ items }: { items: { label: string; color: "in" | "out" }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Stat tile: label · value · optional delta vs the previous period. */
export function Stat({ label, value, sub, delta, upIsGood = true, swatch, tone, hero }: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: number | null; upIsGood?: boolean;
  swatch?: "in" | "out"; tone?: "good" | "bad"; hero?: boolean;
}) {
  const good = delta != null && (delta >= 0) === upIsGood;
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-ink-2">
        {swatch && <Swatch color={swatch} />}
        {label}
      </div>
      <div className={clsx("mt-1 truncate font-semibold tracking-tight", hero ? "text-[28px] leading-9" : "text-[22px] leading-8",
        tone === "good" && "text-good", tone === "bad" && "text-bad")}>
        {value}
      </div>
      <div className="mt-0.5 flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-muted">
        {delta != null && Number.isFinite(delta) && (
          <span className={clsx("inline-flex items-center font-medium", good ? "text-good" : "text-bad")}>
            {delta >= 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
            {Math.abs(delta * 100).toFixed(1)}%
            <span className="sr-only">{delta >= 0 ? "up" : "down"} vs previous period</span>
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

export function Meter({ value, color = "out" }: { value: number; color?: "in" | "out" }) {
  return (
    <span className={clsx("inline-block h-1.5 w-16 overflow-hidden rounded-full", color === "out" ? "bg-out/15" : "bg-in/15")} aria-hidden>
      <span className={clsx("block h-full rounded-full", color === "out" ? "bg-out" : "bg-in")} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-ink-2">
        <Icon size={20} strokeWidth={1.7} aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function SortHeader({ label, active, dir, onClick, align = "left" }: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right";
}) {
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={clsx("sticky top-0 z-[1] bg-surface px-3 py-2.5 text-xs font-semibold text-ink-2", align === "right" ? "text-right" : "text-left")}>
      <button onClick={onClick} className={clsx("inline-flex h-5 items-center gap-0.5 align-middle hover:text-ink", align === "right" && "flex-row-reverse", active && "text-ink")}>
        {label}
        {active ? (dir === "asc" ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />) : <span className="w-[13px]" />}
      </button>
    </th>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th scope="col" className={clsx("sticky top-0 z-[1] bg-surface px-3 py-2.5 text-xs font-semibold text-ink-2", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export const tdCls = "border-t border-grid px-3 py-2.5 align-middle";
export const numCls = "tnum text-right whitespace-nowrap";
