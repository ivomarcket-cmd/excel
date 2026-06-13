// POST /api/upload-image — admin only
// Receives multipart/form-data with field "image", stores in R2 IMAGES_BUCKET,
// returns { ok: true, url: "/images/products/<key>" }
// Requires Cloudflare Pages R2 binding: IMAGES_BUCKET

export async function onRequestPost({ request, env }) {
  const pw = request.headers.get("x-admin-password") || "";
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return res({ error: "Unauthorized." }, 401);
  }
  if (!env.IMAGES_BUCKET) {
    return res({ error: "R2 no configurado. Añade el binding IMAGES_BUCKET en Cloudflare Pages → Configuración → R2." }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return res({ error: "Error al leer el formulario." }, 400);
  }

  const file = formData.get("image");
  if (!file || typeof file === "string" || !file.size) {
    return res({ error: "No se recibió ningún archivo." }, 400);
  }

  const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  if (!ALLOWED.includes(file.type)) {
    return res({ error: "Tipo de archivo no permitido. Usa JPEG, PNG, WebP o GIF." }, 400);
  }

  if (file.size > 8 * 1024 * 1024) {
    return res({ error: "Imagen demasiado grande (máx 8 MB)." }, 400);
  }

  const ext = file.type === "image/webp" ? "webp"
    : file.type === "image/png" ? "png"
    : file.type === "image/gif" ? "gif"
    : "jpg";

  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const key = `products/${Date.now()}-${rand}.${ext}`;

  await env.IMAGES_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  });

  return res({ ok: true, url: `/images/${key}` });
}

function res(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
