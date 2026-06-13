export async function onRequest({ request, env }) {
  if (!env.SITE_CONFIG_KV) return response("Storage not configured.", 500);
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  const token = String(url.searchParams.get("token") || "").trim();
  const key = `cart-lead:${email}`;
  const lead = await env.SITE_CONFIG_KV.get(key, "json").catch(() => null);
  if (!lead || !token || lead.unsubscribeToken !== token) return response("هذا الرابط غير صالح أو منتهي الصلاحية.", 404);

  await env.SITE_CONFIG_KV.put(key, JSON.stringify({ ...lead, unsubscribed: true, unsubscribedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
  if (request.method === "POST") return new Response("", { status: 200 });
  return new Response(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تفضيلات البريد</title></head><body style="margin:0;background:#f8fafc;font-family:Tahoma,Arial,sans-serif;color:#111827"><main style="max-width:560px;margin:72px auto;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:14px"><h1 style="margin:0 0 12px;font-size:24px">تم إلغاء الاشتراك</h1><p style="margin:0;line-height:1.8;color:#4b5563">لن تتلقى المزيد من رسائل تذكير السلة من Raqmiy Digital.</p></main></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } });
}

function response(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "no-store" } });
}
