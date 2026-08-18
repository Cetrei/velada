import type { APIContext } from "astro";

/**
 * Reads a server-side env var in a way that works both in production
 * (Cloudflare Workers) and in local dev (`astro dev`).
 *
 * With @astrojs/cloudflare + output: "server", `import.meta.env` only ever
 * reflects PUBLIC_* vars inlined at build time. Non-public secrets
 * (SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY) configured as Cloudflare
 * Workers Secrets/Variables are NOT visible through import.meta.env at
 * runtime — they're only exposed via the request-scoped
 * `context.locals.runtime.env` binding the adapter attaches to every
 * request. See @astrojs/cloudflare's `Runtime` type (dist/entrypoints/
 * server.d.ts) for the exact shape: `locals.runtime.env`.
 *
 * `astro dev` never populates `locals.runtime`, so it falls back to
 * `import.meta.env`, which does read from `.env` locally — meaning this
 * function is a safe drop-in replacement for `import.meta.env.X` in any
 * server-only code path (Actions, .astro frontmatter, lib functions),
 * as long as the caller has a request context to pass through.
 */
export function getServerEnv(
  context: Pick<APIContext, "locals">,
  key: string
): string | undefined {
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, unknown> } } | undefined)
    ?.runtime?.env;

  const runtimeValue = runtimeEnv?.[key];
  if (typeof runtimeValue === "string" && runtimeValue.length > 0) {
    return runtimeValue;
  }

  const buildTimeValue = (import.meta.env as Record<string, string | undefined>)[key];
  return buildTimeValue;
}
