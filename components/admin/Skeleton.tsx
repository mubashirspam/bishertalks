/**
 * Loading placeholders for the admin panel.
 *
 * Server components on purpose — these are rendered as Suspense fallbacks and
 * inside loading.tsx, so shipping them to the browser as client components
 * would be pointless weight.
 *
 * The shapes deliberately match the real content they stand in for. A skeleton
 * that's the wrong size is worse than none: the page visibly jumps when data
 * arrives, which reads as slower even when it isn't.
 */

export function SkeletonBox({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-neutral-200/70 ${className}`}
      style={style}
    />
  );
}

/** Page title + subtitle. */
export function SkeletonHeader() {
  return (
    <div className="mb-6">
      <SkeletonBox className="h-7 w-40" />
      <SkeletonBox className="h-4 w-72 mt-2" />
    </div>
  );
}

/** The stat tiles used on the dashboard, insights and referrals. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
          <SkeletonBox className="h-3 w-16" />
          <SkeletonBox className="h-7 w-24 mt-2" />
        </div>
      ))}
    </div>
  );
}

/** The filter card that sits above most tables. */
export function SkeletonFilters() {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm mb-5">
      <div className="flex flex-wrap items-end gap-3">
        {[150, 130, 130, 200].map((w, i) => (
          <div key={i}>
            <SkeletonBox className="h-3 w-16 mb-2" />
            <SkeletonBox className="h-9" style={{ width: w }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A table placeholder.
 *
 * `rows` should match the page size the real table uses, so the scroll height
 * doesn't collapse the moment data lands.
 */
export function SkeletonTable({
  rows = 8,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 flex gap-6">
        {Array.from({ length: columns }, (_, i) => (
          <SkeletonBox key={i} className="h-3 flex-1 max-w-[110px]" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="border-b border-neutral-100 last:border-0 px-4 py-4 flex gap-6 items-center"
        >
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1 max-w-[160px]">
              <SkeletonBox className="h-3.5 w-full" />
              {c === 1 && <SkeletonBox className="h-3 w-2/3 mt-1.5" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Row of queue tabs, as on the delivery screen. */
export function SkeletonTabs({ count = 7 }: { count?: number }) {
  return (
    <div className="flex gap-1.5 overflow-hidden pb-2 mb-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBox key={i} className="h-9 w-28 rounded-xl flex-shrink-0" />
      ))}
    </div>
  );
}

/** Generic card body, for the form-shaped screens. */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm space-y-3">
      <SkeletonBox className="h-4 w-32" />
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBox key={i} className="h-3.5" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
