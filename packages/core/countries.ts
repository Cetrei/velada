/**
 * Lista de paises (nombre en espanol + bandera emoji) para el campo
 * "Pais" del formulario de perfil. Se usa con un <input list> +
 * <datalist>: el jugador puede escribir libremente (autocompletado
 * sugiere de esta lista) pero tambien puede dejar un valor que no este
 * en la lista — en ese caso countryFlag no se resuelve y el fallback de
 * bandera (un icono generico) se muestra en su lugar.
 *
 * Las banderas son emoji Unicode (regional indicator symbols), no
 * archivos de imagen — no dependen de ningun asset local ni de un CDN de
 * terceros, y se ven bien en cualquier dispositivo/SO moderno.
 */

export interface CountryOption {
  name: string;
  flag: string;
}

export const COUNTRIES: CountryOption[] = [
  { name: "Argentina", flag: "🇦🇷" },
  { name: "Bolivia", flag: "🇧🇴" },
  { name: "Brasil", flag: "🇧🇷" },
  { name: "Chile", flag: "🇨🇱" },
  { name: "Colombia", flag: "🇨🇴" },
  { name: "Costa Rica", flag: "🇨🇷" },
  { name: "Cuba", flag: "🇨🇺" },
  { name: "Ecuador", flag: "🇪🇨" },
  { name: "El Salvador", flag: "🇸🇻" },
  { name: "España", flag: "🇪🇸" },
  { name: "Estados Unidos", flag: "🇺🇸" },
  { name: "Guatemala", flag: "🇬🇹" },
  { name: "Honduras", flag: "🇭🇳" },
  { name: "México", flag: "🇲🇽" },
  { name: "Nicaragua", flag: "🇳🇮" },
  { name: "Panamá", flag: "🇵🇦" },
  { name: "Paraguay", flag: "🇵🇾" },
  { name: "Perú", flag: "🇵🇪" },
  { name: "Puerto Rico", flag: "🇵🇷" },
  { name: "República Dominicana", flag: "🇩🇴" },
  { name: "Uruguay", flag: "🇺🇾" },
  { name: "Venezuela", flag: "🇻🇪" },
  { name: "Alemania", flag: "🇩🇪" },
  { name: "Andorra", flag: "🇦🇩" },
  { name: "Australia", flag: "🇦🇺" },
  { name: "Austria", flag: "🇦🇹" },
  { name: "Bélgica", flag: "🇧🇪" },
  { name: "Bulgaria", flag: "🇧🇬" },
  { name: "Canadá", flag: "🇨🇦" },
  { name: "China", flag: "🇨🇳" },
  { name: "Corea del Sur", flag: "🇰🇷" },
  { name: "Croacia", flag: "🇭🇷" },
  { name: "Dinamarca", flag: "🇩🇰" },
  { name: "Egipto", flag: "🇪🇬" },
  { name: "Eslovaquia", flag: "🇸🇰" },
  { name: "Eslovenia", flag: "🇸🇮" },
  { name: "Estonia", flag: "🇪🇪" },
  { name: "Filipinas", flag: "🇵🇭" },
  { name: "Finlandia", flag: "🇫🇮" },
  { name: "Francia", flag: "🇫🇷" },
  { name: "Grecia", flag: "🇬🇷" },
  { name: "Hungría", flag: "🇭🇺" },
  { name: "India", flag: "🇮🇳" },
  { name: "Indonesia", flag: "🇮🇩" },
  { name: "Irlanda", flag: "🇮🇪" },
  { name: "Islandia", flag: "🇮🇸" },
  { name: "Israel", flag: "🇮🇱" },
  { name: "Italia", flag: "🇮🇹" },
  { name: "Japón", flag: "🇯🇵" },
  { name: "Letonia", flag: "🇱🇻" },
  { name: "Lituania", flag: "🇱🇹" },
  { name: "Luxemburgo", flag: "🇱🇺" },
  { name: "Malasia", flag: "🇲🇾" },
  { name: "Malta", flag: "🇲🇹" },
  { name: "Marruecos", flag: "🇲🇦" },
  { name: "Noruega", flag: "🇳🇴" },
  { name: "Nueva Zelanda", flag: "🇳🇿" },
  { name: "Países Bajos", flag: "🇳🇱" },
  { name: "Polonia", flag: "🇵🇱" },
  { name: "Portugal", flag: "🇵🇹" },
  { name: "Reino Unido", flag: "🇬🇧" },
  { name: "República Checa", flag: "🇨🇿" },
  { name: "Rumania", flag: "🇷🇴" },
  { name: "Rusia", flag: "🇷🇺" },
  { name: "Singapur", flag: "🇸🇬" },
  { name: "Sudáfrica", flag: "🇿🇦" },
  { name: "Suecia", flag: "🇸🇪" },
  { name: "Suiza", flag: "🇨🇭" },
  { name: "Tailandia", flag: "🇹🇭" },
  { name: "Turquía", flag: "🇹🇷" },
  { name: "Ucrania", flag: "🇺🇦" },
  { name: "Vietnam", flag: "🇻🇳" }
].sort((a, b) => a.name.localeCompare(b.name, "es"));

/**
 * Bandera generica para cuando el pais escrito no matchea ninguno de la
 * lista (el input permite texto libre a proposito, ver comentario
 * arriba) — mejor mostrar un icono neutro que nada o un emoji roto.
 */
export const UNKNOWN_COUNTRY_FLAG = "🏳️";

/**
 * Busca la bandera exacta (case-insensitive, sin importar tildes) para un
 * nombre de pais. Devuelve UNKNOWN_COUNTRY_FLAG si no hay match exacto —
 * nunca intenta adivinar con matching parcial, para no asignar una
 * bandera incorrecta a un texto libre que se parece a otro pais.
 */
export function flagForCountry(countryName: string | null | undefined): string {
  if (!countryName) return UNKNOWN_COUNTRY_FLAG;
  const normalized = countryName.trim().toLowerCase();
  const match = COUNTRIES.find((c) => c.name.toLowerCase() === normalized);
  return match?.flag ?? UNKNOWN_COUNTRY_FLAG;
}
