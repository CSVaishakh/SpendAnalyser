import type { Metadata } from "next";
import { RulesView } from "@/components/views/rules";

export const metadata: Metadata = { title: "Rules" };

export default function Page() {
  return <RulesView />;
}
