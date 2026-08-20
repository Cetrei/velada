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
