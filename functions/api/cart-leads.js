export async function onRequestPost({ request, env }) {
  if (!env.SITE_CONFIG_KV) return json({ ok: true });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const name = String(body.name || "").trim().slice(0, 100);
  if (!isEmail(email)) return json({ error: "Email غير صالح." }, 400);

  const key = `cart-lead:${email}`;
  const existing = await env.SITE_CONFIG_KV.get(key, "json").catch(() => null);
  if (existing?.status === "converted" || await hasCompletedOrder(env, email)) {
    return json({ ok: true, skipped: true, reason: "already_purchased" });
  }

  const lead = {
    ...(existing || {}),
    email,
    name,
    page: String(body.page || "/").slice(0, 500),
    date: existing?.date || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    unsubscribeToken: existing?.unsubscribeToken || createToken(),
    unsubscribed: existing?.unsubscribed === true,
    manualReminderSentAt: existing?.manualReminderSentAt || null
  };

  await env.SITE_CONFIG_KV.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ ok: true });
}

function createToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hasCompletedOrder(env, email) {
  let cursor;
  do {
    const page = await env.SITE_CONFIG_KV.list({ prefix: "order-DP-", cursor }).catch(() => ({ keys: [], list_complete: true }));
    for (const { name } of page.keys || []) {
      const order = await env.SITE_CONFIG_KV.get(name, "json").catch(() => null);
      if (order?.status === "completed" && String(order.email || "").trim().toLowerCase() === email) return true;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return false;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
