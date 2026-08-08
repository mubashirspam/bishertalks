import {
  SkeletonHeader,
  SkeletonStats,
  SkeletonTable,
} from "@/components/admin/Skeleton";

/**
 * Instant shell for the dashboard.
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
      <SkeletonStats />
      <SkeletonTable rows={6} columns={4} />
    </div>
  );
}
