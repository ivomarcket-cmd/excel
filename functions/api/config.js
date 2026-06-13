const DEFAULT_CONFIG = {
  price: 29,
  currency: "USD",
  productName: "Digital Products Pack",
  successUrl: "/success.html?paid=paypal",
  stripePublishableKey: "pk_live_YOUR_STRIPE_PUBLISHABLE_KEY",
  stripePriceId: "price_YOUR_STRIPE_PRICE_ID",
  orderBumpEnabled: false,
  orderBumpName: "Pack extra premium",
  orderBumpDescription: "Añade recursos premium adicionales a tu pedido.",
  orderBumpImageUrl: "",
  orderBumpPrice: 9,
  orderBumpStripePriceId: "",
  upsellEnabled: false,
  upsellName: "Actualizacion PRO",
  upsellDescription: "Oferta especial disponible despues de la compra.",
  upsellImageUrl: "",
  upsellPrice: 19,
  upsellStripePriceId: "",
  paypalClientId: "YOUR_PAYPAL_CLIENT_ID",
  paypalClientSecret: "",
  paypalMerchantId: "YOUR_PAYPAL_MERCHANT_ID",
  countdownHours: 6,
  downloadUrl: "",
  supportEmail: "support@example.com",
  metaPixelId: "",
  gtmId: "",
  notifyEmail: "info@digital.raqmiy.com",
  resendApiKey: "",
  fromEmail: "info@digital.raqmiy.com",
  fromName: "Raqmiy Digital",
  cartCampaignMinHours: 1,
  cartReminderSubject: "هل ترغب في إكمال طلبك؟",
  cartReminderHeadline: "طلبك ما زال بانتظارك",
  cartReminderBody: "بدأت خطوة الدفع لباقة المنتجات الرقمية ولكن لم يكتمل الطلب. إذا كنت لا تزال ترغب في الحزمة، يمكنك العودة إلى صفحة الدفع الآمنة.",
  cartReminderCta: "إكمال الطلب",
  businessAddress: "",
  googleClientId: "",
  cloudinaryCloudName: "",
  cloudinaryUploadPreset: ""
};

const CONFIG_KEY = "site_config";

export async function onRequestGet({ env }) {
  const config = await readConfig(env);
  return json(sanitizeConfig(config));
}

export async function onRequestPost({ request, env }) {
  const password = request.headers.get("x-admin-password") || "";

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (!env.SITE_CONFIG_KV) {
    return json({ error: "Missing SITE_CONFIG_KV binding in Cloudflare Pages." }, 500);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid configuration payload." }, 400);
  }

  const nextConfig = sanitizeConfig({ ...DEFAULT_CONFIG, ...body });
  await env.SITE_CONFIG_KV.put(CONFIG_KEY, JSON.stringify(nextConfig));

  return json({ ok: true, config: nextConfig });
}

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return DEFAULT_CONFIG;

  const stored = await env.SITE_CONFIG_KV.get(CONFIG_KEY, "json");
  if (!stored || typeof stored !== "object") return DEFAULT_CONFIG;

  return { ...DEFAULT_CONFIG, ...stored };
}

function sanitizeConfig(config) {
  return {
    price: normalizePrice(config.price, DEFAULT_CONFIG.price),
    currency: cleanString(config.currency, 3).toUpperCase() || DEFAULT_CONFIG.currency,
    productName: cleanString(config.productName, 120) || DEFAULT_CONFIG.productName,
    successUrl: cleanString(config.successUrl, 220) || DEFAULT_CONFIG.successUrl,
    stripePublishableKey: cleanString(config.stripePublishableKey, 180),
    stripePriceId: cleanString(config.stripePriceId, 180),
    orderBumpEnabled: config.orderBumpEnabled === true || config.orderBumpEnabled === "true",
    orderBumpName: cleanString(config.orderBumpName, 120) || DEFAULT_CONFIG.orderBumpName,
    orderBumpDescription: cleanString(config.orderBumpDescription, 240) || DEFAULT_CONFIG.orderBumpDescription,
    orderBumpImageUrl: cleanString(config.orderBumpImageUrl, 800),
    orderBumpPrice: Math.max(0, Number(config.orderBumpPrice) || DEFAULT_CONFIG.orderBumpPrice),
    orderBumpStripePriceId: cleanString(config.orderBumpStripePriceId, 180),
    upsellEnabled: config.upsellEnabled === true || config.upsellEnabled === "true",
    upsellName: cleanString(config.upsellName, 120) || DEFAULT_CONFIG.upsellName,
    upsellDescription: cleanString(config.upsellDescription, 240) || DEFAULT_CONFIG.upsellDescription,
    upsellImageUrl: cleanString(config.upsellImageUrl, 800),
    upsellPrice: Math.max(0, Number(config.upsellPrice) || DEFAULT_CONFIG.upsellPrice),
    upsellStripePriceId: cleanString(config.upsellStripePriceId, 180),
    paypalClientId: cleanString(config.paypalClientId, 260),
    paypalClientSecret: cleanString(config.paypalClientSecret, 260),
    paypalMerchantId: cleanString(config.paypalMerchantId, 160),
    countdownHours: Math.max(1, Math.min(72, Number(config.countdownHours) || DEFAULT_CONFIG.countdownHours)),
    downloadUrl: cleanString(config.downloadUrl, 800),
    supportEmail: cleanString(config.supportEmail, 180),
    metaPixelId: cleanString(config.metaPixelId, 80),
    gtmId: cleanString(config.gtmId, 20),
    notifyEmail: cleanString(config.notifyEmail, 180),
    resendApiKey: cleanString(config.resendApiKey, 120),
    fromEmail: cleanString(config.fromEmail, 180),
    fromName: cleanString(config.fromName, 80),
    cartCampaignMinHours: Math.max(0, Math.min(168, Number(config.cartCampaignMinHours) || 0)),
    cartReminderSubject: cleanString(config.cartReminderSubject, 160) || DEFAULT_CONFIG.cartReminderSubject,
    cartReminderHeadline: cleanString(config.cartReminderHeadline, 180) || DEFAULT_CONFIG.cartReminderHeadline,
    cartReminderBody: cleanString(config.cartReminderBody, 800) || DEFAULT_CONFIG.cartReminderBody,
    cartReminderCta: cleanString(config.cartReminderCta, 80) || DEFAULT_CONFIG.cartReminderCta,
    businessAddress: cleanString(config.businessAddress, 240),
    googleClientId: cleanString(config.googleClientId, 300),
    cloudinaryCloudName: cleanString(config.cloudinaryCloudName, 120),
    cloudinaryUploadPreset: cleanString(config.cloudinaryUploadPreset, 120)
  };
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizePrice(value, fallback) {
  const price = Number(value) || fallback;
  return price === 27 ? 29 : price;
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
