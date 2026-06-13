// GET    /api/products          — admin: returns all products with download URLs + categories
// POST   /api/products          — admin: add product or category
// PUT    /api/products?id=xx    — admin: update product
// PUT    /api/products          — admin: rename category and update products
// DELETE /api/products?id=xx    — admin: delete product
// DELETE /api/products?category=xx — admin: delete category and move products to fallback

export async function onRequestGet({ request, env }) {
  const pw = request.headers.get("x-admin-password") || "";
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing KV." }, 500);

  const [products, categories] = await Promise.all([listProducts(env), getCategories(env)]);
  return json({ products, categories: uniqueSorted([...categories, ...products.map((p) => p?.category)]) });
}

export async function onRequestPost({ request, env }) {
  const pw = request.headers.get("x-admin-password") || "";
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing KV." }, 500);

  const body = await request.json().catch(() => null);
  if (body?.type === "category") {
    const name = cleanCategory(body.name);
    if (!name) return json({ error: "category name is required." }, 400);

    const categories = await getCategories(env);
    if (!categories.includes(name)) {
      categories.push(name);
      await saveCategories(env, categories);
    }
    const products = await listProducts(env);
    return json({ ok: true, categories, products });
  }

  if (!body || !body.name || !body.downloadUrl) {
    return json({ error: "name and downloadUrl are required." }, 400);
  }

  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const product = {
    id,
    name: String(body.name).slice(0, 120),
    category: String(body.category || "Otros").slice(0, 60),
    accessLevel: cleanAccessLevel(body.accessLevel),
    imageUrl: String(body.imageUrl || "").slice(0, 500),
    downloadUrl: String(body.downloadUrl).slice(0, 800),
    description: String(body.description || "").slice(0, 300),
    active: body.active === false ? false : true,
    createdAt: new Date().toISOString()
  };

  const existing = await listProducts(env);
  existing.unshift(product);
  await saveProducts(env, existing);
  await addCategoryIfMissing(env, product.category);
  return json({ ok: true, product, products: existing, categories: await getCategories(env) });
}

export async function onRequestPut({ request, env }) {
  const pw = request.headers.get("x-admin-password") || "";
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing KV." }, 500);

  const body = await request.json().catch(() => null);
  if (body?.type === "category") {
    const from = cleanCategory(body.from);
    const to = cleanCategory(body.to);
    if (!from || !to) return json({ error: "from and to are required." }, 400);

    const products = await listProducts(env);
    const updated = products.map((p) => p.category === from
      ? { ...p, category: to, updatedAt: new Date().toISOString() }
      : p
    );
    await saveProducts(env, updated);

    const categories = (await getCategories(env)).map((cat) => cat === from ? to : cat);
    await saveCategories(env, categories);
    return json({ ok: true, products: updated, categories: await getCategories(env) });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ error: "Missing id." }, 400);

  if (!body || !body.name || !body.downloadUrl) {
    return json({ error: "name and downloadUrl are required." }, 400);
  }

  const products = await listProducts(env);
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return json({ error: "Product not found." }, 404);

  const product = {
    ...products[idx],
    id,
    name: String(body.name).slice(0, 120),
    category: cleanCategory(body.category || products[idx].category || "Otros"),
    accessLevel: cleanAccessLevel(body.accessLevel || products[idx].accessLevel),
    imageUrl: String(body.imageUrl || "").slice(0, 500),
    downloadUrl: String(body.downloadUrl).slice(0, 800),
    description: String(body.description || "").slice(0, 300),
    active: body.active === false ? false : true,
    updatedAt: new Date().toISOString()
  };

  products[idx] = product;
  await saveProducts(env, products);
  await addCategoryIfMissing(env, product.category);
  return json({ ok: true, product, products, categories: await getCategories(env) });
}

export async function onRequestDelete({ request, env }) {
  const pw = request.headers.get("x-admin-password") || "";
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized." }, 401);
  if (!env.SITE_CONFIG_KV) return json({ error: "Missing KV." }, 500);

  const url = new URL(request.url);
  const category = url.searchParams.get("category") || "";
  if (category) {
    const fallback = cleanCategory(url.searchParams.get("fallback") || "Otros");
    await addCategoryIfMissing(env, fallback);
    const products = await listProducts(env);
    const updated = products.map((p) => p.category === category
      ? { ...p, category: fallback, updatedAt: new Date().toISOString() }
      : p
    );
    await saveProducts(env, updated);

    const categories = (await getCategories(env)).filter((c) => c !== category);
    await saveCategories(env, categories);
    return json({ ok: true, products: updated, categories });
  }

  const id = url.searchParams.get("id") || "";
  if (!id) return json({ error: "Missing id." }, 400);

  const products = await listProducts(env);
  const updated = products.filter((p) => p.id !== id);
  await saveProducts(env, updated);
  return json({ ok: true, products: updated });
}

const DEFAULT_CATEGORIES = [
  "Canva Templates",
  "Design",
  "Ebook",
  "Video",
  "Audio",
  "Software",
  "Social Media",
  "Marketing",
  "Otros"
];

async function listProducts(env) {
  // Primary: single consolidated key (1 KV read)
  const stored = await env.SITE_CONFIG_KV.get("products", "json").catch(() => null);
  if (Array.isArray(stored)) {
    const products = stored.filter(p => p && p.id);
    if (products.length > 0) return products;
  }

  // Fallback: scan legacy product-{id} keys (migration / recovery)
  const keys = (await listAllKeys(env, "product-"))
    .filter(({ name }) => name !== "product-categories");
  if (!keys.length) return [];

  const results = await Promise.all(
    keys.map(({ name }) => env.SITE_CONFIG_KV.get(name, "json").catch(() => null))
  );

  const products = results
    .map((p, i) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      if (!p.id) p.id = keys[i].name.replace("product-", "");
      return p;
    })
    .filter(Boolean)
    .filter(p => p.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Consolidate found products into the fast-path key
  if (products.length > 0) {
    await env.SITE_CONFIG_KV.put("products", JSON.stringify(products)).catch(() => {});
  }
  return products;
}

async function listAllKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.SITE_CONFIG_KV.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function saveProducts(env, products) {
  const clean = (Array.isArray(products) ? products : [])
    .filter(p => p && p.id);
  // Single write — individual backup keys were burning 37 KV writes per operation
  await env.SITE_CONFIG_KV.put("products", JSON.stringify(clean));
}

async function getCategories(env) {
  const saved = await env.SITE_CONFIG_KV.get("product-categories", "json").catch(() => null);
  if (!Array.isArray(saved)) return [...DEFAULT_CATEGORIES];
  return uniqueSorted(saved);
}

async function saveCategories(env, categories) {
  await env.SITE_CONFIG_KV.put("product-categories", JSON.stringify(uniqueSorted(categories)));
}

async function addCategoryIfMissing(env, category) {
  const name = cleanCategory(category);
  if (!name) return;
  const categories = await getCategories(env);
  if (!categories.includes(name)) {
    categories.push(name);
    await saveCategories(env, categories);
  }
}

function uniqueSorted(categories) {
  const names = (Array.isArray(categories) ? categories : []).map(cleanCategory).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "es"));
}

function cleanCategory(value) {
  return String(value || "").trim().slice(0, 60);
}

function cleanAccessLevel(value) {
  const level = String(value || "main").trim().toLowerCase();
  return ["main", "bump", "upsell"].includes(level) ? level : "main";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
