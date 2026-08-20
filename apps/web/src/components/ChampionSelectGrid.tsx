import { useState } from "react";
import type { Participant } from "@velada/core";
import { CHAMPION_SELECT } from "@velada/core";

interface ChampionSelectGridProps {
  participants: Participant[];
  rivalByParticipantId?: Record<string, Participant | undefined>;
}

type RoleFilter = Participant["mainRole"];
type SortDirection = "asc" | "desc";

/**
 * Iconos de rol reales del wiki de LoL, no dibujados a mano. Los intentos
 * anteriores (Font Awesome fa-bow-arrow/fa-staff-snake, despues paths SVG
 * propios) no se leian bien o directamente no existian en el set free.
 * El usuario descarga los 5 PNG de
 * https://wiki.leagueoflegends.com/en-us/Category:Role_icons (paginas
 * File:Top_icon.png, File:Jungle_icon.png, File:Middle_icon.png,
 * File:Bottom_icon.png, File:Support_icon.png -> boton "Original file",
 * 136x136) y los coloca en apps/web/public/images/roles/ con estos
 * nombres exactos. Si un archivo todavia no esta, onError en el <img>
 * oculta el icono en vez de mostrar el roto del navegador (mismo patron
 * que ya usa rankIcon.ts para los PNGs de rango).
 */
const ROLE_FILTERS: Array<{ role: RoleFilter; label: string; icon: string }> = [
  { role: "Top", label: "Top", icon: "/images/roles/top.png" },
  { role: "Jungle", label: "Jungle", icon: "/images/roles/jungle.png" },
  { role: "Mid", label: "Mid", icon: "/images/roles/middle.png" },
  { role: "ADC", label: "ADC", icon: "/images/roles/bottom.png" },
  { role: "Support", label: "Support", icon: "/images/roles/support.png" }
];

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/300x400/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname)}`;
}

export default function ChampionSelectGrid({
  participants,
  rivalByParticipantId = {}
}: ChampionSelectGridProps) {
  // Estados para controlar la selección y el modo "Lock In" (Fijado)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLockedIn, setIsLockedIn] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Resolviendo el participante seleccionado y su rival usando tu lógica
  const selected = participants.find((p) => p.id === selectedId) ?? null;
  const rival = selected ? rivalByParticipantId[selected.id] : undefined;

  // Filtrado por nombre/apodo y por rol principal, luego orden alfabetico segun sortDirection
  const filteredParticipants = participants
    .filter((p) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        q.length === 0 || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q);
      const matchesRole = !roleFilter || p.mainRole === roleFilter;
      return matchesQuery && matchesRole;
    })
    .sort((a, b) => {
      const cmp = a.nickname.localeCompare(b.nickname);
      return sortDirection === "asc" ? cmp : -cmp;
    });

  // Elige un participante al azar dentro de los resultados filtrados actuales
  // (respeta busqueda + filtro de rol activos), igual que el boton de
  // random del cliente real de LoL.
  function pickRandom() {
    if (isLockedIn || filteredParticipants.length === 0) return;
    const pool = filteredParticipants.filter((p) => p.id !== selectedId);
    const candidates = pool.length > 0 ? pool : filteredParticipants;
    const random = candidates[Math.floor(Math.random() * candidates.length)];
    setSelectedId(random.id);
  }

  return (
    <div className="relative w-full bg-[#010a13] text-[#f0e6d2] flex flex-col items-center overflow-hidden lol-main-bg py-2 sm:py-3 px-3 sm:px-6">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* FONDO SPLASH GLOBAL: cubre TODO el componente (inset-0, absolute) sin
          afectar el flujo del layout -- a diferencia de la version anterior,
          donde el fondo vivia adentro del contenedor central y quedaba
          recortado por su min-height propio. Vive como primer hijo del root
          y en z-index 0 (todo lo demas de aca abajo va con z-10 relative
          para flotar encima), asi que banner/titulo/grid/action-bar quedan
          siempre por encima sin necesidad de tocar su propio z-index
          individualmente uno por uno. */}
      <div className={`splash-background transition-opacity duration-500 ${isLockedIn ? 'opacity-100' : 'opacity-0'}`}>
          {selected && (
              <img
                  src={selected.banner ?? selected.photo ?? fallbackPhoto(selected)}
                  alt="Background"
                  decoding="async"
                  onError={(e) => {
                      const fallback = fallbackPhoto(selected);
                      if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                  }}
              />
          )}
          <div className="splash-background-fade" />
      </div>

      {/* BANNER DEL JUGADOR: z-10 para estar por encima del fondo global */}
      <div className={`player-banner relative z-10 w-full max-w-2xl ${isLockedIn ? 'locked-state-banner' : 'picking-state'}`}>
        <div className="banner-bg"></div>

        <div className="hidden sm:flex flex-col gap-1 ml-4 z-10">
            <div className="w-5 h-5 border bg-[#1e2328] dynamic-border-color transition-colors duration-300"></div>
            <div className="w-5 h-5 border bg-[#1e2328] dynamic-border-color transition-colors duration-300"></div>
        </div>

        <div className="w-11 h-11 sm:w-[52px] sm:h-[52px] rounded-full border-2 ml-3 flex items-center justify-center bg-[#010a13] overflow-hidden avatar-border z-10 relative transition-all duration-300 flex-shrink-0">
            {selected && (
                <img
                    src={selected.photo ?? fallbackPhoto(selected)}
                    alt="Avatar"
                    decoding="async"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                        const fallback = fallbackPhoto(selected);
                        if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                    }}
                />
            )}
        </div>

        <div className="ml-3 flex flex-col justify-center z-10 flex-1 min-w-0">
             <span className="text-[#f0e6d2] text-xs sm:text-sm font-bold tracking-wide drop-shadow-md truncate block">
                {isLockedIn && selected ? selected.name.toUpperCase() : "Eligiendo..."}
             </span>
             <span className="text-[0.6rem] sm:text-[0.65rem] dynamic-text-color font-semibold tracking-wider uppercase transition-colors duration-300">
                Invocador 1
             </span>
        </div>

        <div className="mr-4 text-lg sm:text-2xl font-bold dynamic-text-color z-10 flex items-center transition-colors duration-300 beaufort-font flex-shrink-0">
            <i className="fa-solid fa-chevron-left text-xs mr-2 opacity-50 relative top-1"></i> 21
        </div>
      </div>

      {/* TÍTULO PRINCIPAL: siempre ocupa su espacio en el layout (a diferencia
          de la version con "isLockedIn &&" que lo montaba/desmontaba del
          DOM), solo cambia de opacidad -- asi nada de lo que viene debajo
          salta de posicion al fijar/cancelar. */}
      <div className={`relative z-10 transition-opacity duration-300 mt-2 mb-1 flex justify-center ${isLockedIn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <h2 className="text-center px-2 text-xl sm:text-2xl text-[#f0e6d2] font-bold tracking-[2px] beaufort-font uppercase">
          CHOOSE YOUR LOADOUT!
        </h2>
      </div>

      <div className="timer-text relative z-10">67</div>

      {/* CONTENEDOR CENTRAL: Cambia entre la Grid (Cuadricula) y el Splash Art.
          Ambas vistas viven superpuestas (position: absolute, inset: 0)
          dentro de este contenedor -- el contenedor en si NO cambia de
          alto entre estados, solo el hijo activo. El alto real que
          necesita el splash vive en .splash-view-active (min-height
          propio, position: absolute dentro de este contenedor), no en el
          contenedor compartido, para no empujar el titulo/action-bar que
          vienen despues en el layout. */}
      <div
        className="relative z-10 w-full max-w-4xl flex justify-center items-start min-h-[220px] sm:min-h-[260px]"
        style={{ perspective: '1000px' }}
      >

        {/* VISTA 1: CUADRÍCULA (GRID) DE PARTICIPANTES */}
        <div className={`champ-grid-container w-full transition-opacity duration-400 ${isLockedIn ? 'opacity-0 pointer-events-none absolute' : 'opacity-100 relative'}`}>

            <div className="controls-bar w-full max-w-2xl flex flex-wrap justify-between items-center gap-3 mb-2 px-2 sm:px-[20px] pb-[10px] border-b border-[#c8aa6e]/30">
                <div className="role-filters flex flex-nowrap items-center gap-2.5 sm:gap-[15px] text-[#a09b8c] text-base sm:text-base order-2 sm:order-1 flex-shrink-0">
                    {ROLE_FILTERS.map(({ role, label, icon }) => (
                        <button
                            key={role}
                            type="button"
                            className={`role-filter-icon flex-shrink-0 bg-transparent border-0 p-0 cursor-pointer transition-all ${roleFilter === role ? 'role-filter-icon-active' : ''}`}
                            title={label}
                            aria-label={label}
                            aria-pressed={roleFilter === role}
                            onClick={() => setRoleFilter((current) => (current === role ? null : role))}
                        >
                            <img
                                src={icon}
                                alt={label}
                                width={18}
                                height={18}
                                onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                }}
                            />
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-3 sm:gap-4 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
                    <button
                        type="button"
                        onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                        className="hidden sm:flex items-center text-xs text-[#a09b8c] cursor-pointer hover:text-[#c8aa6e] whitespace-nowrap transition-colors bg-transparent border-0 p-0"
                        aria-label={`Ordenar por nombre, ${sortDirection === "asc" ? "ascendente" : "descendente"}`}
                    >
                        Ordenar por Nombre
                        <i className={`fa-solid fa-chevron-${sortDirection === "asc" ? "down" : "up"} ml-1 text-[0.65rem]`}></i>
                    </button>
                    <div className="search-input-wrap relative flex-1 sm:flex-none">
                        <i className="fa-solid fa-search absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[#5c5c5c] text-xs pointer-events-none z-10"></i>
                        <input
                            type="text"
                            className="search-input pl-8 w-full sm:w-[150px]"
                            placeholder="Buscar"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="champ-grid-scroll grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2 auto-rows-[64px]">
                {/* Boton de seleccion al azar dentro de los resultados filtrados actuales */}
                <button
                    type="button"
                    onClick={pickRandom}
                    disabled={filteredParticipants.length === 0}
                    className="champ-portrait champ-portrait-random"
                    aria-label="Elegir al azar"
                    title="Elegir al azar"
                >
                    <i className="fa-solid fa-question random-icon" aria-hidden="true"></i>
                    <div className="champ-name">Random</div>
                </button>
                {/* Mapeo de TUS participantes reales */}
                {filteredParticipants.map(p => {
                    const isSelected = selectedId === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => !isLockedIn && setSelectedId(current => current === p.id ? null : p.id)}
                            className={`champ-portrait group ${isSelected ? 'selected' : ''} ${!p.photo ? 'no-photo' : ''}`}
                            aria-pressed={isSelected}
                        >
                            <img
                                src={p.photo ?? fallbackPhoto(p)}
                                alt={p.name}
                                className="placeholder-img"
                                loading="lazy"
                                onError={(e) => {
                                    const fallback = fallbackPhoto(p);
                                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                                }}
                            />
                            <div className={`champ-name ${isSelected ? 'text-[#f0e6d2]' : ''}`}>
                                {p.nickname}
                            </div>
                        </button>
                    );
                })}
                {filteredParticipants.length === 0 && (
                    <div className="col-span-4 sm:col-span-5 md:col-span-7 flex items-center justify-center text-center text-[#5c5c5c] text-xs uppercase tracking-wider">
                        Sin resultados
                    </div>
                )}
            </div>
        </div>

        {/* VISTA 2: LOADOUT / INFO. El fondo con la foto/banner del seleccionado
            ya NO vive aca adentro -- se movio al fondo global de arriba del
            todo (.splash-background, primer hijo del root) para cubrir el
            componente completo en vez de quedar acotado a este contenedor
            central. Aca solo quedan los arcos hextech y el texto, que si
            siguen siendo propios de la vista de loadout. */}
        <div className={`absolute inset-x-0 top-0 w-full transition-all duration-500 ${isLockedIn ? 'splash-view-active opacity-100 z-10' : 'h-full opacity-0 pointer-events-none -z-10'}`}>
            <div className="hextech-arcs">
                <div className="arc-left"></div>
                <div className="arc-right"></div>
                <div className="tick-marks"></div>
            </div>

            <div className="loadout-content w-full h-full">
                <div className="skin-selector">
                    {/* Renderizamos la info del RIVAL si existe */}
                    {rival && (
                        <div className="mb-4 text-center bg-black/40 px-6 py-2 rounded border border-lol-border/40 backdrop-blur-sm">
                            <span className="text-[#c8aa6e] font-bold text-lg beaufort-font mr-2">{CHAMPION_SELECT.vsLabel}</span>
                            <span className="text-white text-md font-bold uppercase">{rival.name}</span>
                        </div>
                    )}

                    <div className="random-skin-tag">
                        {selected?.mainRole || "Participante"}
                        {selected?.lolRank ? ` - ${selected.lolRank}` : ""}
                    </div>

                    <div className="skin-name">Perfil Principal de {selected?.nickname || selected?.name}</div>
                </div>
            </div>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN INFERIORES */}
      <div className="action-bar relative z-10">

        {/* Botón de Cancelar / Atrás */}
        <div className="action-bar-side justify-end">
            <button
                type="button"
                onClick={() => setIsLockedIn(false)}
                className={`cancel-btn ${isLockedIn ? 'cancel-active' : 'pointer-events-none'}`}
                aria-label="Volver"
            >
                <i className="fa-solid fa-xmark text-xl"></i>
            </button>
        </div>

        {/* Botón Central FIJAR (Lock In) */}
        <div className="lock-in-container">
            <button
                type="button"
                onClick={() => {
                    if (selectedId && !isLockedIn) setIsLockedIn(true);
                }}
                className={`lock-in-btn ${selectedId ? 'active' : ''} ${isLockedIn ? 'locked-state' : ''}`}
            >
                {isLockedIn ? 'FIJADO' : 'FIJAR'}
            </button>
        </div>

        {/* Enlace hacia el perfil usando tu prop viewProfileCta */}
        <div className="action-bar-side justify-start">
            <a
                href={selected ? `/peleadores/${selected.id}` : '#'}
                className={`ver-ficha-btn flex items-center justify-center transition-all duration-400 ${isLockedIn ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
            >
                {CHAMPION_SELECT.viewProfileCta}
            </a>
        </div>
      </div>

      {/* ESTILOS CSS INSERTADOS */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Beaufort+for+LOL:ital,wght@0,400;0,500;0,700;1,400&family=Spiegel:ital,wght@0,400;0,600;0,700;1,400&display=swap');

        .lol-main-bg {
            font-family: 'Spiegel', sans-serif;
            background: radial-gradient(circle at center, #0a1f2e 0%, #010a13 70%);
        }

        .beaufort-font { font-family: 'Beaufort for LOL', serif; }

        .champ-grid-container {
            background-image: url('data:image/svg+xml;utf8,<svg width="600" height="600" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg"><circle cx="300" cy="300" r="280" fill="none" stroke="rgba(200, 170, 110, 0.1)" stroke-width="2"/><circle cx="300" cy="300" r="290" fill="none" stroke="rgba(200, 170, 110, 0.05)" stroke-width="1" stroke-dasharray="4 4"/></svg>');
            background-position: center;
            background-repeat: no-repeat;
            padding: 8px 40px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .timer-text {
            color: #f0e6d2;
            font-size: 2rem;
            font-weight: bold;
            text-shadow: 0 0 10px rgba(240, 230, 210, 0.5);
            margin-bottom: 8px;
            letter-spacing: 2px;
            font-family: 'Beaufort for LOL', serif;
        }

        .role-filters {
            padding-top: 6px;
        }

        .role-filter-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 0;
        }

        .role-filter-icon img {
            filter: brightness(0) saturate(100%) invert(66%) sepia(11%) saturate(383%) hue-rotate(191deg) brightness(94%) contrast(87%);
            opacity: 0.85;
            transition: filter 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
        }

        .role-filter-icon:hover img {
            filter: brightness(0) saturate(100%) invert(85%) sepia(21%) saturate(526%) hue-rotate(357deg) brightness(96%) contrast(92%);
            opacity: 1;
        }

        .role-filter-icon-active img {
            filter: brightness(0) saturate(100%) invert(70%) sepia(66%) saturate(2476%) hue-rotate(140deg) brightness(97%) contrast(96%);
            opacity: 1;
            transform: scale(1.1);
        }

        .search-input-wrap {
            display: flex;
            align-items: center;
        }

        .search-input {
            box-sizing: border-box;
            background-color: rgba(0, 0, 0, 0.2);
            border: 1px solid #3c3c41;
            color: #f0e6d2;
            padding: 6px 10px 6px 30px;
            font-family: 'Spiegel', sans-serif;
            font-size: 0.8rem;
            line-height: 1.2;
            height: 30px;
            outline: none;
            transition: border-color 0.2s, background-color 0.2s;
        }
        .search-input::placeholder {
            color: #5c5c5c;
        }
        .search-input:focus {
            border-color: #c8aa6e;
            background-color: rgba(0, 0, 0, 0.4);
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }

        .champ-grid-scroll {
            min-height: 128px;
            max-height: 128px;
            overflow-y: auto;
            overflow-x: hidden;
            /* Sin esto, la rueda del mouse quedaba atrapada dentro de este
               scroll interno chico apenas el cursor pasaba por encima --
               nunca llegaba a propagarse al scroll de la pagina (contenedor
               con snap-mandatory en index.astro), asi que hacia falta
               agarrar la scrollbar a mano para bajar. overscroll-behavior:
               contain hace que, al llegar al tope/fondo de ESTE scroll, el
               resto del gesto de rueda se lo quede el navegador para seguir
               scrolleando el contenedor padre en vez de descartarlo. */
            overscroll-behavior-y: contain;
            padding: 6px 6px 6px 4px;
            align-content: start;
            scrollbar-width: thin;
            scrollbar-color: #c8aa6e #0a1420;
        }

        @media (min-height: 820px) {
            .champ-grid-scroll {
                min-height: 200px;
                max-height: 200px;
            }
        }

        .champ-grid-scroll::-webkit-scrollbar {
            width: 8px;
        }
        .champ-grid-scroll::-webkit-scrollbar-track {
            background: #0a1420;
            border: 1px solid rgba(200, 170, 110, 0.15);
        }
        .champ-grid-scroll::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, #c8aa6e, #785a28);
            border-radius: 4px;
        }
        .champ-grid-scroll::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, #f0e6d2, #c8aa6e);
        }

        .champ-portrait {
            width: 64px;
            height: 64px;
            border: 2px solid transparent;
            cursor: pointer;
            position: relative;
            transition: all 0.2s ease;
            box-sizing: border-box;
            background-color: #0a0e14;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 0;
            margin: 0;
        }

        .champ-portrait.no-photo {
            background-color: #0a0e14;
            background-image: radial-gradient(circle at center, #0a0e14 0%, #04070c 100%);
        }

        .champ-portrait-random {
            background-color: #0a0e14;
            background-image: radial-gradient(circle at center, #0a0e14 0%, #04070c 100%);
        }

        .champ-portrait-random:disabled {
            cursor: not-allowed;
            opacity: 0.4;
        }

        .random-icon {
            color: #f0e6d2;
            font-size: 1.4rem;
            text-shadow: 0 0 8px rgba(240, 230, 210, 0.4);
            transition: text-shadow 0.2s ease;
        }

        .champ-portrait-random:hover:not(:disabled) .random-icon {
            text-shadow: 0 0 12px rgba(240, 230, 210, 0.8);
        }

        .champ-portrait:hover, .champ-portrait.selected {
            border-color: #0b9bd492;
            box-shadow: 0 0 8px rgba(11, 172, 212, 0.56), inset 0 0 10px rgba(11, 212, 212, 0.32);
            transform: scale(1.05);
            z-index: 10;
        }

        .champ-portrait.selected {
            border-width: 2px;
            border-style: solid;
            border-image: linear-gradient(to bottom, #e0f8f8, #0b9ed4a6) 1;
        }

        .champ-name {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            background: rgba(0, 0, 0, 0.7);
            color: #a09b8c;
            font-size: 0.6rem;
            text-align: center;
            padding: 2px 0;
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
            pointer-events: none;
            transition: color 0.2s;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .champ-portrait:hover .champ-name { color: #f0e6d2; }

        .placeholder-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: brightness(0.8) contrast(1.2);
        }

        /* Alto real del bloque de splash (retrato vertical de banner/foto)
           cuando esta activo. Vive en este elemento (position: absolute,
           fuera del flujo) en vez de en el contenedor compartido de mas
           arriba, asi que crecerlo no empuja el titulo/action-bar que
           vienen despues en el layout. La seccion #roster en index.astro
           tiene overflow-y-auto como red de seguridad para viewports
           bajos donde este alto no entrara completo. */
        .splash-view-active {
            min-height: min(640px, 62dvh);
        }
        @media (min-height: 820px) {
            .splash-view-active {
                min-height: 720px;
            }
        }

        /* FONDO SPLASH GLOBAL: cubre el componente entero (inset: 0 sobre el
           root, position absolute), en vez de quedar acotado al contenedor
           central como antes -- por eso el degradado de los 4 lados ahora
           se ve completo hasta los bordes reales del componente en vez de
           cortarse contra el limite del contenedor de la grilla/splash. */
        .splash-background {
            position: absolute;
            inset: 0;
            z-index: 0;
            overflow: hidden;
            pointer-events: none;
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
            height: 100%;
        }

        .splash-background img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: center 15%;
            filter: blur(2px) brightness(0.55);
        }

        /* Degradado en los 4 lados (no solo arriba/abajo) usando dos
           linear-gradient superpuestos -- vertical + horizontal -- para
           que la imagen se funda con el fondo del componente por los
           cuatro bordes en vez de solo arriba y abajo. */
        .splash-background-fade {
            position: absolute;
            inset: 0;
            background:
                linear-gradient(to bottom, rgba(1, 10, 19, 1) 0%, rgba(1, 10, 19, 0) 15%, rgba(1, 10, 19, 0) 85%, rgba(1, 10, 19, 1) 100%),
                linear-gradient(to right, rgba(1, 10, 19, 1) 0%, rgba(1, 10, 19, 0) 15%, rgba(1, 10, 19, 0) 85%, rgba(1, 10, 19, 1) 100%);
            pointer-events: none;
        }

        .hextech-arcs {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            /* Escala con min()/% en vez de un tamano fijo para seguir
               viendose completo sin recortes sin importar el alto real de
               .splash-view-active (ver ese comentario para el porque). */
            width: min(760px, 92%);
            height: min(760px, 88%);
            z-index: 1;
            pointer-events: none;
            opacity: 0.4;
        }

        .arc-left, .arc-right {
            position: absolute;
            top: 0;
            width: 50%;
            height: 100%;
            border: 2px solid transparent;
            border-radius: 50%;
        }

        .arc-left {
            left: 0;
            border-left-color: #c8aa6e;
            border-top-color: rgba(200, 170, 110, 0.2);
            border-bottom-color: rgba(200, 170, 110, 0.2);
            clip-path: polygon(0 10%, 100% 0, 100% 100%, 0 90%);
        }

        .arc-right {
            right: 0;
            border-right-color: #c8aa6e;
            border-top-color: rgba(200, 170, 110, 0.2);
            border-bottom-color: rgba(200, 170, 110, 0.2);
            clip-path: polygon(0 0, 100% 10%, 100% 90%, 0 100%);
        }

        .tick-marks {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: repeating-conic-gradient(from 0deg, transparent 0deg, transparent 2deg, rgba(200, 170, 110, 0.5) 2deg, rgba(200, 170, 110, 0.5) 3deg);
            border-radius: 50%;
            mask-image: radial-gradient(circle at center, transparent 68%, black 70%, black 72%, transparent 74%);
            -webkit-mask-image: radial-gradient(circle at center, transparent 68%, black 70%, black 72%, transparent 74%);
            clip-path: polygon(0 15%, 20% 0, 80% 0, 100% 15%, 100% 85%, 80% 100%, 20% 100%, 0 85%);
        }

        .loadout-content {
            position: relative;
            z-index: 10;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
            padding-bottom: 20px;
        }

        .skin-selector {
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 20px;
        }

        .random-skin-tag {
            border: 1px solid #c8aa6e;
            color: #c8aa6e;
            font-size: 0.6rem;
            padding: 2px 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 5px;
            background: rgba(0,0,0,0.5);
        }

        .skin-name {
            font-family: 'Spiegel', sans-serif;
            font-size: 1.2rem;
            color: #f0e6d2;
            font-style: italic;
            margin-bottom: 15px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }

        .action-bar {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 12px;
            margin-top: 12px;
            width: 100%;
            max-width: 480px;
            position: relative;
            z-index: 20;
        }

        .action-bar-side {
            display: flex;
            align-items: center;
            min-width: 0;
            overflow: visible;
        }

        .lock-in-container {
            position: relative;
            z-index: 15;
            width: 220px;
            max-width: 60vw;
            height: 56px;
            display: flex;
            justify-content: center;
            align-items: center;
            flex-shrink: 0;
            background-image: url('data:image/svg+xml;utf8,<svg width="300" height="60" viewBox="0 0 300 60" xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 Q 150 60 300 0" fill="none" stroke="rgba(0, 255, 255, 0.3)" stroke-width="2"/><path d="M 20 0 Q 150 50 280 0" fill="none" stroke="rgba(0, 255, 255, 0.1)" stroke-width="1"/></svg>');
            background-position: top center;
            background-repeat: no-repeat;
            background-size: 100% 100%;
        }

        .lock-in-btn {
            background: linear-gradient(to bottom, #1a2a3a, #0d1620);
            border: 2px solid #3c3c41;
            color: #5c5c5c;
            font-family: 'Beaufort for LOL', serif;
            font-size: 1.1rem;
            font-weight: 700;
            letter-spacing: 2px;
            padding: 10px 28px;
            cursor: not-allowed;
            text-transform: uppercase;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            white-space: nowrap;
            clip-path: polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%);
        }

        .lock-in-btn.active {
            border-color: #0bd4d4;
            color: #ffffff;
            cursor: pointer;
            background: linear-gradient(to bottom, #0a3a4a, #051a25);
        }

        .lock-in-btn.active:hover {
            border-color: #00ffff;
            text-shadow: 0 0 8px rgba(255,255,255,0.7);
            box-shadow: 0 0 15px rgba(11, 212, 212, 0.3);
        }

        .lock-in-btn.active:active { transform: scale(0.98); }

        .lock-in-btn.locked-state {
            border-color: #0bd4d4;
            color: #ffffff;
            background: linear-gradient(to bottom, #0a3a4a, #051a25);
            cursor: default;
            animation: magicPulse 1.5s infinite alternate;
            text-shadow: 0 0 10px #0bd4d4;
        }

        .lock-in-btn.locked-state::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 50%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(11, 212, 212, 0.5), transparent);
            transform: skewX(-25deg);
            animation: magicShine 2.5s infinite;
        }

        .lock-in-btn.locked-state:hover { transform: none; }

        .cancel-btn {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            border: 2px solid #3c3c41;
            color: #5c5c5c;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            flex-shrink: 0;
            z-index: 10;
        }

        .cancel-btn.cancel-active {
            border-color: #c8aa6e;
            color: #c8aa6e;
            background: radial-gradient(circle, #3a2a15 0%, #1a120a 100%);
            cursor: pointer;
            box-shadow: 0 0 10px rgba(200, 170, 110, 0.3);
            pointer-events: auto;
        }

        .cancel-btn.cancel-active:hover {
            color: #f0e6d2;
            background: radial-gradient(circle, #4a3a25 0%, #2a1a0f 100%);
            box-shadow: 0 0 15px rgba(200, 170, 110, 0.6), inset 0 0 5px rgba(200, 170, 110, 0.4);
            transform: scale(1.05);
        }

        .cancel-btn.cancel-active:active { transform: scale(0.95); }

        .ver-ficha-btn {
            background: linear-gradient(to bottom, #051a25, #020a10);
            border: 1px solid #0bd4d4;
            color: #0bd4d4;
            font-family: 'Beaufort for LOL', serif;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.5px;
            padding: 10px 14px;
            cursor: pointer;
            text-transform: uppercase;
            transition: all 0.3s ease;
            clip-path: polygon(10% 0, 100% 0, 100% 70%, 90% 100%, 0 100%, 0 30%);
            white-space: nowrap;
            z-index: 10;
            text-decoration: none;
        }

        @media (min-width: 480px) {
            .ver-ficha-btn {
                font-size: 0.85rem;
                letter-spacing: 1px;
                padding: 10px 18px;
            }
        }

        .ver-ficha-btn:hover {
            background: linear-gradient(to bottom, #0a3a4a, #051a25);
            color: #ffffff;
            box-shadow: 0 0 15px rgba(11, 212, 212, 0.4);
            border-color: #00ffff;
        }

        .player-banner {
            position: relative;
            width: 100%;
            height: 68px;
            display: flex;
            align-items: center;
            z-index: 30;
            transition: all 0.4s ease;
            border-radius: 4px;
            overflow: hidden;
        }

        .banner-bg {
            position: absolute;
            inset: 0;
            z-index: -1;
            mask-image: linear-gradient(to right, black 70%, transparent 100%);
            -webkit-mask-image: linear-gradient(to right, black 70%, transparent 100%);
            overflow: hidden;
        }

        .banner-bg::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            transform: skewX(-20deg);
        }

        .player-banner.picking-state .banner-bg {
            background: linear-gradient(to right, rgba(80, 60, 20, 0.8) 0%, rgba(160, 120, 40, 0.4) 60%, transparent 100%);
        }

        .player-banner.picking-state .banner-bg::after {
            background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.25), transparent);
            animation: sweepGold 2s infinite linear;
        }

        .player-banner.picking-state .avatar-border {
            border-color: #c8aa6e;
            box-shadow: 0 0 10px rgba(200, 170, 110, 0.5);
        }

        .player-banner.picking-state .dynamic-text-color { color: #c8aa6e; }
        .player-banner.picking-state .dynamic-border-color { border-color: rgba(200, 170, 110, 0.4); }

        .player-banner.locked-state-banner .banner-bg {
            background: linear-gradient(to right, rgba(5, 30, 40, 0.9) 0%, rgba(11, 212, 212, 0.4) 60%, transparent 100%);
        }

        .player-banner.locked-state-banner .banner-bg::after {
            background: linear-gradient(90deg, transparent, rgba(11, 212, 212, 0.4), transparent);
            animation: sweepCyan 2.5s infinite linear;
        }

        .player-banner.locked-state-banner .avatar-border {
            border-color: #0bd4d4;
            box-shadow: 0 0 12px rgba(11, 212, 212, 0.7);
        }

        .player-banner.locked-state-banner .dynamic-text-color { color: #0bd4d4; }
        .player-banner.locked-state-banner .dynamic-border-color { border-color: rgba(11, 212, 212, 0.5); }

        @keyframes magicPulse {
            0% { box-shadow: 0 0 10px rgba(0, 200, 200, 0.4); }
            50% { box-shadow: 0 0 25px rgba(11, 212, 212, 0.8), inset 0 0 15px rgba(11, 212, 212, 0.4); }
            100% { box-shadow: 0 0 10px rgba(0, 200, 200, 0.4); }
        }
        @keyframes magicShine { 0% { left: -150%; } 100% { left: 150%; } }
        @keyframes sweepGold { 0% { left: -100%; } 100% { left: 100%; } }
        @keyframes sweepCyan { 0% { left: -100%; } 100% { left: 100%; } }
      `}</style>
    </div>
  );
}
