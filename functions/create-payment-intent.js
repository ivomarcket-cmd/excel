export async function onRequestPost({ request, env }) {
  try {
    const config = await readConfig(env);
    const stripeSecretKey = getConfiguredSecret(config.stripeSecretKey, "sk_live_YOUR_STRIPE_SECRET_KEY") || env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return json({ error: "Stripe is not configured." }, 500);

    const body = await request.json().catch(() => ({}));
    const checkoutType = body.checkoutType === "upsell" ? "upsell" : "main";
    const email = cleanEmail(body.email);
    const orderBump = checkoutType === "main" && body.orderBump === true && config.orderBumpEnabled === true && Number(config.orderBumpPrice) > 0;
    const baseAmount = checkoutType === "upsell" ? Number(config.upsellPrice) : Number(config.price);
    const bumpAmount = orderBump ? Number(config.orderBumpPrice) : 0;
    const amount = baseAmount + bumpAmount;
    const currency = cleanCurrency(config.currency || "USD");
    const productName = String(checkoutType === "upsell"
      ? (config.upsellName || "Digital Products Upsell")
      : (config.productName || "Digital Products Pack")
    ).slice(0, 120);

    if (!amount || amount <= 0) {
      return json({ error: "Payment amount is not configured." }, 500);
    }

    const params = new URLSearchParams();
    params.append("amount", String(Math.round(amount * 100)));
    params.append("currency", currency.toLowerCase());
    params.append("payment_method_types[0]", "card");
    params.append("description", productName);
    if (email) params.append("receipt_email", email);
    params.append("metadata[product_name]", productName);
    params.append("metadata[checkout_type]", checkoutType);
    params.append("metadata[order_bump]", orderBump ? "true" : "false");
    if (orderBump) params.append("metadata[order_bump_name]", config.orderBumpName || "Order bump");
    if (email) params.append("metadata[buyer_email]", email);

    const response = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const intent = await response.json();
    if (!response.ok) {
      return json({ error: intent.error?.message || "Stripe payment intent could not be created." }, response.status);
    }

    return json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (error) {
    return json({ error: error.message || "Unexpected payment intent error." }, 500);
  }
}

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return {};
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 180);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanCurrency(value) {
  const currency = String(value || "USD").trim().toUpperCase().slice(0, 3);
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
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
