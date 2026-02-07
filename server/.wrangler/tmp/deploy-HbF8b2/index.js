var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/itty-router/index.mjs
var t = /* @__PURE__ */ __name(({ base: e = "", routes: t2 = [], ...r2 } = {}) => ({ __proto__: new Proxy({}, { get: /* @__PURE__ */ __name((r3, o2, a2, s2) => (r4, ...c2) => t2.push([o2.toUpperCase?.(), RegExp(`^${(s2 = (e + r4).replace(/\/+(\/|$)/g, "$1")).replace(/(\/?\.?):(\w+)\+/g, "($1(?<$2>*))").replace(/(\/?\.?):(\w+)/g, "($1(?<$2>[^$1/]+?))").replace(/\./g, "\\.").replace(/(\/?)\*/g, "($1.*)?")}/*$`), c2, s2]) && a2, "get") }), routes: t2, ...r2, async fetch(e2, ...o2) {
  let a2, s2, c2 = new URL(e2.url), n2 = e2.query = { __proto__: null };
  for (let [e3, t3] of c2.searchParams) n2[e3] = n2[e3] ? [].concat(n2[e3], t3) : t3;
  e: try {
    for (let t3 of r2.before || []) if (null != (a2 = await t3(e2.proxy ?? e2, ...o2))) break e;
    t: for (let [r3, n3, l, i] of t2) if ((r3 == e2.method || "ALL" == r3) && (s2 = c2.pathname.match(n3))) {
      e2.params = s2.groups || {}, e2.route = i;
      for (let t3 of l) if (null != (a2 = await t3(e2.proxy ?? e2, ...o2))) break t;
    }
  } catch (t3) {
    if (!r2.catch) throw t3;
    a2 = await r2.catch(t3, e2.proxy ?? e2, ...o2);
  }
  try {
    for (let t3 of r2.finally || []) a2 = await t3(a2, e2.proxy ?? e2, ...o2) ?? a2;
  } catch (t3) {
    if (!r2.catch) throw t3;
    a2 = await r2.catch(t3, e2.proxy ?? e2, ...o2);
  }
  return a2;
} }), "t");
var r = /* @__PURE__ */ __name((e = "text/plain; charset=utf-8", t2) => (r2, o2 = {}) => {
  if (void 0 === r2 || r2 instanceof Response) return r2;
  const a2 = new Response(t2?.(r2) ?? r2, o2.url ? void 0 : o2);
  return a2.headers.set("content-type", e), a2;
}, "r");
var o = r("application/json; charset=utf-8", JSON.stringify);
var a = /* @__PURE__ */ __name((e) => ({ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" })[e] || "Unknown Error", "a");
var s = /* @__PURE__ */ __name((e = 500, t2) => {
  if (e instanceof Error) {
    const { message: r2, ...o2 } = e;
    e = e.status || 500, t2 = { error: r2 || a(e), ...o2 };
  }
  return t2 = { status: e, ..."object" == typeof t2 ? t2 : { error: t2 || a(e) } }, o(t2, { status: e });
}, "s");
var c = /* @__PURE__ */ __name((e) => {
  e.proxy = new Proxy(e.proxy ?? e, { get: /* @__PURE__ */ __name((t2, r2) => t2[r2]?.bind?.(e) ?? t2[r2] ?? t2?.params?.[r2], "get") });
}, "c");
var n = /* @__PURE__ */ __name(({ format: e = o, missing: r2 = /* @__PURE__ */ __name((() => s(404)), "r"), finally: a2 = [], before: n2 = [], ...l } = {}) => t({ before: [c, ...n2], catch: s, finally: [(e2, ...t2) => e2 ?? r2(...t2), e, ...a2], ...l }), "n");
var p = r("text/plain; charset=utf-8", String);
var f = r("text/html");
var u = r("image/jpeg");
var h = r("image/png");
var g = r("image/webp");
var y = /* @__PURE__ */ __name((e = {}) => {
  const { origin: t2 = "*", credentials: r2 = false, allowMethods: o2 = "*", allowHeaders: a2, exposeHeaders: s2, maxAge: c2 } = e, n2 = /* @__PURE__ */ __name((e2) => {
    const o3 = e2?.headers.get("origin");
    return true === t2 ? o3 : t2 instanceof RegExp ? t2.test(o3) ? o3 : void 0 : Array.isArray(t2) ? t2.includes(o3) ? o3 : void 0 : t2 instanceof Function ? t2(o3) : "*" == t2 && r2 ? o3 : t2;
  }, "n"), l = /* @__PURE__ */ __name((e2, t3) => {
    for (const [r3, o3] of Object.entries(t3)) o3 && e2.headers.append(r3, o3);
    return e2;
  }, "l");
  return { corsify: /* @__PURE__ */ __name((e2, t3) => e2?.headers?.get("access-control-allow-origin") || 101 == e2.status ? e2 : l(e2.clone(), { "access-control-allow-origin": n2(t3), "access-control-allow-credentials": r2 }), "corsify"), preflight: /* @__PURE__ */ __name((e2) => {
    if ("OPTIONS" == e2.method) {
      const t3 = new Response(null, { status: 204 });
      return l(t3, { "access-control-allow-origin": n2(e2), "access-control-allow-methods": o2?.join?.(",") ?? o2, "access-control-expose-headers": s2?.join?.(",") ?? s2, "access-control-allow-headers": a2?.join?.(",") ?? a2 ?? e2.headers.get("access-control-request-headers"), "access-control-max-age": c2, "access-control-allow-credentials": r2 });
    }
  }, "preflight") };
}, "y");

// src/index.js
var { preflight, corsify } = y({
  origin: "*",
  headers: {
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Email"
  }
});
var router = n();
router.all("*", (request) => {
  console.log("[Request]", request.method, request.url);
  console.log("Headers:", JSON.stringify(Object.fromEntries(request.headers.entries())));
  return preflight(request);
});
var withAuth = /* @__PURE__ */ __name((request) => {
  const userEmail = request.headers.get("X-User-Email");
  if (!userEmail) {
    return new Response("Unauthorized - Missing User Email", { status: 401 });
  }
  request.userEmail = userEmail;
}, "withAuth");
router.all("*", preflight);
router.get("/api/tasks", withAuth, async (request, env) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC"
  ).bind(request.userEmail).all();
  return results;
});
router.post("/api/tasks", withAuth, async (request, env) => {
  try {
    const body = await request.json();
    const { uuid, name, targetFreq, completions } = body;
    const email = request.userEmail;
    if (!uuid || !name) {
      return new Response("Missing required fields", { status: 400 });
    }
    await env.DB.prepare(`
      INSERT INTO tasks (uuid, user_email, name, target_freq, completions, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        name = excluded.name,
        target_freq = excluded.target_freq,
        completions = excluded.completions,
        updated_at = excluded.updated_at
    `).bind(
      uuid,
      email,
      name,
      targetFreq || 1,
      JSON.stringify(completions || []),
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[Worker POST Error]", err);
    return new Response("Sync Error: " + err.message, { status: 500 });
  }
});
router.get("/api/debug", async (request, env) => {
  const tasksCount = await env.DB.prepare("SELECT COUNT(*) as total FROM tasks").first("total");
  const users = await env.DB.prepare("SELECT email, last_login FROM users ORDER BY last_login DESC LIMIT 5").all();
  return Response.json({
    status: "online",
    database: "connected",
    stats: { tasks: tasksCount },
    recent_logins: users.results,
    server_time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
router.post("/api/login", async (request, env) => {
  try {
    const { email, name, picture } = await request.json();
    if (!email) return new Response("Email required", { status: 400 });
    await env.DB.prepare(`
      INSERT INTO users (email, name, picture, last_login)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        picture = excluded.picture,
        last_login = CURRENT_TIMESTAMP
    `).bind(email, name, picture).run();
    return new Response("Login Tracked", { status: 200 });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
});
router.delete("/api/tasks/:uuid", withAuth, async (request, env) => {
  const { uuid } = request.params;
  await env.DB.prepare("DELETE FROM tasks WHERE uuid = ? AND user_email = ?").bind(uuid, request.userEmail).run();
  return new Response("Deleted", { status: 200 });
});
var index_default = {
  fetch: /* @__PURE__ */ __name((request, env, ctx) => router.fetch(request, env, ctx).then(corsify), "fetch")
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
