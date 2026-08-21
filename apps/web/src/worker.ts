/**
 * Worker wrapper: envuelve el handler que genera @astrojs/cloudflare
 * (dist/_worker.js/index.js, solo exporta `fetch`) para agregarle un
 * handler `scheduled()` -- Cron Trigger que refresca mmradar_engine_matches/
 * lol_rank de los participantes automaticamente, sin depender de que
 * alguien apriete "Actualizar" a mano.
 *
 * ORIGEN (2026-08-21): el usuario reporto (con capturas reales de
 * mmradar.gg vs. lo que mostraba el test de calibracion) que el Current
 * Rank guardado en Supabase para algunos jugadores estaba desactualizado
 * varias divisiones -- LegenPaPaNoel: guardado Gold I, mmradar.gg real
 * Gold IV; YourDaddyDrinks: guardado Platinum I, mmradar.gg real
 * Platinum IV. Confirmado leyendo actions/index.ts: lol_rank/
 * mmradar_engine_matches SOLO se re-escriben cuando alguien hace refresh
 * manual (saveOwnParticipant/saveParticipant al editar el perfil, o el
 * boton "Actualizar" -> refreshMmradarData) -- no hay ningun proceso que
 * los mantenga al dia solo, asi que cualquier jugador que no haya tocado
 * su perfil recientemente queda con un snapshot viejo indefinidamente.
 * Este archivo cierra ese gap con un Cron Trigger que hace lo mismo que
 * el boton "Actualizar" pero solo, en rotacion sobre todo el roster.
 *
 * Por que un wrapper y no tocar el output de Astro directamente: esta
 * version del adapter (@astrojs/cloudflare@11.2.0, confirmado contra
 * node_modules/@astrojs/cloudflare/package.json y dist/index.d.ts reales
 * de este proyecto) no expone ninguna opcion tipo `workerEntryPoint` ni un
 * `handle()` reusable (esas llegaron recien en versiones mucho mas nuevas
 * del adapter/Astro 6, ver la doc oficial actual que SI las menciona -- no
 * aplican aca). El unico export utilizable de esta version es
 * createExports(manifest) (dist/entrypoints/server.js), y el manifest lo
 * arma Astro en build time dentro de dist/_worker.js/index.js -- no es
 * algo que este archivo pueda reconstruir a mano de forma segura. El
 * patron que SI funciona con cualquier adapter/framework que solo exporte
 * `fetch` es el documentado por Cloudflare para este exacto problema
 * (mismo enfoque que usa el adapter de OpenNext para Next.js): importar el
 * default export ya compilado y reexportarlo con `scheduled` al lado.
 * dist/_worker.js/index.js siempre existe en el momento en que Wrangler
 * resuelve este import porque .github/workflows/deploy.yml corre
 * `astro build` ANTES de `wrangler deploy` (que es el paso que usa el
 * nuevo `main` de wrangler.toml apuntando a ESTE archivo, no directo al de
 * Astro) -- confirmado leyendo ese workflow real antes de escribir esto.
 *
 * `env` aca es el binding real de Cloudflare (equivalente a
 * locals.runtime.env dentro de un request Astro), pero un evento
 * scheduled no tiene request/locals -- por eso el cliente de Supabase se
 * arma standalone con createClient() directo en vez de
 * createSupabaseAdminClient(locals) (lib/supabaseServer.ts, que exige ese
 * contexto). Mismo patron que ya usa scripts/test-rank-calibration.test.ts
 * (createStandaloneSupabaseClient) para el mismo problema de fondo (correr
 * fuera de un request real de Astro).
 *
 * La logica de refresh en si (fetchMmradarProfile + upsert de
 * lol_rank/performance_rank/mmradar_engine_matches/mmradar_updated_at) es
 * una reimplementacion deliberada de refreshMmradarData
 * (apps/web/src/actions/index.ts) -- no se pudo importar esa Action
 * directamente porque esta definida con defineAction() y espera un
 * `context: APIContext` de Astro (cookies, locals) que no existe en un
 * evento scheduled. Si el comportamiento de refreshMmradarData cambia (que
 * campos guarda, fallback de rank, etc.), este bloque tiene que
 * actualizarse a mano en el mismo cambio -- no hay forma de compartir el
 * codigo sin refactorizar esa Action para aceptar un cliente ya creado en
 * vez de `context` (fuera de scope de este cambio).
 */
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error -- dist/_worker.js/index.js solo existe DESPUES de
// `astro build` (generado, no versionado en git). El typecheck del editor
// puede marcar esto en rojo antes de buildear una vez; `wrangler deploy`
// SI lo resuelve porque corre despues del build (ver deploy.yml). No
// reemplazar por un import estatico tipado sin antes confirmar que el
// build local ya genero ese archivo.
import { default as astroHandler } from "../dist/_worker.js/index.js";
import { fetchMmradarProfile, MmradarLookupError } from "@velada/core";

interface Env {
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ASSETS: unknown;
  [key: string]: unknown;
}

/**
 * Tipos minimos propios para los globals del runtime de Cloudflare Workers
 * (ScheduledController/ExecutionContext/ExportedHandler), en vez de asumir
 * que @cloudflare/workers-types esta resuelto como ambient global en este
 * paquete. Confirmado que NO esta instalado como dependencia directa de
 * apps/web (ni en apps/web/node_modules ni hoisteado en la raiz del
 * monorepo Bun) -- es una dependencia transitiva de @astrojs/cloudflare,
 * y tsconfig.json (extends astro/tsconfigs/strict) no declara
 * `types: ["@cloudflare/workers-types"]`, asi que no hay garantia de que
 * el typecheck resuelva esos nombres sin este fallback. Si en el futuro
 * se agrega esa dependencia + `types` explicito al tsconfig, estos tipos
 * locales pueden borrarse sin romper nada (son estructuralmente
 * compatibles con los reales, solo mas angostos).
 */
interface ScheduledController {
  cron: string;
  scheduledTime: number;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
type ExportedHandler<TEnv> = {
  fetch?: (request: Request, env: TEnv, ctx: ExecutionContext) => Promise<Response> | Response;
  scheduled?: (controller: ScheduledController, env: TEnv, ctx: ExecutionContext) => Promise<void> | void;
};

/**
 * Cuantos participantes se refrescan por invocacion del cron. Cloudflare
 * Workers tiene un limite de CPU/wall-time por invocacion -- un roster
 * grande podria no alcanzar a terminar en una sola corrida si se
 * procesara sin limite. Con el cron corriendo cada 6 horas (ver
 * wrangler.toml) y este tope, un roster de ~20-30 participantes se
 * termina de rotar en menos de un dia incluso en el peor caso; subir con
 * confianza si el roster real termina siendo mas grande (proyecto de
 * "evento entre amigos", no se espera escala grande).
 */
const MAX_REFRESHED_PER_RUN = 15;

/**
 * Participantes candidatos a refresh, ordenados por mmradar_updated_at
 * ascendente (nulls primero -- nunca se refrescaron, maxima prioridad).
 * Mismo criterio de "fuente de verdad = ultimo refresh real" que ya
 * establecio refreshMmradarData; el cron simplemente deja de depender de
 * que un humano lo dispare a mano.
 */
async function fetchRefreshCandidates(
  admin: ReturnType<typeof createClient<any>>
): Promise<{ id: string; lol_username: string; lol_rank: string | null }[]> {
  const { data, error } = await admin
    .from("participants")
    .select("id, lol_username, lol_rank, mmradar_updated_at")
    .not("lol_username", "is", null)
    .order("mmradar_updated_at", { ascending: true, nullsFirst: true })
    .limit(MAX_REFRESHED_PER_RUN);

  if (error) {
    console.error(`[scheduled] error leyendo candidatos de refresh: ${error.message}`);
    return [];
  }
  return (data ?? []) as { id: string; lol_username: string; lol_rank: string | null }[];
}

/**
 * Refresca un participante puntual -- mismo shape de datos que persiste
 * refreshMmradarData (actions/index.ts): lol_rank (con fallback al ya
 * guardado si mmradar no devuelve nada, para no pisar un rango real con
 * "Sin clasificar" por una falla puntual de la fuente), performance_rank,
 * performance_scores, titles, mmradar_icon_url, mmradar_server,
 * mmradar_level, duel_rating, duel_confidence, mmradar_engine_matches,
 * mmradar_updated_at.
 */
async function refreshOne(
  admin: ReturnType<typeof createClient<any>>,
  participant: { id: string; lol_username: string; lol_rank: string | null }
): Promise<{ id: string; ok: boolean; reason?: string }> {
  try {
    const profile = await fetchMmradarProfile(participant.lol_username);
    const rank = profile.currentRank?.rank ?? participant.lol_rank ?? "Sin clasificar";
    const updatedAt = new Date().toISOString();

    const { error } = await admin
      .from("participants")
      .update({
        lol_rank: rank,
        performance_rank: profile.performanceRank,
        performance_scores: profile.performanceScores,
        titles: profile.titles.length > 0 ? profile.titles : null,
        mmradar_icon_url: profile.iconUrl,
        mmradar_server: profile.server,
        mmradar_level: profile.level,
        duel_rating: profile.duelRating?.rating ?? null,
        duel_confidence: profile.duelRating?.confidence ?? null,
        mmradar_engine_matches: profile.engineMatches,
        mmradar_updated_at: updatedAt,
        updated_at: updatedAt
      })
      .eq("id", participant.id);

    if (error) return { id: participant.id, ok: false, reason: error.message };
    return { id: participant.id, ok: true };
  } catch (err) {
    if (err instanceof MmradarLookupError) {
      // not_found/source_unavailable/etc. -- no es un bug, mmradar puede
      // estar caido o el Riot ID puede haber quedado invalido. Se loguea
      // y se sigue con el resto del batch, mismo criterio que
      // fetchMmradarData (nunca tira error hacia arriba) en actions/index.ts.
      return { id: participant.id, ok: false, reason: `${err.reason}: ${err.message}` };
    }
    return { id: participant.id, ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function runScheduledRefresh(env: Env): Promise<void> {
  const url = env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("[scheduled] PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados, se salta el refresh.");
    return;
  }

  const admin = createClient<any>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const candidates = await fetchRefreshCandidates(admin);
  if (candidates.length === 0) {
    console.log("[scheduled] sin participantes con Riot ID para refrescar.");
    return;
  }

  // Secuencial, no Promise.all: mmradar.gg esta detras de Cloudflare y
  // puede tratar rafagas de consultas seguidas como bot (ver el aviso ya
  // documentado en test-rank-calibration.test.ts sobre REQUEST_DELAY_MS)
  // -- un batch de hasta MAX_REFRESHED_PER_RUN consultas en paralelo
  // dispararia ese bloqueo con certeza.
  const results: { id: string; ok: boolean; reason?: string }[] = [];
  for (const participant of candidates) {
    results.push(await refreshOne(admin, participant));
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `[scheduled] refresh completo: ${okCount}/${results.length} ok. ` +
      results
        .filter((r) => !r.ok)
        .map((r) => `${r.id}: ${r.reason}`)
        .join(" | ")
  );
}

export default {
  fetch: astroHandler.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log(`[scheduled] cron trigger disparado: ${controller.cron}`);
    // waitUntil mantiene el Worker vivo hasta terminar el refresh sin
    // bloquear la respuesta al trigger en si (mismo patron documentado
    // por Cloudflare para trabajo de fondo en scheduled()).
    ctx.waitUntil(runScheduledRefresh(env));
  }
} satisfies ExportedHandler<Env>;
