/**
 * Fuente de verdad de todo el copy del sitio: titulos, subtitulos, textos de
 * navegacion y metadata de cada pagina (title de tab + description). Cambiar
 * texto visible del sitio se hace aqui, no en los .astro.
 */

export const SITE = {
  name: "La Venida del Año",
  shortName: "VL",
  logoText: "VL",
  defaultDescription: "La Venida del Año",
  footer: (year: number) => `© ${year} La Venida del Año. Todos los derechos reservados.`
};

export const NAV = {
  links: [
    { href: "/", label: "Inicio" },
    { href: "/peleadores", label: "Peleadores" },
    { href: "/sorteo", label: "Sorteo" }
  ],
  liveCta: "Ver en Vivo"
};

export const PAGES = {
  home: {
    tabTitle: "La Venida del Año",
    hero: {
      eyebrow: "La corrida de la decada",
      titleLine1: "El",
      titleHighlight: "Phonk",
      titleLine2: "Final",
      subtitle: (fighterCount: number) =>
        `${fighterCount} pajeros, un solo sigma. La Grieta del Invocador está a punto temblar.`
    },
    overview: {
      title: "Los Peleadores",
      subtitle: (fighterCount: number) =>
        `${fighterCount} combatientes confirmados. Adelanto del roster completo.`,
      cta: "Ver el roster completo"
    },
    raffle: {
      title: "Sorteo Oficial",
      subtitleLive: "El sorteo ya está en vivo. Entra y descubre los cruces en tiempo real.",
      subtitleWaiting:
        "La suerte decidira quien folla a quien. El sorteo se replica en vivo para todos.",
      ctaLive: "Entrar al sorteo en vivo",
      ctaWaiting: "Ver estado del sorteo"
    }
  },

  fighters: {
    tabTitle: "Peleadores - La Venida en LoL",
    title: "Roster Completo",
    subtitle: (fighterCount: number) => `${fighterCount} combatientes listos para la Grieta del Invocador.`
  },

  raffle: {
    tabTitle: "Sorteo en Vivo - La Venida del Año",
    title: "Sorteo Oficial",
    subtitle: "La suerte decidira quien folla a quien. En vivo para todo el mundo."
  },

  panelLogin: {
    tabTitle: "Acceso al Panel - La Venida del Año",
    title: "Acceso al Panel",
    emailLabel: "Email",
    passwordLabel: "Contraseña",
    submitCta: "Entrar",
    errorGeneric: "Revisa el formato del email."
  },

  panelPassphrase: {
    tabTitle: "Gestion de Participantes - La Venida del Año",
    title: "Clave del panel",
    subtitle: (email: string) => `Sesion iniciada como ${email}. Ingresa la clave adicional del panel.`,
    label: "Clave",
    submitCta: "Desbloquear",
    errorEmpty: "Ingresa una clave."
  },

  rosterManager: {
    title: "Gestion de Participantes",
    logoutCta: "Cerrar sesion"
  },

  admin: {
    tabTitle: "Panel Admin - La Venida del Año",
    title: "Panel del Host",
    subtitle: "Control de fase del evento y emisión del sorteo."
  }
};

export const FIGHTER_CARD = {
  rankLabel: "Rango Actual",
  favChampionLabel: "Campeón Favorito"
};

export const ADMIN_CONTROL = {
  connected: "Conectado a Supabase",
  disconnected: "Sin conexión a Supabase",
  phaseTitle: "Fase del evento",
  raffleControlTitle: "Control del sorteo",
  lockRaffle: "Bloquear sorteo",
  unlockRaffle: "Desbloquear sorteo",
  emitRandomMatch: "Emitir sorteo aleatorio en vivo",
  loadedFighters: (count: number) => `Participantes cargados (${count})`
};

export const PARTICIPANT_MANAGER = {
  newParticipant: "Nuevo participante",
  editingParticipant: (id: string) => `Editando: ${id}`,
  fields: {
    id: "ID unico *",
    name: "Nombre *",
    nickname: "Apodo *",
    mainRole: "Rol principal *",
    favChampion: "Campeon favorito *",
    age: "Edad",
    weight: "Peso",
    height: "Altura",
    lolUsername: "Usuario (Riot ID)",
    lolServer: "Servidor",
    lolRank: "Rango *",
    description: "Descripcion",
    photo: "Foto (desde archivos o camara del celular)"
  },
  placeholders: {
    id: "p11",
    weight: "75 kg",
    height: "178 cm",
    lolUsername: "Nombre#TAG",
    lolRank: "Diamond II",
    statLabel: "Nombre del stat"
  },
  errorRequiredFields: "Completa los campos obligatorios.",
  errorLookupMissingFields: "Completa usuario de LoL y servidor primero.",
  successRankUpdated: "Elo actualizado desde Riot API.",
  successSaved: (name: string) => `${name} guardado correctamente.`,
  successDeleted: "Participante eliminado.",
  confirmDelete: "¿Borrar este participante?",
  lolSectionTitle: "League of Legends",
  lookupCta: "Consultar",
  lookupCtaBusy: "...",
  statsTitle: "Stats (libres, 0-100)",
  statsEmptyHint: "Sin stats. Ej: Mental, Toxicidad, Micro, Macro.",
  addStatCta: "+ Agregar stat",
  removeStatCta: "Quitar",
  rosterTitle: (count: number) => `Roster actual (${count})`,
  editCta: "Editar",
  deleteCta: "Borrar",
  submitNewCta: "Agregar participante",
  submitEditCta: "Guardar cambios",
  cancelCta: "Cancelar"
};
