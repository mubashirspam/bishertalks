import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";

/** Instant shell for the landing CMS. */
export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonTable rows={5} columns={4} />
    </div>
  );
}
