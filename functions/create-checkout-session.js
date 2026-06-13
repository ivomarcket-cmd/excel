export async function onRequestPost({ request, env }) {
  try {
    const config = await readConfig(env);
    const stripeSecretKey = (isConfigured(config.stripeSecretKey, "sk_live_YOUR_STRIPE_SECRET_KEY") ? config.stripeSecretKey : null) || env.STRIPE_SECRET_KEY;
    const useFixedStripePrices = env.USE_STRIPE_PRICE_IDS === "true";
    const stripePriceId = useFixedStripePrices ? ((isConfigured(config.stripePriceId, "price_YOUR_STRIPE_PRICE_ID") ? config.stripePriceId : null) || env.STRIPE_PRICE_ID) : null;
    const orderBumpPriceId = useFixedStripePrices ? (isConfigured(config.orderBumpStripePriceId, "") ? config.orderBumpStripePriceId : env.STRIPE_BUMP_PRICE_ID) : null;
    const upsellPriceId = useFixedStripePrices ? (isConfigured(config.upsellStripePriceId, "") ? config.upsellStripePriceId : env.STRIPE_UPSELL_PRICE_ID) : null;

    if (!stripeSecretKey) {
      return json({ error: "Stripe is not configured." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    const origin = env.SITE_URL || url.origin;
    const allowed = ["auto", "es", "pt-BR"];
    const locale = allowed.includes(body.locale) ? body.locale : "en";
    const customerEmail = cleanEmail(body.email);
    const checkoutType = body.checkoutType === "upsell" ? "upsell" : "main";
    const orderBumpAmount = Number(config.orderBumpPrice);
    const includeOrderBump = checkoutType === "main"
      && body.orderBump === true
      && config.orderBumpEnabled === true
      && (!!orderBumpPriceId || orderBumpAmount > 0);
    const productName = String(
      checkoutType === "upsell"
        ? (config.upsellName || body.productName || "Digital Products Pack Upsell")
        : (body.productName || config.productName || "Digital Products Pack")
    ).slice(0, 120);
    const selectedPriceId = checkoutType === "upsell" ? upsellPriceId : stripePriceId;
    const selectedAmount = checkoutType === "upsell" ? Number(config.upsellPrice) : Number(config.price);

    if (!selectedPriceId && (!selectedAmount || selectedAmount <= 0)) {
      return json({ error: checkoutType === "upsell" ? "Upsell price is not configured." : "Product price is not configured." }, 500);
    }

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("ui_mode", "embedded");
    params.append("locale", locale);
    params.append("payment_method_types[0]", "card");
    appendLineItem(params, 0, {
      priceId: selectedPriceId,
      name: productName,
      amount: selectedAmount,
      currency: config.currency || "USD"
    });
    params.append("line_items[0][quantity]", "1");
    if (includeOrderBump) {
      appendLineItem(params, 1, {
        priceId: orderBumpPriceId,
        name: config.orderBumpName || "Order bump",
        amount: orderBumpAmount,
        currency: config.currency || "USD"
      });
      params.append("line_items[1][quantity]", "1");
    }
    params.append("return_url", `${origin}/success.html?paid=stripe${checkoutType === "upsell" ? "&upsell=1" : ""}&session_id={CHECKOUT_SESSION_ID}`);
    params.append("billing_address_collection", "auto");
    params.append("customer_creation", "if_required");
    if (customerEmail) params.append("customer_email", customerEmail);
    params.append("metadata[product_name]", productName);
    params.append("metadata[checkout_type]", checkoutType);
    params.append("metadata[order_bump]", includeOrderBump ? "true" : "false");
    if (customerEmail) params.append("metadata[buyer_email]", customerEmail);
    if (includeOrderBump) params.append("metadata[order_bump_name]", config.orderBumpName || "Order bump");

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const session = await response.json();

    if (!response.ok) {
      return json({ error: session.error?.message || "Stripe session could not be created." }, response.status);
    }

    return json({ clientSecret: session.client_secret });
  } catch (error) {
    return json({ error: error.message || "Unexpected checkout error." }, 500);
  }
}

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return {};
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
}

function isConfigured(value, placeholder) {
  return typeof value === "string" && value.trim() && value.trim() !== placeholder;
}

function appendLineItem(params, index, item) {
  if (item.priceId) {
    params.append(`line_items[${index}][price]`, item.priceId);
    return;
  }

  params.append(`line_items[${index}][price_data][currency]`, String(item.currency || "USD").toLowerCase());
  params.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round((Number(item.amount) || 0) * 100)));
  params.append(`line_items[${index}][price_data][product_data][name]`, String(item.name || "Digital Product").slice(0, 120));
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 180);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
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
