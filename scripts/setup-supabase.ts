/**
 * Uso:
 *   bun run scripts/setup-supabase.ts
 *     Crea/actualiza el schema (SETUP_SQL), corre la migracion de limpieza
 *     del schema viejo (MIGRATION_SQL, siempre segura, solo dropea objetos
 *     ya no usados), escribe .env / apps/web/.env, y siembra
 *     participants.yml. Idempotente, seguro de correr repetidas veces.
 *
 *   CONFIRM_RESET_DATA=yes bun run scripts/setup-supabase.ts --reset-data
 *     Ademas de lo anterior, BORRA todas las filas de participant_users,
 *     sessions y participants (RESET_DATA_SQL) antes de re-sembrar desde
 *     el YAML. Pensado para limpiar cuentas/participantes de prueba
 *     creados mientras se armaba el sistema de auth nuevo. Requiere el
 *     flag Y la env var juntos a proposito, para que no se dispare por
 *     accidente. NO borra event_state/matches/predictions.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";

/**
 * Auth is fully custom now (own participant_users + sessions tables, see
 * apps/web/src/lib/session.ts + lib/password.ts) — Supabase Auth
 * (auth.users, magic links, RLS via auth.uid()) is NOT used anywhere in
 * this schema anymore. Every table has RLS disabled: the service-role
 * client is the only thing that ever touches these tables, and permission
 * checks (own-profile-only, admin-only) happen by hand in
 * apps/web/src/actions/index.ts, not via policies. "Admin" is derived at
 * request time from ADMIN_EMAILS (env) matched against
 * participant_users.email, not a DB row.
 */
const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS event_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  start_time TIMESTAMPTZ NOT NULL,
  roulette_unlocked BOOLEAN DEFAULT FALSE,
  current_phase TEXT DEFAULT 'COUNTDOWN',
  registrations_open BOOLEAN DEFAULT TRUE,
  voting_enabled BOOLEAN DEFAULT FALSE,
  event_started BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE event_state ADD COLUMN IF NOT EXISTS registrations_open BOOLEAN DEFAULT TRUE;
ALTER TABLE event_state ADD COLUMN IF NOT EXISTS voting_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE event_state ADD COLUMN IF NOT EXISTS event_started BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_number INTEGER,
  name TEXT DEFAULT NULL,
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT DEFAULT NULL,
  decision TEXT DEFAULT NULL,
  judge_cards JSONB DEFAULT NULL,
  predictions_open BOOLEAN DEFAULT FALSE,
  is_random BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_number INTEGER;
-- Nombre opcional del combate (ej. "Semifinal", "Gran Final") — la ruleta
-- (aleatoria o manual desde el panel) sigue generando el emparejamiento
-- (player1/player2), este campo solo etiqueta el match despues de creado,
-- se edita a mano desde /gestion-roster-x9f2 (pestana Evento).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS name TEXT DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS decision TEXT DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS judge_cards JSONB DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS predictions_open BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS predictions (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  predicted_winner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (match_id, voter_id)
);

-- Reemplaza Supabase Auth (auth.users): cuentas propias de fighters/admins,
-- password_hash es PBKDF2 via Web Crypto (ver apps/web/src/lib/password.ts),
-- nunca texto plano ni bcrypt (no disponible en el runtime de Workers).
CREATE TABLE IF NOT EXISTS participant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reemplaza las cookies de sesion de @supabase/ssr: id opaco random en la
-- cookie (velada_session), esta fila es la unica fuente de verdad de si
-- ese id sigue siendo una sesion valida. Sin RLS -> siempre via admin
-- client, expires_at se filtra a mano en lib/session.ts (getSession).
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES participant_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  owner_user_id UUID UNIQUE REFERENCES participant_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  photo TEXT,
  banner TEXT,
  age INTEGER,
  weight TEXT,
  height TEXT,
  country TEXT,
  country_flag TEXT,
  instagram_handle TEXT,
  instagram_followers TEXT,
  x_handle TEXT,
  x_followers TEXT,
  lol_rank TEXT NOT NULL DEFAULT '',
  lol_username TEXT,
  lol_server TEXT,
  main_role TEXT NOT NULL,
  fav_champion TEXT NOT NULL,
  description TEXT,
  stats JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS country_flag TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS instagram_handle TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS instagram_followers TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS x_handle TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS x_followers TEXT;
-- Datos de mmradar.gg (performance rank, los 6 scores, titulos) usados
-- para mostrar en el perfil publico del peleador Y como fuente del skill
-- rating del balanceador de equipos (ver packages/core/skillRating.ts).
-- Se re-consultan al mismo tiempo que el rango de liga (fetchRiotRank),
-- nunca escritos a mano.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS performance_rank TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS performance_scores JSONB;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS titles JSONB;
-- Icono de invocador y servidor/region tal como los muestra mmradar.gg
-- (ver packages/core/mmradarScraper.ts parseIconUrl/parseServer). Se
-- guardan junto al resto de datos de mmradar en el mismo upsert, nunca
-- escritos a mano. mmradar_icon_url puede quedar NULL si el sitio no
-- expone el icono para ese perfil -- el componente que lo consume
-- simplemente no lo muestra en ese caso, sin dejar espacio en blanco.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS mmradar_icon_url TEXT;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS mmradar_server TEXT;

-- Combates por equipos (5v5 o mezclas de 4v4/3v3) del evento mayor,
-- separados de matches (que es siempre 1v1, de la ruleta). Un solo
-- ganador por equipo completo, como una partida real de LoL -- no hay
-- resultado por jugador individual aca.
CREATE TABLE IF NOT EXISTS team_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT DEFAULT NULL,
  team_a_ids JSONB NOT NULL,
  team_b_ids JSONB NOT NULL,
  winner_team TEXT DEFAULT NULL,
  generation_mode TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'predictions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE predictions;
  END IF;
END $$;

-- RLS deshabilitado en todo: sin Supabase Auth no hay auth.uid() con el
-- que escribir policies con sentido. La tabla predictions es la unica
-- excepcion real (el cliente anon vota directo desde el browser via
-- getSupabaseClient), asi que se queda con RLS + policies publicas de
-- antes. Todo lo demas (event_state, matches, participants,
-- participant_users, sessions) solo se toca desde el service-role client
-- en las Astro Actions, que ya hace sus propios checks de permisos.
ALTER TABLE event_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE participant_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura publica de predictions" ON predictions;
CREATE POLICY "Lectura publica de predictions" ON predictions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Voto publico anonimo" ON predictions;
CREATE POLICY "Voto publico anonimo" ON predictions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Cambio de voto publico anonimo" ON predictions;
CREATE POLICY "Cambio de voto publico anonimo" ON predictions FOR UPDATE USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('participant-photos', 'participant-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Lectura publica de fotos" ON storage.objects;
CREATE POLICY "Lectura publica de fotos" ON storage.objects FOR SELECT
  USING (bucket_id = 'participant-photos');

-- La escritura de fotos ya solo pasa por el service-role client (Astro
-- Actions), asi que no necesita una policy de escritura separada: el
-- service role bypassea RLS de storage.objects igual que en cualquier
-- otra tabla.
DROP POLICY IF EXISTS "Escritura admin de fotos" ON storage.objects;

INSERT INTO event_state (id, start_time, roulette_unlocked, current_phase, registrations_open, voting_enabled, event_started)
VALUES ('main', NOW() + INTERVAL '7 days', FALSE, 'COUNTDOWN', TRUE, FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;
`;

/**
 * One-time migration for projects that ran the OLD (Supabase Auth based)
 * version of this script before: drops the now-unused admins/panel_secret
 * tables and the verify_panel_passphrase RPC, and detaches
 * participants.owner_user_id from auth.users so it can be repointed at
 * participant_users. Safe to run repeatedly (everything is IF EXISTS).
 * Existing participants rows keep their id/data; owner_user_id just goes
 * NULL for anyone who had a Supabase Auth-linked profile, since there's no
 * way to carry over an auth.users row into participant_users (no password
 * to migrate) — those fighters need to re-register once with the same
 * email to reclaim their profile via saveOwnParticipant's upsert-by-email
 * flow... actually re-linking is by owner_user_id, so in practice this
 * means: re-registering creates a NEW profile unless done manually. Fine
 * for this project (confirmed with the user: no real users yet).
 */
const MIGRATION_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'participants_owner_user_id_fkey') THEN
    ALTER TABLE participants DROP CONSTRAINT participants_owner_user_id_fkey;
  END IF;
END $$;

-- Dropea dinamicamente TODAS las policies que dependan de is_admin(),
-- sea cual sea su nombre o tabla exacta. Un DROP POLICY IF EXISTS con
-- nombres hardcodeados es fragil (fallo en produccion: el error solo
-- listaba "Escritura protegida" en matches, pero versiones previas de
-- este schema pudieron haber creado policies con otros nombres) asi que
-- en vez de adivinar nombres, se consulta pg_policy + pg_depend por
-- cualquier policy cuya qual/with_check dependa de la funcion is_admin,
-- y se dropea cada una encontrada antes de tocar la funcion. Reemplaza el
-- listado explicito de antes; sigue sin usar DROP FUNCTION ... CASCADE
-- directo, que dropearia silenciosamente cualquier tipo de objeto
-- dependiente sin loguear cual.
DO $$
DECLARE
  dep RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin') THEN
    FOR dep IN
      SELECT DISTINCT pol.polname AS policy_name, cls.relname AS table_name
      FROM pg_depend d
      JOIN pg_proc p ON p.oid = d.refobjid AND p.proname = 'is_admin'
      JOIN pg_policy pol ON pol.oid = d.objid AND d.classid = 'pg_policy'::regclass
      JOIN pg_class cls ON cls.oid = pol.polrelid
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', dep.policy_name, dep.table_name);
    END LOOP;
  END IF;
END $$;

DROP FUNCTION IF EXISTS verify_panel_passphrase(TEXT);
DROP FUNCTION IF EXISTS is_admin();
DROP TABLE IF EXISTS panel_secret;
DROP TABLE IF EXISTS admins;

UPDATE participants SET owner_user_id = NULL
WHERE owner_user_id IS NOT NULL
  AND owner_user_id NOT IN (SELECT id FROM participant_users);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participants_owner_user_id_fkey'
  ) THEN
    ALTER TABLE participants
      ADD CONSTRAINT participants_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES participant_users(id) ON DELETE CASCADE;
  END IF;
END $$;
`;

/**
 * Opt-in hard reset of DATA (not schema) for the NEW auth tables, for when
 * you want to wipe test accounts/sessions/participants created while
 * building against the current schema — separate from MIGRATION_SQL, which
 * only ever cleans up the OLD pre-migration schema (drops admins/
 * panel_secret) and runs unconditionally every time since that's just
 * removing dead objects, never live data.
 *
 * This one deletes real rows, so it's gated behind two independent
 * confirmations (see main()): the --reset-data CLI flag AND
 * CONFIRM_RESET_DATA=yes in the environment. Either alone is not enough —
 * a stray flag in a copy-pasted command shouldn't be able to wipe a
 * production roster by itself.
 *
 * sessions cascades from participant_users (ON DELETE CASCADE), so
 * deleting participant_users alone would already drop sessions — it's
 * listed explicitly anyway so the order and intent are obvious from
 * reading the SQL, not from remembering an FK's ON DELETE behavior.
 * participants.owner_user_id also cascades from participant_users, so
 * wiping participant_users deletes every participants row too — that's
 * the point of a full reset, not a bug.
 */
const RESET_DATA_SQL = `
DELETE FROM sessions;
DELETE FROM participants;
DELETE FROM participant_users;
`;

interface SupabaseApiKeyEntry {
  api_key: string;
  id: string;
  type: "legacy" | "publishable" | "secret";
  name?: string;
  prefix?: string;
}

type SupabaseApiKeysResponse = SupabaseApiKeyEntry[];

interface SupabaseProjectResponse {
  id: string;
  endpoint?: string;
  ref: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

/**
 * Accepts either a bare project ref or a full project URL
 * (https://<ref>.supabase.co) and always returns the bare ref.
 * The Management API rejects anything else with a confusing 404.
 */
function normalizeProjectRef(rawRef: string): string {
  const urlMatch = rawRef.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  const ref = urlMatch ? urlMatch[1] : rawRef.trim();

  if (!PROJECT_REF_PATTERN.test(ref)) {
    throw new Error(
      `SUPABASE_PROJECT_REF looks invalid: "${rawRef}". ` +
        `Expected a 20-char project ref (e.g. kquoixkswgmzasqygdqw), not a full URL or dashboard link.`
    );
  }

  return ref;
}

async function runQuery(projectRef: string, accessToken: string, query: string): Promise<void> {
  const response = await fetch(
    `${MANAGEMENT_API_BASE}/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase query failed (${response.status}): ${body}`);
  }
}

async function fetchApiKeys(
  projectRef: string,
  accessToken: string
): Promise<{ anonKey: string; serviceRoleKey: string }> {
  const response = await fetch(
    `${MANAGEMENT_API_BASE}/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch API keys (${response.status}): ${body}`);
  }

  const data = (await response.json()) as SupabaseApiKeysResponse;
  const legacyKeys = data.filter((k) => k.type === "legacy");

  const anonKey = legacyKeys.find((k) => k.name === "anon")?.api_key;
  const serviceRoleKey = legacyKeys.find((k) => k.name === "service_role")?.api_key;

  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      `Could not find legacy anon/service_role keys in Supabase API response. ` +
        `Got: ${JSON.stringify(data.map((k) => ({ type: k.type, name: k.name })))}`
    );
  }

  return { anonKey, serviceRoleKey };
}

async function fetchProjectEndpoint(projectRef: string, accessToken: string): Promise<string> {
  const response = await fetch(`${MANAGEMENT_API_BASE}/projects/${projectRef}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch project details (${response.status}): ${body}`);
  }

  const data = (await response.json()) as SupabaseProjectResponse;
  return data.endpoint ?? `https://${data.ref}.supabase.co`;
}

function sqlString(value: string | undefined | null): string {
  if (value === undefined || value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function upsertEnvVar(filePath: string, key: string, value: string): void {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const lines = existing.split("\n").filter((line) => line.trim().length > 0);
  const withoutKey = lines.filter((line) => !line.startsWith(`${key}=`));
  withoutKey.push(`${key}=${value}`);

  writeFileSync(filePath, withoutKey.join("\n") + "\n", "utf-8");
}

function writeEnvFile(
  filePath: string,
  vars: Record<string, string>,
  description: string
): void {
  console.log(`Writing ${description} -> ${filePath}`);
  for (const [key, value] of Object.entries(vars)) {
    upsertEnvVar(filePath, key, value);
  }
}

/**
 * Seeds the participants table from apps/web/src/data/participants.yml
 * so the admin panel has real starting data instead of an empty table.
 * Uses ON CONFLICT DO NOTHING, so it never overwrites edits made from the
 * admin panel on a re-run. Reuses @velada/core's validated YAML parser
 * (falls back to mock data) instead of re-implementing YAML parsing here.
 */
async function seedParticipantsFromYaml(projectRef: string, accessToken: string): Promise<void> {
  const { parseParticipants } = await import(
    resolve(import.meta.dirname, "..", "packages", "core", "utils.ts")
  );
  const yamlPath = resolve(
    import.meta.dirname,
    "..",
    "apps",
    "web",
    "src",
    "data",
    "participants.yml"
  );

  if (!existsSync(yamlPath)) {
    console.log("  participants.yml no encontrado, se omite el seed inicial.");
    return;
  }

  const raw = parseParticipants(readFileSync(yamlPath, "utf-8"));
  if (!raw || raw.length === 0) {
    console.log("  participants.yml vacio, se omite el seed inicial.");
    return;
  }

  const values = raw
    .map((p) => {
      const stats = p.stats ? sqlString(JSON.stringify(p.stats)) + "::jsonb" : "NULL";
      return `(${sqlString(p.id)}, ${sqlString(p.name)}, ${sqlString(p.nickname)}, ${sqlString(p.photo)}, ${sqlString(p.banner)}, ${p.age ?? "NULL"}, ${sqlString(p.weight)}, ${sqlString(p.height)}, ${sqlString(p.lolRank)}, ${sqlString(p.lolUsername)}, ${sqlString(p.lolServer)}, ${sqlString(p.mainRole)}, ${sqlString(p.favChampion)}, ${sqlString(p.description)}, ${stats})`;
    })
    .join(",\n");

  const insertSql = `
INSERT INTO participants (id, name, nickname, photo, banner, age, weight, height, lol_rank, lol_username, lol_server, main_role, fav_champion, description, stats)
VALUES
${values}
ON CONFLICT (id) DO NOTHING;
`;

  await runQuery(projectRef, accessToken, insertSql);
  console.log(`  ${raw.length} participantes sembrados (o ya existian).`);
}

async function main() {
  console.log("Configurando Supabase (tablas, Realtime, Storage)...");

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = normalizeProjectRef(requireEnv("SUPABASE_PROJECT_REF"));

  // Doble confirmacion a proposito: el flag CLI solo (copiado sin pensar de
  // otro comando) o la env var sola (dejada en un .env compartido) no
  // alcanzan por separado para borrar cuentas/participantes reales.
  const wantsReset = process.argv.includes("--reset-data");
  const confirmedReset = process.env.CONFIRM_RESET_DATA === "yes";
  const willReset = wantsReset && confirmedReset;
  if (wantsReset && !confirmedReset) {
    throw new Error(
      "--reset-data pedido pero falta la confirmacion. Corre con " +
        "CONFIRM_RESET_DATA=yes bun run scripts/setup-supabase.ts --reset-data " +
        "(las dos cosas a la vez, a proposito, para que no se dispare por accidente)."
    );
  }

  const totalSteps = willReset ? 7 : 6;
  let step = 1;

  console.log(`${step++}/${totalSteps} Ejecutando DDL (tablas, publicaciones realtime, bucket)...`);
  await runQuery(projectRef, accessToken, SETUP_SQL);

  console.log(`${step++}/${totalSteps} Migrando proyectos que tenian el schema viejo (Supabase Auth)...`);
  await runQuery(projectRef, accessToken, MIGRATION_SQL);

  if (willReset) {
    console.log(`${step++}/${totalSteps} --reset-data confirmado: borrando participant_users/sessions/participants...`);
    await runQuery(projectRef, accessToken, RESET_DATA_SQL);
    console.log("  Listo. Las tablas de auth/participantes quedaron vacias.");
  }

  console.log(`${step++}/${totalSteps} Obteniendo API keys y endpoint del proyecto...`);
  const [{ anonKey, serviceRoleKey }, endpoint] = await Promise.all([
    fetchApiKeys(projectRef, accessToken),
    fetchProjectEndpoint(projectRef, accessToken)
  ]);

  console.log(`${step++}/${totalSteps} Escribiendo variables de entorno...`);
  const rootEnvPath = resolve(import.meta.dirname, "..", ".env");
  const webEnvPath = resolve(import.meta.dirname, "..", "apps", "web", ".env");

  const publicVars = {
    PUBLIC_SUPABASE_URL: endpoint,
    PUBLIC_SUPABASE_ANON_KEY: anonKey
  };

  // apps/web/.env necesita las mismas server-only vars que el root .env:
  // Astro SSR (bun run dev / el build) corre con cwd en apps/web/, asi
  // que import.meta.env ahi solo ve apps/web/.env, no el .env de la raiz.
  // Sin esto, checkEmailExists/saveOwnParticipant/saveParticipant/
  // deleteParticipant/fetchRiotRank/verifyPassphrase fallan en local con
  // "Supabase no configurado" o "RIOT_API_KEY no configurada" aunque el
  // root .env este completo.
  const serverOnlyVars: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey };
  if (process.env.PANEL_PASSPHRASE) serverOnlyVars.PANEL_PASSPHRASE = process.env.PANEL_PASSPHRASE;
  if (process.env.ADMIN_EMAILS) serverOnlyVars.ADMIN_EMAILS = process.env.ADMIN_EMAILS;

  writeEnvFile(rootEnvPath, { ...publicVars, ...serverOnlyVars }, "root .env");
  writeEnvFile(webEnvPath, { ...publicVars, ...serverOnlyVars }, "apps/web/.env");

  console.log(`${step++}/${totalSteps} Sembrando participantes desde participants.yml...`);
  await seedParticipantsFromYaml(projectRef, accessToken);

  if (!process.env.ADMIN_EMAILS) {
    console.log(
      "\nADMIN_EMAILS no definido en .env. Agrega ADMIN_EMAILS=tu@email.com,amigo@email.com" +
        " (sin invitacion ni email: estos emails simplemente pueden loguearse sin contrasena" +
        " en /panel-login, la lista se lee en runtime desde el Worker) y volve a correr este script."
    );
  }
  if (!process.env.PANEL_PASSPHRASE) {
    console.log(
      "PANEL_PASSPHRASE no definido en .env. Agregalo (una frase larga y unica, no la compartas" +
        " en chats ni la pegues en ningun lado publico) para que el panel pida esa clave" +
        " despues del login de un admin."
    );
  }
  if (!willReset) {
    console.log(
      "\nTip: si necesitas vaciar cuentas/participantes de prueba de las tablas nuevas" +
        " (participant_users, sessions, participants), corre este mismo script con" +
        " CONFIRM_RESET_DATA=yes bun run scripts/setup-supabase.ts --reset-data"
    );
  }

  console.log("\nListo. Supabase configurado y variables de entorno generadas.");
}

main().catch((error) => {
  console.error("Error configurando Supabase:", error.message ?? error);
  process.exitCode = 1;
});
