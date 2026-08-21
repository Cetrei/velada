/**
 * Test unitario puro (sin red, sin Supabase) de packages/core/roulette.ts
 * -- pedido explicito del usuario 2026-08-21: la ruleta debe cubrir a
 * todos los participantes en 1v1 distintos antes de repetir a nadie, y
 * solo repetir cuando queda un sobrante impar. Ver el bloque de
 * comentarios grande al inicio de roulette.ts para el detalle completo
 * de las reglas.
 *
 * Uso: bun test scripts/test-roulette.test.ts
 */
import { describe, test, expect } from "bun:test";
import { pickNextPair, countRandomAppearances, type RouletteMatchLike } from "../packages/core/roulette";

/** Generador determinista simple para tests -- nunca Math.random real aca, así los resultados son reproducibles. */
function makeDeterministicRandom(seedValues: number[]): () => number {
  let i = 0;
  return () => {
    const v = seedValues[i % seedValues.length];
    i += 1;
    return v;
  };
}

describe("countRandomAppearances", () => {
  test("solo cuenta combates isRandom, ignora los cargados a mano", () => {
    const matches: RouletteMatchLike[] = [
      { player1Id: "a", player2Id: "b", isRandom: true },
      { player1Id: "c", player2Id: "d", isRandom: false }
    ];
    const counts = countRandomAppearances(matches);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
    expect(counts.has("c")).toBe(false);
    expect(counts.has("d")).toBe(false);
  });

  test("cuenta multiples apariciones del mismo participante", () => {
    const matches: RouletteMatchLike[] = [
      { player1Id: "a", player2Id: "b", isRandom: true },
      { player1Id: "a", player2Id: "c", isRandom: true }
    ];
    const counts = countRandomAppearances(matches);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBe(1);
  });
});

describe("pickNextPair", () => {
  test("con pool par y sin historial, empareja dos frescos cualquiera", () => {
    const pair = pickNextPair(["a", "b", "c", "d"], []);
    expect(pair).not.toBeNull();
    expect(pair!.player1Id).not.toBe(pair!.player2Id);
    expect(["a", "b", "c", "d"]).toContain(pair!.player1Id);
    expect(["a", "b", "c", "d"]).toContain(pair!.player2Id);
  });

  test("nunca elige dentro de los ya usados mientras haya 2+ frescos", () => {
    const existing: RouletteMatchLike[] = [{ player1Id: "a", player2Id: "b", isRandom: true }];
    // fresh = [c, d] -- debe elegir exactamente ese par, nunca tocar a/b.
    const pair = pickNextPair(["a", "b", "c", "d"], existing);
    expect(pair).not.toBeNull();
    expect([pair!.player1Id, pair!.player2Id].sort()).toEqual(["c", "d"]);
  });

  test("cubre secuencialmente pool par completo sin repetir a nadie hasta agotar", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const matches: RouletteMatchLike[] = [];
    const seenPairs: string[] = [];

    for (let i = 0; i < 3; i++) {
      const pair = pickNextPair(ids, matches);
      expect(pair).not.toBeNull();
      seenPairs.push([pair!.player1Id, pair!.player2Id].sort().join("-"));
      matches.push({ player1Id: pair!.player1Id, player2Id: pair!.player2Id, isRandom: true });
    }

    // 6 participantes, 3 giros -- cada uno debe haber aparecido exactamente 1 vez.
    const appearances = countRandomAppearances(matches);
    for (const id of ids) {
      expect(appearances.get(id)).toBe(1);
    }
    // Ningun par repetido en las 3 rondas de esta cobertura inicial.
    expect(new Set(seenPairs).size).toBe(3);
  });

  test("pool impar: el ultimo sobrante repite forzosamente contra alguien ya usado", () => {
    const ids = ["a", "b", "c", "d", "e"]; // impar
    const matches: RouletteMatchLike[] = [];

    for (let i = 0; i < 2; i++) {
      const pair = pickNextPair(ids, matches);
      expect(pair).not.toBeNull();
      matches.push({ player1Id: pair!.player1Id, player2Id: pair!.player2Id, isRandom: true });
    }

    // Tras 2 giros, 4 de los 5 ya aparecieron -- queda exactamente 1 fresco.
    const appearancesBeforeThird = countRandomAppearances(matches);
    const freshBeforeThird = ids.filter((id) => !appearancesBeforeThird.has(id));
    expect(freshBeforeThird.length).toBe(1);
    const soleFreshId = freshBeforeThird[0];

    // El 3er giro DEBE incluir a ese sobrante (regla 3) -- es forzoso.
    const thirdPair = pickNextPair(ids, matches);
    expect(thirdPair).not.toBeNull();
    expect([thirdPair!.player1Id, thirdPair!.player2Id]).toContain(soleFreshId);

    // Y su rival debe ser alguien YA usado (no el mismo par que antes necesariamente,
    // pero si alguien de appearancesBeforeThird).
    const rivalId = thirdPair!.player1Id === soleFreshId ? thirdPair!.player2Id : thirdPair!.player1Id;
    expect(appearancesBeforeThird.has(rivalId)).toBe(true);
  });

  test("cobertura completa: el siguiente giro arranca una ronda nueva sobre todo el pool", () => {
    const ids = ["a", "b", "c", "d"];
    // Simula que ya salieron los 4 (2 combates que cubren a todos).
    const matches: RouletteMatchLike[] = [
      { player1Id: "a", player2Id: "b", isRandom: true },
      { player1Id: "c", player2Id: "d", isRandom: true }
    ];

    const pair = pickNextPair(ids, matches);
    expect(pair).not.toBeNull();
    // Con cobertura completa, cualquier par del pool es valido de nuevo --
    // lo unico que se verifica es que no devuelva null ni se rompa.
    expect(["a", "b", "c", "d"]).toContain(pair!.player1Id);
    expect(["a", "b", "c", "d"]).toContain(pair!.player2Id);
    expect(pair!.player1Id).not.toBe(pair!.player2Id);
  });

  test("pool de menos de 2 participantes devuelve null", () => {
    expect(pickNextPair([], [])).toBeNull();
    expect(pickNextPair(["a"], [])).toBeNull();
  });

  test("nunca empareja a alguien consigo mismo, con random inyectado fijo", () => {
    const random = makeDeterministicRandom([0, 0, 0, 0, 0]);
    for (let i = 0; i < 20; i++) {
      const ids = ["a", "b", "c", "d", "e"];
      const matches: RouletteMatchLike[] = [];
      let pair = pickNextPair(ids, matches, { random });
      while (pair) {
        expect(pair.player1Id).not.toBe(pair.player2Id);
        matches.push({ player1Id: pair.player1Id, player2Id: pair.player2Id, isRandom: true });
        if (matches.length > 10) break; // corte de seguridad, no debe hacer falta
        pair = pickNextPair(ids, matches, { random });
      }
    }
  });

  test("ids duplicados en el pool de entrada se deduplican", () => {
    const pair = pickNextPair(["a", "a", "b"], []);
    expect(pair).not.toBeNull();
    expect([pair!.player1Id, pair!.player2Id].sort()).toEqual(["a", "b"]);
  });
});
