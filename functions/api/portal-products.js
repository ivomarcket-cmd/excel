// GET /api/portal-products
// Public: returns all active products WITHOUT downloadUrl
// Verified buyer: returns WITH downloadUrl + isPurchaser:true
// Auth: session cookie OR x-order-email + x-order-id headers

export async function onRequestGet({ request, env }) {
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing KV." }, 500);

  const session = await getSession(request, env);
  let verifiedEmail = null;
  let directOrder = null;

  if (session) {
    verifiedEmail = session.email;
  } else {
    const orderEmail = (request.headers.get("x-order-email") || "").toLowerCase().trim();
    const orderId    = (request.headers.get("x-order-id")    || "").trim();
    if (orderEmail && orderId) {
      const order = await env.SITE_CONFIG_KV.get(`order-${orderId}`, "json");
      if (order && order.email && order.email.toLowerCase() === orderEmail && order.status === "completed") {
        verifiedEmail = orderEmail;
        directOrder = order;
      }
    }
  }

  const access = verifiedEmail ? await getPurchaseAccess(verifiedEmail, env, directOrder) : emptyAccess();
  const isPurchaser = access.main || access.bump || access.upsell;

  // Primary: single consolidated key (1 KV read)
  let raw = await env.SITE_CONFIG_KV.get("products", "json").catch(() => null);

  if (Array.isArray(raw)) {
    raw = raw.filter(p => p && p.id);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    // Fallback: scan legacy product-{id} keys
    const keys = (await listAllKeys(env, "product-"))
      .filter(({ name }) => name !== "product-categories");
    if (keys.length > 0) {
      const results = await Promise.all(
        keys.map(({ name }) => env.SITE_CONFIG_KV.get(name, "json").catch(() => null))
      );
      raw = results.filter(p => p && typeof p === "object" && !Array.isArray(p) && p.id);
      if (raw.length > 0) {
        await env.SITE_CONFIG_KV.put("products", JSON.stringify(raw)).catch(() => {});
      }
    } else {
      raw = [];
    }
  }

  const products = raw
    .filter(p => p && p.active)
    .filter(p => canSeeProduct(p, access))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(p => {
      if (canDownloadProduct(p, access)) return p;
      const { downloadUrl, ...pub } = p;
      return pub;
    });

  const user = session
    ? { name: session.name, email: session.email, picture: session.picture }
    : verifiedEmail ? { email: verifiedEmail } : null;

  return json({ products, user, isPurchaser, access });
}

function emptyAccess() {
  return { main: false, bump: false, upsell: false };
}

async function getPurchaseAccess(email, env, directOrder) {
  const access = emptyAccess();
  applyOrderAccess(access, directOrder);
  const keys = await listAllKeys(env, "order-DP-");
  for (const { name } of keys) {
    const order = await env.SITE_CONFIG_KV.get(name, "json").catch(() => null);
    if (order && order.status === "completed" && order.email && order.email.toLowerCase() === email) {
      applyOrderAccess(access, order);
    }
  }
  return access;
}

function applyOrderAccess(access, order) {
  if (!order || order.status !== "completed") return;
  if (order.checkoutType === "upsell") {
    access.upsell = true;
    return;
  }
  access.main = true;
  if (order.orderBump === true || order.orderBump === "true") access.bump = true;
}

function productAccessLevel(product) {
  const level = String(product?.accessLevel || "main").toLowerCase();
  return ["main", "bump", "upsell"].includes(level) ? level : "main";
}

function canSeeProduct(product, access) {
  const level = productAccessLevel(product);
  if (level === "main") return true;
  return access[level] === true;
}

function canDownloadProduct(product, access) {
  return access[productAccessLevel(product)] === true;
}

async function getSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/digital_session=([^;]+)/);
  if (!match) return null;
  const data = await env.SITE_CONFIG_KV.get(`session:${match[1]}`, "json").catch(() => null);
  if (!data || Date.now() > data.expires) return null;
  return data;
}

async function listAllKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.SITE_CONFIG_KV.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
