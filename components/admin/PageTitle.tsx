"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { STAGE_LABELS, type OrderStage } from "@/lib/order-stage";

/**
 * The page heading, rendered in the top bar instead of the body.
 *
 * Driven by the pathname rather than a context the pages write into: a context
 * would have to be set from an effect, which flashes an empty bar on every
 * navigation. Screens that aren't listed here render nothing and keep their own
 * body heading, so nothing ever shows a title twice.
 */
const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/admin/delivery-portal": {
    title: "Delivery portal",
    subtitle: "Copy the address, tick what's done",
  },
};

export default function PageTitle() {
  const pathname = usePathname();
  const params = useSearchParams();

  if (pathname === "/admin/orders") {
    const stage = (params.get("stage") ?? "all") as OrderStage | "all";
    // A hand-edited ?stage= can be anything; fall back rather than render blank.
    const subtitle = stage === "all" ? "All customers" : STAGE_LABELS[stage] ?? "All customers";
    return <Heading title="Orders" subtitle={subtitle} />;
  }

  const fixed = TITLES[pathname];
  return fixed ? <Heading title={fixed.title} subtitle={fixed.subtitle} /> : null;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-w-0">
      <h1 className="text-base font-black leading-tight truncate">{title}</h1>
      <p className="text-neutral-500 text-xs leading-tight truncate">{subtitle}</p>
    </div>
  );
}
