import {
  SkeletonFilters,
  SkeletonHeader,
  SkeletonStats,
  SkeletonTable,
} from "@/components/admin/Skeleton";

/**
 * Instant shell for the reports screen.
 *
 * Next renders this the moment the link is clicked, so navigation feels
 * immediate even though the aggregates behind it still cost a round trip.
 * Without it the browser sits on the previous screen until every query
 * finishes, which reads as the app being frozen.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonStats count={6} />
      <div className="h-40 rounded-2xl bg-neutral-100 animate-pulse mb-5" />
      <SkeletonTable rows={10} columns={8} />
    </div>
  );
}
