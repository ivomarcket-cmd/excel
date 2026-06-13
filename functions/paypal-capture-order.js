export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId || "").trim();
    if (!orderId) {
      return json({ error: "Missing PayPal order ID." }, 400);
    }

    const config = await readConfig(env);
    const accessToken = await getPayPalAccessToken(env, config);
    const res = await fetch(`${getPayPalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }
    });

    const capture = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: capture.message || capture.name || "PayPal order could not be captured." }, res.status);
    }

    return json({
      id: capture.id,
      status: capture.status,
      payerEmail: capture.payer?.email_address || null
    });
  } catch (error) {
    return json({ error: error.message || "Unexpected PayPal error." }, 500);
  }
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

async function readConfig(env) {
  if (!env.SITE_CONFIG_KV) return {};
  const stored = await env.SITE_CONFIG_KV.get("site_config", "json");
  return stored && typeof stored === "object" ? stored : {};
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
