export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  if (url.pathname !== "/admin.html" && url.pathname !== "/admin") {
    return next();
  }

  if (!env.ADMIN_PASSWORD) {
    return new Response("Admin password is not configured.", { status: 500 });
  }

  const authorization = request.headers.get("Authorization") || "";
  const expected = `admin:${env.ADMIN_PASSWORD}`;

  if (!authorization.startsWith("Basic ")) {
    return unauthorized();
  }

  const provided = atob(authorization.slice("Basic ".length));

  if (provided !== expected) {
    return unauthorized();
  }

  return next();
}

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Private Admin"',
      "Cache-Control": "no-store"
    }
  });
}
