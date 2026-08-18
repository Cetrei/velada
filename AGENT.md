# AGENT.md — velada_lol

## Que es esto
Sitio web para "La Velada del Año - Especial LoL" (evento entre amigos).
Landing + roster de peleadores + sorteo en vivo (ruleta sincronizada via
Supabase Realtime) + panel admin. Monorepo Bun, Astro SSR en Cloudflare
Workers.

## Estado actual (2026-08-17)
Implementacion e2e completa del frontend y la capa de datos, dividido en 4
paginas segun se pidio: landing (resumen + CTAs), /peleadores (roster
completo), /sorteo (ruleta en vivo), /admin (panel de control). El prototipo
en prototipo.html fue solo referencia visual, no se reutiliza directamente.

### Estructura
- `packages/core/` — fuente de verdad: schemas Zod (`schemas.ts`) + parser
  YAML con fallback mock (`utils.ts`). `@velada/types` re-exporta los tipos
  inferidos de aqui, no duplica definiciones.
- `apps/web/src/content/participants.yml` — 10 participantes demo.
  Si el YAML queda vacio o invalido, `parseParticipants` cae a un mock de 4
  fighters (`packages/core/utils.ts`) en vez de romper el build.
- `apps/web/src/lib/`
  - `supabase.ts` — cliente singleton, retorna `null` si faltan env vars
    (paginas siguen funcionando en modo local/estatico).
  - `loadParticipants.ts` — lee el YAML en build/request time.
  - `eventState.ts` — lee `event_state` de Supabase, fallback a countdown de
    7 dias si no hay conexion.
- `apps/web/src/components/`
  - `Countdown.tsx`, `FighterCard.astro` (modo resumen y `detailed`),
    `RouletteWheel.tsx` (canvas + Supabase Realtime broadcast + suscripcion a
    cambios de `event_state.roulette_unlocked`), `AdminControl.tsx` (cambia
    fase del evento, toggle de sorteo, emite el broadcast oficial y persiste
    en `matches`).
  - `Roulette.tsx` — DEPRECATED, vacio, pendiente borrado manual (el MCP de
    filesystem no expone delete).
- `scripts/setup-supabase.ts` — provisioning real via Supabase Management
  API: crea tablas, RLS, realtime publications, escribe `.env` y
  `apps/web/.env`.
- `scripts/setup-cloudflare-secrets.ts` — lee `.env` de la raiz y setea
  `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` como GitHub Actions secrets via `gh secret set`
  (requiere `gh` CLI autenticado). Corre con `bun run setup:cf-secrets`.
  Estas van como GitHub secret (no `wrangler secret put`) porque
  `deploy.yml` las necesita en el paso de build de Astro, no en runtime del
  Worker; el Worker no referencia ninguna var server-side hoy.

## Decision de arquitectura tomada esta sesion
El spec original (`docs/ARCHITECTURE_SPEC.md`) apuntaba a Cloudflare Pages.
El adapter `@astrojs/cloudflare` actual ya no soporta Pages, solo Workers.
Se decidio (con el usuario, no unilateral) migrar a SSR completo
(`output: 'server'`) sobre Cloudflare Workers. Afecta:
- `astro.config.mjs` (adapter cloudflare + output server)
- `apps/web/wrangler.toml` (nuevo, formato Workers con `[assets]`)
- `.github/workflows/deploy.yml` (`wrangler deploy` en vez de
  `pages deploy`)
- `docs/ARCHITECTURE_SPEC.md` actualizado con nota al respecto

## Pendiente / siguiente sesion
- Instalar dependencias reales (`bun install`) y correr `bun run dev` para
  verificar que compila; no se corrio ningun comando en esta sesion, todo
  fue edicion de archivos via filesystem MCP.
- Reemplazar `participants.yml` con datos reales (~10 amigos) cuando estén
  listos.
- Correr `bun run setup:db` con `SUPABASE_ACCESS_TOKEN` y
  `SUPABASE_PROJECT_REF` reales para provisionar la base.
- Borrar manualmente `apps/web/src/components/Roulette.tsx` (deprecated).
- Definir imagenes reales para `photo`/`banner` de cada participante (hoy
  cae a placeholder de placehold.co).
- Evaluar si `admin.astro` necesita autenticacion real (hoy no tiene guard,
  cualquiera con la URL puede controlar el evento).

## Convenciones del proyecto
Ver `shared/code_standards.md` del sistema de roles. camelCase, funciones
chicas, guard clauses, sin comentarios obvios.
