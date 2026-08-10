import { Suspense } from "react";
import { LayoutTemplate } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { listAllTestimonials, getLandingSettings } from "@/lib/db/landing";
import { imagekitConfigured } from "@/lib/imagekit";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import LandingManager from "./LandingManager";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  await requirePageAccess("landing.manage");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <LayoutTemplate className="w-5 h-5 text-primary-500" /> Landing page
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Testimonials and the explainer video for /neuro-code. Media is uploaded
          to ImageKit; changes appear on the page immediately.
        </p>
      </div>

      <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={5} columns={4} /></>}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const [testimonials, settings] = await Promise.all([
    listAllTestimonials(),
    getLandingSettings(),
  ]);

  return (
    <LandingManager
      testimonials={testimonials}
      settings={settings}
      // Checked on the server: the private key must never reach the browser,
      // and the admin needs to know why uploading is refusing to work.
      uploadsReady={imagekitConfigured()}
    />
  );
}
