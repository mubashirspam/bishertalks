import {
  SkeletonHeader,
  SkeletonStats,
  SkeletonCard,
  SkeletonTable,
} from "@/components/admin/Skeleton";

/**
 * Instant shell for the profit report.
 *
 * The page reads every paid order to work out the run rate, which is the slow
 * part. Without this the browser sits on the previous screen while it runs.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonStats />
      <SkeletonCard lines={6} />
      <SkeletonTable rows={6} columns={7} />
    </div>
  );
}
