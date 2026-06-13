export async function onRequestPost({ request, env }) {
  try {
    if (!env.SITE_CONFIG_KV) {
      return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
    }

    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return json({ error: "Stripe webhook secret is not configured." }, 500);
    }

    const signature = request.headers.get("Stripe-Signature") || "";
    const rawBody = await request.text();
    const verified = await verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!verified.ok) {
      return json({ error: verified.error }, 400);
    }

    const event = JSON.parse(rawBody);
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded"].includes(event.type)) {
      return json({ received: true, ignored: true });
    }

    const object = event.data?.object;
    if (event.type === "payment_intent.succeeded") {
      if (!object || object.object !== "payment_intent") {
        return json({ error: "Invalid Stripe payment intent event." }, 400);
      }
      const result = await completeStripeOrderFromPaymentIntent({ env, intent: object });
      return json({ received: true, ...result });
    }

    const session = object;
    if (!session || session.object !== "checkout.session") {
      return json({ error: "Invalid Stripe checkout session event." }, 400);
    }

    if (session.payment_status !== "paid") {
      return json({ received: true, ignored: true, paymentStatus: session.payment_status || null });
    }

    const result = await completeStripeOrderFromSession({ env, session });
    return json({ received: true, ...result });
  } catch (error) {
    return json({ error: error.message || "Unexpected webhook error." }, 500);
  }
}

async function completeStripeOrderFromSession({ env, session }) {
  const sessionId = String(session.id || "").trim();
  if (!sessionId.startsWith("cs_")) {
    throw new Error("Invalid Stripe session ID.");
  }

  const existing = await env.SITE_CONFIG_KV.get(`stripe-session:${sessionId}`, "json");
  if (existing) {
    return { orderId: existing.orderId, duplicate: true };
  }

  const config = await readConfig(env);
  const customerEmail = session.customer_details?.email || session.customer_email || null;
  const amount = session.amount_total ? session.amount_total / 100 : config.price || 29;
  const currency = session.currency ? session.currency.toUpperCase() : config.currency || "USD";
  const productName = session.metadata?.product_name || config.productName || "Digital Products Pack";
  const checkoutType = session.metadata?.checkout_type || "main";
  const orderBump = session.metadata?.order_bump === "true";
  const orderBumpName = session.metadata?.order_bump_name || null;
  const locale = session.locale || "auto";

  const countRaw = await env.SITE_CONFIG_KV.get("orders-count");
  const count = parseInt(countRaw || "0", 10) + 1;
  await env.SITE_CONFIG_KV.put("orders-count", String(count));

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderId = `DP-${dateStr}-${String(count).padStart(4, "0")}`;

  const tokenBytes = new Uint8Array(20);
  crypto.getRandomValues(tokenBytes);
  const invoiceToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const origin = env.SITE_URL || config.siteUrl || "https://digital.raqmiy.com";
  const invoiceUrl = `${origin}/invoice?id=${orderId}&token=${invoiceToken}`;

  const order = {
    orderId,
    date: new Date().toISOString(),
    method: "stripe",
    sessionId,
    paypalOrderId: null,
    email: customerEmail,
    amount,
    currency,
    productName,
    checkoutType,
    orderBump,
    orderBumpName,
    locale,
    invoiceToken,
    status: "completed",
    source: "stripe-webhook"
  };

  await env.SITE_CONFIG_KV.put(`order-${orderId}`, JSON.stringify(order));
  await env.SITE_CONFIG_KV.put(
    `stripe-session:${sessionId}`,
    JSON.stringify({ orderId, date: order.date, invoiceToken })
  );

  const resendKey = env.RESEND_API_KEY || config.resendApiKey;
  const notifyEmail = config.notifyEmail || config.supportEmail;
  const fromEmail = config.fromEmail || "info@digital.raqmiy.com";
  const fromName = config.fromName || "Raqmiy Digital";
  if (resendKey && notifyEmail) {
    await sendEmails(resendKey, notifyEmail, customerEmail, order, "", invoiceUrl, fromEmail, fromName);
  }

  if (customerEmail) {
    await cancelCartLead(env, customerEmail).catch(() => {});
  }

  await sendMetaPurchaseEvent({
    env,
    config,
    order,
    eventId: orderId,
    sourceUrl: `${origin}/success.html?paid=stripe&session_id=${encodeURIComponent(sessionId)}`
  });

  return { orderId, invoiceUrl, metaEventId: orderId };
}

async function completeStripeOrderFromPaymentIntent({ env, intent }) {
  const paymentIntentId = String(intent.id || "").trim();
  if (!paymentIntentId.startsWith("pi_")) {
    throw new Error("Invalid Stripe payment intent ID.");
  }

  const existing = await env.SITE_CONFIG_KV.get(`stripe-payment-intent:${paymentIntentId}`, "json");
  if (existing) {
    return { orderId: existing.orderId, duplicate: true };
  }

  const config = await readConfig(env);
  const customerEmail = intent.receipt_email || intent.metadata?.buyer_email || null;
  const amount = intent.amount_received ? intent.amount_received / 100 : intent.amount ? intent.amount / 100 : config.price || 29;
  const currency = intent.currency ? intent.currency.toUpperCase() : config.currency || "USD";
  const productName = intent.metadata?.product_name || intent.description || config.productName || "Digital Products Pack";
  const checkoutType = intent.metadata?.checkout_type || "main";
  const orderBump = intent.metadata?.order_bump === "true";
  const orderBumpName = intent.metadata?.order_bump_name || null;
  const locale = "auto";

  const countRaw = await env.SITE_CONFIG_KV.get("orders-count");
  const count = parseInt(countRaw || "0", 10) + 1;
  await env.SITE_CONFIG_KV.put("orders-count", String(count));

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderId = `DP-${dateStr}-${String(count).padStart(4, "0")}`;

  const tokenBytes = new Uint8Array(20);
  crypto.getRandomValues(tokenBytes);
  const invoiceToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const origin = env.SITE_URL || config.siteUrl || "https://digital.raqmiy.com";
  const invoiceUrl = `${origin}/invoice?id=${orderId}&token=${invoiceToken}`;

  const order = {
    orderId,
    date: new Date().toISOString(),
    method: "stripe",
    sessionId: null,
    paymentIntentId,
    paypalOrderId: null,
    email: customerEmail,
    amount,
    currency,
    productName,
    checkoutType,
    orderBump,
    orderBumpName,
    locale,
    invoiceToken,
    status: "completed",
    source: "stripe-webhook"
  };

  await env.SITE_CONFIG_KV.put(`order-${orderId}`, JSON.stringify(order));
  await env.SITE_CONFIG_KV.put(
    `stripe-payment-intent:${paymentIntentId}`,
    JSON.stringify({ orderId, date: order.date, invoiceToken })
  );

  const resendKey = env.RESEND_API_KEY || config.resendApiKey;
  const notifyEmail = config.notifyEmail || config.supportEmail;
  const fromEmail = config.fromEmail || "info@digital.raqmiy.com";
  const fromName = config.fromName || "Raqmiy Digital";
  if (resendKey && notifyEmail) {
    await sendEmails(resendKey, notifyEmail, customerEmail, order, "", invoiceUrl, fromEmail, fromName);
  }

  if (customerEmail) {
    await cancelCartLead(env, customerEmail).catch(() => {});
  }

  await sendMetaPurchaseEvent({
    env,
    config,
    order,
    eventId: orderId,
    sourceUrl: `${origin}/success.html?paid=stripe&payment_intent=${encodeURIComponent(paymentIntentId)}`
  });

  return { orderId, invoiceUrl, metaEventId: orderId };
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...valueParts] = part.split("=");
      return [key, valueParts.join("=")];
    })
  );
  const timestamp = parts.t;
  const signatures = signatureHeader
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestamp || !signatures.length) {
    return { ok: false, error: "Missing Stripe signature." };
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return { ok: false, error: "Expired Stripe signature." };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);
  const ok = signatures.some((signature) => timingSafeEqualHex(signature, expected));
  return ok ? { ok: true } : { ok: false, error: "Invalid Stripe signature." };
}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a, b) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function cancelCartLead(env, email) {
  if (!env.SITE_CONFIG_KV) return;
  email = String(email || "").trim().toLowerCase();
  if (!email) return;
  const lead = await env.SITE_CONFIG_KV.get(`cart-lead:${email}`, "json").catch(() => null);
  if (!lead || lead.status === "converted") return;

  const config = await readConfig(env);
  const resendKey = env.RESEND_API_KEY || config.resendApiKey;

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

  await env.SITE_CONFIG_KV.put(
    `cart-lead:${email}`,
    JSON.stringify({ ...lead, status: "converted" }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  ).catch(() => {});
}

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return {};
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
}

async function sendEmails(apiKey, adminEmail, customerEmail, order, downloadUrl, invoiceUrl, fromEmail, fromName) {
  const fmtAr = new Intl.NumberFormat("ar", { style: "currency", currency: order.currency }).format(order.amount);
  const dateFmtAr = new Date(order.date).toLocaleString("ar", { dateStyle: "long", timeStyle: "short" });
  const panelUrl = `${new URL(invoiceUrl).origin}/panel.html`;

  const row = (label, value) =>
    `<tr><td style="padding:8px 0;color:#a1a1aa;width:140px;vertical-align:top">${label}</td><td style="padding:8px 0;font-weight:600">${value}</td></tr>`;

  const adminHtml = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:32px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
    <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:24px"></div>
    <h2 style="margin:0 0 20px;color:#fbbf24;font-size:22px">طلب جديد تم استلامه</h2>
    <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:15px;text-align:right">
      ${row("رقم الطلب", `<span style="color:#fbbf24;font-size:18px;font-weight:900">${order.orderId}</span>`)}
      ${row("التاريخ", dateFmtAr)}
      ${row("المبلغ", `<span style="color:#22c55e;font-size:17px">${fmtAr}</span>`)}
      ${row("طريقة الدفع", "STRIPE")}
      ${row("بريد العميل", order.email || "-")}
      ${row("Session ID", `<span style="font-size:12px;color:#71717a">${order.sessionId}</span>`)}
    </table>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.1)">
      <a href="${invoiceUrl}" style="color:#fbbf24;font-weight:700;font-size:14px">عرض فاتورة العميل</a>
    </div>
  </div>`;

  const buyerHtml = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:32px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
    <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:24px"></div>
    <div style="text-align:center;margin-bottom:28px">
      <div style="width:68px;height:68px;border:2px solid #22c55e;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:14px;color:#bbf7d0">✓</div>
      <h1 style="margin:0;font-size:28px;color:#fbbf24">تم تأكيد الدفع</h1>
      <p style="color:#a1a1aa;margin:8px 0 0">شكراً لشرائك حزمة Digital Products Pack</p>
    </div>
    <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.28);border-radius:8px;padding:18px;text-align:center;margin-bottom:24px">
      <p style="margin:0 0 4px;color:#a1a1aa;font-size:13px">رقم طلبك</p>
      <p style="margin:0;font-size:26px;font-weight:900;color:#fbbf24;letter-spacing:2px">${order.orderId}</p>
    </div>
    <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:24px;text-align:right">
      ${row("المنتج", order.productName || "Digital Products Pack")}
      ${row("المبلغ", `<span style="color:#22c55e">${fmtAr}</span>`)}
      ${row("التاريخ", dateFmtAr)}
    </table>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:24px 0">
      <a href="${panelUrl}" style="display:inline-block;background:#111827;border:1px solid rgba(251,191,36,.5);color:#fbbf24;padding:14px 28px;border-radius:8px;font-weight:900;text-decoration:none;font-size:15px">دخول لوحة منتجاتي</a>
      <a href="${invoiceUrl}" style="display:inline-block;background:transparent;border:1px solid rgba(251,191,36,.5);color:#fbbf24;padding:14px 28px;border-radius:8px;font-weight:900;text-decoration:none;font-size:15px">عرض الفاتورة العربية / حفظ PDF</a>
    </div>
    <p style="color:#71717a;font-size:13px;border-top:1px solid rgba(255,255,255,.08);padding-top:16px;margin-bottom:0">للدخول إلى لوحة منتجاتي استخدم بريد الشراء ورقم الطلب الظاهر أعلاه. احتفظ بهذا البريد كإثبات للشراء.</p>
  </div>`;

  const calls = [
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [adminEmail],
        subject: `طلب جديد ${order.orderId} · ${fmtAr}`,
        html: adminHtml
      })
    })
  ];

  if (customerEmail) {
    calls.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [customerEmail],
          subject: `تم تأكيد طلبك ${order.orderId} - Digital Products Pack`,
          html: buyerHtml
        })
      })
    );
  }

  await Promise.allSettled(calls);
}

async function sendMetaPurchaseEvent({ env, config, order, eventId, sourceUrl }) {
  const accessToken = env.META_CAPI_ACCESS_TOKEN;
  const pixelId = config.metaPixelId || env.META_PIXEL_ID;
  if (!accessToken || !pixelId || !order.email) return;

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: sourceUrl,
      action_source: "website",
      user_data: {
        em: await sha256(order.email),
        external_id: await sha256(`buyer:${order.email}`)
      },
      custom_data: {
        currency: order.currency,
        value: Number(order.amount) || 0,
        content_name: order.productName,
        content_ids: ["digital-products-pack"],
        content_type: "product",
        order_id: order.orderId,
        num_items: 1
      }
    }]
  };

  if (env.META_TEST_EVENT_CODE) {
    payload.test_event_code = env.META_TEST_EVENT_CODE;
  }

  const apiVersion = String(env.META_GRAPH_API_VERSION || "v24.0").replace(/^\/+/, "");
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("Meta CAPI webhook Purchase failed:", res.status, text.slice(0, 300));
    }
  } catch (error) {
    console.warn("Meta CAPI webhook Purchase failed:", error.message);
  }
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value || "").trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
