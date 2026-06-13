export async function onRequestGet({ request, env }) {
  const password = request.headers.get("x-admin-password") || "";

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (!env.SITE_CONFIG_KV) {
    return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
  }

  const orders = await listOrders(env);

  const totalCount = await env.SITE_CONFIG_KV.get("orders-count");
  const revenue = orders.reduce((sum, o) => sum + (o.amount || 0), 0);

  return json({
    orders,
    stats: {
      total: orders.length,
      revenue: Math.round(revenue * 100) / 100,
      stripe: orders.filter((o) => o.method === "stripe").length,
      paypal: orders.filter((o) => o.method === "paypal").length
    }
  });
}

async function listOrders(env) {
  const prefixes = ["order-DP-", "order-PLR-"];
  const byId = new Map();

  for (const prefix of prefixes) {
    let cursor;
    do {
      const page = await env.SITE_CONFIG_KV.list({ prefix, cursor });
      const values = await Promise.all(
        (page.keys || []).map(({ name }) => env.SITE_CONFIG_KV.get(name, "json").catch(() => null))
      );
      values.filter(Boolean).forEach((order) => {
        byId.set(order.orderId || `${prefix}${byId.size}`, order);
      });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  }

  return Array.from(byId.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function onRequestPost({ request, env }) {
  const password = request.headers.get("x-admin-password") || "";

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (!env.SITE_CONFIG_KV) {
    return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
  }

  const body = await request.json().catch(() => null);
  if (!body || body.action !== "recover-paypal") {
    return json({ error: "Invalid recovery request." }, 400);
  }

  const config = await readConfig(env);
  const email = cleanString(body.email, 180).toLowerCase();
  const paypalOrderId = cleanString(body.paypalOrderId, 140);
  const locale = cleanString(body.locale || "ar", 10);
  const amount = Number(body.amount) || Number(config.price) || 29;
  const currency = cleanString(body.currency || config.currency || "USD", 3).toUpperCase();
  const productName = cleanString(body.productName || config.productName || "Digital Products Pack", 160);

  if (!isEmail(email)) return json({ error: "Valid customer email is required." }, 400);

  if (paypalOrderId) {
    const existing = await env.SITE_CONFIG_KV.get(`paypal-order:${paypalOrderId}`, "json").catch(() => null);
    if (existing?.orderId) {
      const invoiceUrl = buildInvoiceUrl(request, env, existing.orderId, existing.invoiceToken);
      return json({ ok: true, duplicate: true, orderId: existing.orderId, invoiceUrl });
    }
  }

  const countRaw = await env.SITE_CONFIG_KV.get("orders-count");
  const count = parseInt(countRaw || "0", 10) + 1;
  await env.SITE_CONFIG_KV.put("orders-count", String(count));

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderId = `DP-${dateStr}-${String(count).padStart(4, "0")}`;
  const invoiceToken = createToken();
  const invoiceUrl = buildInvoiceUrl(request, env, orderId, invoiceToken);

  const order = {
    orderId,
    date: new Date().toISOString(),
    method: "paypal",
    sessionId: null,
    paypalOrderId: paypalOrderId || null,
    email,
    amount,
    currency,
    productName,
    locale,
    invoiceToken,
    status: "completed",
    recoveredManually: true
  };

  await env.SITE_CONFIG_KV.put(`order-${orderId}`, JSON.stringify(order));

  if (paypalOrderId) {
    await env.SITE_CONFIG_KV.put(
      `paypal-order:${paypalOrderId}`,
      JSON.stringify({ orderId, date: order.date, invoiceToken, recoveredManually: true })
    );
  }

  const resendKey = env.RESEND_API_KEY || config.resendApiKey;
  const fromEmail = env.RESEND_FROM_EMAIL || config.fromEmail || "info@digital.raqmiy.com";
  const fromName = env.RESEND_FROM_NAME || config.fromName || "Raqmiy Digital";
  let emailSent = false;
  let emailWarning = "";

  if (resendKey) {
    const sent = await sendRecoveryEmail(resendKey, email, order, "", invoiceUrl, fromEmail, fromName);
    emailSent = sent.ok;
    emailWarning = sent.warning || "";
  } else {
    emailWarning = "Resend API key not configured.";
  }

  await cancelCartLead(env, email, resendKey, order).catch(() => {});

  return json({
    ok: true,
    order,
    orderId,
    invoiceUrl,
    downloadUrl: config.downloadUrl || null,
    emailSent,
    emailWarning
  });
}

async function readConfig(env) {
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json").catch(() => null);
  return stored && typeof stored === "object" ? stored : {};
}

async function sendRecoveryEmail(apiKey, customerEmail, order, downloadUrl, invoiceUrl, fromEmail, fromName) {
  const amount = new Intl.NumberFormat("ar", { style: "currency", currency: order.currency }).format(order.amount);
  const panelUrl = `${new URL(invoiceUrl).origin}/panel.html`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:32px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
    <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:24px"></div>
    <h1 style="margin:0 0 10px;color:#fbbf24">تم تفعيل وصولك للتحميل</h1>
    <p style="color:#d4d4d8;line-height:1.7">شكراً لصبرك. تم تأكيد طلبك يدوياً ويمكنك الآن تحميل الحزمة.</p>
    <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.28);border-radius:8px;padding:18px;text-align:center;margin:22px 0">
      <p style="margin:0 0 4px;color:#a1a1aa;font-size:13px">رقم الطلب</p>
      <p style="margin:0;font-size:24px;font-weight:900;color:#fbbf24">${escapeHtml(order.orderId)}</p>
    </div>
    <p style="color:#a1a1aa">المبلغ: <strong style="color:#22c55e">${escapeHtml(amount)}</strong></p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:24px 0">
      <a href="${escapeAttr(panelUrl)}" style="display:inline-block;background:#111827;border:1px solid rgba(251,191,36,.5);color:#fbbf24;padding:14px 28px;border-radius:8px;font-weight:900;text-decoration:none">دخول لوحة منتجاتي</a>
      <a href="${escapeAttr(invoiceUrl)}" style="display:inline-block;background:transparent;border:1px solid rgba(251,191,36,.5);color:#fbbf24;padding:14px 28px;border-radius:8px;font-weight:900;text-decoration:none">عرض الفاتورة</a>
    </div>
    <p style="color:#71717a;font-size:13px;margin:0">للدخول إلى لوحة منتجاتي استخدم بريد الشراء ورقم الطلب الظاهر أعلاه.</p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [customerEmail],
      subject: `رابط تحميل طلبك ${order.orderId} — Digital Products Pack`,
      html
    })
  });

  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, warning: text.slice(0, 300) || `Resend returned HTTP ${res.status}.` };
}

async function cancelCartLead(env, email, resendKey, order) {
  email = String(email || "").trim().toLowerCase();
  if (!env.SITE_CONFIG_KV || !email) return;
  const lead = await env.SITE_CONFIG_KV.get(`cart-lead:${email}`, "json").catch(() => null);
  if (!lead || lead.status === "converted") return;

  if (resendKey && lead.resendIds?.length) {
    await Promise.allSettled(
      lead.resendIds.map((id) =>
        fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}` }
        })
      )
    );
  }

  if (order?.orderId) {
    await env.SITE_CONFIG_KV.put(
      `cart-recovered:${order.orderId}`,
      JSON.stringify({ ...lead, status: "converted", convertedAt: new Date().toISOString(), recoveredAt: order.date, orderId: order.orderId, amount: order.amount, currency: order.currency })
    );
  }

  await env.SITE_CONFIG_KV.put(
    `cart-lead:${email}`,
    JSON.stringify({ ...lead, status: "converted", convertedAt: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  );
}

function buildInvoiceUrl(request, env, orderId, invoiceToken) {
  const url = new URL(request.url);
  const origin = env.SITE_URL || url.origin;
  return `${origin}/invoice?id=${encodeURIComponent(orderId)}&token=${encodeURIComponent(invoiceToken)}`;
}

function createToken() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
