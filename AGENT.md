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

## Sesion 2026-08-17: rediseno landing + banner de peleador
- `HeroBanner.astro`: ya no arma un collage de fotos de participantes de
  fondo; usa una imagen fija del sitio en
  `apps/web/public/images/hero-banner.jpg` (el usuario la pone a mano, no
  se sube desde el admin). El bloque de texto/countdown ahora ocupa toda
  la altura del viewport (`h-screen`) con flecha de scroll animada abajo.
- `index.astro`: el landing paso a scroll vertical con snap
  (`snap-y snap-mandatory`, cada seccion `min-h-screen snap-start`) en vez
  de scroll libre continuo — hero, roster/champ-select, pronosticos,
  combates y sorteo son "actos" separados, cada uno resumido (ya estaba
  limitado con `.slice()`, eso no cambio).
- `ChampionSelectGrid.tsx`: reescrito de hover-preview a un layout tipo
  cliente de LoL — rail angosto de retratos a la izquierda (click, no
  hover), panel vacio a la derecha hasta seleccionar, banner grande al
  seleccionar (usa `participant.banner`, fallback a `photo`) con boton
  volver y boton "ver ficha completa" hacia `/peleadores/[id]`.
- Nav superior: el CTA dorado ya no es "Ver en Vivo" -> `/sorteo`, ahora es
  "Inscribirme" -> `/inscripcion` (`NAV.registerCta`, ya existia en
  content.ts). El CTA "Ver en vivo" del sorteo en el fondo del landing NO
  se toco (ese si es sobre el sorteo en vivo real).
- `participant.banner` (ya existia en el schema y en la tabla de Supabase,
  pero no se subia desde ningun formulario): se agrego el input de archivo
  en `ParticipantProfileForm.tsx` (self-service) y `ParticipantManager.tsx`
  (admin), y el upload correspondiente a Supabase Storage
  (bucket `participant-photos`, prefijo `{id}-banner-{timestamp}`) en las
  actions `saveOwnParticipant` y `saveParticipant`.
- Bug del secret truncado (`SUPABASE_SERVICE_ROLE_KE` en el dashboard de
  Cloudflare): no se re-pegó el valor a mano. Se le indicó al usuario
  correr `bun run setup:cf-secrets` (lee `.env` real y usa
  `wrangler secret put` por stdin, sin riesgo de truncamiento de UI). No
  confirmado aun que lo haya corrido.

## Pendiente / siguiente sesion
- Confirmar que el usuario puso `apps/web/public/images/hero-banner.jpg`
  (la imagen de la arena en llamas) y que `bun run dev` / build no rompe
  por el nuevo `HeroBanner`.
- Confirmar que corrio `bun run setup:cf-secrets` y que el secret de
  Cloudflare quedo bien (deleteParticipant y el resto de actions con admin
  client dejaron de fallar).
- Revisar en pantallas chicas el nuevo `ChampionSelectGrid` (el rail pasa a
  fila horizontal arriba del panel en mobile via `flex-col md:flex-row`,
  no probado en dispositivo real).
- Instalar dependencias reales (`bun install`) y correr `bun run dev` para
  verificar que compila; no se corrio ningun comando en esta sesion, todo
  fue edicion de archivos via filesystem MCP.
- Reemplazar `participants.yml` con datos reales (~10 amigos) cuando estén
  listos.
- Correr `bun run setup:db` con `SUPABASE_ACCESS_TOKEN` y
  `SUPABASE_PROJECT_REF` reales para provisionar la base.
- Borrar manualmente `apps/web/src/components/Roulette.tsx` (deprecated).
- Borrar manualmente `scripts/check-admin.ts` (script de diagnostico
  puntual usado para depurar el bug de sesion del magic link, ya resuelto;
  el MCP de filesystem no expone delete).
- Definir imagenes reales para `photo`/`banner` de cada participante (hoy
  cae a placeholder de placehold.co).

## Sistema de auth del panel (resuelto 2026-08-18)
`/panel-login` soporta login por password (`signInWithPassword`) y por
magic link. `admin.astro` fue renombrado/reemplazado por
`gestion-roster-x9f2.astro` con guard real via `getPanelSession`
(`apps/web/src/lib/panelSession.ts`): exige usuario autenticado en
Supabase Auth + fila en la tabla `admins` + passphrase verificada
(`PANEL_PASSPHRASE`, cookie `velada_panel_unlocked`).

`scripts/resend-invite.ts` genera magic links para admins ya invitados sin
gastar el rate limit de emails de Supabase. Dos bugs de Supabase Auth
encontrados y resueltos ahi:
- `generate_link` con `type: magiclink` sobre un usuario existente ignora
  el `redirect_to` pasado y devuelve `action_link`/`redirect_to` apuntando
  al Site URL raiz (bug conocido, supabase/auth#1738). El fix: no usar el
  `action_link` de la respuesta, reconstruir la URL de verify a mano con
  `hashed_token` + `redirect_to` propio, porque `/auth/v1/verify` si lee
  `redirect_to` de la query string real de la request del browser.
- `establishMagicLinkSession` (Astro Action en `actions/index.ts`) llama
  `supabase.auth.setSession()` y despues necesita validar la sesion antes
  de devolver éxito. Un `getPanelSession()` que crea su propio cliente
  Supabase falla ahi con "Auth session missing": ese cliente nuevo lee
  cookies del `request.headers` original, que no tiene las cookies recien
  escritas por `setSession()` (esas solo existen en la response de salida,
  no en la request entrante). Fix: `getPanelSession` ahora acepta un
  cliente ya autenticado como tercer parametro opcional
  (`existingClient`), y tanto `login` como `establishMagicLinkSession` le
  pasan el mismo cliente que hizo `signInWithPassword`/`setSession` en vez
  de dejarlo crear uno nuevo.

Redirect URLs necesarias en Supabase Dashboard (Authentication > URL
Configuration): el Site URL solo no alcanza, hace falta agregar
`https://<dominio>/panel-login` explicitamente a la lista (wildcards tipo
`/*` no lo resolvieron en las pruebas de esta sesion, aunque el bug real
era el de arriba, no whitelist).

- Evaluar si hace falta manejar `type=recovery` o expiracion de magic link
  con mejor UX (hoy el script del cliente en `panel-login.astro` muestra
  el error crudo de Supabase).

## Sesion 2026-08-17 (2): pulido ChampionSelectGrid + HeroBanner + auditoria backend
- `ChampionSelectGrid.tsx`: la grid de retratos ahora vive dentro de
  `.champ-grid-scroll` (`max-height: 260px`, `overflow-y: auto`) con
  scrollbar tematizado dorado (mismo estilo que `global.css` pero en
  `#c8aa6e`/`#0a1420`) en vez de crecer sin limite; el padding del
  contenedor bajo de 40px a 16px verticales para que se vea menos alto.
  Buscador y filtros de rol ahora filtran de verdad: `roleFilter` (estado
  nuevo) + `ROLE_FILTERS` mapea los 5 iconos a `Participant.mainRole`
  exacto (Top/Jungle/Mid/ADC/Support, antes eran iconos decorativos con
  roles inventados tipo "Fighter"/"Tank" que no correspondian al schema).
  Retratos sin `photo` (`.no-photo`) llevan fondo radial negro
  transparente-al-centro -> mas opaco en los bordes en vez de
  `background-color` solido. Contadores decorativos hardcodeados 81 -> 21
  (banner del jugador) y 81 -> 67 (timer grande); siguen siendo estaticos,
  no hay temporizador real detras (si se quiere un conteo real habria que
  conectarlo a `eventState` o a un campo nuevo, no se hizo esta sesion).
- `HeroBanner.astro`: el bloque de texto ya no reclama el centro completo
  del viewport (`justify-center` -> `justify-end`, tipografia del titulo
  reducida de `text-8xl` a `text-6xl` en desktop, gradiente del scrim mas
  transparente en el medio) para dejar ver mas cara/fondo de la imagen.
  El titulo perdio el `drop-shadow-2xl` simple: ahora tiene
  `-webkit-text-stroke` sutil + un pseudo-elemento `::after` con un barrido
  diagonal (`mix-blend-mode: overlay`, gradiente dorado/cyan) en loop de 6s
  (`hero-title-sheen`), mas parecido a un efecto hextech que a una sombra
  plana. `Countdown.tsx` se redujo de tamano (`text-6xl` -> `text-4xl` en
  desktop) para acompanar el titulo mas chico.
- Auditoria del flujo de Supabase (inscripcion/votaciones/panel): todo el
  codigo ya estaba completo de sesiones anteriores (`actions/index.ts`,
  `scripts/setup-supabase.ts`, RLS, storage bucket, `inscripcion.astro`,
  `PredictionCard.tsx` con upsert anonimo a `predictions`). El `.env` raiz
  YA tiene `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` reales y
  `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
  parecen generados (probablemente `setup:db` ya corrio en algun momento).
  No se pudo confirmar en esta sesion si el schema remoto sigue al dia ni
  si el secret de Cloudflare sigue truncado, porque el sandbox de esta
  sesion no tiene red hacia supabase.co ni ejecuta `bun`/`gh`/`wrangler`
  sobre el proyecto real (solo filesystem MCP, sin bash sobre esta ruta).
  Pendiente que el usuario corra el:
  - `bun install` (si no lo hizo desde la ultima sesion)
  - `bun run setup:db` (reafirma DDL/RLS/realtime, es idempotente, no pisa
    datos por `ON CONFLICT DO NOTHING`/`IF NOT EXISTS`)
  - `bun run setup:cf-secrets` (confirma que `SUPABASE_SERVICE_ROLE_KEY` no
    sigue truncado en el Worker)
  - `bun run dev` para verificar visualmente los cambios de esta sesion

## Sesion 2026-08-17 (3): fixes de feedback visual (subtitulo, encogimiento, mobile, efecto de texto)
- `index.astro`: quitado el subtitulo "N combatientes confirmados..." de la
  seccion `#roster` (arriba del `ChampionSelectGrid`) por pedido directo;
  el titulo "LOS PELEADORES" se queda solo.
- `ChampionSelectGrid.tsx`: la causa del "se encoje al filtrar" era que
  `.champ-grid-scroll` solo tenia `max-height`, sin `min-height` -> con
  pocos resultados el grid colapsaba a su contenido. Se agrego
  `min-height: 260px` (igual al max) + `align-content: start` +
  `auto-rows-[64px]` en el grid para que la altura de fila no dependa del
  numero de filas.
  El solape/rotura en mobile (visible en las capturas: el player-banner
  quedaba encima de la grilla, el buscador se salia del viewport) era
  porque `.player-banner` era `position: absolute; width: 300px` fijo y
  `.cancel-btn`/`.ver-ficha-btn` usaban `position: absolute` con
  `margin-left/right: 170px` fijos respecto al centro — funcionaba solo en
  desktop ancho. Reescrito todo a flujo normal responsivo:
  - `.player-banner` ahora ocupa su propia fila arriba (`width: 100%`,
    `position: relative`), ya no flota sobre la grilla.
  - `.action-bar` ahora es `display: grid; grid-template-columns: 1fr auto 1fr`
    con `.action-bar-side` (flex `justify-end`/`justify-start`) para los
    botones laterales — se acomodan solos a cualquier ancho en vez de
    offsets en px.
  - `.controls-bar` (filtros + orden + buscador) pasa a `flex-wrap` con
    orden invertido en mobile (buscador arriba, iconos de rol abajo) y el
    input de busqueda es `w-full` en mobile en vez de 150px fijo.
  - Grid de retratos: `grid-cols-4` (mobile) / `grid-cols-5` (sm) /
    `grid-cols-7` (md+), antes saltaba directo de 4 a 7 columnas.
  No probado en dispositivo real (segue sin acceso a bash sobre el
  proyecto), pero el layout ya no depende de ningun ancho de viewport fijo.
- `HeroBanner.astro`: el efecto de texto del titulo (barrido animado con
  `mix-blend-mode: overlay` sobre todo el `<h1>`, incluyendo el span con
  gradiente propio del highlight) era la causa del look "brusco" e
  ilegible en capturas (se ve claro en "EL PHONK FINAL": el barrido cyan
  pisaba el gradiente dorado del highlight). Se quito el pseudo-elemento
  `::after` animado por completo. `.hero-title` ahora es solo color solido
  + `text-shadow` en capas (sombra dura pegada al texto + sombra difusa +
  halo cyan tenue) para legibilidad sobre cualquier fondo, sin animacion ni
  blend modes. `.hero-title-highlight` no cambio (su gradiente dorado
  propio se queda limpio, ya no se pisa con el overlay). Las posiciones del
  bloque de texto (justify-end, tamanos reducidos) se dejaron igual porque
  el usuario confirmo que esas ya estaban bien.

## Sesion 2026-08-18: fix inscripcion rota + UI del ChampionSelectGrid + check de Riot en vivo + iconos de rango
- **Bug critico (inscripcion imposible)**: `AuthGate.tsx` llamaba a
  `actions.checkEmailExists`, `loginParticipant` y `registerParticipant`
  con objetos JS planos (`{ email }`), pero esas tres actions estan
  definidas con `accept: "form"` en `actions/index.ts` — Astro Actions
  rechaza JSON en ese caso con el error exacto que aparecia en pantalla
  ("This action only accepts FormData"). Fix: las tres llamadas ahora arman
  un `FormData` antes de invocar la action, igual que ya hacia
  `saveOwnParticipant`. `login` (form nativo) y `establishMagicLinkSession`
  (sin `accept: "form"`, JSON esta bien) no tenian este bug.
- `ChampionSelectGrid.tsx` (grid de seleccion del landing, `#roster`):
  - "Ordenar por Nombre" era texto decorativo sin `onClick`. Ahora es un
    boton real con estado `sortDirection` ("asc"/"desc") que ordena
    `filteredParticipants` por `nickname` y alterna el icono de chevron.
  - `.search-input` no tenia `box-sizing: border-box`, asi que el padding
    de Tailwind (`pl-8`) se sumaba al padding del CSS plano y desalineaba
    el icono de lupa / el texto. Reescrito con box-sizing explicito, altura
    fija, y colores mas legibles.
  - Boton "Ver ficha completa" se cortaba a "FICHA COMPL": tenia
    `white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`
    compitiendo por espacio con el boton FIJAR (`width: 220px` fijo) en un
    grid de 3 columnas. Se quito el ellipsis/overflow, se bajo el tamano de
    fuente en mobile con un breakpoint propio (`@media (min-width: 480px)`).
  - `.skin-thumb` (48-56px) mostraba el alt text ("skin thumbnail") partido
    cuando la imagen no cargaba a tiempo. Se agrando a 64-72px, se le puso
    `background-color` de fondo, y `font-size: 0; color: transparent` en el
    `img` para que un alt largo nunca se vea como texto suelto en un
    cuadrito chico.
- **Check de Riot ID en vivo en /inscripcion**: nueva action
  `checkRiotProfile` en `actions/index.ts` (requiere `getParticipantSession`,
  no panel auth — pensada para que la llame cualquier fighter autenticado
  sin abrir un endpoint anonimo que agote el rate limit de la Riot API).
  Nunca tira error para los casos esperados ("todavia escribiendo" /
  "typo"): devuelve `{ status: "found" | "not_found" | "invalid" }`, solo
  lanza `ActionError` si la Riot API o la config del servidor fallan de
  verdad. `ParticipantProfileForm.tsx` la llama con debounce de 600ms
  (`useEffect` + `setTimeout`, con un `requestId` en `useRef` para
  descartar respuestas fuera de orden si el usuario sigue escribiendo) y
  muestra un check verde / spinner amarillo / X roja junto al campo
  `lolUsername`, mas un hint de texto debajo.
- **Iconos de rango**: nuevo `packages/core/rankIcon.ts` (`rankTierOf`,
  `rankIconPath`) que mapea el string libre de `lolRank` (ej.
  "Diamond III", generado por `fetchRiotRank`, nunca escrito a mano por el
  usuario) al path `/images/ranks/{tier}.png`, con fallback a
  `unranked.png`. Los PNGs NO estan incluidos — hay que descargarlos de
  https://leagueoflegends.fandom.com/wiki/Rank_(League_of_Legends) y
  ponerlos en `apps/web/public/images/ranks/` (11 archivos, nombres
  exactos documentados en el README de esa carpeta y en `IMAGENES.md`).
  Todos los `<img>` que lo usan tienen fallback `onerror`/`onError` que
  oculta el icono si el archivo no existe, asi que no rompe nada mientras
  tanto. Aplicado en: `FighterCard.astro` (cards del roster),
  `peleadores/[id].astro` (ficha completa), `RosterExplorer.tsx` (lista de
  `/peleadores`), `ParticipantManager.tsx` (vista de solo lectura del
  roster en el panel admin — el input de edicion de `lolRank` ahi sigue
  siendo texto libre, es la fuente del dato). `ChampionSelectGrid.tsx`
  (grid del landing y su splash de personaje seleccionado) se dejo sin
  icono a proposito, por pedido explicito.
- Pendiente: el usuario tiene que poner los 11 PNGs de rango y correr
  `bun install` + `bun run dev` para verificar visualmente todos los fixes
  de esta sesion (nuevamente sin acceso a bash sobre el proyecto real, todo
  fue edicion via filesystem MCP).

## Sesion 2026-08-18 (2): 3 bugs reales de auth/robustez encontrados y arreglados
- **`getPanelSession`/`getParticipantSession` invertidos (el bug critico
  real detras de "el login no sirve" y de que `/inscripcion` nunca
  mostraba el form de perfil)**: ambas funciones tenian
  `if (!existingClient) return null` como primera linea. `existingClient`
  es un parametro OPCIONAL que solo `login`/`establishMagicLinkSession`
  (panel) y ningun caller de `getParticipantSession` pasan; every otro
  caller — el guard de `gestion-roster-x9f2.astro`, `inscripcion.astro`,
  `verifyPassphrase`, `saveOwnParticipant`, `saveParticipant`,
  `deleteParticipant`, `lookupRank`, `checkRiotProfile` — lo llama SIN ese
  tercer argumento. Resultado: esas dos funciones devolvian `null` siempre
  que no se les pasaba un cliente ya autenticado, es decir, en todos los
  casos salvo el instante exacto del login. Cualquiera que iniciaba sesion
  (password o magic link) quedaba autenticado en Supabase pero cada
  request subsiguiente lo trataba como deslogueado: el panel admin
  redirigia siempre a `/panel-login?error=forbidden` y `/inscripcion`
  jamas mostraba `ParticipantProfileForm` (siempre repetia `AuthGate`).
  Fix: invertido a `let supabase = existingClient; if (!supabase) { crear
  uno nuevo }` en `apps/web/src/lib/panelSession.ts` y
  `apps/web/src/lib/participantSession.ts`.
- **Gap irregular en los iconos de filtro de rol de `ChampionSelectGrid`
  (NO estaba arreglado pese a que la sesion 2026-08-18 anterior afirmo
  haberlo reemplazado por SVG inline)**: el codigo seguia usando
  `<i className="fa-solid fa-bow-arrow">` y `fa-staff-snake`, ambos iconos
  **Pro** de Font Awesome (confirmado contra fontawesome.com — staff-snake
  devuelve "Whoopsie! That action requires a Pro Plan"), inexistentes en
  el set free 6.4.0 cargado por CDN. Se renderizaban vacios con ancho
  inconsistente entre navegadores. Ahora si esta hecho: los 5 icons de rol
  son SVG inline propios (`ROLE_FILTERS` con `path` en vez de `icon`
  string de Font Awesome), boton con `display:flex` fijo — sin dependencia
  de CDN externo para estos 5 (el resto de iconos de FA del componente —
  chevron, search, xmark — no se tocaron, esos si existen en el set free).
- **`.env` local vs Worker desplegado, dos superficies distintas** (ya
  identificado en la sesion anterior, reconfirmado): `apps/web/.env` +
  `import.meta.env` solo aplica a `astro dev` local (Vite normal) y al
  build de Astro. El Worker desplegado en Cloudflare NUNCA lee
  `apps/web/.env` — necesita `wrangler secret put` (via
  `bun run setup:cf-secrets`, que ya cubre `SUPABASE_SERVICE_ROLE_KEY` y
  `RIOT_API_KEY` correctamente) o `[vars]` en `wrangler.toml` para vars no
  sensibles. `PANEL_PASSPHRASE` NO necesita ir ahi: solo se lee una vez en
  `scripts/setup-supabase.ts` (proceso Node local) para hashearla en
  `panel_secret.passphrase_hash`; la verificacion real en runtime es el
  RPC `verify_panel_passphrase`, no una env var leida por el Worker.
  Recordatorio importante para diagnostico futuro: Vite/Astro solo lee
  `.env` al ARRANCAR el proceso — si `apps/web/.env` se edita con el dev
  server ya corriendo, hay que reiniciar `bun run dev` (Ctrl+C y volver a
  correr), no alcanza con guardar el archivo. Si un error de "Supabase no
  configurado" persiste despues de confirmar que el `.env` esta bien,
  sospechar primero de un proceso de dev viejo antes de seguir tocando
  codigo.
- Pendiente de esta sesion: correr `bun install` + `bun run dev` (con
  reinicio real del proceso) para confirmar en caliente que
  `/inscripcion` ahora muestra el form de perfil tras registrarse/loguear,
  que `/gestion-roster-x9f2` ya no rebota siempre a `/panel-login`, y que
  el grid de iconos de rol ya no muestra el gap. Seguia sin poder correr
  `bun`/`wrangler`/`gh` sobre el proyecto real en esta sesion (solo
  filesystem MCP + context7 + web search, sin bash sobre esta ruta).

## Sesion 2026-08-18 (3): iconos de rol reemplazados por assets reales del wiki de LoL
- Los SVG dibujados a mano de la sesion anterior (2) tampoco se leian bien
  (confirmado por el usuario con captura: "no se parecen en nada"). En vez
  de seguir iterando geometria a mano, se cambio de enfoque: usar los
  iconos de posicion REALES de
  https://wiki.leagueoflegends.com/en-us/Category:Role_icons como assets
  estaticos, a pedido del usuario.
- `ChampionSelectGrid.tsx`: `ROLE_FILTERS` ya no tiene paths SVG, apunta a
  `/images/roles/{top,jungle,middle,bottom,support}.png`. El grid renderiza
  `<img>` con `onError` que oculta el icono si el archivo no esta puesto
  (mismo patron que `rankIcon.ts` para los PNGs de rango). Estilo con
  `filter` CSS para tintear el PNG gris/blanco original: dorado en reposo,
  mas claro en hover, cyan + `scale(1.1)` cuando el filtro de rol esta
  activo (clase `.role-filter-icon-active`).
- Carpeta creada: `apps/web/public/images/roles/` con un `README.md` que
  documenta que archivo bajar de que pagina del wiki (5 PNGs, nombres
  exactos en minuscula: top/jungle/middle/bottom/support). **El usuario
  baja los PNGs el mismo** (no se pudo/debio scrapear binarios de un sitio
  de terceros como parte del codigo) y los coloca en esa carpeta.
- Pendiente: usuario descarga los 5 PNGs y confirma visualmente que el
  `filter` CSS (invert/sepia/hue-rotate aproximados a ojo, sin ver el PNG
  real) da un tinte razonable; si no, ajustar esos valores en el `<style>`
  de `ChampionSelectGrid.tsx` es mas facil que tocar los PNGs.

## Sesion 2026-08-18 (5): `lib/env.ts` en verdad NUNCA se escribio en el filesystem real (error de herramienta, no de codigo)
- La entrada de sesion (4) de abajo afirmaba haber creado
  `apps/web/src/lib/env.ts` y lo daba por resuelto. Era falso: el CI
  siguio fallando con `Could not resolve "../lib/env" from
  "src/actions/index.ts"` porque esa sesion uso la tool `create_file`
  (que escribe en un sandbox de ejecucion de bash descartable, no en el
  proyecto real del usuario) en vez de la tool de filesystem MCP
  (`write_file`, que si apunta a `~/Proyectos/Personal/velada_lol` real).
  El resultado "exitoso" de esa escritura era del archivo sandbox, nunca
  del repo del usuario — nunca se commiteo porque nunca existio para git.
  **Leccion para sesiones futuras**: en este proyecto NO se tiene bash
  real sobre la ruta del repo (confirmado repetidas veces en sesiones
  anteriores); `create_file`/`str_replace`/`bash_tool` operan sobre un
  sandbox aislado que no es el filesystem del usuario. Cualquier archivo
  nuevo o edicion tiene que hacerse con las tools de filesystem MCP
  (`write_file`, `edit_file`) apuntando a la ruta real bajo
  `/home/cetrei/Proyectos/...`, y despues confirmarse con un `read_text_file`
  posterior en esa misma ruta antes de darlo por hecho — no alcanza con que
  la tool call devuelva "success", hay que releer el archivo real.
- Fix real esta vez: `apps/web/src/lib/env.ts` escrito con
  `filesystem:write_file` (mismo contenido que se penso en la sesion (4):
  `getServerEnv(context, key)` con fallback `locals.runtime.env` ->
  `import.meta.env`) y confirmado releyendolo desde la ruta real.
- Pendiente: usuario tiene que hacer commit + push de `lib/env.ts` (este
  seguia sin existir en el working tree hasta ahora, asi que ni siquiera
  estaba como cambio sin commitear) y confirmar que el build de CI/deploy.yml
  pasa. Seguimos sin bash real sobre el proyecto en esta sesion tampoco.

## Sesion 2026-08-18 (4): `lib/env.ts` faltante (import roto) + ultimo call-site sin `locals`
- **Bug critico de build**: la sesion anterior (documentada en el chat que
  trajo el usuario, no en este AGENT.md) dejo `supabaseServer.ts` y
  `actions/index.ts` importando `getServerEnv` desde `./lib/env`, pero ese
  archivo nunca se creo — no estaba en el filesystem real del proyecto.
  Esto rompe el build/typecheck entero (import a modulo inexistente), no
  solo el flujo de borrar/editar/guardar que se estaba diagnosticando.
  Creado `apps/web/src/lib/env.ts` con `getServerEnv(context, key)`: lee
  primero `context.locals.runtime.env[key]` (secrets reales de Cloudflare
  Workers en runtime, confirmado el tipo exacto contra
  `node_modules/@astrojs/cloudflare/dist/entrypoints/server.d.ts` ->
  `Runtime['runtime']['env']`), y cae a `import.meta.env[key]` (funciona en
  `astro dev` local via `.env`, y para las `PUBLIC_*` inlineadas en build).
- **Ultimo call-site sin `locals`**: `inscripcion.astro` llamaba
  `findParticipantByOwner(session.userId)` sin el segundo argumento
  `Astro.locals` — `loadParticipants.ts` ya soportaba recibirlo
  (`findParticipantByOwner(ownerUserId, locals?)`), pero este caller
  especifico se quedo afuera cuando se propago `locals` al resto de las
  actions/paginas. Sin esto, el admin client de esa llamada puntual
  volvia a depender solo de `import.meta.env`, es decir el mismo bug que
  se estaba arreglando pero limitado a la deteccion de "ya tenes perfil"
  en `/inscripcion` (mostraria siempre el form de "crear" en vez de
  "editar" en produccion). Fix: `findParticipantByOwner(session.userId,
  Astro.locals)`.
- Revisados uno por uno todos los demas callers de
  `createSupabaseAdminClient`/`createSupabaseServerClient`/`getPanelSession`/
  `getParticipantSession` en `actions/index.ts` y en cada `.astro` de
  `pages/` (`gestion-roster-x9f2`, `panel-login`, `peleadores`, `sorteo`,
  `combates`, `index`, `pronosticos`, `admin` que es el redirect vacio) —
  todos ya pasaban `locals`/`context.locals` correctamente, no habia otro
  gap. `supabase.ts`/`matches.ts`/`eventState.ts` no necesitan tocarse: solo
  leen `PUBLIC_*` via `import.meta.env`, que si esta inlineado en build.
- El tema de scraping de Mobalytics (leer rank Solo/Flex de
  mobalytics.gg/lol/profile/... en vez de la API de Riot) que aparecia en
  el chat pegado por el usuario **no se implemento**: en la transcripcion
  original quedo como advertencia de riesgo pendiente antes de escribir
  cualquier codigo, no se llego a esa parte. Sigue pendiente si se quiere
  retomar, evaluando el riesgo (ToS de Mobalytics, fragilidad del HTML/
  clases hasheadas tipo `m-dbvt3o` que cambian con cada build de su
  frontend) antes de implementar.
- Pendiente (igual que sesiones anteriores): sin bash sobre esta ruta en
  esta sesion tampoco (solo filesystem MCP), no se pudo correr
  `bun install` / `bun run dev` / typecheck real para confirmar en caliente
  que el import de `env.ts` resuelve limpio. Recomendado que el usuario
  corra `bun run dev` (reinicio real del proceso) y pruebe
  borrar/editar/guardar un participante desde `/gestion-roster-x9f2` en
  produccion (o `wrangler dev` local) para confirmar que el fix de
  `SUPABASE_SERVICE_ROLE_KEY`/`RIOT_API_KEY` en runtime de Cloudflare
  ahora si funciona.

## Convenciones del proyecto
Ver `shared/code_standards.md` del sistema de roles. camelCase, funciones
chicas, guard clauses, sin comentarios obvios.
