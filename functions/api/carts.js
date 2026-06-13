const BATCH_SIZE = 100;
const HOUR_MS = 3_600_000;

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
  const [active, recovered, orders, config] = await Promise.all([
    listValues(env, "cart-lead:"),
    listValues(env, "cart-recovered:"),
    listValues(env, "order-DP-"),
    readConfig(env)
  ]);
  const recoveredCarts = recovered.filter(Boolean);
  const carts = await removePurchasedCarts(env, active.filter((lead) => lead?.status !== "converted"), orders.filter(Boolean), recoveredCarts);
  carts.sort((a, b) => new Date(b.updatedAt || b.date) - new Date(a.updatedAt || a.date));
  recoveredCarts.sort((a, b) => new Date(b.recoveredAt) - new Date(a.recoveredAt));
  return json({
    carts,
    recovered: recoveredCarts,
    stats: {
      abandoned: carts.filter((lead) => !lead.unsubscribed).length,
      recovered: recoveredCarts.length,
      remindersSent: carts.filter((lead) => lead.manualReminderSentAt).length,
      campaignEligible: carts.filter((lead) => isEligible(lead, config)).length,
      unsubscribed: carts.filter((lead) => lead.unsubscribed).length
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing SITE_CONFIG_KV binding." }, 500);
  const body = await request.json().catch(() => ({}));
  if (!["send-reminder", "send-campaign"].includes(body.action)) return json({ error: "Unsupported action." }, 400);
  const config = await readConfig(env);
  const resendKey = env.RESEND_API_KEY || config.resendApiKey;
  if (!resendKey) return json({ error: "Configure Resend API key first." }, 409);
  if (!config.businessAddress) return json({ error: "أضف العنوان البريدي التجاري في تبويب التذكيرات قبل الإرسال." }, 409);
  if (body.action === "send-campaign") return sendCampaign({ request, env, config, resendKey });

  const email = normalizeEmail(body.email);
  const lead = await env.SITE_CONFIG_KV.get(`cart-lead:${email}`, "json").catch(() => null);
  if (!lead) return json({ error: "Cart not found." }, 404);
  const order = await findOrder(env, email);
  if (order) {
    await archiveRecovered(env, lead, order);
    await env.SITE_CONFIG_KV.delete(`cart-lead:${email}`).catch(() => {});
    return json({ error: "العميل اشترى بالفعل وتم نقل السلة إلى المسترجعة." }, 409);
  }
  if (lead.unsubscribed) return json({ error: "العميل ألغى الاشتراك في رسائل السلة." }, 409);
  if (lead.manualReminderSentAt) return json({ error: "تم إرسال تذكير يدوي لهذه السلة بالفعل." }, 409);
  await cancelScheduled(env, lead, resendKey);
  const prepared = { ...lead, unsubscribeToken: lead.unsubscribeToken || createToken(), resendIds: [] };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `raqmi-cart-${hash(email)}` },
    body: JSON.stringify(buildPayload(prepared, config, getOrigin(request, env)))
  });
  if (!res.ok) return json({ error: "Resend could not send the reminder.", detail: await safeError(res) }, 502);
  const updated = { ...prepared, manualReminderSentAt: new Date().toISOString() };
  await env.SITE_CONFIG_KV.put(`cart-lead:${email}`, JSON.stringify(updated), { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ ok: true, cart: updated });
}

async function sendCampaign({ request, env, config, resendKey }) {
  const [active, recovered, orders] = await Promise.all([listValues(env, "cart-lead:"), listValues(env, "cart-recovered:"), listValues(env, "order-DP-")]);
  const carts = await removePurchasedCarts(env, active.filter((lead) => lead?.status !== "converted"), orders.filter(Boolean), recovered.filter(Boolean));
  const eligible = carts.filter((lead) => isEligible(lead, config));
  if (!eligible.length) return json({ ok: true, sent: 0, skipped: carts.length, message: "لا توجد سلات مؤهلة للإرسال." });
  const origin = getOrigin(request, env);
  let sent = 0;
  let errors = 0;
  for (let index = 0; index < eligible.length; index += BATCH_SIZE) {
    const chunk = eligible.slice(index, index + BATCH_SIZE);
    await Promise.all(chunk.map((lead) => cancelScheduled(env, lead, resendKey)));
    const prepared = chunk.map((lead) => ({ ...lead, unsubscribeToken: lead.unsubscribeToken || createToken(), resendIds: [] }));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `raqmi-campaign-${hash(chunk.map((lead) => lead.email).join(","))}` },
      body: JSON.stringify(prepared.map((lead) => buildPayload(lead, config, origin)))
    });
    if (!res.ok) { errors += chunk.length; continue; }
    const sentAt = new Date().toISOString();
    await Promise.all(prepared.map((lead) => env.SITE_CONFIG_KV.put(`cart-lead:${normalizeEmail(lead.email)}`, JSON.stringify({ ...lead, manualReminderSentAt: sentAt }), { expirationTtl: 60 * 60 * 24 * 30 })));
    sent += chunk.length;
  }
  return json({ ok: errors === 0, sent, errors, skipped: carts.length - eligible.length });
}

function buildPayload(lead, config, origin) {
  const pageUrl = normalizeUrl(lead.page || "/#checkout", origin);
  const unsubscribeUrl = `${origin}/api/cart-unsubscribe?email=${encodeURIComponent(lead.email)}&token=${encodeURIComponent(lead.unsubscribeToken)}`;
  const name = lead.name || "عزيزي العميل";
  const subject = config.cartReminderSubject || "هل ترغب في إكمال طلبك؟";
  const headline = config.cartReminderHeadline || "طلبك ما زال بانتظارك";
  const body = config.cartReminderBody || "بدأت خطوة الدفع لباقة المنتجات الرقمية ولكن لم يكتمل الطلب. إذا كنت لا تزال ترغب في الحزمة، يمكنك العودة إلى صفحة الدفع الآمنة.";
  const cta = config.cartReminderCta || "إكمال الطلب";
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f8fafc;font-family:Tahoma,Arial,sans-serif;color:#111827"><div style="max-width:600px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden"><div style="height:5px;background:#d4af37"></div><div style="padding:28px;text-align:right"><p style="margin:0 0 10px;color:#6b7280">مرحباً ${escapeHtml(name)}،</p><h1 style="margin:0 0 14px;font-size:24px">${escapeHtml(headline)}</h1><p style="margin:0 0 18px;line-height:1.9;color:#374151">${escapeHtml(body)}</p><p style="text-align:center;margin:0 0 18px"><a href="${escapeAttr(pageUrl)}" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#111827;color:#fff;text-decoration:none;font-weight:800">${escapeHtml(cta)}</a></p><p style="margin:0;color:#6b7280;font-size:13px;line-height:1.7">هذه رسالة تذكير واحدة بخصوص خطوة الدفع التي بدأتها.</p></div><div style="padding:16px 28px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.7;text-align:right"><div>Raqmiy Digital · ${escapeHtml(config.businessAddress)}</div><a href="${escapeAttr(unsubscribeUrl)}" style="color:#6b7280">إيقاف رسائل تذكير السلة</a></div></div></div></body></html>`;
  const text = `مرحباً ${name}،

${headline}

${body}

${cta}: ${pageUrl}

Raqmiy Digital
${config.businessAddress}
إيقاف رسائل تذكير السلة: ${unsubscribeUrl}`;
  return { from: `${config.fromName || "Raqmiy Digital"} <${config.fromEmail || "info@digital.raqmiy.com"}>`, to: [lead.email], reply_to: getReplyTo(config), subject, html, text, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, tags: [{ name: "category", value: "cart_reminder" }] };
}

async function removePurchasedCarts(env, carts, orders, recovered) {
  const byEmail = new Map(orders.filter((order) => order?.status === "completed" && order.email).map((order) => [normalizeEmail(order.email), order]));
  const active = [];
  for (const lead of carts) {
    const order = byEmail.get(normalizeEmail(lead.email));
    if (!order) { active.push(lead); continue; }
    recovered.push(await archiveRecovered(env, lead, order));
    await env.SITE_CONFIG_KV.delete(`cart-lead:${normalizeEmail(lead.email)}`).catch(() => {});
  }
  return active;
}

async function archiveRecovered(env, lead, order) {
  const recovered = { ...lead, status: "converted", recoveredAt: order.date || new Date().toISOString(), orderId: order.orderId, amount: order.amount, currency: order.currency };
  await env.SITE_CONFIG_KV.put(`cart-recovered:${order.orderId}`, JSON.stringify(recovered));
  return recovered;
}

async function findOrder(env, email) {
  const orders = await listValues(env, "order-DP-");
  return orders.find((order) => order?.status === "completed" && normalizeEmail(order.email) === normalizeEmail(email)) || null;
}

async function cancelScheduled(env, lead, resendKey) {
  if (!resendKey || !lead?.resendIds?.length) return;
  await Promise.allSettled(lead.resendIds.map((id) => fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${resendKey}` } })));
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

async function readConfig(env) {
  return await env.SITE_CONFIG_KV.get("site_config", "json").catch(() => ({})) || {};
}

function isEligible(lead, config) {
  if (!lead || lead.unsubscribed || lead.manualReminderSentAt || lead.status === "converted") return false;
  return Date.now() - new Date(lead.date || lead.updatedAt).getTime() >= Math.max(0, Number(config.cartCampaignMinHours) || 0) * HOUR_MS;
}

function getOrigin(request, env) { return env.SITE_URL || new URL(request.url).origin; }
function getReplyTo(config) { const value = String(config.supportEmail || "").trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.endsWith("@example.com") ? value : (config.fromEmail || "info@digital.raqmiy.com"); }
function normalizeUrl(value, origin) { try { const url = new URL(value, origin); return ["http:", "https:"].includes(url.protocol) ? url.href : origin; } catch { return origin; } }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function hash(value) { let result = 0; for (const char of String(value || "")) result = ((result << 5) - result + char.charCodeAt(0)) | 0; return Math.abs(result).toString(36); }
function createToken() { const bytes = new Uint8Array(18); crypto.getRandomValues(bytes); return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
async function safeError(res) { const text = await res.text().catch(() => ""); try { const data = JSON.parse(text); return String(data.message || data.error || text).slice(0, 300); } catch { return text.slice(0, 300); } }
function isAdmin(request, env) { return Boolean(env.ADMIN_PASSWORD) && request.headers.get("x-admin-password") === env.ADMIN_PASSWORD; }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function escapeAttr(value) { return escapeHtml(value); }
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
