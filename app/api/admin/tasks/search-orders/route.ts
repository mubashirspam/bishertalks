export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { searchOrdersForTask } from "@/lib/db/tasks";

/** The task form's attach-order typeahead. Lean JSON, nothing else reads this. */
export async function GET(request: NextRequest) {
  const auth = await requirePermission("tasks.view");
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const orders = await searchOrdersForTask(q);
  return NextResponse.json({ orders });
}
