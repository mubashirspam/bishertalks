import { delhiveryRequest } from "./client";
import type { DelhiverySettings } from "./config";

/**
 * Cancelling a manifested parcel.
 *
 * The real undo for a send — once Delhivery has a shipment, deleting our own
 * column would only make the two systems disagree while a van still collects
 * the parcel.
 *
 * Their constraint, worth stating where someone will read it: cancellation is
 * accepted only while the package is Manifested, In Transit, Pending, Open or
 * Scheduled. And a cancelled *prepaid* shipment becomes `Returned` on their
 * side, not `Cancelled` — so the scan that follows a successful cancel is an
 * RTO one, which is exactly what lib/delhivery/status.ts is careful about.
 */

interface EditResponse {
  status?: boolean | string;
  error?: unknown;
  remark?: string;
  rmk?: string;
}

export interface CancelResult {
  ok: boolean;
  message: string;
}

export async function cancelWaybill(
  waybill: string,
  settings: DelhiverySettings
): Promise<CancelResult> {
  const response = await delhiveryRequest<EditResponse>({
    settings,
    path: "/api/p/edit",
    method: "POST",
    json: { waybill, cancellation: "true" },
    // Changes their state. A timeout must not be quietly repeated.
    retryOnNetworkError: false,
  });

  const ok = response.status === true || String(response.status).toLowerCase() === "success";
  const message =
    response.remark?.trim() ||
    response.rmk?.trim() ||
    (ok ? "Cancelled with Delhivery." : "Delhivery would not cancel this parcel.");

  return { ok, message };
}
