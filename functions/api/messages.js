export async function onRequest({ request, env }) {
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);

  const pw = request.headers.get("x-admin-password");
  const config = await readConfig(env);
  const validPw = env.ADMIN_PASSWORD || config.adminPassword;

  if (!validPw || pw !== validPw) return json({ error: "Unauthorized." }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  const method = request.method.toUpperCase();

  // GET — list all messages
  if (method === "GET") {
    const list = await env.SITE_CONFIG_KV.list({ prefix: "msg:" });
    const messages = await Promise.all(
      list.keys.map(k => env.SITE_CONFIG_KV.get(k.name, "json").catch(() => null))
    );
    const sorted = messages
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const unread = sorted.filter(m => !m.read).length;
    return json({ messages: sorted, unread });
  }

  // POST — send a new Arabic message from admin
  if (method === "POST" && action === "send") {
    const body = await request.json().catch(() => ({}));
    const email = cleanString(body.email, 180).toLowerCase();
    const name = cleanString(body.name || email, 120);
    const subject = cleanString(body.subject || "رسالة من Raqmiy Digital", 160);
    const messageBody = cleanString(body.body, 4000);

    if (!isEmail(email)) return json({ error: "Valid customer email is required." }, 400);
    if (!messageBody) return json({ error: "Message body is required." }, 400);

    const resendKey = env.RESEND_API_KEY || config.resendApiKey;
    const fromEmail = env.RESEND_FROM_EMAIL || config.fromEmail || "info@digital.raqmiy.com";
    const fromName = env.RESEND_FROM_NAME || config.fromName || "Raqmiy Digital";
    const supportEmail = env.SUPPORT_EMAIL || config.supportEmail || fromEmail;

    if (!resendKey) return json({ error: "Resend API key not configured." }, 500);

    const safeBody = escapeHtml(messageBody).replace(/\n/g, "<br>");
    const html = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
      <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:22px"></div>
      <p style="margin:0 0 18px;color:#f8fafc;font-size:15px">مرحباً ${escapeHtml(name || "بك")}،</p>
      <div style="line-height:1.8;color:#d4d4d8;font-size:15px">${safeBody}</div>
      <p style="margin:24px 0 0;color:#71717a;font-size:12px">Raqmiy Digital · إذا احتجت أي مساعدة إضافية، يمكنك الرد على هذا البريد.</p>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [email],
        reply_to: supportEmail,
        subject,
        html
      })
    });

    if (!res.ok) {
      const detail = await readResendError(res);
      return json({ error: "Could not send message.", detail }, 502);
    }

    const msgId = `msg:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id: msgId,
      name,
      email,
      subject,
      message: messageBody,
      lang: "ar",
      page: "admin",
      source: "admin",
      direction: "outgoing",
      date: new Date().toISOString(),
      read: true,
      replies: [{
        body: messageBody,
        date: new Date().toISOString(),
        by: "admin"
      }]
    };
    await env.SITE_CONFIG_KV.put(msgId, JSON.stringify(message), { expirationTtl: 60 * 60 * 24 * 90 });

    return json({ ok: true, message });
  }

  // POST — send reply to a contact
  if (method === "POST" && id && action === "reply") {
    const body = await request.json().catch(() => ({}));
    const replyBody = String(body.body || "").trim().slice(0, 3000);
    if (!replyBody) return json({ error: "Reply body is required." }, 400);

    const existing = await env.SITE_CONFIG_KV.get(id, "json").catch(() => null);
    if (!existing) return json({ error: "Message not found." }, 404);

    const resendKey = env.RESEND_API_KEY || config.resendApiKey;
    const fromEmail = env.RESEND_FROM_EMAIL || config.fromEmail || "info@digital.raqmiy.com";
    const fromName = env.RESEND_FROM_NAME || config.fromName || "Raqmiy Digital";
    const supportEmail = env.SUPPORT_EMAIL || config.supportEmail || fromEmail;

    if (!resendKey) return json({ error: "Resend API key not configured." }, 500);

    const safeReply = escapeHtml(replyBody).replace(/\n/g, "<br>");
    const safeOriginal = escapeHtml(existing.message || "").replace(/\n/g, "<br>");

    const html = `<div dir="rtl" lang="ar" style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:0 auto;background:#0a0a0a;color:#f8fafc;padding:28px;border-radius:12px;border:1px solid rgba(251,191,36,.3);text-align:right">
      <div style="height:4px;background:linear-gradient(90deg,#fbbf24,#f97316,#fbbf24);border-radius:4px;margin-bottom:22px"></div>
      <p style="margin:0 0 18px;color:#f8fafc;font-size:15px">مرحباً ${escapeHtml(existing.name || "بك")}،</p>
      <div style="line-height:1.75;color:#d4d4d8;font-size:15px">${safeReply}</div>
      <div style="margin-top:28px;padding:14px 16px;background:rgba(255,255,255,.04);border-radius:8px;border:1px solid rgba(255,255,255,.1)">
        <p style="margin:0 0 6px;color:#71717a;font-size:11px;font-weight:800">رسالتك الأصلية</p>
        <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.6">${safeOriginal}</p>
      </div>
      <p style="margin:24px 0 0;color:#71717a;font-size:12px">Digital Products Pack · إذا احتجت أي مساعدة إضافية، يمكنك الرد على هذا البريد.</p>
    </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [existing.email],
        reply_to: supportEmail,
        subject: `رد على رسالتك — ${existing.subject || "Digital Products Pack"}`,
        html
      })
    });

    if (!res.ok) {
      const detail = await readResendError(res);
      return json({ error: "Could not send reply.", detail }, 502);
    }

    // Mark as read and keep the reply history so admin can continue the thread.
    const replies = Array.isArray(existing.replies) ? existing.replies : [];
    const updated = {
      ...existing,
      read: true,
      replies: [
        ...replies,
        {
          body: replyBody,
          date: new Date().toISOString(),
          by: "admin"
        }
      ],
      lastReplyAt: new Date().toISOString()
    };
    await env.SITE_CONFIG_KV.put(id, JSON.stringify(updated), { expirationTtl: 60 * 60 * 24 * 90 });

    return json({ ok: true, message: updated });
  }

  // PATCH — mark read/unread
  if (method === "PATCH" && id) {
    const body = await request.json().catch(() => ({}));
    const existing = await env.SITE_CONFIG_KV.get(id, "json").catch(() => null);
    if (!existing) return json({ error: "Message not found." }, 404);
    const updated = { ...existing, read: !!body.read };
    await env.SITE_CONFIG_KV.put(id, JSON.stringify(updated), { expirationTtl: 60 * 60 * 24 * 90 });
    return json({ ok: true, message: updated });
  }

  // DELETE — remove a message
  if (method === "DELETE" && id) {
    await env.SITE_CONFIG_KV.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, 405);
}

async function readConfig(env) {
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json").catch(() => null);
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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
