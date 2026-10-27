const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("en-IN");

export const inr = (n: number) => inr0.format(Math.round(n));
export const inrExact = (n: number) => inr2.format(n);
export const inrCompact = (n: number) => `${n < 0 ? "−" : ""}₹${compact.format(Math.abs(n))}`;
export const signedInr = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${inr(Math.abs(n))}`;
export const count = (n: number) => int.format(n);
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = parseISODate(s);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const fmtDayMonth = (s: string) => {
  const d = parseISODate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const fmtMonth = (key: string, long = false) => {
  const [y, m] = key.split("-").map(Number);
  return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};

export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
