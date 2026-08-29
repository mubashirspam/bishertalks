import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban, Package } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { getContact, windowState, formatWindow } from "@/lib/crm/contacts";
import { listThread } from "@/lib/crm/messages";
import { crmFieldsFor } from "@/lib/crm/tags";
import { pendingFor } from "@/lib/crm/automation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ThreadClient from "./ThreadClient";
import CrmPanel from "./CrmPanel";

export const dynamic = "force-dynamic";

/**
 * One conversation.
 *
 * The customer's orders sit beside it, because almost every question that
 * arrives on this number is about one — answering without knowing what they
 * bought means opening the Orders screen in another tab and searching for a
 * phone number.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requirePageAccess("crm.view");
  const { id } = await params;

  const contact = await getContact(id);
  if (!contact) notFound();

  const [messages, orders, crm, pending] = await Promise.all([
    listThread(contact.id),
    ordersFor(contact.phone),
    crmFieldsFor(contact.id),
    pendingFor(contact.id),
  ]);

  const win = windowState(contact.last_inbound_at);

  return (
    <div>
      <Link
        href="/admin/crm"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition hover:text-neutral-800"
      >
        <ArrowLeft className="h-4 w-4" /> Inbox
      </Link>

      <div className="mb-5">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black">
          {contact.display_name?.trim() || contact.phone}
          {contact.opt_out_at && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
              <Ban className="h-3.5 w-3.5" /> Stopped
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 tabular-nums">
          {contact.phone}
          {contact.marketing_opt_in_at ? " · opted in to marketing" : ""}
        </p>
      </div>

      {contact.opt_out_at && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>
            This contact asked us to stop on {contact.opt_out_at.slice(0, 10)}.
          </strong>{" "}
          {contact.opt_out_reason}
          {contact.opt_out_source ? ` (${contact.opt_out_source})` : ""}. Nothing
          can be sent to them — not campaigns, not order updates — until someone
          with permission lifts it.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <ThreadClient
          contact={{
            id: contact.id,
            phone: contact.phone,
            optedOut: !!contact.opt_out_at,
            marketingOptIn: !!contact.marketing_opt_in_at,
          }}
          messages={messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            body: m.body,
            kind: m.kind,
            hasMedia: !!m.media_id,
            mediaMime: m.media_mime ?? null,
            mediaFilename: m.media_filename ?? null,
            templateName: m.template_name,
            status: m.status,
            error: m.error,
            createdAt: m.created_at,
          }))}
          window={{
            open: win.open,
            label: formatWindow(win.remainingMs),
            everWrote: !!contact.last_inbound_at,
          }}
          canReply={can(staff, "crm.reply")}
          canConsent={can(staff, "crm.consent")}
        />

        {/* ── Where they are, and what happens next ─────────────────────── */}
        <aside className="space-y-5">
          <CrmPanel
            contactId={contact.id}
            tags={crm.tags}
            stage={crm.stage}
            pending={pending.map((e) => ({
              id: e.id,
              eventType: e.event_type,
              templateName: e.template_name,
              scheduledAt: e.scheduled_at,
              reason: e.created_reason,
            }))}
            canEdit={can(staff, "crm.reply")}
          />

          <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Their orders
          </h2>
          {!orders.length ? (
            <p className="rounded-xl border border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-400">
              No orders under this number. They may have written without ever
              buying.
            </p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <Link
                  key={o.order_number}
                  href={`/admin/orders/${o.order_number}`}
                  className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-3 transition hover:border-neutral-300"
                >
                  <p className="flex items-center gap-1.5 text-xs font-bold text-neutral-900">
                    <Package className="h-3.5 w-3.5 text-neutral-400" />
                    {o.order_number}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {o.status} · ₹
                    {Math.round((o.amount_paise ?? 0) / 100).toLocaleString("en-IN")}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {o.ordered_at?.slice(0, 10)}
                  </p>
                </Link>
              ))}
            </div>
          )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface OrderLite {
  order_number: string;
  status: string;
  amount_paise: number | null;
  ordered_at: string | null;
}

/**
 * Orders for this handset.
 *
 * Matched on the last ten digits, because `buyer_phone` holds whatever the
 * customer typed or Razorpay sent back — some rows carry +91, some don't —
 * while the contact's phone is always normalised.
 */
async function ordersFor(phone: string): Promise<OrderLite[]> {
  const local = phone.slice(-10);
  const { data } = await supabaseAdmin
    .from("orders")
    .select("order_number, status, amount_paise, ordered_at")
    .ilike("buyer_phone", `%${local}`)
    .order("ordered_at", { ascending: false })
    .limit(10);
  return (data ?? []) as unknown as OrderLite[];
}
