/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Ship the label fonts with the functions that read them.
   *
   * `public/` is served by the CDN; it is NOT part of a serverless function's
   * filesystem. lib/truetype.ts opens these with fs at request time to embed
   * Malayalam in a PDF, so without this the label route works locally and
   * throws ENOENT the moment it is deployed — the worst shape of bug, because
   * every check short of a real deploy passes.
   */
  outputFileTracingIncludes: {
    '/api/admin/delivery/labels': ['./public/fonts/**'],
    '/api/admin/delivery/address-sheet': ['./public/fonts/**'],
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    // Only hosts listed here may go through next/image. Course thumbnails are
    // admin-pasted URLs from arbitrary hosts, so those deliberately stay plain
    // <img> — an unlisted host makes next/image throw and blanks the page.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Landing page testimonial media, uploaded from Admin → Landing page.
      // Without this, an uploaded screenshot makes next/image throw and blanks
      // the whole page — exactly the failure described above.
      { protocol: 'https', hostname: 'ik.imagekit.io' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
}

module.exports = nextConfig
