export async function onRequestGet({ request, env }) {
  // Try Cloudflare env var first, then fall back to KV config (set via admin panel)
  let clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId && env.SITE_CONFIG_KV) {
    const cfg = await env.SITE_CONFIG_KV.get("site_config", "json").catch(() => null);
    clientId = cfg?.googleClientId || "";
  }

  if (!clientId) {
    return new Response(
      "Google Client ID not configured. Add it in the admin panel (Configuración → Google OAuth) or set GOOGLE_CLIENT_ID in Cloudflare environment variables.",
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const origin = env.SITE_URL || url.origin;
  const lang = cleanLang(url.searchParams.get("lang"));
  const returnTo = cleanReturnPath(url.searchParams.get("return") || "/portal.html");
  const state = crypto.randomUUID();

  await env.SITE_CONFIG_KV.put(
    `oauth-state:${state}`,
    JSON.stringify({ lang, returnTo, clientId }),
    { expirationTtl: 600 }
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account"
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

function cleanLang(value) {
  return ["en", "es", "pt", "ar"].includes(value) ? value : "en";
}

function cleanReturnPath(value) {
  const path = String(value || "/portal.html");
  if (!path.startsWith("/") || path.startsWith("//")) return "/portal.html";
  return path.slice(0, 120);
}
