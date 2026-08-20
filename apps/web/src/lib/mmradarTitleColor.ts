/**
 * mmradar puede o no exponer un color real por titulo en el HTML que se
 * parsea (parseTitles en packages/core/mmradarScraper.ts, ver
 * MmradarTitle.color) -- cuando lo trae, se usa tal cual (resolveTitleColor
 * deriva bg/border a partir de ese hex real). Cuando color es null (la
 * fuente no expone nada para ese titulo puntual), se cae a un color
 * estable derivado del propio texto del titulo (mismo titulo -> mismo
 * color siempre) para seguir teniendo variedad visual (azul, magenta,
 * verde, dorado) sin inventar una taxonomia que no existe del lado de la
 * fuente. Compartido entre MmradarPanel (ficha publica) y
 * PerformancePreviewCard (preview de /mi-perfil) para que un mismo
 * titulo se vea con el mismo color en los dos lugares.
 */

export interface TitleColor {
  text: string;
  bg: string;
  border: string;
}

const TITLE_COLORS: TitleColor[] = [
  { text: "#4FC3E8", bg: "rgba(79, 195, 232, 0.08)", border: "rgba(79, 195, 232, 0.3)" }, // azul
  { text: "#e879f9", bg: "rgba(232, 121, 249, 0.08)", border: "rgba(232, 121, 249, 0.3)" }, // magenta
  { text: "#49B16F", bg: "rgba(73, 177, 111, 0.08)", border: "rgba(73, 177, 111, 0.3)" }, // verde
  { text: "#C8AA6E", bg: "rgba(200, 170, 110, 0.1)", border: "rgba(200, 170, 110, 0.35)" }, // dorado
  { text: "#f87171", bg: "rgba(248, 113, 113, 0.08)", border: "rgba(248, 113, 113, 0.3)" } // rojo
];

function hashColorForTitle(title: string): TitleColor {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return TITLE_COLORS[Math.abs(hash) % TITLE_COLORS.length];
}

/**
 * Convierte un hex real ("#4fc3e8") en el mismo shape {text, bg, border}
 * que usan los chips, para que un color scrapeado de mmradar se vea con
 * la misma composicion visual (fondo semitransparente + borde) que los
 * colores del fallback por hash, en vez de un texto plano sin fondo.
 * Si el hex no matchea el formato esperado (defensivo, no deberia pasar
 * dado que mmradarScraper.ts ya normaliza a #rrggbb), cae a un gris
 * neutro en vez de romper el render.
 */
function titleColorFromHex(hex: string): TitleColor {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return { text: hex, bg: "rgba(255, 255, 255, 0.06)", border: "rgba(255, 255, 255, 0.2)" };
  }

  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);

  return {
    text: hex,
    bg: `rgba(${r}, ${g}, ${b}, 0.08)`,
    border: `rgba(${r}, ${g}, ${b}, 0.3)`
  };
}

/**
 * Punto de entrada unico para resolver el color visual de un chip de
 * titulo: usa el color real scrapeado si vino (nunca lo reemplaza), y
 * solo cae al hash determinista por texto cuando la fuente no trajo nada
 * para ese titulo puntual. Consumido por MmradarPanel y
 * PerformancePreviewCard.
 */
export function resolveTitleColor(title: { text: string; color?: string | null }): TitleColor {
  if (title.color) return titleColorFromHex(title.color);
  return hashColorForTitle(title.text);
}

/** @deprecated usar resolveTitleColor, que prioriza el color real scrapeado cuando esta disponible. */
export function colorForTitle(title: string): TitleColor {
  return hashColorForTitle(title);
}
