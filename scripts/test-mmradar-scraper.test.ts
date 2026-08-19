/**
 * Verifica que la consulta de perfil (packages/core/mmradarScraper.ts)
 * sigue funcionando contra la fuente real (mmradar.gg) y que la
 * URL/slug se arman como se espera. No es un test unitario con mocks:
 * pega de verdad a la web externa a proposito, porque lo que puede
 * romperse con el tiempo es justamente que ESE sitio cambie su HTML o
 * deje de responder como antes — un mock nunca detectaria eso. Mismo
 * patron que el extinto scripts/test-rank-scraper.test.ts (LeagueOfGraphs,
 * deprecated — mmradar.gg es la unica fuente de rango ahora).
 *
 * Uso: bun run test:scrapping
 * (definido en package.json -> "bun test scripts/test-mmradar-scraper.test.ts")
 *
 * IMPORTANTE: mmradar.gg esta detras de Cloudflare, que puede bloquear la
 * peticion (403/503, o un 200 con pagina de challenge) segun el trust
 * score de la IP desde la que se corre este test — sobre todo en
 * CI/servidores, mucho menos en una laptop con IP residencial. Los tests
 * de "consulta real" NO fallan duro ante un bloqueo detectado
 * (MmradarLookupError con reason "source_unavailable" Y mensaje que
 * menciona bloqueo/anti-bot): lo reportan por consola y se saltan la
 * aserción de contenido, porque eso no es un bug del scraper ni de este
 * proyecto, es Cloudflare filtrando la IP de quien corre el test. Un
 * error real de formato (MmradarLookupError con reason distinta, o
 * cualquier otra excepcion) SI sigue haciendo fallar el test.
 */
import { describe, test, expect } from "bun:test";
import {
  fetchMmradarProfile,
  mmradarProfileUrl,
  riotIdToMmradarSlug,
  MmradarLookupError
} from "../packages/core/mmradarScraper";

// Mismo Riot ID real de ejemplo (LAN) que el test anterior de
// LeagueOfGraphs, provisto por el usuario junto con un HTML de ejemplo
// real de mmradar.gg para ese mismo perfil. Si en algun momento deja de
// existir o cambia de rango, el test igual pasa: solo exige que la
// consulta responda con una forma valida, no un rango fijo (un rango fijo
// haria que el test falle solo, sin que nada este roto).
const SAMPLE_RIOT_ID = "OneShotOneKill#sigma";

function isBlockedBySource(err: unknown): err is MmradarLookupError {
  return (
    err instanceof MmradarLookupError &&
    err.reason === "source_unavailable" &&
    /bloque|anti-bot/i.test(err.message)
  );
}

describe("slug / URL de mmradar.gg", () => {
  test('"OneShotOneKill#sigma" -> "OneShotOneKill-sigma"', () => {
    expect(riotIdToMmradarSlug(SAMPLE_RIOT_ID)).toBe("OneShotOneKill-sigma");
  });

  test("preserva mayusculas del nombre y del tag (a diferencia de LeagueOfGraphs)", () => {
    expect(riotIdToMmradarSlug("FaBiTos#PRIV")).toBe("FaBiTos-PRIV");
  });

  test("arma la URL de perfil con el formato pedido", () => {
    const url = mmradarProfileUrl(SAMPLE_RIOT_ID);
    expect(url).toBe("https://mmradar.gg/summoner/OneShotOneKill-sigma");
  });

  test("rechaza un Riot ID sin tag", () => {
    expect(() => riotIdToMmradarSlug("SinTag")).toThrow(MmradarLookupError);
  });
});

describe("consulta real contra mmradar.gg", () => {
  test(
    `encuentra un perfil valido para ${SAMPLE_RIOT_ID}`,
    async () => {
      try {
        const result = await fetchMmradarProfile(SAMPLE_RIOT_ID);

        // El Current Rank (rango oficial) puede ser null si el jugador
        // esta sin clasificar — resultado valido, no una falla del
        // scraper. El Performance Rank en cambio siempre deberia venir
        // (es el campo que fetchMmradarProfile exige para no lanzar
        // unexpected_format).
        expect(typeof result.performanceRank).toBe("string");
        expect(result.performanceRank.length).toBeGreaterThan(0);

        if (result.currentRank) {
          expect(typeof result.currentRank.rank).toBe("string");
          expect(result.currentRank.rank.length).toBeGreaterThan(0);
          expect(result.currentRank.leaguePoints).toBeGreaterThanOrEqual(0);
          console.log(
            `  -> rango oficial: ${result.currentRank.rank} (${result.currentRank.leaguePoints} LP)`
          );
        } else {
          console.log("  -> perfil encontrado pero sin clasificar en Solo/Duo (resultado valido).");
        }
        console.log(`  -> performance rank: ${result.performanceRank}`);

        if (result.performanceScores) {
          for (const key of ["laning", "farming", "objectives", "combat", "teamfight", "vision"] as const) {
            expect(typeof result.performanceScores[key]).toBe("number");
          }
        }

        expect(Array.isArray(result.titles)).toBe(true);
      } catch (err) {
        if (isBlockedBySource(err)) {
          console.warn(
            `  -> mmradar.gg bloqueo la consulta desde esta IP (${(err as MmradarLookupError).message}). ` +
              "No es un bug del scraper — se salta la asercion de contenido."
          );
          return;
        }
        throw err;
      }
    },
    15000
  );

  test(
    "un Riot ID inexistente lanza MmradarLookupError con reason 'not_found'",
    async () => {
      try {
        await fetchMmradarProfile("EsteNombreNoDeberiaExistirNunca12345#ZZZZ");
        throw new Error("Se esperaba que fetchMmradarProfile lanzara MmradarLookupError");
      } catch (err) {
        if (isBlockedBySource(err)) {
          console.warn(
            `  -> mmradar.gg bloqueo la consulta desde esta IP (${(err as MmradarLookupError).message}). Se salta este test.`
          );
          return;
        }
        expect(err).toBeInstanceOf(MmradarLookupError);
        expect((err as MmradarLookupError).reason).toBe("not_found");
      }
    },
    15000
  );
});
