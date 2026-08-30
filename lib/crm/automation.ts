import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The follow-up queue.
 *
 * Every scheduled message in the CRM is a row here, and nothing sends from the
 * place that decides to schedule it. A button tap writes a row and returns; a
 * worker drains the queue later and passes each row through the gate on its
 * own. That gap is the point: a customer who taps *Received* on Monday and
 * says STOP on Wednesday must not get Thursday's reading follow-up, and the
 * only way to guarantee that is to decide at send time rather than at schedule
 * time.
 *
 * Requires migration 0053. Every function here survives the table not
 * existing — migrations are applied by hand in this repo, and a webhook that
 * threw because a follow-up could not be queued would cost us the customer's
 * message as well as the follow-up.
 */

export type EventStatus =
  | "pending"
  | "sending"
  | "sent"
  | "refused"
  | "failed"
  | "cancelled";

export interface AutomationEvent {
  id: string;
  contact_id: string;
  order_id: string | null;
  event_type: string;
  template_name: string | null;
  scheduled_at: string;
  executed_at: string | null;
  status: EventStatus;
  refusal_code: string | null;
  error: string | null;
  attempts: number;
  created_reason: string | null;
  created_at: string;
}

const COLUMNS =
  "id, contact_id, order_id, event_type, template_name, scheduled_at, " +
  "executed_at, status, refusal_code, error, attempts, created_reason, created_at";

/** Postgres saying the table is not there yet. */
const MISSING_TABLE = "42P01";

function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === MISSING_TABLE) {
    console.warn("[CRM] whatsapp_automation_events is missing — apply migration 0053");
    return true;
  }
  return false;
}

/**
 * Queue a follow-up.
 *
 * Idempotent by construction: a partial unique index allows one *pending* row
 * per contact per event type per order, so the two rules in the brief that
 * both schedule the 10-day follow-up — the Received tap and the delivered_at
 * timer — cannot produce two messages. The second one loses the race silently,
 * which is exactly right.
 *
 * Returns the row, or null when it was a duplicate or the table is missing.
 * Callers must not treat null as failure worth reporting to a customer.
 */
export async function scheduleEvent(input: {
  contactId: string;
  orderId?: string | null;
  eventType: string;
  templateName: string;
  afterDays: number;
  reason?: string;
}): Promise<AutomationEvent | null> {
  const when = new Date(Date.now() + input.afterDays * 86_400_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_events")
    .insert({
      contact_id: input.contactId,
      order_id: input.orderId ?? null,
      event_type: input.eventType,
      template_name: input.templateName,
      scheduled_at: when,
      created_reason: input.reason ?? null,
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    // 23505 is the unique index doing its job — already queued, nothing wrong.
    if (error.code !== "23505" && !missing(error)) {
      console.error("[CRM] scheduleEvent failed:", input.eventType, error.message);
    }
    return null;
  }

  return data as unknown as AutomationEvent;
}

/**
 * Drop pending follow-ups.
 *
 * `types` narrows it; omitting them cancels everything still pending for that
 * contact, which is what an opt-out does. Cancelling rather than deleting, so
 * "why did this person stop getting messages" is answerable six months later.
 */
export async function cancelEvents(
  contactId: string,
  options?: { types?: string[]; reason?: string }
): Promise<number> {
  let q = supabaseAdmin
    .from("whatsapp_automation_events")
    .update({
      status: "cancelled",
      error: options?.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("contact_id", contactId)
    .eq("status", "pending");

  if (options?.types?.length) q = q.in("event_type", options.types);

  const { data, error } = await q.select("id");

  if (error) {
    if (!missing(error)) {
      console.error("[CRM] cancelEvents failed:", contactId, error.message);
    }
    return 0;
  }
  return (data ?? []).length;
}

/**
 * Everything still to happen for one contact, soonest first.
 *
 * What the admin panel shows under "next follow-up". Pending only — a sent
 * event is in the message history, where it belongs.
 */
export async function pendingFor(contactId: string): Promise<AutomationEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_events")
    .select(COLUMNS)
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .order("scheduled_at", { ascending: true });

  if (error) {
    missing(error);
    return [];
  }
  return (data ?? []) as unknown as AutomationEvent[];
}

/**
 * Claim due rows for sending.
 *
 * The claim is the update, not the read: rows go to `sending` in one statement
 * and come back from it, so two workers running at once — a cron overlapping
 * itself on a slow day — cannot both take the same row. Reading first and
 * updating after is the version of this that double-sends.
 *
 * Claimed rows sit in `sending` until the worker finishes them. A row left
 * there by a crashed worker is visible as stuck rather than retried forever;
 * `releaseStale()` puts anything held over an hour back in the queue.
 */
export async function claimDue(limit = 100): Promise<AutomationEvent[]> {
  const { data, error } = await supabaseAdmin.rpc("crm_claim_due_events", {
    p_limit: limit,
  });

  if (error) {
    // Without the RPC, fall back to a read-then-claim. Slightly racier, and
    // still safe in practice because the worker runs on one schedule — but it
    // is the reason the RPC exists.
    if (!missing(error)) {
      console.warn("[CRM] claim RPC unavailable, falling back:", error.message);
    }
    return claimDueFallback(limit);
  }

  return (data ?? []) as unknown as AutomationEvent[];
}

async function claimDueFallback(limit: number): Promise<AutomationEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_events")
    .select(COLUMNS)
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    missing(error);
    return [];
  }
  return (data ?? []) as unknown as AutomationEvent[];
}

/** How a row ended. `sent` and `cancelled` are final; `failed` may retry once. */
export async function finishEvent(
  id: string,
  outcome: {
    status: EventStatus;
    refusalCode?: string | null;
    error?: string | null;
    /** Push it back into the queue instead of finishing it. */
    retryInMinutes?: number;
  }
): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    refusal_code: outcome.refusalCode ?? null,
    error: outcome.error ?? null,
  };

  if (outcome.retryInMinutes) {
    patch.status = "pending";
    patch.scheduled_at = new Date(
      Date.now() + outcome.retryInMinutes * 60_000
    ).toISOString();
  } else {
    patch.status = outcome.status;
    patch.executed_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("whatsapp_automation_events")
    .update(patch)
    .eq("id", id);

  if (error && !missing(error)) {
    console.error("[CRM] finishEvent failed:", id, error.message);
  }
}

/** One attempt more on this row, so a retry loop cannot run forever. */
export async function noteAttempt(id: string, attempts: number): Promise<void> {
  await supabaseAdmin
    .from("whatsapp_automation_events")
    .update({ attempts: attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Put back rows a dead worker is still holding.
 *
 * Called at the top of every run. An hour is long enough that a slow run is
 * never interrupted, and short enough that a crash costs one cycle.
 */
export async function releaseStale(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("crm_release_stale_events");
  if (error) {
    if (!missing(error)) console.warn("[CRM] releaseStale unavailable:", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

/**
 * The automation's activity, newest first.
 *
 * What the Automation screen reads. It exists because "is anything sending on
 * its own?" had no answer short of querying the table by hand — and the day
 * that question mattered, a rule had queued 700 people and the only visible
 * symptom was refusals piling up in the message log.
 */
export async function listEvents(
  filters: { status?: string; from?: string; to?: string } = {},
  page = 0,
  perPage = 50
): Promise<{ rows: (AutomationEvent & { contact: { phone: string; display_name: string | null } | null })[]; count: number }> {
  const from = page * perPage;

  let q = supabaseAdmin
    .from("whatsapp_automation_events")
    .select(`${COLUMNS}, contact:whatsapp_contacts(phone, display_name)`, {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (filters.status) q = q.eq("status", filters.status);
  // Queued when, not due when: the question this screen answers is "what did
  // the system decide to do, and when did it decide it".
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lt("created_at", filters.to);

  const { data, error, count } = await q;
  if (error) {
    missing(error);
    return { rows: [], count: 0 };
  }
  return {
    rows: (data ?? []) as unknown as (AutomationEvent & {
      contact: { phone: string; display_name: string | null } | null;
    })[],
    count: count ?? 0,
  };
}

/** Counts for the admin screen: how the queue is doing, by status. */
export async function queueSummary(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const status of ["pending", "sending", "sent", "refused", "failed", "cancelled"]) {
    const { count, error } = await supabaseAdmin
      .from("whatsapp_automation_events")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) {
      missing(error);
      return out;
    }
    out[status] = count ?? 0;
  }
  return out;
}
