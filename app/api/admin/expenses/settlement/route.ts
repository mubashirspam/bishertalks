export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { funderBalances } from "@/lib/db/expenses";

/**
 * The company paying back somebody who funded a purchase.
 *
 * ── Why this one takes an amount from the browser ──
 *
 * The referral payout route is emphatic that it does not: it recomputes the
 * figure from approved rows because *"this is the one endpoint where a forged
 * number would be money."* That reasoning does not carry over, and it is worth
 * saying why rather than quietly departing from it.
 *
 * A referral payout settles a known set of commissions in full — the amount is
 * derivable, so accepting one from the browser would be inventing a number
 * that already exists. A repayment is not: paying Mubashir ₹10,000 against a
 * ₹40,000 balance is an ordinary thing to do, and there is no server-side
 * figure that means "what they decided to pay today".
 *
 * So the amount is typed, and the guard is placed where it can still bite: a
 * settlement may not exceed the outstanding balance, and that balance is read
 * from `funder_balances` — derived from the ledger every time, never stored.
 * Over-repaying is the one direction that silently creates money the company
 * never owed.
 */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(request: NextRequest) {
  const auth = await requirePermission("expenses.edit");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const funderId = str(body.funder_id);
  const amount = Number(body.amount_rupees);

  if (!funderId) {
    return NextResponse.json({ error: "Who is being repaid?" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount in rupees." }, { status: 400 });
  }

  const amountPaise = Math.round(amount * 100);

  const balances = await funderBalances();
  if (balances === null) {
    return NextResponse.json(
      { error: "Expenses are not set up yet — apply migration 0062." },
      { status: 503 }
    );
  }

  const funder = balances.find((f) => f.id === funderId);
  if (!funder) {
    return NextResponse.json({ error: "No such person." }, { status: 404 });
  }
  if (funder.is_company) {
    return NextResponse.json(
      { error: `${funder.name} is the company — it cannot repay itself.` },
      { status: 400 }
    );
  }
  if (amountPaise > funder.balance_paise) {
    const owed = Math.round(funder.balance_paise / 100).toLocaleString("en-IN");
    return NextResponse.json(
      {
        error:
          `That is more than ${funder.name} is owed. The outstanding balance ` +
          `is ₹${owed}. Record the extra as an expense if it is one.`,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("funder_settlements")
    .insert({
      funder_id: funderId,
      amount_paise: amountPaise,
      method: str(body.method) || null,
      reference: str(body.reference) || null,
      receipt_url: str(body.receipt_url) || null,
      note: str(body.note) || null,
      paid_by: auth.staff.id,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[Expenses] settlement failed:", error?.message);
    return NextResponse.json(
      { error: `Could not record it: ${error?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  await audit({
    actor: auth.staff,
    action: "settlement.created",
    entity: "funder",
    entityId: funderId,
    meta: {
      amount_paise: amountPaise,
      balance_before_paise: funder.balance_paise,
      reference: str(body.reference) || null,
    },
  });

  revalidatePath("/admin/expenses/funders");
  return NextResponse.json({ ok: true });
}
