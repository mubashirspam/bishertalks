import {
  SkeletonFilters,
  SkeletonHeader,
  SkeletonStats,
  SkeletonTable,
} from "@/components/admin/Skeleton";

/**
 * Instant shell for the insights.
 *
 * Next renders this the moment the link is clicked, so navigation feels
 * immediate even though the data behind it still costs a database round trip.
 * Without it the browser sits on the previous screen until every query
 * finishes, which reads as the app being frozen.
 */
export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonStats />
      <SkeletonTable rows={8} columns={5} />
    </div>
  );
}
