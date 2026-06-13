export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = env.SITE_URL || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  let stateData = { lang: "en", returnTo: "/portal.html" };

  if (error || !code) {
    return Response.redirect(`${origin}/portal.html?error=cancelled`, 302);
  }

  // Verify CSRF state
  const stateValid = await env.SITE_CONFIG_KV.get(`oauth-state:${state}`);
  if (!stateValid) {
    return Response.redirect(`${origin}/portal.html?error=invalid_state`, 302);
  }
  await env.SITE_CONFIG_KV.delete(`oauth-state:${state}`);
  try {
    const parsed = JSON.parse(stateValid);
    stateData = {
      lang: cleanLang(parsed.lang),
      returnTo: cleanReturnPath(parsed.returnTo),
      clientId: String(parsed.clientId || "")
    };
  } catch (_) {}

  const clientId = stateData.clientId || await getGoogleClientId(env);
  const redirectTo = (codeName) =>
    `${origin}${stateData.returnTo}?error=${encodeURIComponent(codeName)}&lang=${encodeURIComponent(stateData.lang)}`;

  if (!clientId || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(redirectTo("auth_not_configured"), 302);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/auth/callback`,
      grant_type: "authorization_code"
    })
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    return Response.redirect(redirectTo(mapTokenError(tokens)), 302);
  }

  // Get user info
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const user = await userRes.json();

  if (!user.email) {
    return Response.redirect(redirectTo("no_email"), 302);
  }

  // Create session (7 days)
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  const sessionToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  await env.SITE_CONFIG_KV.put(
    `session:${sessionToken}`,
    JSON.stringify({
      email: user.email.toLowerCase(),
      name: user.name || user.email,
      picture: user.picture || "",
      provider: "google",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    }),
    { expirationTtl: 7 * 24 * 60 * 60 }
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}${stateData.returnTo}?lang=${encodeURIComponent(stateData.lang)}`,
      "Set-Cookie": `digital_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    }
  });
}

function mapTokenError(tokens) {
  const code = String(tokens?.error || "");
  const description = String(tokens?.error_description || "").toLowerCase();
  if (code === "invalid_client") return "google_invalid_client";
  if (description.includes("redirect_uri")) return "google_redirect_mismatch";
  if (code === "invalid_grant") return "google_invalid_grant";
  return "auth_failed";
}

async function getGoogleClientId(env) {
  if (env.GOOGLE_CLIENT_ID) return env.GOOGLE_CLIENT_ID;
  if (!env.SITE_CONFIG_KV) return "";
  const cfg = await env.SITE_CONFIG_KV.get("site_config", "json").catch(() => null);
  return cfg?.googleClientId || "";
}

function cleanLang(value) {
  return ["en", "es", "pt", "ar"].includes(value) ? value : "en";
}

function cleanReturnPath(value) {
  const path = String(value || "/portal.html");
  if (!path.startsWith("/") || path.startsWith("//")) return "/portal.html";
  return path.slice(0, 120);
}
