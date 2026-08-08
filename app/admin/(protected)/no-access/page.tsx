import { ShieldOff } from "lucide-react";
import { getCurrentStaff } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Where someone lands when their account has no capabilities at all — a new
 * staff member whose permissions haven't been set yet, or one whose access was
 * narrowed to nothing.
 *
 * A dead end by design, but a legible one: it names who they're signed in as,
 * so the owner can fix the right account.
 */
export default async function NoAccessPage() {
  const staff = await getCurrentStaff();

  return (
    <div className="max-w-lg">
      <div className="bg-white border border-neutral-200 rounded-2xl p-8 shadow-sm text-center">
        <div className="w-12 h-12 bg-neutral-100 rounded-xl flex items-center justify-center mx-auto mb-4">
          <ShieldOff className="w-6 h-6 text-neutral-400" />
        </div>
        <h1 className="text-lg font-bold text-neutral-900">No access yet</h1>
        <p className="text-neutral-500 text-sm mt-2 leading-relaxed">
          Your account doesn&apos;t have permission to open anything in here yet.
          Ask the owner to give you access.
        </p>
        {staff && (
          <p className="text-neutral-400 text-xs mt-4">
            Signed in as <span className="font-medium text-neutral-600">{staff.email}</span>
          </p>
        )}
      </div>
    </div>
  );
}
