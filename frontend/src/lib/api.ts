// Typed client for the FastAPI backend. Requests go to /api/* which Next rewrites to the Python server.

export type Txn = {
  id: number;
  date: string;
  value_date: string | null;
  particulars: string;
  tran_type: string;
  cheque: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  channel: string;
  entity: string;
  category: string;
  counterparty: string | null;
  auto_entity: string;
  rule_id: number | null;
  statement_id: number;
  account_id: number | null;
  is_transfer: boolean;
  kind: Kind;
  kind_reason: string | null;
  payer_app: string | null; // UPI app used for an outgoing payment
};

export type Kind = "person" | "business" | "self" | "cash" | "bank" | "unknown";
/** Types a user can assign to a payee. */
export type SettableKind = "person" | "business" | "cash";
export const KIND_LABEL: Record<Kind, string> = {
  person: "Person", business: "Business", self: "Own account", cash: "Cash", bank: "Bank", unknown: "Unclassified",
};

export type Account = {
  id: number;
  name: string;
  bank: string | null;
  number: string | null;
  last4: string | null;
  holder: string | null;
  kind: string | null;
  transactions?: number;
  statements?: number;
  first_date?: string | null;
  last_date?: string | null;
  balance?: number | null;
};

export type AccountSummary = {
  account_id: number;
  opening: number;
  closing: number;
  income: number;
  spend: number;
  first_date: string;
  last_date: string;
  transactions: number;
};

export type Group = { name: string; amount: number; count: number; share: number; category?: string };

export type Recurring = {
  name: string;
  category: string;
  monthly_amount: number;
  months: number;
  variability: number;
  typical_day: number;
  last_date: string;
  last_amount: number;
  next_expected: string;
};

export type Dashboard = {
  range: { start: string | null; end: string | null; days: number };
  kpis: {
    income: number;
    spend: number;
    net: number;
    savings_rate: number | null;
    opening_balance: number | null;
    closing_balance: number | null;
    avg_monthly_spend: number;
    avg_monthly_income: number;
    credits: number;
    debits: number;
    transactions: number;
    payees: number;
    previous: { income: number; spend: number; net: number; start: string; end: string } | null;
    moved_between_accounts: number;
  };
  accounts: AccountSummary[];
  monthly: { month: string; income: number; spend: number; net: number }[];
  balance: { date: string; balance: number; by_account: Record<string, number> }[];
  categories: Group[];
  income_categories: Group[];
  channels: Group[];
  top_payees: Group[];
  top_sources: Group[];
  weekday: { day: string; amount: number; count: number }[];
  largest: Txn[];
  recurring: Recurring[];
  kinds: (Group & { kind: Kind; payees: number })[];
  apps: Group[];
  top_people: Group[];
  top_businesses: Group[];
};

export type Meta = {
  first_date: string | null;
  last_date: string | null;
  transactions: number;
  statements: number;
  accounts: { id: number; name: string }[];
  apps: string[];
  categories: string[];
  used_categories: string[];
  channels: string[];
  entities: string[];
};

export type EntityRow = {
  name: string;
  category: string;
  paid: number;
  payments: number;
  avg_payment: number;
  received: number;
  receipts: number;
  net: number;
  share_out: number;
  share_in: number;
  first_date: string;
  last_date: string;
  months_active: number;
  channels: string[];
  accounts: number[];
  counterparties: string[];
  kind: Kind;
  kind_reason: string | null;
};

export type EntityDetail = {
  name: string;
  category: string;
  kind: Kind;
  kind_reason: string | null;
  categories: Record<string, number>;
  channels: Record<string, number>;
  auto_names: string[];
  counterparties: string[];
  stats: {
    paid: number;
    payments: number;
    avg_payment: number;
    median_payment: number;
    largest_payment: number;
    received: number;
    receipts: number;
    net: number;
    share_of_spend: number;
    first_date: string;
    last_date: string;
    typical_gap_days: number | null;
    months_active: number;
  };
  recurring: Recurring | null;
  by_account: { account_id: number | null; paid: number; received: number; count: number }[];
  monthly: { month: string; paid: number; received: number; count: number }[];
  variants: { text: string; count: number }[];
  transactions: Txn[];
};

export type TxnPage = {
  total: number;
  page: number;
  page_size: number;
  sum_withdrawal: number;
  sum_deposit: number;
  transfers_hidden: number;
  transfers_hidden_amount: number;
  items: Txn[];
};

export type Statement = {
  id: number;
  account_id: number | null;
  account_name: string | null;
  filename: string;
  uploaded_at: string | null;
  period_start: string | null;
  period_end: string | null;
  rows_parsed: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_skipped: number;
  balance_checked: number;
  balance_mismatches: number;
  reversed_order: boolean;
  warnings: string[];
};

export type UploadResult = {
  filename: string;
  status: "imported" | "duplicate" | "error" | "password_required";
  wrong_password: boolean;
  message: string;
  statement_id: number | null;
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  balance_checked: number;
  balance_mismatches: number;
  reversed_order: boolean;
  period_start: string | null;
  period_end: string | null;
  account_id: number | null;
  account_name: string | null;
  account_created: boolean;
  account_how: string;
  transfers_linked: number;
  warnings: string[];
};

export type RuleInput = {
  field: "any" | "particulars" | "entity";
  match_mode: "contains" | "exact" | "regex";
  pattern: string;
  set_entity: string | null;
  set_category: string | null;
  set_kind?: SettableKind | null;
};
export type Rule = RuleInput & { id: number; position: number; hits: number };

export type Params = Record<string, string | number | null | undefined>;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function qs(params?: Params): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function api<T>(path: string, init?: RequestInit & { params?: Params; json?: unknown }): Promise<T> {
  const { params, json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(params)}`, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Can't reach the analysis server. Is the backend running on port 8000?", 0);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (Array.isArray(body.detail)) msg = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      if (res.status >= 500) msg = "The analysis server isn't responding. Start it with `make dev` or `uv run uvicorn app.main:app`.";
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const exportUrl = (path: string, params?: Params) => `/api${path}${qs(params)}`;
