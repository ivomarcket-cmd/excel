export async function onRequestPost({ request, env }) {
  try {
    const config = await readConfig(env);
    const body = await request.json().catch(() => ({}));
    const productName = String(body.productName || config.productName || "Digital Products Pack").slice(0, 120);
    const currency = String(config.currency || "USD").toUpperCase();
    const price = Number(config.price) || 29;

    const accessToken = await getPayPalAccessToken(env, config);
    const res = await fetch(`${getPayPalApiBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          description: productName,
          amount: {
            currency_code: currency,
            value: price.toFixed(2)
          }
        }]
      })
    });

    const order = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: order.message || order.name || "PayPal order could not be created." }, res.status);
    }

    return json({ id: order.id });
  } catch (error) {
    return json({ error: error.message || "Unexpected PayPal error." }, 500);
  }
}

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return {};
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
