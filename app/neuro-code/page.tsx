import type { Metadata } from "next";
import { getProductPricing } from "@/lib/db/courses";
import NeuroCodeLanding from "./NeuroCodeLanding";

// Price is admin-editable, so this page can't be statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Neuro Code — The Book by Bisher KC | Free NLP Course Included",
  description:
    "Rewrite your internal programming. Order Neuro Code by Bisher KC and get the complete NLP Mastery course free — 14 modules, 42 video lessons and 17 worksheets, unlocked the moment you order.",
  alternates: { canonical: "https://bishertalks.com/neuro-code" },
};

export default async function NeuroCodePage() {
  const pricing = await getProductPricing();
  return <NeuroCodeLanding pricing={pricing} />;
}
