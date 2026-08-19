/**
 * Verifica que la consulta de rango (packages/core/rankScraper.ts) sigue
 * funcionando contra la fuente real (LeagueOfGraphs) y que la URL/slug se
 * arman como se espera. No es un test unitario con mocks: pega de verdad
 * a la web externa a proposito, porque lo que puede romperse con el
 * tiempo es justamente que ESE sitio cambie su HTML o deje de responder
 * como antes — un mock nunca detectaria eso.
 *
 * Uso: bun run test:scrapping
 * (definido en package.json -> "bun test scripts/test-rank-scraper.test.ts")
 *
 * IMPORTANTE: LeagueOfGraphs esta detras de Cloudflare, que puede
 * bloquear la peticion (403/503, o un 200 con pagina de challenge) segun
 * el trust score de la IP desde la que se corre este test — sobre todo
 * en CI/servidores, mucho menos en una laptop con IP residencial. Los
 * tests de "consulta real" NO fallan duro ante un bloqueo detectado
 * (RankLookupError con reason "source_unavailable" Y mensaje que
 * menciona bloqueo/anti-bot): lo reportan por consola y se saltan la
 * aserción de contenido, porque eso no es un bug del scraper ni de este
 * proyecto, es Cloudflare filtrando la IP de quien corre el test. Un
 * error real de formato (RankLookupError con reason distinta, o
 * cualquier otra excepcion) SI sigue haciendo fallar el test.
 */
import { describe, test, expect } from "bun:test";
import {
  fetchRankFromLeagueOfGraphs,
  leagueOfGraphsProfileUrl,
  riotIdToLeagueOfGraphsSlug,
  RankLookupError
} from "../packages/core/rankScraper";

// Riot ID real de ejemplo (LAN) provisto al armar este test. Si en algun
// momento deja de existir o cambia de rango, el test igual pasa: solo
// exige que la consulta responda con una forma valida, no un rango fijo
// (un rango fijo haria que el test falle solo, sin que nada este roto).
const SAMPLE_RIOT_ID = "OneShotOneKill#sigma";
const SAMPLE_SERVER = "LAN";

function isBlockedBySource(err: unknown): err is RankLookupError {
  return (
    err instanceof RankLookupError &&
    err.reason === "source_unavailable" &&
    /bloque|anti-bot/i.test(err.message)
  );
}

describe("slug / URL de LeagueOfGraphs", () => {
  test('"OneShotOneKill#sigma" -> "oneshotonekill-sigma"', () => {
    expect(riotIdToLeagueOfGraphsSlug(SAMPLE_RIOT_ID)).toBe("oneshotonekill-sigma");
  });

  test("el nombre va en minusculas, el tag se conserva", () => {
    expect(riotIdToLeagueOfGraphsSlug("FaBiTos#PRIV")).toBe("fabitos-PRIV");
  });

  test("arma la URL de perfil con el formato pedido", () => {
    const url = leagueOfGraphsProfileUrl(SAMPLE_RIOT_ID, SAMPLE_SERVER);
    expect(url).toBe("https://www.leagueofgraphs.com/summoner/lan/oneshotonekill-sigma");
  });

  test("rechaza un Riot ID sin tag", () => {
    expect(() => riotIdToLeagueOfGraphsSlug("SinTag")).toThrow(RankLookupError);
  });

  test("rechaza un servidor no soportado", () => {
    expect(() => leagueOfGraphsProfileUrl(SAMPLE_RIOT_ID, "EUW9000")).toThrow(RankLookupError);
  });
});

describe("consulta real contra LeagueOfGraphs", () => {
  test(
    `encuentra un rango valido para ${SAMPLE_RIOT_ID} (${SAMPLE_SERVER})`,
    async () => {
      try {
        const result = await fetchRankFromLeagueOfGraphs(SAMPLE_RIOT_ID, SAMPLE_SERVER);

        // Un perfil sin clasificar en ambas colas es un resultado valido
        // (null), no una falla del scraper — solo se afirma la forma del
        // resultado cuando existe.
        if (result) {
          expect(typeof result.rank).toBe("string");
          expect(result.rank.length).toBeGreaterThan(0);
          expect(["solo", "flex"]).toContain(result.queue);
          expect(result.leaguePoints).toBeGreaterThanOrEqual(0);
          console.log(`  -> rango encontrado: ${result.rank} (${result.leaguePoints} LP, cola ${result.queue})`);
        } else {
          console.log("  -> perfil encontrado pero sin clasificar en ninguna cola (resultado valido).");
        }
      } catch (err) {
        if (isBlockedBySource(err)) {
          console.warn(
            `  -> LeagueOfGraphs bloqueo la consulta desde esta IP (${err.message}). ` +
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
    "un Riot ID inexistente lanza RankLookupError con reason 'not_found'",
    async () => {
      try {
        await fetchRankFromLeagueOfGraphs("EsteNombreNoDeberiaExistirNunca12345#ZZZZ", SAMPLE_SERVER);
        throw new Error("Se esperaba que fetchRankFromLeagueOfGraphs lanzara RankLookupError");
      } catch (err) {
        if (isBlockedBySource(err)) {
          console.warn(`  -> LeagueOfGraphs bloqueo la consulta desde esta IP (${err.message}). Se salta este test.`);
          return;
        }
        expect(err).toBeInstanceOf(RankLookupError);
        expect((err as RankLookupError).reason).toBe("not_found");
      }
    },
    15000
  );
});
