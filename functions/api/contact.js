export async function onRequestPost({ request, env }) {
  try {
    if (!env.SITE_CONFIG_KV) return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);

    // Rate limit: max 5 contact form submissions per IP per hour
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const rlKey = `rl:contact:${ip}`;
    const rlCount = parseInt(await env.SITE_CONFIG_KV.get(rlKey).catch(() => "0") || "0");
    if (rlCount >= 20) return json({ error: "Too many requests. Please try again later." }, 429);
    await env.SITE_CONFIG_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 }).catch(() => {});

    const body = await request.json().catch(() => null);

    // Honeypot: bots fill this field, real users never see it
    if (body?._hp) return json({ ok: true }); // silently discard

    const name = cleanString(body?.name, 120);
    const email = cleanString(body?.email, 180).toLowerCase();
    const subject = cleanString(body?.subject, 120);
    const message = cleanString(body?.message, 2000);
    const lang = cleanString(body?.lang || "en", 10);
    const page = cleanString(body?.page, 500);

    if (!name) return json({ error: "Name is required." }, 400);
    if (!isEmail(email)) return json({ error: "Valid email is required." }, 400);
    if (!subject) return json({ error: "Subject is required." }, 400);
    if (!message) return json({ error: "Message is required." }, 400);

    // Save message to KV (best-effort, doesn't block email)
    const msgId = `msg:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await env.SITE_CONFIG_KV.put(msgId, JSON.stringify({
      id: msgId, name, email, subject, message, lang, page,
      date: new Date().toISOString(), read: false
    }), { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});

    const config = await readConfig(env);
    const resendKey = env.RESEND_API_KEY || config.resendApiKey;
    const to = env.NOTIFY_EMAIL || config.notifyEmail || env.SUPPORT_EMAIL || config.supportEmail;
    const fromEmail = env.RESEND_FROM_EMAIL || config.fromEmail || "info@digital.raqmiy.com";
    const fromName = env.RESEND_FROM_NAME || config.fromName || "Raqmiy Digital";

    if (!resendKey || !to) return json({ ok: true, warn: "Email not configured but message saved." });

    const now = new Date().toLocaleString("ar", { dateStyle: "long", timeStyle: "short" });
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
    const safePage = escapeHtml(page || "unknown");

    const html = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
      <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:22px"></div>
      <h2 style="margin:0 0 6px;color:#fbbf24">رسالة جديدة من نموذج التواصل</h2>
      <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px">أرسل زائر رسالة من صفحة التواصل.</p>
      <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:15px;text-align:right">
        <tr><td style="padding:8px 0;color:#a1a1aa;width:120px">الاسم</td><td style="padding:8px 0;font-weight:800">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:8px 0;color:#a1a1aa">البريد</td><td style="padding:8px 0;font-weight:800;direction:ltr;text-align:right">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:8px 0;color:#a1a1aa">الموضوع</td><td style="padding:8px 0">${escapeHtml(subject)}</td></tr>
        <tr><td style="padding:8px 0;color:#a1a1aa">اللغة</td><td style="padding:8px 0">${escapeHtml(lang.toUpperCase())}</td></tr>
        <tr><td style="padding:8px 0;color:#a1a1aa">التاريخ</td><td style="padding:8px 0">${escapeHtml(now)}</td></tr>
        <tr><td style="padding:8px 0;color:#a1a1aa">الصفحة</td><td style="padding:8px 0;direction:ltr;text-align:right"><a href="${safePage}" style="color:#fbbf24">${safePage}</a></td></tr>
      </table>
      <div style="margin-top:18px;padding:16px;background:rgba(255,255,255,.06);border-radius:8px;border:1px solid rgba(255,255,255,.1)">
        <p style="margin:0;color:#a1a1aa;font-size:13px;font-weight:800">الرسالة</p>
        <p style="margin:8px 0 0;line-height:1.7">${safeMessage}</p>
      </div>
      <div style="margin-top:20px;padding:14px;background:rgba(251,191,36,.07);border-radius:8px;border:1px solid rgba(251,191,36,.2)">
        <p style="margin:0;color:#fbbf24;font-size:13px">يمكنك الرد مباشرة على هذا البريد للتواصل مع ${escapeHtml(name)}.</p>
      </div>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        reply_to: email,
        subject: `[رسالة تواصل] ${escapeHtml(subject)} · ${escapeHtml(name)}`,
        html
      })
    });

    if (!res.ok) {
      const detail = await readResendError(res);
      return json({ error: "Could not send email.", detail }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || "Unexpected error." }, 500);
  }
}

async function readConfig(env) {
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
}

async function readResendError(response) {
  const text = await response.text().catch(() => "");
  if (!text) return `Resend returned HTTP ${response.status}.`;
  try {
    const data = JSON.parse(text);
    return String(data.message || data.error || text).slice(0, 300);
  } catch (_) {
    return text.slice(0, 300);
  }
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
