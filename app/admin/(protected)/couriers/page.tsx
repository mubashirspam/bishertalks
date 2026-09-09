import { Suspense } from "react";
import { Truck } from "lucide-react";
import { requirePageAccessAny } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { listCouriers } from "@/lib/db/couriers";
import { delhiveryReadiness, delhiveryEnv } from "@/lib/delhivery/config";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import CourierManager from "./CourierManager";

export const dynamic = "force-dynamic";

/**
 * The logistics partners.
 *
 * The screen that makes adding a partner a five-second job instead of a
 * deploy — which is the point of the whole courier table. Most partners will be
 * `manual`: we hand the parcel over or post it, and someone types the tracking
 * number in. Only a partner with an API we have actually integrated can be sent
 * to from here, and the page says plainly which is which.
 */
export default async function CouriersPage() {
  // Three separate reasons to be here — managing couriers, entering barcode
  // stock, importing a postal delivery report — and only one of them is
  // needed to reach the page at all. Which of those a person actually gets is
  // decided inside Body, per section; this just decides whether the screen
  // has anything on it for them.
  const staff = await requirePageAccessAny([
    "delivery.assign",
    "delivery.barcodes",
    "delivery.complete",
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary-500" /> Couriers
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Who carries parcels, and how each one gets them. Adding a courier here
          makes it choosable on the delivery screen.
        </p>
      </div>

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={4} columns={4} /></>}>
        <Body
          canComplete={can(staff, "delivery.complete")}
          canManage={can(staff, "delivery.assign")}
          canBarcodes={can(staff, "delivery.barcodes")}
        />
      </Suspense>
    </div>
  );
}

async function Body({
  canComplete,
  canManage,
  canBarcodes,
}: {
  canComplete: boolean;
  canManage: boolean;
  canBarcodes: boolean;
}) {
  const couriers = await listCouriers();

  // Checked on the server: the token must never reach the browser, and the
  // admin needs to know why the Send button is refusing to work.
  const delhivery = couriers.find((c) => c.slug === "delhivery");
  const readiness = delhivery
    ? delhiveryReadiness(delhivery.config)
    : { ready: false, missing: [], settings: null };

  return (
    <CourierManager
      couriers={couriers}
      delhivery={{
        configured: readiness.ready,
        missing: readiness.missing,
        env: delhiveryEnv(),
      }}
      canComplete={canComplete}
      canManage={canManage}
      canBarcodes={canBarcodes}
    />
  );
}
