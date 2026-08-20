/**
 * Persistencia de borrador en localStorage para ParticipantProfileForm:
 * pedido del usuario 2026-08-19 ("que el formulario y sus valores se
 * guarden por si se queda sin internet o recarga la pagina"). El
 * formulario de inscripcion/mi-perfil es largo (identidad, redes, LoL,
 * stats custom, descripcion) y saveOwnParticipant requiere red real
 * (Supabase + mmradar.gg) -- sin esto, quedarse sin señal o refrescar la
 * pagina por error tira todo lo escrito.
 *
 * Deliberadamente NO incluye photo/banner (File no es serializable a
 * JSON de forma util -- guardar un dataURL en localStorage para fotos de
 * celular sin comprimir facilmente pasaria el limite de 5-10MB del
 * storage). El resto de campos de texto + stats custom si persisten.
 *
 * Scope del draft: una key por participante (dueno de sesion), no
 * global, para que loguearse con otra cuenta en el mismo navegador no
 * pise el borrador de otra persona. Se limpia automaticamente al guardar
 * con exito (ParticipantProfileForm llama clearDraft en el submit
 * exitoso) para no restaurar datos viejos despues de un guardado real.
 */

const DRAFT_PREFIX = "velada:participant-draft:";
const DRAFT_VERSION = 1;

export interface ParticipantFormDraft<TForm, TStat> {
  version: number;
  savedAt: string;
  form: TForm;
  stats: TStat[];
}

function draftKey(scopeId: string): string {
  return `${DRAFT_PREFIX}${scopeId}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * scopeId identifica de quien es el borrador: el id del participante ya
 * existente si esta editando, o "new" si todavia no tiene fila propia
 * (alta nueva en /inscripcion). No es el userId de sesion a proposito --
 * si en algun momento se muestra este form en otro contexto (panel admin
 * editando a otra persona) alcanza con pasar un scopeId distinto para no
 * cruzar borradores.
 */
export function saveDraft<TForm, TStat>(scopeId: string, form: TForm, stats: TStat[]): void {
  if (!isBrowser()) return;
  try {
    const payload: ParticipantFormDraft<TForm, TStat> = {
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      form,
      stats
    };
    window.localStorage.setItem(draftKey(scopeId), JSON.stringify(payload));
  } catch {
    // localStorage puede fallar (modo privado, cuota llena, etc.) -- el
    // guardado del borrador es una comodidad, nunca debe romper el
    // formulario en si. Silencioso a proposito, igual que
    // compressImageFile en imageCompression.ts.
  }
}

export function loadDraft<TForm, TStat>(scopeId: string): ParticipantFormDraft<TForm, TStat> | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(scopeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParticipantFormDraft<TForm, TStat>;
    if (parsed.version !== DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(scopeId: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(draftKey(scopeId));
  } catch {
    // ver nota en saveDraft
  }
}
