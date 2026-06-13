// GET /images/* — sirve imágenes desde R2 IMAGES_BUCKET con caché agresivo
// Sin autenticación: las imágenes de productos son públicas
// Cache-Control: immutable → el navegador y CDN las cachean 1 año

export async function onRequestGet({ params, env }) {
  if (!env.IMAGES_BUCKET) {
    return new Response("Almacenamiento de imágenes no configurado.", { status: 500 });
  }

  const segments = Array.isArray(params.path) ? params.path : [params.path || ""];
  const key = segments.join("/");
  if (!key) return new Response("Not found.", { status: 404 });

  const obj = await env.IMAGES_BUCKET.get(key);
  if (!obj) return new Response("Not found.", { status: 404 });

  const contentType = obj.httpMetadata?.contentType || "image/jpeg";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (obj.etag) headers["ETag"] = obj.etag;

  return new Response(obj.body, { headers });
}
