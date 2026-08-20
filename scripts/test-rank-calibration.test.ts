/**
 * Test de CALIBRACION para packages/core/performanceRank.ts (y de paso
 * duelRating.ts, ver el resumen final). No es un test de regresion en el
 * sentido tradicional -- esta pensado para correrse en loop mientras se
 * ajustan las constantes de performanceRank.ts (TIER_THRESHOLDS,
 * multiplicadores de winRateAdjustment/consistencyAdjustment) hasta que el
 * output se acerque a los valores de referencia reales.
 *
 * FUENTE DE DATOS (2026-08-20, pedido del usuario): ya NO le pega a
 * mmradar.gg en cada corrida por defecto. Los 6 Riot IDs de
 * scripts/rank-calibration-fixtures.json son participantes reales
 * cargados en la tabla `participants` de Supabase, y
 * saveOwnParticipant/saveParticipant/refreshMmradarData (ver
 * apps/web/src/actions/index.ts) ya persisten las partidas crudas de cada
 * uno en la columna `mmradar_engine_matches` cada vez que alguien hace
 * refresh desde la web. Este test primero intenta LEER esa columna directo
 * de Supabase (via @supabase/supabase-js con la service role key del .env
 * de la raiz -- bun test carga .env automaticamente) y corre
 * computePerformanceRankDebug sobre lo que encuentra ahi.
 *
 * FALLBACK: si un jugador todavia no tiene mmradar_engine_matches en la DB
 * (nunca se hizo refresh desde la web para ese perfil, el campo vino
 * null/vacio, o Supabase no esta configurado en .env), se cae a consultar
 * mmradar.gg en vivo para ESE jugador puntual (fetchMmradarProfile, mismo
 * criterio que scripts/test-mmradar-scraper.test.ts), con el mismo
 * delay/retry contra bloqueos de Cloudflare que ya existia. Asi el test
 * sigue funcionando de punta a punta la primera vez, antes de que nadie
 * haya refrescado nada desde la web para alguno de los 6 fixtures.
 *
 * Por cada jugador imprime una tabla de diagnostico completa (promedio,
 * winrate, consistencia, tier base, ajuste crudo vs clampeado, resultado) --
 * eso es lo que hay que mirar para decidir que constante tocar en
 * performanceRank.ts. El assert final no hace fallar el test si un rango no
 * matchea exacto (el objetivo de esta corrida es AJUSTAR constantes, no
 * bloquear un build) -- en cambio junta los desvios y los imprime en un
 * resumen al final, para poder ver de un vistazo cuantos jugadores quedaron
 * bien calibrados.
 *
 * Uso: bun run calibrate:rank
 * (definido en package.json -> "bun test scripts/test-rank-calibration.test.ts")
 *
 * Mismo aviso que test-mmradar-scraper.test.ts para el camino de fallback:
 * mmradar.gg esta detras de Cloudflare y puede bloquear la consulta segun
 * la IP (403/503/challenge page). Un bloqueo se reporta por consola y NO
 * cuenta como jugador mal calibrado (no es un problema del algoritmo).
 *
 * IMPORTANTE sobre bloqueo por rafaga (visto en la practica: la web con
 * `bun run dev` consulta un Riot ID a la vez y entra sin problema, pero
 * pegarle a mmradar.gg varias veces seguidas sin pausa puede ser tratado
 * como bot aunque sea la MISMA IP): en el camino de fallback cada consulta
 * espera REQUEST_DELAY_MS desde que termina la anterior, y si aun asi se
 * detecta bloqueo hay hasta MAX_RETRIES reintentos con backoff creciente
 * antes de rendirse para ese jugador puntual. Cuando todos los jugadores
 * ya tienen datos en Supabase este delay ni se usa -- las lecturas a la DB
 * no tienen ninguna restriccion de rafaga.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { fetchMmradarProfile, MmradarLookupError, type MmradarProfileResult } from "../packages/core/mmradarScraper";
import { computePerformanceRankDebug, type PerformanceRankDebug } from "../packages/core/performanceRank";
import { computeDuelRatingFromMatches } from "../packages/core/duelRating";
import { EngineMatchSchema } from "../packages/core/schemas";
import type { TitleEngineMatch } from "../packages/core/titleEngine";

interface RankFixture {
  riotId: string;
  expectedRank: string;
}

const FIXTURES: RankFixture[] = JSON.parse(
  readFileSync(join(import.meta.dir, "rank-calibration-fixtures.json"), "utf-8")
);

const REQUEST_DELAY_MS = 4000;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedBySource(err: unknown): err is MmradarLookupError {
  return (
    err instanceof MmradarLookupError &&
    err.reason === "source_unavailable" &&
    /bloque|anti-bot/i.test(err.message)
  );
}

async function fetchWithRetry(riotId: string): Promise<MmradarProfileResult | "blocked"> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchMmradarProfile(riotId);
    } catch (err) {
      if (!isBlockedBySource(err)) throw err;
      if (attempt === MAX_RETRIES) return "blocked";
      const wait = RETRY_BACKOFF_MS * attempt;
      console.warn(
        `  -> mmradar.gg bloqueo la consulta para ${riotId} (intento ${attempt}/${MAX_RETRIES}). Reintentando en ${wait}ms...`
      );
      await sleep(wait);
    }
  }
  return "blocked";
}

/**
 * Cliente Supabase standalone para este script: NO se reusa
 * apps/web/src/lib/supabaseServer.ts porque createSupabaseAdminClient
 * necesita un `locals` de Astro (Cloudflare Worker) para leer las env
 * vars en produccion -- fuera de un request de Astro ese contexto no
 * existe. Este script corre con `bun test` desde la raiz del repo, donde
 * bun ya carga .env automaticamente, asi que alcanza con process.env
 * directo. null si PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no
 * estan seteadas -- el caller cae al fallback de fetch en vivo en ese
 * caso, no hace fallar el test.
 */
function createStandaloneSupabaseClient(): ReturnType<typeof createClient<any>> | null {
  const url = process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient<any>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Intenta leer mmradar_engine_matches de Supabase para este Riot ID
 * (matcheado contra participants.lol_username, tal como se guarda el
 * campo en saveOwnParticipant/saveParticipant). Devuelve null si la fila
 * no existe, el campo vino null/vacio, no matchea el schema esperado, o
 * el cliente no esta configurado -- en todos esos casos el caller decide
 * caer al fetch en vivo.
 */
async function fetchEngineMatchesFromDb(
  admin: ReturnType<typeof createClient<any>>,
  riotId: string
): Promise<{ engineMatches: TitleEngineMatch[]; currentRank: string | null } | null> {
  const { data, error } = await admin
    .from("participants")
    .select("mmradar_engine_matches, lol_rank")
    .eq("lol_username", riotId)
    .maybeSingle();

  if (error) {
    console.warn(`  -> error leyendo Supabase para ${riotId}: ${error.message}`);
    return null;
  }
  if (!data || !data.mmradar_engine_matches) return null;

  try {
    const engineMatches = z.array(EngineMatchSchema).parse(data.mmradar_engine_matches);
    if (engineMatches.length === 0) return null;
    return { engineMatches, currentRank: (data.lol_rank as string | null) ?? null };
  } catch (err) {
    console.warn(
      `  -> mmradar_engine_matches de ${riotId} en Supabase no matchea el schema esperado, se ignora: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function normalizeRank(rank: string): string {
  return rank.trim().toLowerCase().replace(/\s+/g, " ");
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function fmtSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function printDebugRow(riotId: string, expectedRank: string, debug: PerformanceRankDebug | null) {
  console.log(`\n=== ${riotId} ===`);
  console.log(`  esperado:        ${expectedRank}`);

  if (!debug) {
    console.log("  -> sin partidas recientes, no se pudo calcular nada.");
    return;
  }

  console.log(`  obtenido:        ${debug.result?.rank ?? "(null)"}`);
  console.log(`  partidas:        ${debug.gamesPlayed} (${debug.wins}W / ${debug.gamesPlayed - debug.wins}L, winrate ${fmtPct(debug.winRate)})`);
  console.log(`  promedio total:  ${debug.avgTotal.toFixed(1)}`);
  console.log(`  tier base:       ${debug.baseTierLabel} (indice ${debug.baseTierIndex}, ${(debug.fractionalInTier * 100).toFixed(0)}% dentro del tier) -> ${debug.totalSteps} escalones`);
  console.log(`  ajuste winrate:      ${fmtSigned(debug.winRateAdjustment)} escalones`);
  console.log(`  ajuste consistencia: ${fmtSigned(debug.consistencyAdjustment)} escalones`);
  console.log(`  ajuste crudo total:  ${fmtSigned(debug.rawAdjustment)} -> clampeado a ${fmtSigned(debug.clampedAdjustment)}`);
  console.log(`  escalones finales:   ${debug.totalSteps} + ${Math.round(debug.clampedAdjustment)} = ${debug.finalSteps}`);
}

describe("calibracion de Performance Rank contra datos reales", () => {
  const results: { riotId: string; expected: string; obtained: string | null; match: boolean; source: string }[] = [];
  const supabase = createStandaloneSupabaseClient();
  if (!supabase) {
    console.warn(
      "\nPUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no estan en .env -- se salta la lectura de Supabase" +
        " y se cae directo al fetch en vivo contra mmradar.gg para los 6 fixtures."
    );
  }
  let previousLiveRequestFinishedAt = 0;

  for (const fixture of FIXTURES) {
    test(
      fixture.riotId,
      async () => {
        const fromDb = supabase ? await fetchEngineMatchesFromDb(supabase, fixture.riotId) : null;

        let engineMatches: TitleEngineMatch[];
        let currentRank: string | null;
        let source: "db" | "live";

        if (fromDb) {
          engineMatches = fromDb.engineMatches;
          currentRank = fromDb.currentRank;
          source = "db";
        } else {
          console.log(`  (${fixture.riotId}: sin datos en Supabase todavia, consultando mmradar.gg en vivo...)`);

          // Espaciar las consultas en vivo entre si (no solo dentro de un
          // mismo test) -- ver el aviso de rafaga en la cabecera del
          // archivo. Solo aplica a jugadores que caen a este camino.
          const elapsedSincePrevious = Date.now() - previousLiveRequestFinishedAt;
          if (previousLiveRequestFinishedAt > 0 && elapsedSincePrevious < REQUEST_DELAY_MS) {
            await sleep(REQUEST_DELAY_MS - elapsedSincePrevious);
          }

          const profile = await fetchWithRetry(fixture.riotId);
          previousLiveRequestFinishedAt = Date.now();

          if (profile === "blocked") {
            console.warn(
              `  -> mmradar.gg siguio bloqueando la consulta para ${fixture.riotId} tras ${MAX_RETRIES} intentos. Se salta.`
            );
            return;
          }

          if (!profile.engineMatches || profile.engineMatches.length === 0) {
            console.warn(`  -> ${fixture.riotId}: sin partidas recientes en mmradar.gg, no se puede calibrar.`);
            results.push({ riotId: fixture.riotId, expected: fixture.expectedRank, obtained: null, match: false, source: "live" });
            return;
          }

          engineMatches = profile.engineMatches;
          currentRank = profile.currentRank?.rank ?? null;
          source = "live";
        }

        const debug = computePerformanceRankDebug(engineMatches);
        printDebugRow(`${fixture.riotId} [${source === "db" ? "Supabase" : "mmradar.gg en vivo"}]`, fixture.expectedRank, debug);

        const obtained = debug?.result?.rank ?? null;
        const match = obtained !== null && normalizeRank(obtained) === normalizeRank(fixture.expectedRank);
        results.push({ riotId: fixture.riotId, expected: fixture.expectedRank, obtained, match, source });

        // Referencia de duelRating tambien, por si hace falta calibrarlo en
        // paralelo (usa los mismos datos crudos) -- no forma parte de la
        // aserción del test, es solo informativo.
        const duelRating = computeDuelRatingFromMatches(engineMatches, {
          performanceRank: debug?.result?.rank ?? null,
          currentRank
        });
        if (duelRating) {
          console.log(
            `  duel rating:     ${duelRating.rating}/100 (confianza ${fmtPct(duelRating.confidence)}, ${duelRating.gamesConsidered} partidas)`
          );
        }

        // No se hace expect(obtained).toBe(expected) a proposito: mientras
        // se calibra, un desvio es informacion util, no un fallo que deba
        // frenar la corrida del resto de los jugadores. El resumen final
        // (afterAll-like, ver bottom) es donde se ve el estado global.
        expect(typeof obtained === "string" || obtained === null).toBe(true);
      },
      // Timeout generoso: cubre tanto el camino rapido (lectura a
      // Supabase) como el fallback en vivo (delay previo + hasta
      // MAX_RETRIES reintentos con backoff creciente si mmradar bloquea).
      REQUEST_DELAY_MS + MAX_RETRIES * (RETRY_BACKOFF_MS * MAX_RETRIES) + 15000
    );
  }

  test("resumen de calibracion", () => {
    // Este test corre despues de los anteriores (bun:test respeta el orden
    // de declaracion dentro de un describe) y solo imprime el resumen -- no
    // repite ninguna consulta.
    if (results.length === 0) {
      console.log("\n(sin resultados -- probablemente todas las consultas en vivo fueron bloqueadas por Cloudflare)");
      return;
    }

    const matched = results.filter((r) => r.match).length;
    const fromDb = results.filter((r) => r.source === "db").length;
    console.log(`\n\n===== RESUMEN DE CALIBRACION (${matched}/${results.length} coinciden, ${fromDb}/${results.length} desde Supabase) =====`);
    for (const r of results) {
      const mark = r.match ? "OK" : "!!";
      const tag = r.source === "db" ? "db" : "live";
      console.log(`  [${mark}] [${tag}] ${r.riotId.padEnd(28)} esperado=${r.expected.padEnd(14)} obtenido=${r.obtained ?? "(sin datos)"}`);
    }
    if (matched < results.length) {
      console.log(
        "\nAjusta TIER_THRESHOLDS / winRateAdjustment / consistencyAdjustment en " +
          "packages/core/performanceRank.ts mirando el detalle de cada jugador arriba, y volve a correr este test."
      );
    }
    if (fromDb < results.length) {
      console.log(
        "\nTip: los jugadores marcados [live] no tenian mmradar_engine_matches en Supabase todavia --" +
          " haciendo refresh de su perfil una vez desde la web (o /mi-perfil, o el boton Actualizar del panel)" +
          " los va a dejar guardados ahi y las proximas corridas de este test van a leer directo de la DB para ellos."
      );
    }
    expect(results.length).toBeGreaterThan(0);
  });
});
