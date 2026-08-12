"use client";

import { usePathname } from "next/navigation";

/**
 * Screens that get the whole window instead of the reading-width column.
 *
 * The delivery portal is a spreadsheet: a dozen columns an agent reads across
 * while copying an address into a courier's site. Capping it at max-w-7xl put
 * a permanent horizontal scroll on a screen wide enough to show everything.
 */
const FULL_WIDTH = ["/admin/delivery-portal"];

/**
 * The admin content column.
 *
 * A client component purely to read the path — the layout around it is a
 * server component, and a server component can't ask which page it's holding.
 */
export default function AdminMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = FULL_WIDTH.some((p) => pathname.startsWith(p));

  return (
    <main className={`px-4 lg:px-8 py-4 lg:py-5 ${wide ? "" : "max-w-7xl"}`}>
      {children}
    </main>
  );
}
