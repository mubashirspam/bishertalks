import { Suspense } from "react";
import { SkeletonHeader, SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import { Gift } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import {
  listReferrers,
  getReferrerStats,
  getReferralSettings,
} from "@/lib/db/referrals";
import ReferralsManager from "./ReferralsManager";
import { getProductPricing } from "@/lib/db/courses";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Guard runs in the shell so an unauthorised visitor is redirected before
  // any of the work below is started. The staff lookup is memoised per
  // request, so the body re-reading it costs nothing.
  await requirePageAccess("referrals.view");

  return (
    <Suspense fallback={<><SkeletonHeader /><SkeletonStats /><SkeletonTable rows={8} columns={7} /></>}>
      <ReferralsBody  />
    </Suspense>
  );
}

async function ReferralsBody() {
  const staff = await requirePageAccess("referrals.view");

  const [referrers, stats, settings, pricing] = await Promise.all([
    listReferrers(),
    getReferrerStats(),
    getReferralSettings(),
    // The book's normal price, so the settings card can show what a referred
    // sale actually nets instead of asking the reader to do the arithmetic.
    getProductPricing(),
  ]);

  // Flattened here rather than in the client: the stats map is keyed by id and
  // a Map doesn't survive the server/client boundary.
  const rows = referrers.map((r) => ({
    ...r,
    stats: stats.get(r.id) ?? {
      referrerId: r.id,
      orders: 0,
      paidOrders: 0,
      pendingPaise: 0,
      approvedPaise: 0,
      paidPaise: 0,
    },
  }));

  // Owed = approved only. Pending commissions are for parcels still in transit
  // and are deliberately not counted as a liability yet.
  const totalOwed = rows.reduce((s, r) => s + r.stats.approvedPaise, 0);
  const totalPaid = rows.reduce((s, r) => s + r.stats.paidPaise, 0);
  const totalPending = rows.reduce((s, r) => s + r.stats.pendingPaise, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary-500" /> Referrals
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Add the people you want sharing the book. Commission is approved when
          the parcel is <strong>delivered</strong> — not when it&apos;s paid for — so
          returns never cost you a payout.
        </p>
      </div>

      <ReferralsManager
        rows={rows}
        settings={settings}
        totals={{ owed: totalOwed, paid: totalPaid, pending: totalPending }}
        canPayout={can(staff, "referrals.payout")}
        bookPriceRupees={pricing.payable}
      />
    </div>
  );
}
