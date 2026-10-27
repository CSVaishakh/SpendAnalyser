import type { Metadata } from "next";
import { PayeesView } from "@/components/views/payees";

export const metadata: Metadata = { title: "Payees" };

export default function Page() {
  return <PayeesView />;
}
