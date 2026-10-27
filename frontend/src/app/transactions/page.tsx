import type { Metadata } from "next";
import { TransactionsView } from "@/components/views/transactions";

export const metadata: Metadata = { title: "Transactions" };

export default function Page() {
  return <TransactionsView />;
}
