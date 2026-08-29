import { Suspense } from "react";
import { MessageSquare, AlertTriangle, Info } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import {
  TEMPLATE_LANGUAGE,
  variableCount,
  type TemplateDef,
} from "@/lib/whatsapp-templates";
import {
  gatherTemplates,
  countByFilter,
  filterOf,
  sendableProblems,
  isTemplateFilter,
  PURPOSE_LABELS,
  type TemplatePurpose,
} from "@/lib/whatsapp-registry";
import TemplateFilters from "./TemplateFilters";
import {
  fetchMetaTemplateStatus,
  STATUS_BADGE,
  STATUS_LABEL,
  REJECTION_REASON,
  type MetaStatus,
} from "@/lib/whatsapp-meta";
import {
  funnelPreviews,
  deliveryPreviews,
  emailPreviews,
} from "@/lib/template-previews";

export const dynamic = "force-dynamic";

/**
 * Every message this shop can send, in one read-only place.
 *
 * It exists because the answer to "what did the customer get?" was previously
 * spread across three files and a terminal command. Support has no checkout,
 * and the automated wording only exists in the repo and on Meta's servers.
 *
 * Nothing here can be edited, and that is deliberate rather than unfinished.
 * Changing an automated template means resubmitting it to Meta and waiting for
 * approval — a change with a review queue attached belongs in a commit, not
 * behind a Save button that would quietly desynchronise the code from what
 * Meta actually holds.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; purpose?: string }>;
}) {
  await requirePageAccess("templates.view");
  const params = await searchParams;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary-500" /> Message
          templates
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Everything a customer can receive — automatic WhatsApp, hand-sent
          WhatsApp, and email. Read-only: the wording lives in the code, and the
          automatic ones need Meta&rsquo;s approval before they change.
        </p>
      </div>

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={6} columns={2} /></>}>
        <Body status={params.status} purpose={params.purpose} />
      </Suspense>
    </div>
  );
}

async function Body({ status, purpose }: { status?: string; purpose?: string }) {
  const meta = await fetchMetaTemplateStatus();

  // Every registry, plus whatever Meta holds that no code sends. Before this
  // the screen showed two registries of four, so the seven conversation-flow
  // templates existed, were submitted, and appeared nowhere in the admin.
  const all = gatherTemplates(meta);

  const wantedStatus = isTemplateFilter(status) ? status : null;
  const wantedPurpose = (
    ["automatic", "flow", "campaign", "draft", "orphan"] as TemplatePurpose[]
  ).includes(purpose as TemplatePurpose)
    ? (purpose as TemplatePurpose)
    : null;

  // Each axis counted with the OTHER applied but not itself, so a chip's
  // number is what clicking it would show rather than what is on screen now.
  const statusCounts = countByFilter(
    all.filter((e) => !wantedPurpose || e.purpose === wantedPurpose)
  );
  const purposeCounts = Object.fromEntries(
    (["automatic", "flow", "campaign", "draft", "orphan"] as TemplatePurpose[]).map((p) => [
      p,
      all.filter(
        (e) => e.purpose === p && (!wantedStatus || filterOf(e.status) === wantedStatus)
      ).length,
    ])
  ) as Record<TemplatePurpose, number>;

  const shown = all.filter(
    (e) =>
      (!wantedStatus || filterOf(e.status) === wantedStatus) &&
      (!wantedPurpose || e.purpose === wantedPurpose)
  );

  // Only what something actually tries to send. A draft nobody sends and an
  // orphan with no code behind it are not outages.
  const broken = sendableProblems(all);

  return (
    <div className="space-y-10">
      {meta.error && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {meta.error}
        </p>
      )}

      {!meta.error && broken.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>
              {broken.length} message{broken.length === 1 ? "" : "s"} cannot be
              sent.
            </strong>{" "}
            A template that is not approved fails at send time — the order,
            payment and course access are unaffected, but the customer hears
            nothing. Filter by status below to see which.
          </span>
        </p>
      )}

      <TemplateFilters
        statusCounts={statusCounts}
        purposeCounts={purposeCounts}
        total={all.length}
        showing={shown.length}
      />

      <Section
        title="WhatsApp templates"
        blurb={
          <>
            Every template in the code and every one Meta holds, together.
            Status comes from Meta and is up to a minute old. A template only
            sends when it says Approved — in review, rejected and never
            submitted all mean the customer hears nothing.
          </>
        }
      >
        {shown.length === 0 ? (
          <p className="text-sm text-neutral-400">Nothing matches those filters.</p>
        ) : (
          <div className="space-y-4">
            {shown.map((e) =>
              e.def ? (
                <TemplateCard
                  key={e.name}
                  event={e.key}
                  def={e.def}
                  status={e.status}
                  language={e.language}
                  rejectedReason={e.rejectedReason}
                  unknown={!!meta.error}
                  purpose={e.purpose}
                />
              ) : (
                // An orphan has no definition to render — Meta holds it and no
                // code sends it, so there is no wording of ours to show.
                <div
                  key={e.name}
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-neutral-900">{e.name}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {PURPOSE_LABELS[e.purpose]} · {e.category} · {e.language}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[e.status]}`}
                    >
                      {STATUS_LABEL[e.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Meta holds this template. Nothing in the code sends it —
                    usually a retired wording, kept because a deleted name is
                    locked for 30 days.
                  </p>
                  {e.rejectedReason && (
                    <p className="mt-1 text-xs text-red-700">
                      {REJECTION_REASON[e.rejectedReason] ?? e.rejectedReason}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </Section>

      {/* ── Manual ─────────────────────────────────────────────────────── */}
      <Section
        title="Hand-sent WhatsApp"
        blurb={
          <>
            Pre-filled text behind the WhatsApp button on the Orders and
            Delivery screens. These go from the shop&rsquo;s own number, so they
            need no approval and can be edited before sending — what you see
            here is what the box opens with.
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <MessageList
            heading="From the Orders screen"
            note="Chosen by where the customer got to in the funnel."
            previews={funnelPreviews()}
          />
          <MessageList
            heading="From the Delivery screen"
            note="Chosen by where the parcel is."
            previews={deliveryPreviews()}
          />
        </div>
      </Section>

      {/* ── Email ──────────────────────────────────────────────────────── */}
      <Section
        title="Email"
        blurb={
          <>
            Sent through Resend. Only buyers who gave an email address get one —
            many do not, which is why the hand-sent WhatsApp above carries the
            course link too.
          </>
        }
      >
        <div className="space-y-4">
          {emailPreviews().map((e) => (
            <div
              key={e.key}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <div className="border-b border-neutral-100 px-4 py-3">
                <p className="text-sm font-bold text-neutral-900">{e.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{e.when}</p>
                <p className="mt-2 text-xs text-neutral-600">
                  <span className="text-neutral-400">Subject:</span>{" "}
                  <span className="font-medium">{e.subject}</span>
                </p>
              </div>
              <div className="bg-neutral-50 p-4">
                {/* Rendered in an iframe, not dangerouslySetInnerHTML: the mail
                    is a full document with its own <body> styling, and dropping
                    it into the page would leak those styles into the admin. */}
                <iframe
                  title={`${e.label} preview`}
                  srcDoc={e.html}
                  sandbox=""
                  className="h-[620px] w-full rounded-lg border border-neutral-200 bg-white"
                />
              </div>
              <details className="border-t border-neutral-100">
                <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-neutral-500 hover:text-neutral-800">
                  Plain-text version
                </summary>
                <pre className="whitespace-pre-wrap break-words px-4 pb-4 text-xs leading-relaxed text-neutral-700">
                  {e.text}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      <p className="mt-1 mb-4 max-w-3xl text-xs leading-relaxed text-neutral-500">
        {blurb}
      </p>
      {children}
    </section>
  );
}

/**
 * One approved-or-not template, with its wording filled in.
 *
 * The example values are substituted rather than shown as `{{1}}` — the
 * question this screen answers is what the customer reads, and a placeholder
 * does not answer it. A small legend under the body says which parts vary.
 */
function TemplateCard({
  event,
  def,
  status,
  language,
  rejectedReason,
  unknown,
  purpose,
}: {
  event: string;
  def: TemplateDef;
  status: MetaStatus;
  language?: string;
  rejectedReason?: string;
  unknown: boolean;
  purpose: TemplatePurpose;
}) {
  let filled = def.body;
  def.example.forEach((v, i) => {
    filled = filled.replaceAll(`{{${i + 1}}}`, v);
  });

  // The language mismatch that costs a day: the code asks for 'ml', the
  // template exists in 'en_US', and every send answers "template not found".
  const wrongLanguage = !!language && language !== TEMPLATE_LANGUAGE;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900">{def.name}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {PURPOSE_LABELS[purpose]} · {event} · {def.category} ·{" "}
            {TEMPLATE_LANGUAGE} · {variableCount(def.body)} variables
            {def.buttons?.length ? ` · ${def.buttons.length} buttons` : ""}
          </p>
        </div>
        {!unknown && (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>

      {status === "REJECTED" && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          <strong>{rejectedReason ?? "Rejected"}</strong>
          {rejectedReason && REJECTION_REASON[rejectedReason]
            ? ` — ${REJECTION_REASON[rejectedReason]}`
            : ""}
        </p>
      )}

      {wrongLanguage && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          Meta holds this in <strong>{language}</strong>, but the app asks for{" "}
          <strong>{TEMPLATE_LANGUAGE}</strong>. Every send fails with
          &ldquo;template not found&rdquo;.
        </p>
      )}

      <div className="bg-neutral-50 px-4 py-4">
        <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-900">
          <p className="whitespace-pre-wrap break-words">{filled}</p>
          {def.buttons?.map((b) => (
            <span
              key={b.text}
              className="mt-2 block border-t border-black/10 pt-2 text-center text-[13px] font-medium text-[#00a5f4]"
              title={b.type === "URL" ? b.example : "Sends a reply back to us"}
            >
              {b.text}
            </span>
          ))}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-neutral-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Sample values shown. The parts that change per customer:{" "}
          {def.example.join(" · ")}
        </p>
      </div>
    </div>
  );
}

function MessageList({
  heading,
  note,
  previews,
}: {
  heading: string;
  note: string;
  previews: { key: string; label: string; body: string }[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-4 py-3">
        <p className="text-sm font-bold text-neutral-900">{heading}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{note}</p>
      </div>
      <div className="divide-y divide-neutral-100">
        {previews.map((p) => (
          <details key={p.key} className="group">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
              {p.label}
              <span className="text-[10px] text-neutral-400 group-open:hidden">
                show
              </span>
            </summary>
            <div className="bg-neutral-50 px-4 py-3">
              <p className="max-w-md whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-900">
                {p.body}
              </p>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
