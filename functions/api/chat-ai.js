const BASE_PROMPT = `You are a friendly AI sales assistant for Digital Products Pack (digital.raqmiy.com).

PRODUCT FACTS:
- 35,000+ digital products with commercial-use rights — edit, rebrand, resell freely
- Price: $29 one-time (normal price $997, save 97%)
- 8 free bonuses — total bundle value $1,847
- Instant digital delivery after payment
- 30-day money-back guarantee, no questions asked
- Full commercial rights — sell as your own, keep 100% of profits

WHAT'S INCLUDED:
Ebooks, guides, checklists, planners, Canva templates, Excel spreadsheets, video content, audio tracks, Notion templates, website templates, social media content, AI prompts, and much more.

8 BONUSES:
01 Launch checklist | 02 Niche research kit | 03 Sales page template | 04 Promotional email pack
05 Canva cover ideas | 06 Offer stacking guide | 07 Pricing sheet | 08 Traffic starter plan

PAYMENT: Stripe (credit/debit card) or PayPal. Instant access after payment.

HOW TO BUY: Click "Get Access Now" on the page — takes less than 2 minutes.

FOR WHOM:
- Beginners wanting to start a digital business without creating products from scratch
- Content creators wanting to monetize their audience
- Course creators needing bonus materials
- Agencies needing client deliverables fast
- Marketplace sellers wanting to expand their catalog

GUARANTEE: 30 days, full refund, no questions asked. Zero risk.

YOUR BEHAVIOUR RULES:
- Always respond in the SAME LANGUAGE the user writes in (Spanish → Spanish, Arabic → Arabic, etc.)
- Be warm, conversational, and concise — 2 to 4 sentences maximum per reply
- When the user is near the checkout/buy section, gently encourage action
- When the user is reading FAQs, give clear and direct answers
- When the user is on the bonuses/features section, highlight value
- If you don't know something specific, say to contact info@digital.raqmiy.com
- Never invent prices, features, or details not listed above`;

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.message) return json({ error: "message required" }, 400);

    const userMessage = String(body.message || "").trim().slice(0, 600);
    const history     = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const lang        = String(body.lang || "en").slice(0, 10);
    const section     = String(body.section || "").slice(0, 80);
    const pageTitle   = String(body.pageTitle || "").slice(0, 120);
    const pageUrl     = String(body.pageUrl || "").slice(0, 200);

    // Build dynamic context block
    const contextLines = [];
    if (pageTitle) contextLines.push(`Page title: ${pageTitle}`);
    if (pageUrl)   contextLines.push(`Current URL: ${pageUrl}`);
    if (section)   contextLines.push(`Section visitor is currently viewing: ${section}`);
    const contextBlock = contextLines.length
      ? `\nCURRENT VISITOR CONTEXT:\n${contextLines.join("\n")}\n`
      : "";

    const systemPrompt = BASE_PROMPT + contextBlock;

    // Fallback if AI binding not configured
    if (!env.AI) {
      return json({ reply: getFallback(lang), fallback: true });
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content || "").slice(0, 500)
      })),
      { role: "user", content: userMessage }
    ];

    const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages,
      max_tokens: 240,
      stream: false
    });

    const reply = result?.response?.trim() || getFallback(lang);
    return json({ reply });

  } catch (err) {
    return json({ reply: getFallback("en") });
  }
}

function getFallback(lang) {
  return {
    en: "Thanks for your question! For immediate help email info@digital.raqmiy.com — we reply fast.",
    es: "¡Gracias! Para ayuda inmediata escríbenos a info@digital.raqmiy.com — respondemos rápido.",
    pt: "Obrigado! Para ajuda imediata escreva para info@digital.raqmiy.com — respondemos rápido.",
    ar: "شكراً! للمساعدة الفورية راسلنا على info@digital.raqmiy.com — نرد بسرعة."
  }[lang] || "Email info@digital.raqmiy.com for help.";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
