import Link from "@/components/admin/AdminLink";
import { ArrowLeft, MapPin } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { listPincodeStats, type PincodeFilter } from "@/lib/db/pincode-stats";
import { listStaff } from "@/lib/db/staff";
import PincodeTable from "./PincodeTable";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

const isFilter = (v: string | undefined): v is PincodeFilter =>
  v === "eligible" || v === "not_eligible" || v === "overridden";

/**
 * Every pincode Delhivery has ever been asked to carry, and the rule's own
 * verdict on it — the browse-and-override screen behind the "Courier fit"
 * filter on /admin/delivery. See lib/db/pincode-stats.ts for the rule
 * (>=3 delivered, >=90% within 5 days of packing) and how an override here
 * survives the next automatic recompute instead of being overwritten by it.
 */
export default async function PincodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const staff = await requirePageAccess("delivery.view");
  const mayOverride = can(staff, "delivery.assign");

  const params = await searchParams;
  const search = params.q ?? "";
  const filter = isFilter(params.filter) ? params.filter : "all";
  const pageNum = Math.max(0, parseInt(params.page ?? "1") - 1);

  const [{ rows, count }, staffList] = await Promise.all([
    listPincodeStats({ search, filter, pageNum, perPage: PER_PAGE }),
    listStaff(),
  ]);
  const staffNames = Object.fromEntries(staffList.map((s) => [s.id, s.name]));

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/delivery"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Delivery
        </Link>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary-500" /> Pincodes
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Every pincode with Delhivery delivery history, and whether it&apos;s earned
          the fast lane — 3+ delivered, 90%+ packed-to-delivered within 5 days.{" "}
          {mayOverride
            ? "Pin one by hand to override the rule; a pin survives the next automatic recompute."
            : "Only delivery.assign can change a pin."}
        </p>
      </div>

      <PincodeTable
        rows={rows}
        count={count}
        pageNum={pageNum}
        perPage={PER_PAGE}
        search={search}
        filter={filter}
        staffNames={staffNames}
        mayOverride={mayOverride}
      />
    </div>
  );
}
