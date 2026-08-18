import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_SECRETS = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

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

function main(): void {
  const rootEnvPath = resolve(import.meta.dir, "..", ".env");
  if (!existsSync(rootEnvPath)) {
    console.error(`No existe ${rootEnvPath}. Copia .env.example primero.`);
    process.exit(1);
  }

  const env = parseEnvFile(rootEnvPath);
  const missing = REQUIRED_SECRETS.filter((key) => !env[key]);
  if (missing.length > 0) {
    console.error(`Faltan variables en .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  ensureGhCli();

  console.log("Configurando GitHub Actions secrets para el workflow de deploy...\n");
  for (const key of REQUIRED_SECRETS) {
    setGithubSecret(key, env[key]!);
  }

  console.log(
    "\nListo. El workflow .github/workflows/deploy.yml ya puede leer estos" +
      " secrets en el proximo push a main o release."
  );
  console.log(
    "Nota: PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY se inyectan en" +
      " build time (Astro las incrusta al compilar), por eso van como" +
      " GitHub secret y no como `wrangler secret put` en el Worker."
  );
}

main();
