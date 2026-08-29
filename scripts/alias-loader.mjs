import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve `@/…` the way Next does, so a script can import the app's own code.
 *
 * Without this a script either cannot touch lib/ at all — every module there
 * imports `@/lib/supabase/admin` — or has to reimplement the logic it wants to
 * exercise, which is how a maintenance script quietly drifts from the thing it
 * is meant to be maintaining.
 *
 * Register with:
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs <script>
 */
const root = process.cwd();
const CANDIDATES = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx", ""];

export async function resolve(specifier, context, next) {
  // `lib/` uses React's cache() to memoise per-request reads. Node cannot
  // import that as a named export from React's CJS build, and a script has no
  // render to memoise within anyway — see scripts/react-shim.mjs.
  if (specifier === "react") {
    return next(pathToFileURL(path.join(root, "scripts/react-shim.mjs")).href, context);
  }

  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    for (const ext of CANDIDATES) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return next(pathToFileURL(p).href, context);
      }
    }
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    // `next/server` and friends resolve through package "exports" conditions
    // that Next's own bundler sets and a plain Node run does not, so the
    // subpath comes back unresolved with the file sitting right there. Falling
    // back to the explicit file is enough for a script.
    if (
      e?.code === "ERR_MODULE_NOT_FOUND" &&
      !specifier.startsWith(".") &&
      !specifier.startsWith("@/") &&
      !/\.[cm]?js$/.test(specifier)
    ) {
      return next(`${specifier}.js`, context);
    }
    throw e;
  }
}

// Node ≥20.6: register this file's hooks from within itself, so one --import
// flag is all a script needs.
const { register } = await import("node:module");
register(pathToFileURL(import.meta.filename).href);
