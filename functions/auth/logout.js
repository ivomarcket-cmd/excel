export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = env.SITE_URL || url.origin;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/digital_session=([^;]+)/);

  if (match && env.SITE_CONFIG_KV) {
    await env.SITE_CONFIG_KV.delete(`session:${match[1]}`).catch(() => {});
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/portal.html`,
      "Set-Cookie": "digital_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    }
  });
}
