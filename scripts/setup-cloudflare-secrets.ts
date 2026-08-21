import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const GITHUB_ACTIONS_SECRETS = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

// Estas NO van como GitHub Actions secret (no se usan en build time) - van
// directo al Worker desplegado via `wrangler secret put`, porque
// createSupabaseAdminClient() y el login/passphrase de admin (isAdminEmail,
// verifyPassphrase) las leen en runtime via getServerEnv/locals.runtime.env
// dentro del handler de una Action, no al compilar. Si faltan, cualquier
// Action que use el admin client (saveParticipant, deleteParticipant,
// subida de fotos) falla en producción con "Supabase admin no
// configurado.", y sin ADMIN_EMAILS/PANEL_PASSPHRASE el login de admin y
// el gate del panel fallan tambien, aunque el build haya sido exitoso.
// RIOT_API_KEY ya NO hace falta: el lookup de rango scrapea mmradar.gg
// (packages/core/mmradarScraper.ts), no llama a la Riot API.
const WORKER_RUNTIME_SECRETS = ["SUPABASE_SERVICE_ROLE_KEY", "PANEL_PASSPHRASE", "ADMIN_EMAILS"] as const;

function parseEnvFile(path: string): Record<string, string> {
  const raw = readFileSync(path, "utf-8");
  const env: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

function ensureGhCli(): void {
  const check = spawnSync("gh", ["--version"], { stdio: "ignore" });
  if (check.status !== 0) {
    console.error(
      "gh CLI no encontrado. Instalalo (https://cli.github.com) y corre " +
        "`gh auth login` antes de usar este script."
    );
    process.exit(1);
  }

  const authCheck = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
  if (authCheck.status !== 0) {
    console.error("gh CLI no autenticado. Corre `gh auth login` primero.");
    process.exit(1);
  }
}

function setGithubSecret(name: string, value: string): void {
  const result = spawnSync("gh", ["secret", "set", name, "--body", value], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`Fallo al setear ${name}:`, result.stderr.trim());
    process.exit(1);
  }

  console.log(`✓ ${name} configurado en GitHub Actions secrets`);
}

function ensureWranglerCli(cwd: string): void {
  const check = spawnSync("bunx", ["wrangler", "--version"], { stdio: "inherit", cwd });
  if (check.status !== 0) {
    console.error("wrangler no disponible via bunx. Corre `bun install` en apps/web primero.");
    process.exit(1);
  }
}

function setWorkerSecret(name: string, value: string, cwd: string): void {
  const result = spawnSync("bunx", ["wrangler", "secret", "put", name], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf-8",
    cwd
  });

  if (result.status !== 0) {
    console.error(`Fallo al setear ${name} en el Worker.`);
    process.exit(1);
  }

  console.log(`✓ ${name} configurado como secret del Worker (velada-lol)`);
}

/**
 * PUBLIC_SUPABASE_URL como var de Worker (texto plano en wrangler.toml, no
 * secret -- ver el comentario largo en [vars] de apps/web/wrangler.toml):
 * src/worker.ts (handler `scheduled` del cron de refresh de mmradar) corre
 * fuera del bundle de Astro y necesita leerla de env.PUBLIC_SUPABASE_URL en
 * runtime, no de import.meta.env (que solo existe inlineado en el codigo
 * compilado de Astro). `wrangler secret put` no sirve para esto (esta
 * pensado para valores sensibles, no aparece en `[vars]` ni es legible al
 * editar el archivo despues) -- la forma correcta para una var no sensible
 * es escribirla directo en wrangler.toml, asi queda versionable/visible
 * como cualquier otra config. Reemplaza la linea
 * `PUBLIC_SUPABASE_URL = "..."` existente (dejada vacia por defecto en el
 * archivo) por el valor real leido del .env de la raiz.
 */
function patchWranglerTomlPublicSupabaseUrl(url: string, webDir: string): void {
  const wranglerTomlPath = resolve(webDir, "wrangler.toml");
  const raw = readFileSync(wranglerTomlPath, "utf-8");
  const pattern = /^PUBLIC_SUPABASE_URL = ".*"$/m;

  if (!pattern.test(raw)) {
    console.warn(
      `No se encontro una linea 'PUBLIC_SUPABASE_URL = "..."' en ${wranglerTomlPath} bajo [vars] -- ` +
        "se salta este paso. Si el cron de refresh (src/worker.ts) falla con " +
        "'PUBLIC_SUPABASE_URL no configurado', agregala a mano ahi."
    );
    return;
  }

  const patched = raw.replace(pattern, `PUBLIC_SUPABASE_URL = "${url}"`);
  writeFileSync(wranglerTomlPath, patched, "utf-8");
  console.log(`✓ PUBLIC_SUPABASE_URL escrita en ${wranglerTomlPath} ([vars], texto plano)`);
}

function main(): void {
  const rootEnvPath = resolve(import.meta.dir, "..", ".env");
  if (!existsSync(rootEnvPath)) {
    console.error(`No existe ${rootEnvPath}. Copia .env.example primero.`);
    process.exit(1);
  }

  const env = parseEnvFile(rootEnvPath);
  const missingGithub = GITHUB_ACTIONS_SECRETS.filter((key) => !env[key]);
  const missingWorker = WORKER_RUNTIME_SECRETS.filter((key) => !env[key]);
  const missing = [...missingGithub, ...missingWorker];
  if (missing.length > 0) {
    console.error(`Faltan variables en .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  ensureGhCli();

  console.log("Configurando GitHub Actions secrets para el workflow de deploy...\n");
  for (const key of GITHUB_ACTIONS_SECRETS) {
    setGithubSecret(key, env[key]!);
  }

  const webDir = resolve(import.meta.dir, "..", "apps", "web");
  ensureWranglerCli(webDir);

  console.log("\nConfigurando secrets del Worker (runtime, via wrangler)...\n");
  for (const key of WORKER_RUNTIME_SECRETS) {
    setWorkerSecret(key, env[key]!, webDir);
  }

  console.log("\nConfigurando PUBLIC_SUPABASE_URL como var de Worker (wrangler.toml)...\n");
  patchWranglerTomlPublicSupabaseUrl(env.PUBLIC_SUPABASE_URL!, webDir);

  console.log(
    "\nListo. El workflow .github/workflows/deploy.yml ya puede leer estos" +
      " secrets en el proximo push a main o release, el Worker ya tiene" +
      " SUPABASE_SERVICE_ROLE_KEY / PANEL_PASSPHRASE / ADMIN_EMAILS" +
      " disponibles en runtime, y apps/web/wrangler.toml ya tiene" +
      " PUBLIC_SUPABASE_URL escrita para que el cron de refresh de mmradar" +
      " (src/worker.ts) pueda usarla."
  );
  console.log(
    "Nota: PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY para el codigo de" +
      " Astro/las Actions se inyectan en build time (Astro las incrusta al" +
      " compilar), por eso van como GitHub secret. PUBLIC_SUPABASE_URL" +
      " ADEMAS se escribe en texto plano en apps/web/wrangler.toml ([vars])" +
      " porque src/worker.ts (el handler scheduled del cron) corre fuera" +
      " del bundle de Astro y no tiene import.meta.env -- no es sensible," +
      " por eso no usa wrangler secret put. El resto (SUPABASE_SERVICE_ROLE_KEY," +
      " PANEL_PASSPHRASE, ADMIN_EMAILS) se lee en runtime via" +
      " locals.runtime.env / env directo, por eso van a `wrangler secret put`" +
      " en vez de a GitHub Actions o a wrangler.toml en texto plano."
  );
  console.log(
    "\nRecorda hacer commit + push de apps/web/wrangler.toml (PUBLIC_SUPABASE_URL" +
      " quedo escrita ahi, no es un secret pero si config real del deploy) y de" +
      " apps/web/src/worker.ts si todavia no estan en el repo."
  );
}

main();
