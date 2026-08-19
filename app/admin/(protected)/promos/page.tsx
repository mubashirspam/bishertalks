import { Suspense } from "react";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { listPromoCodes } from "@/lib/db/promo";
import { getGiftSettings } from "@/lib/db/gift";
import { getCheckoutSettings } from "@/lib/db/checkout-settings";
import AddPromoForm from "./AddPromoForm";
import PromoRow from "./PromoRow";
import GiftSettingsCard from "./GiftSettingsCard";
import PromoFieldCard from "./PromoFieldCard";
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Guard runs in the shell so an unauthorised visitor is redirected before
  // any of the work below is started. The staff lookup is memoised per
  // request, so the body re-reading it costs nothing.
  await requirePageAccess("promos.manage");

  return (
    <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={6} columns={5} /></>}>
      <PromosBody  />
    </Suspense>
  );
}

async function PromosBody() {
  await requirePageAccess("promos.manage");

  const [promos, gift, checkout] = await Promise.all([
    listPromoCodes(),
    getGiftSettings(),
    getCheckoutSettings(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-neutral-900">Checkout</h1>
        <p className="text-neutral-500 text-sm mt-1">
          What a customer can add or take off at the moment of paying.
        </p>
      </div>

      {/* Gift wrapping lives here rather than on a screen of its own: it is a
          checkout-time money setting, which is what this page already is, and
          two fields do not earn a nav item. */}
      <GiftSettingsCard settings={gift} />

      {/* Above the table it governs: "these codes exist but nobody can enter
          them" is the most confusing state this screen has, so the switch that
          causes it is the thing you read first. */}
      <PromoFieldCard settings={checkout} />

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-neutral-900">Promo codes</h2>
          <p className="text-neutral-500 text-sm mt-1">
            {promos.length} code{promos.length === 1 ? "" : "s"} ·{" "}
            {checkout.promoFieldIsEnabled
              ? "applied at checkout"
              : "field hidden — nobody can enter one"}
          </p>
        </div>
        <AddPromoForm />
      </div>

      {!promos.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          No promo codes yet. Create one to offer a discount at checkout.
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Code</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Discount</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">Used</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden lg:table-cell">Expires</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <PromoRow key={p.id} promo={p} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
