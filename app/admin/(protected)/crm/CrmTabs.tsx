import Link from "@/components/admin/AdminLink";

/**
 * The CRM's own navigation.
 *
 * A section rather than a screen: the inbox, the campaigns and the number's
 * health are three different jobs that happen to share a data model, and
 * putting them behind one sidebar item with tabs keeps the main nav from
 * growing four entries for one feature.
 */
const TABS = [
  { key: "inbox", href: "/admin/crm", label: "Inbox" },
  // Between the inbox and campaigns because that is the order the work
  // happens in: read what came back, decide who to reach, then reach them.
  { key: "people", href: "/admin/crm/people", label: "People" },
  { key: "campaigns", href: "/admin/crm/campaigns", label: "Campaigns" },
  // Between campaigns and the log: what the system sends on its own sits
  // between what a person sends and the record of everything.
  { key: "automation", href: "/admin/crm/automation", label: "Automation" },
  { key: "log", href: "/admin/crm/log", label: "Message log" },
  { key: "health", href: "/admin/crm/health", label: "Number health" },
] as const;

export default function CrmTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-neutral-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
            active === t.key
              ? "border-primary-500 text-primary-700"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
