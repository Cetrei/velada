// DEPRECATED: reemplazado por PlayerCardLive.tsx + MmradarPanel.tsx
// (mounts client:load separados que se comunican via
// lib/mmradarUpdateBus.ts) en la misma sesion en que se creo este
// archivo. El enfoque de un solo wrapper con `display: contents` para
// que PlayerCard y MmradarPanel compartieran una isla de React resulto
// no poder reproducir el grid de 5 columnas de [id].astro (el bloque de
// mmradar necesita vivir DENTRO del flujo de la columna derecha, no como
// hermano de grid en la posicion 2). El event bus es mas simple y no
// pelea con el layout. El MCP de filesystem no expone delete, ver
// convencion ya establecida en AGENT.md (Roulette.tsx, rankScraper.ts).
export {};
