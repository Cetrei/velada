import { existsSync, readFileSync } from "node:fs";
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
// RIOT_API_KEY ya NO hace falta: el lookup de rango scrapea LeagueOfGraphs
// (packages/core/rankScraper.ts), no llama a la Riot API.
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

  console.log(
    "\nListo. El workflow .github/workflows/deploy.yml ya puede leer estos" +
      " secrets en el proximo push a main o release, y el Worker ya tiene" +
      " SUPABASE_SERVICE_ROLE_KEY / PANEL_PASSPHRASE / ADMIN_EMAILS" +
      " disponibles en runtime."
  );
  console.log(
    "Nota: PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY se inyectan en" +
      " build time (Astro las incrusta al compilar), por eso van como" +
      " GitHub secret. El resto (SUPABASE_SERVICE_ROLE_KEY, PANEL_PASSPHRASE," +
      " ADMIN_EMAILS) se lee en runtime dentro de las Astro Actions via" +
      " locals.runtime.env, por eso van directo al Worker con" +
      " `wrangler secret put` en vez de a GitHub Actions."
  );
}

main();
