export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";

/**
 * Recording, correcting and removing a line in the expense ledger.
 *
 * Rupees in, paise stored — the same boundary `app/api/admin/reports/costs`
 * already keeps. Every money column in this database is paise, and a form that
 * asked for paise would produce a hundredfold error the first time somebody
 * typed what they saw on the invoice.
 *
 * A DELETE is a real delete rather than a flag. An expense is a claim on the
 * company's money, and a wrong one left soft-deleted is a number that keeps
 * turning up in somebody's balance long after everyone agreed it was a
 * mistake. The audit log holds what was removed and by whom.
 */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Whole rupees (or a decimal) to paise, refusing anything that is not money. */
function paise(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

interface Parsed {
  row: Record<string, unknown>;
  error?: undefined;
}
interface Failed {
  row?: undefined;
  error: string;
}

async function parse(body: Record<string, unknown>): Promise<Parsed | Failed> {
  const spentOn = str(body.spent_on);
  const categoryId = str(body.category_id);
  const funderId = str(body.funder_id);
  const description = str(body.description);
  const amountPaise = paise(body.amount_rupees);

  const problems: string[] = [];
  if (!isDate(spentOn)) problems.push("the date it was spent");
  if (!categoryId) problems.push("a category");
  if (!funderId) problems.push("who paid for it");
  if (!description) problems.push("a description");
  if (amountPaise === null) problems.push("an amount in rupees");

  if (problems.length) {
    return { error: `Still needed: ${problems.join(", ")}.` };
  }

  // The category has to exist and be readable, because `kind` decides how this
  // row is counted and an unknown category would land in a total nobody can
  // explain.
  const { data: category, error: catError } = await supabaseAdmin
    .from("expense_categories")
    .select("id,kind")
    .eq("id", categoryId)
    .maybeSingle();

  if (catError) return { error: "Could not read the categories." };
  if (!category) return { error: "That category no longer exists." };

  const kind = (category as { kind: string }).kind;
  const unitsRaw = Number(body.units);
  const units =
    Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.floor(unitsRaw) : null;

  return {
    row: {
      spent_on: spentOn,
      category_id: categoryId,
      vendor_id: str(body.vendor_id) || null,
      funder_id: funderId,
      print_run_id: str(body.print_run_id) || null,
      amount_paise: amountPaise,
      description,
      reference: str(body.reference) || null,
      receipt_url: str(body.receipt_url) || null,
      // Only meaningful where the cost scales with books. Storing it on a
      // monthly server bill would invite a per-book server cost, which is not
      // a thing.
      units: kind === "variable" ? units : null,
      notes: str(body.notes) || null,
    },
  };
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("expenses.edit");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const parsed = await parse(body as Record<string, unknown>);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("expenses")
    .insert({
      ...parsed.row,
      actor_id: auth.staff.id,
      actor_email: auth.staff.email,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[Expenses] insert failed:", error?.message);
    return NextResponse.json(
      { error: `Could not save it: ${error?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "expense.created",
    entity: "expense",
    entityId: (data as { id: string }).id,
    meta: parsed.row,
  });

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports");
  return NextResponse.json({ id: (data as { id: string }).id });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("expenses.edit");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = str(body.id);
  if (!id) return NextResponse.json({ error: "Which expense?" }, { status: 400 });

  const parsed = await parse(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("expenses")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "That expense no longer exists." },
      { status: error ? 500 : 404 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "expense.updated",
    entity: "expense",
    entityId: id,
    meta: parsed.row,
  });

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports");
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePermission("expenses.edit");
  if (!auth.ok) return auth.response;

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which expense?" }, { status: 400 });

  // Read it first, so the audit entry says what was removed rather than only
  // that something was.
  const { data: before } = await supabaseAdmin
    .from("expenses")
    .select("spent_on,amount_paise,description,funder_id,category_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("expenses").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    actor: auth.staff,
    action: "expense.deleted",
    entity: "expense",
    entityId: id,
    meta: (before ?? {}) as Record<string, unknown>,
  });

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports");
  return NextResponse.json({ ok: true });
}
