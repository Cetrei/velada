/**
 * Compresion/resize de imagenes del lado del navegador antes de subirlas a
 * Supabase Storage, usando la Canvas API (sin dependencias externas).
 *
 * Por que aca y no una transformacion server-side de Supabase: Image
 * Transformations es una feature de pago (solo planes Pro+, con costo
 * variable por imagen de origen procesada) — no tiene sentido pagar por
 * eso en un proyecto de este tamano cuando se puede lograr el mismo
 * resultado (fotos livianas, cargas rapidas) gratis comprimiendo antes de
 * subir. Las fotos que suben los jugadores desde el celular suelen pesar
 * varios MB sin comprimir; esto las deja en un rango razonable (tipico
 * unos cientos de KB) antes de que toquen la red.
 *
 * Solo se usa desde componentes cliente (ParticipantProfileForm,
 * ParticipantManager) — Canvas/Image no existen en el runtime de
 * Cloudflare Workers ni en Node, asi que este modulo nunca se importa
 * desde codigo server-side (actions/index.ts sigue recibiendo el File ya
 * comprimido tal cual, sin tocarlo).
 */

export interface CompressImageOptions {
  /** Lado mas largo en pixeles; la imagen se escala manteniendo aspect ratio si lo excede. */
  maxDimension: number;
  /** Calidad JPEG/WebP, 0-1. */
  quality: number;
}

/** Fotos de perfil: se muestran chicas (avatares, grid de retratos), no necesitan mucha resolucion. */
export const PHOTO_COMPRESSION: CompressImageOptions = { maxDimension: 800, quality: 0.82 };

/** Banners: se muestran grandes (splash de ChampionSelectGrid, fondo de PlayerCard), necesitan mas resolucion que una foto de perfil. */
export const BANNER_COMPRESSION: CompressImageOptions = { maxDimension: 1600, quality: 0.82 };

/**
 * Redimensiona y recomprime un File de imagen en el navegador. Si el
 * archivo no es una imagen que el navegador pueda decodificar (o algo
 * falla en el camino), devuelve el File original sin tocar en vez de
 * bloquear el formulario — comprimir es una optimizacion, no un
 * requisito para poder guardar el perfil.
 */
export async function compressImageFile(file: File, options: CompressImageOptions): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, options.maxDimension / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.round(bitmap.width * scale);
    const targetHeight = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const outputType = file.type === "image/png" && !hasTransparency(canvas, ctx) ? "image/jpeg" : file.type === "image/gif" ? file.type : "image/jpeg";

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, outputType, options.quality));
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + (outputType === "image/jpeg" ? ".jpg" : "");
    return new File([blob], newName, { type: outputType });
  } catch {
    return file;
  }
}

/**
 * Chequeo barato (esquinas + centro, no pixel a pixel) de si un PNG tiene
 * transparencia real -- si no la tiene, conviene recodificar a JPEG
 * (mucho mas liviano que PNG para fotos). Si algo falla al leer el
 * canvas, se asume que SI tiene transparencia (mas seguro: se queda en
 * PNG en vez de arriesgarse a perder un canal alpha real).
 */
function hasTransparency(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  try {
    const points = [
      [0, 0],
      [canvas.width - 1, 0],
      [0, canvas.height - 1],
      [canvas.width - 1, canvas.height - 1],
      [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)]
    ];
    return points.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] < 255);
  } catch {
    return true;
  }
}
