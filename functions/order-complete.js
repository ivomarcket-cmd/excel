export async function onRequestPost({ request, env }) {
  try {
    if (!env.SITE_CONFIG_KV) {
      return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const method = body.method === "paypal" ? "paypal" : "stripe";
    const sessionId = String(body.sessionId || "").trim().slice(0, 200);
    const paymentIntentId = String(body.paymentIntentId || "").trim().slice(0, 200);
    const paypalOrderId = String(body.paypalOrderId || "").trim().slice(0, 120);
    const locale = String(body.locale || "en").slice(0, 10);
    const trackingConsent = body.trackingConsent === true;
    const sourceUrl = String(body.sourceUrl || "").slice(0, 500);
    const overridePixelId = String(body.pixelId || "").trim().slice(0, 80) || null;
    const browserSignals = {
      fbp: cleanMetaCookie(body.fbp),
      fbc: cleanMetaCookie(body.fbc)
    };

    const config = await readConfig(env);

    let customerEmail = null;
    let amount = null;
    let currency = null;
    let productName = null;
    let checkoutType = "main";
    let orderBump = false;
    let orderBumpName = null;

    // --- Verify Stripe payment ---
    if (method === "stripe") {
      if (!sessionId.startsWith("cs_") && !paymentIntentId.startsWith("pi_")) {
        return json({ error: "Invalid Stripe payment reference." }, 400);
      }

      const stripeKey = sessionId ? `stripe-session:${sessionId}` : `stripe-payment-intent:${paymentIntentId}`;
      const existing = await env.SITE_CONFIG_KV.get(stripeKey, "json");
      if (existing) {
        const config = await readConfig(env);
        const url = new URL(request.url);
        const origin = env.SITE_URL || url.origin;
        const invoiceUrl = `${origin}/invoice?id=${existing.orderId}&token=${existing.invoiceToken}`;
        const order = await env.SITE_CONFIG_KV.get(`order-${existing.orderId}`, "json").catch(() => null);
        return json({ orderId: existing.orderId, email: order?.email || null, downloadUrl: config.downloadUrl || null, invoiceUrl, duplicate: true, metaEventId: existing.orderId });
      }

      const secretKey = getConfiguredSecret(config.stripeSecretKey, "sk_live_YOUR_STRIPE_SECRET_KEY") || env.STRIPE_SECRET_KEY;
      if (!secretKey) return json({ error: "Stripe not configured." }, 500);

      if (sessionId) {
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        const session = await stripeRes.json();

        if (!stripeRes.ok) {
          return json({ error: session.error?.message || "Could not verify payment." }, 400);
        }
        if (session.payment_status !== "paid") {
          return json({ error: "Payment not completed yet." }, 402);
        }

        customerEmail = session.customer_details?.email || session.customer_email || null;
        amount = session.amount_total ? session.amount_total / 100 : null;
        currency = session.currency ? session.currency.toUpperCase() : "USD";
        productName = session.metadata?.product_name || null;
        checkoutType = session.metadata?.checkout_type || "main";
        orderBump = session.metadata?.order_bump === "true";
        orderBumpName = session.metadata?.order_bump_name || null;
      } else {
        const intentRes = await fetch(
          `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        const intent = await intentRes.json();
        if (!intentRes.ok) {
          return json({ error: intent.error?.message || "Could not verify payment." }, 400);
        }
        if (intent.status !== "succeeded") {
          return json({ error: "Payment not completed yet." }, 402);
        }

        customerEmail = intent.receipt_email || intent.metadata?.buyer_email || null;
        amount = intent.amount_received ? intent.amount_received / 100 : intent.amount ? intent.amount / 100 : null;
        currency = intent.currency ? intent.currency.toUpperCase() : "USD";
        productName = intent.metadata?.product_name || intent.description || null;
        checkoutType = intent.metadata?.checkout_type || "main";
        orderBump = intent.metadata?.order_bump === "true";
        orderBumpName = intent.metadata?.order_bump_name || null;
      }
    }

    // --- Verify PayPal payment ---
    if (method === "paypal") {
      if (!paypalOrderId) {
        return json({ error: "Missing PayPal order ID." }, 400);
      }

      const existing = await env.SITE_CONFIG_KV.get(`paypal-order:${paypalOrderId}`, "json");
      if (existing) {
        const config = await readConfig(env);
        const url = new URL(request.url);
        const origin = env.SITE_URL || url.origin;
        const invoiceUrl = `${origin}/invoice?id=${existing.orderId}&token=${existing.invoiceToken}`;
        const order = await env.SITE_CONFIG_KV.get(`order-${existing.orderId}`, "json").catch(() => null);
        return json({ orderId: existing.orderId, email: order?.email || null, downloadUrl: config.downloadUrl || null, invoiceUrl, duplicate: true, metaEventId: existing.orderId });
      }

      const paypal = await getPayPalOrder(env, paypalOrderId, await readConfig(env));
      if (paypal.status !== "COMPLETED") {
        return json({ error: "PayPal payment not completed yet." }, 402);
      }

      const unit = paypal.purchase_units?.[0] || {};
      const capture = unit.payments?.captures?.[0] || {};
      const payer = paypal.payer || {};
      customerEmail = payer.email_address || null;
      amount = Number(capture.amount?.value || unit.amount?.value) || null;
      currency = (capture.amount?.currency_code || unit.amount?.currency_code || "USD").toUpperCase();
      productName = unit.description || null;
    }

    // --- Load site config ---
    if (!amount) amount = config.price || 29;
    if (!currency) currency = config.currency || "USD";
    if (!productName) productName = config.productName || "Digital Products Pack";

    // --- Generate order number ---
    const countRaw = await env.SITE_CONFIG_KV.get("orders-count");
    const count = parseInt(countRaw || "0", 10) + 1;
    await env.SITE_CONFIG_KV.put("orders-count", String(count));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const orderId = `DP-${dateStr}-${String(count).padStart(4, "0")}`;

    // --- Generate secure invoice token ---
    const tokenBytes = new Uint8Array(20);
    crypto.getRandomValues(tokenBytes);
    const invoiceToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    // --- Build invoice URL ---
    const reqUrl = new URL(request.url);
    const origin = env.SITE_URL || reqUrl.origin;
    const invoiceUrl = `${origin}/invoice?id=${orderId}&token=${invoiceToken}`;

    // --- Save order ---
    const order = {
      orderId,
      date: new Date().toISOString(),
      method,
      sessionId: method === "stripe" ? sessionId : null,
      paymentIntentId: method === "stripe" ? paymentIntentId : null,
      paypalOrderId: method === "paypal" ? paypalOrderId : null,
      email: customerEmail,
      amount,
      currency,
      productName,
      checkoutType,
      orderBump,
      orderBumpName,
      locale,
      invoiceToken,
      status: "completed"
    };

    await env.SITE_CONFIG_KV.put(`order-${orderId}`, JSON.stringify(order));

    if (method === "stripe" && sessionId) {
      await env.SITE_CONFIG_KV.put(
        `stripe-session:${sessionId}`,
        JSON.stringify({ orderId, date: order.date, invoiceToken })
      );
    }

    if (method === "stripe" && paymentIntentId) {
      await env.SITE_CONFIG_KV.put(
        `stripe-payment-intent:${paymentIntentId}`,
        JSON.stringify({ orderId, date: order.date, invoiceToken })
      );
    }

    if (method === "paypal" && paypalOrderId) {
      await env.SITE_CONFIG_KV.put(
        `paypal-order:${paypalOrderId}`,
        JSON.stringify({ orderId, date: order.date, invoiceToken })
      );
    }

    // --- Send email notifications ---
    const resendKey = env.RESEND_API_KEY || config.resendApiKey;
    const notifyEmail = config.notifyEmail || config.supportEmail;
    const fromEmail = config.fromEmail || "info@digital.raqmiy.com";
    const fromName = config.fromName || "Raqmiy Digital";
    if (resendKey && notifyEmail) {
      await sendEmails(resendKey, notifyEmail, customerEmail, order, "", invoiceUrl, fromEmail, fromName);
    }

    // Cancel any pending cart-recovery emails for this customer
    if (customerEmail) {
      await cancelCartLead(env, customerEmail).catch(() => {});
    }

    if (trackingConsent) {
      await sendMetaPurchaseEvent({
        request,
        env,
        config,
        order,
        eventId: orderId,
        sourceUrl: sourceUrl || `${origin}/success.html`,
        browserSignals,
        overridePixelId
      });
    }

    return json({ orderId, email: customerEmail, downloadUrl: config.downloadUrl || null, invoiceUrl, metaEventId: orderId });
  } catch (error) {
    return json({ error: error.message || "Unexpected error." }, 500);
  }
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

  const orders = await listValues(env, "order-DP-");
  const order = orders
    .filter((item) => item?.status === "completed" && String(item.email || "").trim().toLowerCase() === email)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (order?.orderId) {
    await env.SITE_CONFIG_KV.put(
      `cart-recovered:${order.orderId}`,
      JSON.stringify({ ...lead, status: "converted", recoveredAt: order.date, orderId: order.orderId, amount: order.amount, currency: order.currency })
    ).catch(() => {});
  }

  await env.SITE_CONFIG_KV.put(
    `cart-lead:${email}`,
    JSON.stringify({ ...lead, status: "converted" }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  ).catch(() => {});
}

async function listValues(env, prefix) {
  const values = [];
  let cursor;
  do {
    const page = await env.SITE_CONFIG_KV.list({ prefix, cursor });
    values.push(...await Promise.all((page.keys || []).map(({ name }) => env.SITE_CONFIG_KV.get(name, "json").catch(() => null))));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return values;
}

async function getPayPalOrder(env, orderId, config = {}) {
  const accessToken = await getPayPalAccessToken(env, config);
  const res = await fetch(`${getPayPalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.name || "Could not verify PayPal payment.");
  }
  return data;
}

async function getPayPalAccessToken(env, config = {}) {
  const clientId = env.PAYPAL_CLIENT_ID || config.paypalClientId;
  const clientSecret = env.PAYPAL_CLIENT_SECRET || config.paypalClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("PayPal not configured.");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${getPayPalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Could not authenticate with PayPal.");
  }
  return data.access_token;
}

function getPayPalApiBase(env) {
  return env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
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
  const rowAr = (label, value) =>
    `<tr><td style="padding:8px 0;color:#a1a1aa;width:140px;vertical-align:top">${label}</td><td style="padding:8px 0;font-weight:600">${value}</td></tr>`;

  const adminHtml = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:32px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
    <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:24px"></div>
    <h2 style="margin:0 0 20px;color:#fbbf24;font-size:22px">طلب جديد تم استلامه</h2>
    <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:15px;text-align:right">
      ${row("رقم الطلب", `<span style="color:#fbbf24;font-size:18px;font-weight:900">${order.orderId}</span>`)}
      ${row("التاريخ", dateFmtAr)}
      ${row("المبلغ", `<span style="color:#22c55e;font-size:17px">${fmtAr}</span>`)}
      ${row("طريقة الدفع", order.method.toUpperCase())}
      ${row("بريد العميل", order.email || "—")}
      ${row("اللغة", order.locale)}
      ${order.sessionId ? row("Session ID", `<span style="font-size:12px;color:#71717a">${order.sessionId}</span>`) : ""}
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
      ${rowAr("المنتج", order.productName || "Digital Products Pack")}
      ${rowAr("المبلغ", `<span style="color:#22c55e">${fmtAr}</span>`)}
      ${rowAr("التاريخ", dateFmtAr)}
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
          subject: `تم تأكيد طلبك ${order.orderId} — Digital Products Pack`,
          html: buyerHtml
        })
      })
    );
  }

  await Promise.allSettled(calls);
}

async function sendMetaPurchaseEvent({ request, env, config, order, eventId, sourceUrl, browserSignals, overridePixelId }) {
  const accessToken = env.META_CAPI_ACCESS_TOKEN;
  const pixelId = overridePixelId || config.metaPixelId || env.META_PIXEL_ID;
  if (!accessToken || !pixelId) return;

  const userData = {
    client_ip_address: getClientIp(request),
    client_user_agent: request.headers.get("User-Agent") || undefined,
    fbp: browserSignals.fbp || getCookie(request, "_fbp"),
    fbc: browserSignals.fbc || getCookie(request, "_fbc")
  };

  if (order.email) userData.em = await sha256(order.email);
  if (order.email) userData.external_id = await sha256(`buyer:${order.email}`);
  Object.keys(userData).forEach((key) => {
    if (!userData[key]) delete userData[key];
  });

  if (!Object.keys(userData).length) return;

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: sourceUrl,
      action_source: "website",
      user_data: userData,
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
      console.warn("Meta CAPI Purchase failed:", res.status, text.slice(0, 300));
    }
  } catch (error) {
    console.warn("Meta CAPI Purchase failed:", error.message);
  }
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value || "").trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("X-Forwarded-For");
  return forwarded ? forwarded.split(",")[0].trim() : undefined;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function cleanMetaCookie(value) {
  return String(value || "").trim().slice(0, 180) || undefined;
}

function getConfiguredSecret(value, placeholder) {
  const cleaned = String(value || "").trim();
  if (!cleaned || cleaned === placeholder || cleaned.includes("YOUR_STRIPE")) return null;
  return cleaned;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
