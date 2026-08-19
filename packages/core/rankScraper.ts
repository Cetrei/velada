// DEPRECATED (2026-08-18): reemplazado por completo por
// packages/core/mmradarScraper.ts (fetchMmradarProfile -> currentRank).
// Decision explicita del usuario: dejar de usar LeagueOfGraphs como fuente
// del rango "oficial" de un peleador; mmradar.gg es la unica fuente ahora
// (ya no hay concepto de servidor/region en la consulta de rango, mmradar
// lo resuelve solo). Este archivo se dejo vacio en vez de borrado porque
// el MCP de filesystem no expone delete; borrarlo a mano cuando se pueda.
export {};
