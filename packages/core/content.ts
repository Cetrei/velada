/**
 * Fuente de verdad de todo el copy del sitio: titulos, subtitulos, textos de
 * navegacion y metadata de cada pagina (title de tab + description). Cambiar
 * texto visible del sitio se hace aqui, no en los .astro.
 */

export const SITE = {
  name: "La Follada del Año",
  shortName: "VL",
  logoText: "VL",
  defaultDescription: "La Follada del Año",
  footer: (year: number) => `© ${year} La Follada del Año. Todos los derechos reservados.`
};

export const NAV = {
  links: [
    { href: "/", label: "Inicio" },
    { href: "/peleadores", label: "Peleadores" },
    { href: "/combates", label: "Combates" },
    { href: "/pronosticos", label: "Pronósticos" },
    { href: "/sorteo", label: "Sorteo" }
  ],
  liveCta: "Ver en Vivo",
  registerCta: "Inscribirme",
  profileCta: "Mi Perfil"
};

export const PAGES = {
  home: {
    tabTitle: "La Follada del Año",
    hero: {
      eyebrow: "La corrida de la decada",
      titleLine1: "",
      titleHighlight: "",
      titleLine2: "",
      subtitle: () => ""
    },
    overview: {
      cta: "Ver el roster completo"
    },
    predictions: {
      title: "Pronósticos",
      subtitle: "Así está votando la comunidad. Elige tu ganador antes de que empiece.",
      cta: "Ver todos los pronósticos",
      emptyState: "Aún no hay combates abiertos a pronóstico."
    },
    matches: {
      title: "Combates",
      subtitle: "Resultados oficiales y tarjetas de los jueces.",
      cta: "Ver todos los combates"
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
    tabTitle: "Peleadores - La Follada en LoL",
    title: "Roster Completo",
    subtitle: (fighterCount: number) => `${fighterCount} combatientes listos para la Grieta del Invocador.`,
    searchPlaceholder: "Buscar por nombre o apodo...",
    filterRoleLabel: "Rol",
    filterRoleAll: "Todos",
    filterEloLabel: "Elo",
    filterEloAll: "Todos",
    sortLabel: "Ordenar por",
    sortOptions: {
      nameAsc: "Nombre (A-Z)",
      votesDesc: "Más votados",
      votesAsc: "Menos votados"
    },
    emptyState: "Ningún peleador coincide con esa búsqueda."
  },

  fighterDetail: {
    tabTitle: (name: string) => `${name} - La Follada del Año`,
    backCta: "Volver al roster",
    followersLabel: "Seguidores",
    countryLabel: "País",
    heightLabel: "Estatura",
    weightLabel: "Peso",
    categoryLabel: "Categoría",
    rivalLabel: "Su rival",
    viewMatchCta: "Ver el combate",
    noRivalYet: "Rival por definir",
    predictionTitle: "Pronóstico de la comunidad",
    notFoundTitle: "Peleador no encontrado",
    notFoundSubtitle: "Puede que el link esté roto o el participante ya no exista.",
    notFoundCta: "Volver al roster"
  },

  matches: {
    tabTitle: "Combates - La Follada del Año",
    title: "Combates",
    subtitle: "Resultados oficiales y tarjetas de los jueces de La Follada del Año.",
    officialResultsLabel: "Resultados oficiales",
    winnerLabel: "Ganadora",
    winnerLabelMasc: "Ganador",
    decisionLabel: "Decisión",
    pendingResult: "Resultado pendiente",
    emptyState: "Todavía no hay combates cargados."
  },

  predictions: {
    tabTitle: "Pronósticos - La Follada del Año",
    title: "Pronósticos",
    subtitle: "Así pronosticó la comunidad los combates de La Follada del Año.",
    communityLabel: "Pronóstico de la comunidad",
    votesLabel: (count: number) => `${count.toLocaleString("es")} votos`,
    votedLabel: "Ya votaste",
    voteCta: "Votar",
    emptyState: "No hay combates abiertos a pronóstico todavía.",
    closedLabel: "Pronóstico cerrado",
    votingPhaseClosedTitle: "Votaciones cerradas",
    votingPhaseClosedSubtitle: "El host todavía no habilitó la fase de votaciones. Volvé a intentarlo más tarde."
  },

  raffle: {
    tabTitle: "Sorteo en Vivo - La Follada del Año",
    title: "Sorteo Oficial",
    subtitle: "La suerte decidira quien folla a quien. En vivo para todo el mundo."
  },

  panelLogin: {
    tabTitle: "Acceso al Panel - La Follada del Año",
    title: "Acceso al Panel",
    emailLabel: "Email",
    passwordLabel: "Contraseña",
    submitCta: "Entrar",
    errorGeneric: "Revisa el formato del email."
  },

  panelPassphrase: {
    tabTitle: "Gestion de Participantes - La Follada del Año",
    title: "Clave del panel",
    subtitle: (email: string) => `Sesion iniciada como ${email}. Ingresa la clave adicional del panel.`,
    label: "Clave",
    submitCta: "Desbloquear",
    errorEmpty: "Ingresa una clave."
  },

  rosterManager: {
    title: "Panel del Host",
    subtitle: "Edita o elimina los perfiles que cada peleador cargo desde /mi-perfil.",
    logoutCta: "Cerrar sesion",
    tabParticipants: "Participantes",
    tabEvent: "Evento"
  },

  admin: {
    tabTitle: "Panel Admin - La Follada del Año",
    title: "Panel del Host",
    subtitle: "Control de fase del evento, combates y sorteo."
  },

  inscripcion: {
    tabTitle: "Inscripción - La Follada del Año",
    title: "Inscripción",
    subtitleAuth: "Ingresá tu email para crear tu cuenta o iniciar sesión.",
    emailLabel: "Email",
    passwordLabel: "Contraseña",
    confirmPasswordLabel: "Confirmar contraseña",
    continueCta: "Continuar",
    changeEmailCta: "Usar otro email",
    newAccountHint: "No encontramos una cuenta con este email. Creá una contraseña para registrarte.",
    existingAccountHint: "Ya tenés cuenta. Ingresá tu contraseña para continuar.",
    loginCta: "Entrar",
    registerCta: "Crear cuenta",
    errorEmailInvalid: "Ingresá un email válido.",
    errorPasswordMismatch: "Las contraseñas no coinciden.",
    emailCheckingHint: "Verificando email...",
    emailNewAccountHint: "Email válido. Vamos a crear tu cuenta.",
    emailExistingAccountHint: "Ya tenés cuenta con este email.",
    emailAdminHint: "Cuenta de host detectada.",
    passwordRequirementsTitle: "Tu contraseña necesita:",
    passwordRequirementMinLength: "Al menos 8 caracteres",
    passwordRequirementLetter: "Una letra",
    passwordRequirementNumber: "Un número",
    passwordRequirementsMet: "Contraseña válida",
    passwordMatchHint: "Las contraseñas coinciden"
  },

  miPerfil: {
    tabTitle: "Mi Perfil - La Follada del Año",
    title: "Mi Perfil",
    titleIncomplete: "Completá tu ficha",
    closedTitle: "Inscripciones cerradas",
    closedSubtitle: "El host cerró las inscripciones por ahora. Todavía podés editar tu perfil si ya tenías uno cargado.",
    subtitleNewProfile: "Falta poco. Completá estos datos para aparecer en el roster.",
    subtitleEditProfile: "Este es tu perfil. Podés editarlo cuando quieras.",
    logoutCta: "Cerrar sesión",
    currentRankLabel: "Rango actual",
    submitCreateCta: "Crear mi perfil",
    submitUpdateCta: "Guardar cambios",
    successCreated: "¡Perfil creado! Ya formás parte del roster.",
    successUpdated: "Perfil actualizado.",
    incompleteBadge: "Perfil incompleto — todavía no aparecés en el roster público."
  }
};

export const FIGHTER_CARD = {
  rankLabel: "Rango Actual",
  favChampionLabel: "Campeón Favorito"
};

export const CHAMPION_SELECT = {
  title: "¡Elige tu peleador!",
  hint: "",
  emptyHint: "Selecciona un peleador",
  backCta: "Volver",
  viewProfileCta: "Ver ficha completa",
  vsLabel: "VS"
};

export const ADMIN_CONTROL = {
  connected: "Conectado a Supabase",
  disconnected: "Sin conexión a Supabase",
  stateTitle: "Estado del evento",
  stateHint: "Activá o desactivá cada etapa en el orden que quieras. Cada switch solo habilita/deshabilita esa parte del sitio.",
  registrationsLabel: "Inscripciones",
  registrationsOpenState: "Abiertas",
  registrationsClosedState: "Cerradas",
  rouletteLabel: "Ruleta de combates",
  rouletteEnabledState: "Habilitada",
  rouletteDisabledState: "Bloqueada",
  votingLabel: "Fase de votaciones",
  votingEnabledState: "Habilitada",
  votingDisabledState: "Bloqueada",
  eventStartedLabel: "Inicio de la velada",
  eventStartedOnState: "Empezada",
  eventStartedOffState: "Sin empezar",
  emitRandomMatch: "Emitir sorteo aleatorio en vivo",
  loadedFighters: (count: number) => `Participantes cargados (${count})`,
  startTimeTitle: "Fecha de inicio",
  startTimeLabel: "Fecha y hora de inicio del evento",
  saveStartTimeCta: "Guardar fecha",
  errorStartTimeEmpty: "Elegi una fecha valida.",
  successStartTimeUpdated: "Fecha de inicio actualizada.",
  errorNotConnected: "Supabase no esta configurado. Corre bun run setup:supabase.",
  errorUnexpected: (detail: string) => `Error inesperado: ${detail}`,
  matchesTitle: "Combates",
  newMatchCta: "Nuevo combate",
  matchNumberLabel: "N° de combate",
  player1Label: "Peleador 1",
  player2Label: "Peleador 2",
  createMatchCta: "Crear combate",
  deleteMatchCta: "Borrar",
  predictionsOpenLabel: "Pronóstico abierto al público",
  togglePredictionsCta: "Cambiar",
  winnerLabel: "Ganador",
  noWinnerYet: "Sin definir",
  decisionLabel: "Decisión (ej: Decisión unánime 5-0)",
  saveResultCta: "Guardar resultado",
  votesCountLabel: (p1: number, p2: number) => `${p1} vs ${p2} votos`,
  successMatchCreated: "Combate creado.",
  successMatchUpdated: "Combate actualizado.",
  successMatchDeleted: "Combate eliminado.",
  confirmDeleteMatch: "¿Borrar este combate? Se borran también sus pronósticos.",
  errorNeedTwoDifferent: "Elegí dos peleadores distintos."
};

export const PARTICIPANT_MANAGER = {
  editingParticipant: (id: string) => `Editando: ${id}`,
  newParticipant: "Nuevo participante",
  submitNewCta: "Crear participante",
  noManualCreateHint: "Los peleadores se inscriben ellos mismos en /inscripcion y completan su ficha en /mi-perfil. Aca solo podes editar o borrar.",
  fields: {
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
    photo: "Foto (desde archivos o camara del celular)",
    banner: "Banner (foto grande, se usa en la selección de peleador)"
  },
  placeholders: {
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
  submitEditCta: "Guardar cambios",
  cancelCta: "Cancelar"
};
