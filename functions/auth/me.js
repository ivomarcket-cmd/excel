export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true, email: session.email, name: session.name, picture: session.picture });
}

async function getSession(request, env) {
  if (!env.SITE_CONFIG_KV) return null;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/digital_session=([^;]+)/);
  if (!match) return null;
  const data = await env.SITE_CONFIG_KV.get(`session:${match[1]}`, "json");
  if (!data || Date.now() > data.expires) return null;
  return data;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
