/**
 * Diagnostico: compara el user_id real en auth.users contra lo que hay en
 * la tabla admins, para los emails dados. Util cuando alguien recibe
 * "Tu cuenta no tiene acceso al panel" despues de loguearse bien.
 *
 * Uso:
 *   bun run scripts/check-admin.ts email1@x.com email2@x.com
 */

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function runQuery(projectRef: string, accessToken: string, query: string): Promise<unknown> {
  const response = await fetch(`${MANAGEMENT_API_BASE}/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase query failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function main() {
  const emails = process.argv.slice(2);
  if (emails.length === 0) {
    console.error("Uso: bun run scripts/check-admin.ts email1@x.com email2@x.com");
    process.exitCode = 1;
    return;
  }

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = requireEnv("SUPABASE_PROJECT_REF");

  const emailList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
  const query = `
    SELECT u.id AS auth_user_id, u.email, u.confirmed_at, a.user_id AS admin_row_user_id
    FROM auth.users u
    LEFT JOIN admins a ON a.user_id = u.id
    WHERE u.email IN (${emailList});
  `;

  const rlsQuery = `
    SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
    FROM pg_policy
    WHERE polrelid = 'public.admins'::regclass;
  `;

  const funcQuery = `
    SELECT proname, prosecdef AS is_security_definer
    FROM pg_proc
    WHERE proname = 'is_admin';
  `;

  const result = await runQuery(projectRef, accessToken, query);
  console.log("admins vs auth.users:");
  console.log(JSON.stringify(result, null, 2));

  const rlsResult = await runQuery(projectRef, accessToken, rlsQuery);
  console.log("\npolicies on admins:");
  console.log(JSON.stringify(rlsResult, null, 2));

  const funcResult = await runQuery(projectRef, accessToken, funcQuery);
  console.log("\nis_admin() definition:");
  console.log(JSON.stringify(funcResult, null, 2));
}

main().catch((error) => {
  console.error("Error:", error.message ?? error);
  process.exitCode = 1;
});
