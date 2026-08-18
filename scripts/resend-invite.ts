/**
 * Regenera el link de invitacion para un admin que ya fue invitado
 * previamente (ej. el link original quedo apuntando a una URL vieja/rota,
 * o expiro antes de que lo usaran).
 *
 * A diferencia de reinvitar via /auth/v1/invite (que falla con 422 para
 * usuarios existentes y ademas cuenta contra el rate limit de emails de
 * Supabase), esto usa el endpoint admin/generate_link, que:
 *  - No dispara el envio automatico de email de Supabase.
 *  - Devuelve el action_link directamente en la consola, para que lo
 *    mandes tu mismo por WhatsApp/Discord/lo que uses.
 *  - Usa SITE_URL del .env para armar el redirect_to a /panel-login.
 *
 * Uso:
 *   bun run scripts/resend-invite.ts amigo@email.com
 */

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function normalizeProjectRef(rawRef: string): string {
  const urlMatch = rawRef.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  const ref = urlMatch ? urlMatch[1] : rawRef.trim();

  if (!PROJECT_REF_PATTERN.test(ref)) {
    throw new Error(
      `SUPABASE_PROJECT_REF looks invalid: "${rawRef}". ` +
        `Expected a 20-char project ref, not a full URL or dashboard link.`
    );
  }

  return ref;
}

async function fetchProjectEndpoint(projectRef: string, accessToken: string): Promise<string> {
  const response = await fetch(`${MANAGEMENT_API_BASE}/projects/${projectRef}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch project details (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { endpoint?: string; ref: string };
  return data.endpoint ?? `https://${data.ref}.supabase.co`;
}

async function fetchServiceRoleKey(projectRef: string, accessToken: string): Promise<string> {
  const response = await fetch(
    `${MANAGEMENT_API_BASE}/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch API keys (${response.status}): ${body}`);
  }

  const data = (await response.json()) as Array<{ type: string; name?: string; api_key: string }>;
  const serviceRoleKey = data.find((k) => k.type === "legacy" && k.name === "service_role")?.api_key;

  if (!serviceRoleKey) {
    throw new Error("No se encontro la service_role key en la respuesta de Supabase.");
  }

  return serviceRoleKey;
}

interface GenerateLinkResponse {
  action_link?: string;
  properties?: { action_link?: string };
}

async function generateInviteLink(
  endpoint: string,
  serviceRoleKey: string,
  email: string,
  redirectTo: string | undefined
): Promise<string> {
  const response = await fetch(`${endpoint}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "invite",
      email,
      ...(redirectTo ? { options: { redirect_to: redirectTo } } : {})
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Fallo al generar el link para ${email} (${response.status}): ${body}`);
  }

  const data = (await response.json()) as GenerateLinkResponse;
  const link = data.action_link ?? data.properties?.action_link;

  if (!link) {
    throw new Error(`Supabase no devolvio action_link para ${email}. Respuesta: ${JSON.stringify(data)}`);
  }

  return link;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: bun run scripts/resend-invite.ts <email>");
    process.exitCode = 1;
    return;
  }

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = normalizeProjectRef(requireEnv("SUPABASE_PROJECT_REF"));
  const siteUrl = process.env.SITE_URL;

  if (!siteUrl) {
    console.log(
      "  SITE_URL no definido en .env, el link generado no incluira redirect_to explicito" +
        " (usara el Site URL configurado en el dashboard de Supabase)."
    );
  }

  const redirectTo = siteUrl ? `${siteUrl.replace(/\/$/, "")}/panel-login` : undefined;

  console.log(`Generando link de invitacion para ${email}...`);
  const [endpoint, serviceRoleKey] = await Promise.all([
    fetchProjectEndpoint(projectRef, accessToken),
    fetchServiceRoleKey(projectRef, accessToken)
  ]);

  const link = await generateInviteLink(endpoint, serviceRoleKey, email, redirectTo);

  console.log("\nListo. Este link es de un solo uso, mandaselo directamente a la persona:\n");
  console.log(link);
  console.log("\nNo pasa por el sistema de emails de Supabase, asi que no cuenta contra el rate limit.");
}

main().catch((error) => {
  console.error("Error generando el link:", error.message ?? error);
  process.exitCode = 1;
});
