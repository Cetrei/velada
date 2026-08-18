/**
 * DEPRECATED: este script generaba magic links de Supabase Auth
 * (auth.users, admin/generate_link) para reenviar invitaciones de admin.
 * Ya no aplica — el sistema de auth se migro a tablas propias
 * (participant_users/sessions, ver AGENT.md "Sistema de auth del panel") y
 * el acceso de admin ahora es ADMIN_EMAILS (env) + login por email sin
 * password + PANEL_PASSPHRASE, sin invitaciones ni magic links de ningun
 * tipo. Para dar acceso de admin a alguien nuevo, agrega su email a
 * ADMIN_EMAILS en .env (separado por coma) y corre
 * `bun run setup:cf-secrets` para propagarlo al Worker — no hace falta
 * ningun link ni email.
 *
 * Dejado como stub (en vez de borrado) porque sigue referenciado en
 * package.json (`bun run resend-invite`) y el filesystem MCP no expone
 * delete; borrar este archivo y el script de package.json a mano cuando
 * se pueda.
 */
console.error(
  "resend-invite ya no aplica: el panel no usa magic links ni invitaciones " +
    "desde la migracion a auth propia. Agrega el email a ADMIN_EMAILS en " +
    ".env y corre `bun run setup:cf-secrets` para darle acceso de admin."
);
process.exitCode = 1;

