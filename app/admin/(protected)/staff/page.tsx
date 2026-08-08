import { Suspense } from "react";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import { Shield } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { listStaff } from "@/lib/db/staff";
import StaffManager from "./StaffManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Guard runs in the shell so an unauthorised visitor is redirected before
  // any of the work below is started. The staff lookup is memoised per
  // request, so the body re-reading it costs nothing.
  await requirePageAccess("staff.manage");

  return (
    <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={4} columns={5} /></>}>
      <StaffBody  />
    </Suspense>
  );
}

async function StaffBody() {
  const me = await requirePageAccess("staff.manage");
  const staff = await listStaff();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary-500" /> Staff
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Who can sign in, and what each person is allowed to do. A role sets the
          usual permissions; tick or untick them for anyone who needs something
          different.
        </p>
      </div>

      <StaffManager staff={staff} currentStaffId={me.id} />
    </div>
  );
}
