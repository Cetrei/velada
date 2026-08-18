/**
 * Regenera el link de acceso para un admin ya invitado previamente (ej. el
 * link original quedo apuntando a una URL vieja/rota, o expiro antes de que
 * lo usaran). Tambien funciona si el email nunca fue invitado.
 *
 * A diferencia de /auth/v1/invite o generate_link con type "invite" (que
 * fallan con 422 email_exists para cualquier usuario que ya este en
 * auth.users, incluyendo admins invitados que nunca aceptaron), este script
 * intenta primero "invite" (para emails nuevos) y si Supabase responde
 * email_exists cae automaticamente a type "magiclink" (funciona sobre
 * usuarios existentes, confirmados o no). Ninguno de los dos tipos dispara
 * el envio automatico de email de Supabase cuando se usa generate_link en
 * vez de signInWithOtp/invite normal - el link se devuelve directo en la
 * consola para que lo mandes tu mismo por WhatsApp/Discord/lo que uses.
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
  hashed_token?: string;
  properties?: { action_link?: string; hashed_token?: string };
}

interface GenerateLinkErrorBody {
  error_code?: string;
  code?: number;
  msg?: string;
}

/**
 * Generates a link for an existing or new user, without triggering
 * Supabase's automatic email send.
 *
 * type "invite" only works for users that do NOT exist yet (it creates
 * them) - Supabase rejects it with 422 email_exists for anyone already in
 * auth.users, including admins invited before but who never accepted. For
 * those, "magiclink" is the right type: it works on existing users
 * (confirmed or not) and still returns action_link directly instead of
 * emailing it. So: try invite first (covers brand-new admins), and on
 * email_exists fall back to magiclink (covers already-invited admins).
 *
 * IMPORTANT: we never return generate_link's own action_link/redirect_to
 * as-is. Supabase has a known bug (supabase/auth#1738) where
 * generate_link's response ignores the redirect_to we pass and falls back
 * to Site URL for existing users - the action_link comes back pointing at
 * the bare Site URL even though we asked for /panel-login. But the
 * /auth/v1/verify endpoint itself reads redirect_to from the actual query
 * string of the request the user's browser makes when they click the link
 * - not from anything baked into generate_link's response - so we rebuild
 * the verify URL ourselves from hashed_token and stick our redirectTo on
 * it directly. This sidesteps the bug entirely instead of waiting on
 * Supabase to fix it.
 */
async function generateLink(
  endpoint: string,
  serviceRoleKey: string,
  email: string,
  redirectTo: string | undefined
): Promise<{ link: string; type: "invite" | "magiclink" }> {
  const requestLink = async (type: "invite" | "magiclink") => {
    const response = await fetch(`${endpoint}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type,
        email,
        ...(redirectTo ? { options: { redirect_to: redirectTo } } : {})
      })
    });
    return response;
  };

  const buildVerifyUrl = (data: GenerateLinkResponse, type: "invite" | "magiclink"): string => {
    const hashedToken = data.hashed_token ?? data.properties?.hashed_token;
    if (!hashedToken) {
      throw new Error(
        `Supabase no devolvio hashed_token para ${email}. Respuesta: ${JSON.stringify(data)}`
      );
    }

    const verifyUrl = new URL(`${endpoint}/auth/v1/verify`);
    verifyUrl.searchParams.set("token", hashedToken);
    verifyUrl.searchParams.set("type", type === "invite" ? "invite" : "magiclink");
    if (redirectTo) verifyUrl.searchParams.set("redirect_to", redirectTo);
    return verifyUrl.toString();
  };

  const inviteResponse = await requestLink("invite");

  if (inviteResponse.ok) {
    const data = (await inviteResponse.json()) as GenerateLinkResponse;
    return { link: buildVerifyUrl(data, "invite"), type: "invite" };
  }

  const inviteErrorBody = (await inviteResponse.json().catch(() => null)) as GenerateLinkErrorBody | null;
  const isExistingUser = inviteResponse.status === 422 && inviteErrorBody?.error_code === "email_exists";

  if (!isExistingUser) {
    throw new Error(
      `Fallo al generar el link para ${email} (${inviteResponse.status}): ${JSON.stringify(inviteErrorBody)}`
    );
  }

  console.log(`  ${email} ya tiene cuenta (invitado previamente), generando magic link en su lugar...`);
  const magicLinkResponse = await requestLink("magiclink");

  if (!magicLinkResponse.ok) {
    const body = await magicLinkResponse.text();
    throw new Error(`Fallo al generar magic link para ${email} (${magicLinkResponse.status}): ${body}`);
  }

  const magicLinkData = (await magicLinkResponse.json()) as GenerateLinkResponse;
  return { link: buildVerifyUrl(magicLinkData, "magiclink"), type: "magiclink" };
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

  const { link, type } = await generateLink(endpoint, serviceRoleKey, email, redirectTo);

  console.log(`\nListo (link tipo "${type}"). Este link es de un solo uso, mandaselo directamente a la persona:\n`);
  console.log(link);
  console.log("\nNo paso por el sistema de emails de Supabase, asi que no cuenta contra el rate limit.");
}

main().catch((error) => {
  console.error("Error generando el link:", error.message ?? error);
  process.exitCode = 1;
});
