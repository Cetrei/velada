import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";

const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS event_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  start_time TIMESTAMPTZ NOT NULL,
  roulette_unlocked BOOLEAN DEFAULT FALSE,
  current_phase TEXT DEFAULT 'COUNTDOWN',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id TEXT NOT NULL,
  player2_id TEXT NOT NULL,
  winner_id TEXT DEFAULT NULL,
  is_random BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  photo TEXT,
  banner TEXT,
  age INTEGER,
  weight TEXT,
  height TEXT,
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

CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS panel_secret (
  id TEXT PRIMARY KEY DEFAULT 'main',
  passphrase_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
END $$;

ALTER TABLE event_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE panel_secret ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION verify_panel_passphrase(input TEXT) RETURNS BOOLEAN AS $$
  SELECT passphrase_hash = crypt(input, passphrase_hash)
  FROM panel_secret WHERE id = 'main';
$$ LANGUAGE sql SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION verify_panel_passphrase(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_panel_passphrase(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Lectura publica de event_state" ON event_state;
CREATE POLICY "Lectura publica de event_state" ON event_state FOR SELECT USING (true);

DROP POLICY IF EXISTS "Lectura publica de matches" ON matches;
CREATE POLICY "Lectura publica de matches" ON matches FOR SELECT USING (true);

DROP POLICY IF EXISTS "Lectura publica de participants" ON participants;
CREATE POLICY "Lectura publica de participants" ON participants FOR SELECT USING (true);

DROP POLICY IF EXISTS "Escritura protegida event_state" ON event_state;
CREATE POLICY "Escritura protegida event_state" ON event_state FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Escritura protegida matches" ON matches;
CREATE POLICY "Escritura protegida matches" ON matches FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Escritura admin de participants" ON participants;
CREATE POLICY "Escritura admin de participants" ON participants FOR ALL USING (is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Solo admins ven la tabla admins" ON admins;
CREATE POLICY "Solo admins ven la tabla admins" ON admins FOR SELECT USING (is_admin() OR auth.role() = 'service_role');

INSERT INTO storage.buckets (id, name, public)
VALUES ('participant-photos', 'participant-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Lectura publica de fotos" ON storage.objects;
CREATE POLICY "Lectura publica de fotos" ON storage.objects FOR SELECT
  USING (bucket_id = 'participant-photos');

DROP POLICY IF EXISTS "Escritura admin de fotos" ON storage.objects;
CREATE POLICY "Escritura admin de fotos" ON storage.objects FOR ALL
  USING (bucket_id = 'participant-photos' AND (is_admin() OR auth.role() = 'service_role'));

INSERT INTO event_state (id, start_time, roulette_unlocked, current_phase)
VALUES ('main', NOW() + INTERVAL '7 days', FALSE, 'COUNTDOWN')
ON CONFLICT (id) DO NOTHING;
`;

function buildPanelSecretSql(passphrase: string): string {
  const escaped = passphrase.replace(/'/g, "''");
  return `
INSERT INTO panel_secret (id, passphrase_hash)
VALUES ('main', crypt('${escaped}', gen_salt('bf')))
ON CONFLICT (id) DO UPDATE SET passphrase_hash = EXCLUDED.passphrase_hash, updated_at = NOW();
`;
}

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

class RateLimitError extends Error {}

interface SupabaseInviteResponse {
  id: string;
  email?: string;
}

/**
 * Invites a user by email via Supabase Auth Admin API and marks them as
 * admin. Idempotent: if the user already exists, looks them up instead of
 * failing, and the admins insert uses ON CONFLICT DO NOTHING.
 * If siteUrl is set, passes redirect_to=<siteUrl>/panel-login so the invite
 * email lands on the deployed app instead of Supabase's default Site URL
 * (which defaults to localhost and 404s in production).
 */
async function inviteAdmin(
  endpoint: string,
  serviceRoleKey: string,
  projectRef: string,
  accessToken: string,
  email: string,
  siteUrl: string | undefined
): Promise<void> {
  const redirectTo = siteUrl ? `${siteUrl.replace(/\/$/, "")}/panel-login` : undefined;

  const inviteResponse = await fetch(
    `${endpoint}/auth/v1/invite${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ""}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    }
  );

  let userId: string;

  if (inviteResponse.ok) {
    const data = (await inviteResponse.json()) as SupabaseInviteResponse;
    userId = data.id;
  } else if (inviteResponse.status === 422) {
    console.log(`  ${email} ya tiene cuenta, buscando su user_id existente...`);
    const listResponse = await fetch(
      `${endpoint}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    if (!listResponse.ok) {
      throw new Error(`No se pudo buscar el usuario existente ${email}: ${await listResponse.text()}`);
    }
    const listData = (await listResponse.json()) as { users: SupabaseInviteResponse[] };
    const existing = listData.users.find((u) => u.email === email);
    if (!existing) {
      throw new Error(`${email} devolvio 422 pero no se encontro en la lista de usuarios`);
    }
    userId = existing.id;
  } else if (inviteResponse.status === 429) {
    throw new RateLimitError(
      `Rate limit de emails alcanzado al invitar a ${email}. ` +
        `Supabase Auth (SMTP por defecto) permite muy pocos correos por hora. ` +
        `Espera unos minutos y vuelve a correr "bun run setup:db": los admins ya invitados ` +
        `se detectan como existentes (422) y no se reenvia el correo.`
    );
  } else {
    throw new Error(`Fallo al invitar a ${email} (${inviteResponse.status}): ${await inviteResponse.text()}`);
  }

  await runQuery(
    projectRef,
    accessToken,
    `INSERT INTO admins (user_id) VALUES ('${userId}') ON CONFLICT (user_id) DO NOTHING;`
  );
  console.log(`  ✓ ${email} marcado como admin`);
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
  console.log("Configurando Supabase (tablas, RLS, Realtime, Storage)...");

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = normalizeProjectRef(requireEnv("SUPABASE_PROJECT_REF"));

  console.log("1/6 Ejecutando DDL (tablas, RLS, publicaciones realtime, bucket)...");
  await runQuery(projectRef, accessToken, SETUP_SQL);

  console.log("2/6 Obteniendo API keys y endpoint del proyecto...");
  const [{ anonKey, serviceRoleKey }, endpoint] = await Promise.all([
    fetchApiKeys(projectRef, accessToken),
    fetchProjectEndpoint(projectRef, accessToken)
  ]);

  console.log("3/6 Escribiendo variables de entorno...");
  const rootEnvPath = resolve(import.meta.dirname, "..", ".env");
  const webEnvPath = resolve(import.meta.dirname, "..", "apps", "web", ".env");

  const publicVars = {
    PUBLIC_SUPABASE_URL: endpoint,
    PUBLIC_SUPABASE_ANON_KEY: anonKey
  };

  writeEnvFile(
    rootEnvPath,
    { ...publicVars, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
    "root .env"
  );
  writeEnvFile(webEnvPath, publicVars, "apps/web/.env");

  console.log("4/6 Sembrando participantes desde participants.yml...");
  await seedParticipantsFromYaml(projectRef, accessToken);

  console.log("5/6 Invitando admins (ADMIN_EMAILS en .env, separados por coma)...");
  const adminEmailsRaw = process.env.ADMIN_EMAILS;
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.log(
      "  SITE_URL no definido: el correo de invitacion usara el Site URL configurado" +
        " en el dashboard de Supabase (Authentication > URL Configuration), no /panel-login." +
        " Agrega SITE_URL=https://tu-dominio al .env para fijar el destino explicitamente."
    );
  }
  if (!adminEmailsRaw) {
    console.log(
      "  ADMIN_EMAILS no definido, se omite. Agrega ADMIN_EMAILS=tu@email.com,amigo@email.com" +
        " al .env y vuelve a correr este script para invitar admins al panel."
    );
  } else {
    const emails = adminEmailsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    for (const email of emails) {
      try {
        await inviteAdmin(endpoint, serviceRoleKey, projectRef, accessToken, email, siteUrl);
      } catch (error) {
        if (error instanceof RateLimitError) {
          console.warn(`  ⚠ ${error.message}`);
          console.warn(
            `  Deteniendo invitaciones por rate limit; el resto de emails pendientes no se intentaron. ` +
              `Vuelve a correr "bun run setup:db" mas tarde para invitar a los que falten.`
          );
          break;
        }
        throw error;
      }
    }
  }

  console.log("6/6 Configurando la clave del panel (PANEL_PASSPHRASE en .env)...");
  const panelPassphrase = process.env.PANEL_PASSPHRASE;
  if (!panelPassphrase) {
    console.log(
      "  PANEL_PASSPHRASE no definido, se omite. Agrega PANEL_PASSPHRASE=una-frase-larga" +
        " al .env y vuelve a correr este script para (re)configurar la clave del panel."
    );
  } else {
    await runQuery(projectRef, accessToken, buildPanelSecretSql(panelPassphrase));
    console.log("  Clave del panel configurada.");
  }

  console.log("Listo. Supabase configurado y variables de entorno generadas.");
}

main().catch((error) => {
  console.error("Error configurando Supabase:", error.message ?? error);
  process.exitCode = 1;
});
