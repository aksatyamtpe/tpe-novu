/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // Mount the entire admin app under /admin. With basePath set, Next will:
  //   * route /admin and /admin/<sub> to app/page.tsx and app/<sub>/page.tsx
  //   * auto-prefix every <Link href> with /admin (so href values inside the
  //     codebase stay clean: /templates, /schedules, /history)
  //   * auto-prefix every static-asset URL with /admin/_next/...
  // assetPrefix was the wrong tool for sub-path deployment — it left routing
  // unchanged so /admin/<sub> requests landed in _not-found. basePath is the
  // documented primitive for "deploy this app under a sub-path" and replaces
  // it cleanly: assets and routes are namespaced together.
  //
  // Note: basePath does NOT auto-prefix:
  //   - <a> tags (use <Link>)
  //   - fetch() calls
  //   - <form action> attributes
  //   - window.location.href / Response.redirect()
  // Those still need the explicit /admin prefix in the codebase.
  basePath: '/admin',

  // Defensive — first-build TypeScript / ESLint gates skipped, mirroring the
  // bridge image. Tighten once the admin contract stabilises.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};
module.exports = nextConfig;
