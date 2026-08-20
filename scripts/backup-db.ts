/**
 * Backup de la base de datos real (Supabase) a JSON local.
 *
 * Uso: bun run backup:db
 * (definido en package.json -> "bun run scripts/backup-db.ts")
 *
 * Vuelca cada tabla de la app a su propio archivo
 * data/<timestamp>/<tabla>.json (uno por tabla, para poder inspeccionar o
 * restaurar una tabla puntual sin tener que parsear un dump gigante), mas
 * un data/<timestamp>/manifest.json con la fecha, cuantas filas trajo cada
 * tabla, y si alguna fallo. data/ ya esta en .gitignore (raiz del repo) --
 * estos backups nunca se commitean, quedan solo en disco local.
 *
 * Standalone (no depende de apps/web/src/lib/supabaseServer.ts, que
 * necesita un `locals` de Astro/Cloudflare Worker que no existe fuera de
 * un request real) -- mismo patron que
 * scripts/test-rank-calibration.test.ts: cliente de @supabase/supabase-js
 * armado directo con PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY de
 * process.env (bun carga el .env de la raiz del repo automaticamente).
 *
 * TABLAS EXCLUIDAS A PROPOSITO (nunca se respaldan, ni siquiera en
 * data/, que ya esta gitignoreado):
 * - `sessions`: solo contiene sesiones activas efimeras (expiran solas,
 *   `expires_at`), no hay nada de valor que preservar y restaurarlas
 *   vencidas no sirve para nada.
 * - `participant_users.password_hash`: aunque es un hash (PBKDF2, ver
 *   lib/password.ts) y no la contrasena en texto plano, no hay motivo
 *   para que un hash de contrasena viva en un archivo JSON en disco si
 *   no hace falta -- se respalda el resto de la fila (id, email,
 *   created_at) para poder ver que cuentas existen, pero NUNCA
 *   password_hash.
 *
 * No es un backup "point in time" transaccional (cada tabla se consulta
 * en su propio SELECT, sin snapshot atomico) -- para el tamano de este
 * proyecto (evento entre amigos, no un sistema con escrituras
 * concurrentes constantes) alcanza sobra.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

interface TableBackupConfig {
  /** Nombre real de la tabla en Supabase. */
  table: string;
  /**
   * Columnas a traer. "*" trae todas -- se usa explicito (no
   * simplemente omitir el campo) para que quede claro en el propio
   * codigo cuales tablas se respaldan completas.
   */
  select: string;
  /** Nombre del archivo de salida (sin extension). */
  fileName: string;
}

/**
 * Todas las tablas reales del schema (ver scripts/setup-supabase.ts,
 * SETUP_SQL) menos `sessions` (excluida arriba). `participant_users` se
 * trae SIN `password_hash` -- ver comentario de cabecera.
 */
const TABLES: TableBackupConfig[] = [
  { table: "event_state", select: "*", fileName: "event_state" },
  { table: "participants", select: "*", fileName: "participants" },
  { table: "participant_users", select: "id, email, created_at", fileName: "participant_users" },
  { table: "matches", select: "*", fileName: "matches" },
  { table: "predictions", select: "*", fileName: "predictions" },
  { table: "team_matches", select: "*", fileName: "team_matches" }
];

interface TableBackupResult {
  table: string;
  fileName: string;
  rowCount: number | null;
  error: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este script lee el .env de la raiz del repo ` +
        `(mismo criterio que scripts/setup-supabase.ts) -- confirma que PUBLIC_SUPABASE_URL ` +
        `y SUPABASE_SERVICE_ROLE_KEY esten seteados ahi.`
    );
  }
  return value;
}

function timestampSlug(date: Date): string {
  // YYYY-MM-DD_HH-mm-ss en hora local -- evita ":" (invalido en nombres
  // de archivo/carpeta en Windows) y es ordenable alfabeticamente igual
  // que cronologicamente.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

async function backupTable(
  admin: ReturnType<typeof createClient>,
  config: TableBackupConfig,
  outputDir: string
): Promise<TableBackupResult> {
  const { data, error } = await admin.from(config.table).select(config.select);

  if (error) {
    console.error(`  [ERROR] ${config.table}: ${error.message}`);
    return { table: config.table, fileName: config.fileName, rowCount: null, error: error.message };
  }

  const rows = data ?? [];
  const filePath = resolve(outputDir, `${config.fileName}.json`);
  writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`  [OK] ${config.table}: ${rows.length} filas -> ${config.fileName}.json`);

  return { table: config.table, fileName: config.fileName, rowCount: rows.length, error: null };
}

async function main() {
  const url = requireEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const startedAt = new Date();
  const slug = timestampSlug(startedAt);
  const dataRoot = resolve(import.meta.dirname, "..", "data");
  const outputDir = resolve(dataRoot, slug);

  if (!existsSync(dataRoot)) mkdirSync(dataRoot, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  console.log(`Backup de la base de datos -> data/${slug}/`);

  const results: TableBackupResult[] = [];
  for (const config of TABLES) {
    results.push(await backupTable(admin, config, outputDir));
  }

  const finishedAt = new Date();
  const failed = results.filter((r) => r.error !== null);

  const manifest = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    supabaseUrl: url,
    excludedTables: [
      "sessions (efimera, no vale la pena respaldarla)",
      "participant_users.password_hash (nunca se respalda, ver cabecera del script)"
    ],
    tables: results
  };
  writeFileSync(resolve(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`\nListo. ${results.length - failed.length}/${results.length} tablas respaldadas en data/${slug}/`);
  if (failed.length > 0) {
    console.error(`${failed.length} tabla(s) fallaron:`);
    for (const f of failed) console.error(`  - ${f.table}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Error haciendo el backup:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
