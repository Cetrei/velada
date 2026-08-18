import { useState } from "react";
import type { Participant } from "@velada/core";
import { CHAMPION_SELECT } from "@velada/core";

interface ChampionSelectGridProps {
  participants: Participant[];
  rivalByParticipantId?: Record<string, Participant | undefined>;
}

type RoleFilter = Participant["mainRole"];

const ROLE_FILTERS: Array<{ role: RoleFilter; icon: string; label: string }> = [
  { role: "Top", icon: "fa-khanda", label: "Top" },
  { role: "Jungle", icon: "fa-shield-halved", label: "Jungle" },
  { role: "Mid", icon: "fa-wand-magic-sparkles", label: "Mid" },
  { role: "ADC", icon: "fa-bow-arrow", label: "ADC" },
  { role: "Support", icon: "fa-staff-snake", label: "Support" }
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

  // Resolviendo el participante seleccionado y su rival usando tu lógica
  const selected = participants.find((p) => p.id === selectedId) ?? null;
  const rival = selected ? rivalByParticipantId[selected.id] : undefined;

  // Filtrado por nombre/apodo y por rol principal
  const filteredParticipants = participants.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      q.length === 0 || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q);
    const matchesRole = !roleFilter || p.mainRole === roleFilter;
    return matchesQuery && matchesRole;
  });

  return (
    <div className="relative w-full bg-[#010a13] text-[#f0e6d2] flex flex-col items-center overflow-hidden lol-main-bg py-2 sm:py-3 px-3 sm:px-6">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* BANNER DEL JUGADOR: fila propia arriba, deja de ser absoluto para no solaparse en mobile */}
      <div className={`player-banner w-full max-w-2xl ${isLockedIn ? 'locked-state-banner' : 'picking-state'}`}>
        <div className="banner-bg"></div>

        <div className="hidden sm:flex flex-col gap-1 ml-4 z-10">
            <div className="w-5 h-5 border bg-[#1e2328] dynamic-border-color transition-colors duration-300"></div>
            <div className="w-5 h-5 border bg-[#1e2328] dynamic-border-color transition-colors duration-300"></div>
        </div>

        <div className="w-11 h-11 sm:w-[52px] sm:h-[52px] rounded-full border-2 ml-3 flex items-center justify-center bg-[#010a13] overflow-hidden avatar-border z-10 relative transition-all duration-300 flex-shrink-0">
            {selected && (
                <img src={selected.photo ?? fallbackPhoto(selected)} alt="Avatar" className="w-full h-full object-cover" />
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

      {/* TÍTULO PRINCIPAL: solo se muestra en el estado fijado, ya no hay hint de "elige un peleador" */}
      {isLockedIn && (
        <h2 className="transition-all duration-300 text-center px-2 text-xl sm:text-2xl text-[#f0e6d2] font-bold tracking-[2px] beaufort-font mt-2 mb-1 uppercase">
          CHOOSE YOUR LOADOUT!
        </h2>
      )}
      <div className="timer-text">67</div>

      {/* CONTENEDOR CENTRAL: Cambia entre la Grid (Cuadrícula) y el Splash Art */}
      <div className="relative w-full max-w-4xl flex justify-center items-start min-h-[220px] sm:min-h-[260px]" style={{ perspective: '1000px' }}>
        
        {/* VISTA 1: CUADRÍCULA (GRID) DE PARTICIPANTES */}
        <div className={`champ-grid-container w-full transition-opacity duration-400 ${isLockedIn ? 'opacity-0 pointer-events-none absolute' : 'opacity-100 relative'}`}>
            
            <div className="controls-bar w-full max-w-2xl flex flex-wrap justify-between items-center gap-3 mb-2 px-2 sm:px-[20px] pb-[10px] border-b border-[#c8aa6e]/30">
                <div className="role-filters flex flex-nowrap gap-2.5 sm:gap-[15px] text-[#a09b8c] text-base sm:text-base order-2 sm:order-1 flex-shrink-0">
                    {ROLE_FILTERS.map(({ role, icon, label }) => (
                        <i
                            key={role}
                            className={`fa-solid ${icon} cursor-pointer transition-colors flex-shrink-0 ${roleFilter === role ? 'text-[#0bd4d4] drop-shadow-[0_0_6px_rgba(11,212,212,0.6)]' : 'hover:text-[#c8aa6e]'}`}
                            title={label}
                            role="button"
                            aria-pressed={roleFilter === role}
                            onClick={() => setRoleFilter((current) => (current === role ? null : role))}
                        ></i>
                    ))}
                </div>
                
                <div className="flex items-center gap-3 sm:gap-4 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="hidden sm:block text-xs text-[#a09b8c] cursor-pointer hover:text-[#c8aa6e] whitespace-nowrap">
                        Ordenar por Nombre <i className="fa-solid fa-chevron-down ml-1"></i>
                    </div>
                    <div className="relative flex-1 sm:flex-none">
                        <i className="fa-solid fa-search absolute left-2.5 top-1/2 transform -translate-y-1/2 text-[#5c5c5c] text-xs pointer-events-none"></i>
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

            <div className="champ-grid-scroll grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-1 auto-rows-[64px]">
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
                            <img src={p.photo ?? fallbackPhoto(p)} alt={p.name} className="placeholder-img" loading="lazy" />
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

        {/* VISTA 2: LOADOUT / SPLASH BACKGROUND */}
        <div className={`absolute inset-0 w-full h-full transition-all duration-500 ${isLockedIn ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none -z-10'}`}>
            
            <div className="splash-background">
                 {selected && <img src={selected.banner ?? selected.photo ?? fallbackPhoto(selected)} alt="Background" />}
            </div>

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

                    <div className="skin-thumbnails">
                        <div className="skin-thumb active">
                            {selected && <img src={selected.photo ?? fallbackPhoto(selected)} alt="skin thumbnail" />}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN INFERIORES */}
      <div className="action-bar">
        
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

        .search-input {
            background-color: transparent;
            border: 1px solid #3c3c41;
            color: #a09b8c;
            padding: 5px 10px;
            font-family: 'Spiegel', sans-serif;
            font-size: 0.8rem;
            width: 150px;
            outline: none;
            transition: border-color 0.2s;
        }
        .search-input:focus {
            border-color: #5c5c5c;
            color: #a09b8c;
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }

        .champ-grid-scroll {
            min-height: 128px;
            max-height: 128px;
            overflow-y: auto;
            padding-right: 6px;
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
            background-color: #1e2328;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 0;
            margin: 0;
        }

        .champ-portrait.no-photo {
            background-color: transparent;
            background-image: radial-gradient(circle at center, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.75) 100%);
        }

        .champ-portrait:hover, .champ-portrait.selected {
            border-color: #0bd4d4;
            box-shadow: 0 0 8px rgba(11, 212, 212, 0.8), inset 0 0 10px rgba(11, 212, 212, 0.5);
            transform: scale(1.05);
            z-index: 10;
        }

        .champ-portrait.selected {
            border-width: 2px;
            border-style: solid;
            border-image: linear-gradient(to bottom, #e0f8f8, #0bd4d4) 1;
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

        .splash-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            overflow: hidden;
            opacity: 0.3;
            pointer-events: none;
            display: flex;
            justify-content: center;
            align-items: center;
            mask-image: radial-gradient(circle at center, black 40%, transparent 80%);
            -webkit-mask-image: radial-gradient(circle at center, black 40%, transparent 80%);
        }

        .splash-background img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: blur(2px) brightness(0.6);
        }

        .hextech-arcs {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 700px;
            height: 700px;
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

        .skin-thumbnails {
            display: flex;
            gap: 5px;
            align-items: center;
            justify-content: center;
        }

        .skin-thumb {
            width: 48px;
            height: 48px;
            border: 1px solid #3c3c41;
            position: relative;
            cursor: pointer;
            filter: grayscale(0.5);
        }
        
        .skin-thumb.active {
            border-color: #c8aa6e;
            width: 56px;
            height: 56px;
            filter: grayscale(0);
        }

        .skin-thumb img { width: 100%; height: 100%; object-fit: cover; }

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
            font-size: 0.85rem;
            font-weight: 700;
            letter-spacing: 1px;
            padding: 10px 18px;
            cursor: pointer;
            text-transform: uppercase;
            transition: all 0.3s ease;
            clip-path: polygon(10% 0, 100% 0, 100% 70%, 90% 100%, 0 100%, 0 30%);
            white-space: nowrap;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 10;
            text-decoration: none;
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