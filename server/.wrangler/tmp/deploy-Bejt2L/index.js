var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Email"
};
async function verifyGoogleToken(token) {
  if (!token || token === "local-dev-token") return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    if (!res.ok) return null;
    const payload = await res.json();
    return payload.email?.toLowerCase();
  } catch (e) {
    return null;
  }
}
__name(verifyGoogleToken, "verifyGoogleToken");
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/" || path === "") {
        return new Response("Leca API v7.1 (Secure Checkout) - Online \u{1F942}", {
          headers: { ...corsHeaders, "content-type": "text/plain; charset=UTF-8" }
        });
      }
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (path === "/api/debug" && request.method === "GET") {
        const verifiedEmail = await verifyGoogleToken(token);
        const headerEmail = request.headers.get("X-User-Email") || url.searchParams.get("email");
        if (!verifiedEmail || verifiedEmail !== headerEmail?.toLowerCase()) {
          return new Response("Unauthorized Debug Access", { status: 401, headers: corsHeaders });
        }
        let stats = {
          tasks: null,
          user_exists: false,
          global: { total_tasks: 0, total_users: 0 }
        };
        const globalTasks = await env.DB.prepare("SELECT COUNT(*) as total FROM tasks").first();
        const globalUsers = await env.DB.prepare("SELECT COUNT(*) as total FROM users").first();
        stats.global.total_tasks = globalTasks?.total || 0;
        stats.global.total_users = globalUsers?.total || 0;
        if (verifiedEmail) {
          const userRow = await env.DB.prepare("SELECT is_premium FROM users WHERE email = ?").bind(verifiedEmail).first();
          stats.user_exists = !!userRow;
          stats.is_premium = userRow?.is_premium === 1;
          const count = await env.DB.prepare("SELECT COUNT(*) as total FROM tasks WHERE user_email = ?").bind(verifiedEmail).first();
          stats.tasks = count?.total || 0;
        }
        return new Response(JSON.stringify({
          status: "online",
          database: "connected",
          verified_user: verifiedEmail,
          stats,
          server_time: (/* @__PURE__ */ new Date()).toISOString()
        }), {
          headers: { ...corsHeaders, "content-type": "application/json" }
        });
      }
      if (path === "/api/login" && request.method === "POST") {
        const verifiedEmail = await verifyGoogleToken(token);
        let { email, name, picture } = await request.json();
        if (!verifiedEmail || verifiedEmail !== email?.toLowerCase()) {
          return new Response("Unauthorized Login attempt", { status: 401, headers: corsHeaders });
        }
        const emailLower = verifiedEmail;
        await env.DB.prepare(`
          INSERT INTO users (email, name, picture, last_login)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            picture = excluded.picture,
            last_login = CURRENT_TIMESTAMP
        `).bind(emailLower, name || null, picture || null).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "content-type": "application/json" }
        });
      }
      if (path === "/api/checkout" && request.method === "POST") {
        const verifiedEmail = await verifyGoogleToken(token);
        if (!verifiedEmail) {
          return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        }
        const userRow = await env.DB.prepare("SELECT name FROM users WHERE email = ?").bind(verifiedEmail).first();
        const userName = userRow?.name || "Cliente Leca";
        const apiKey = env.ABACATE_PAY_API_KEY;
        if (!apiKey) {
          return new Response("AbacatePay API Key not configured", { status: 500, headers: corsHeaders });
        }
        const abacateRes = await fetch("https://api.abacatepay.com/v1/billing/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            frequency: "ONE_TIME",
            methods: ["PIX"],
            products: [{
              externalId: "leca_pro_lifetime",
              name: "Leca Pro - Acesso Vital\xEDcio",
              quantity: 1,
              price: 1990
              // R$ 19,90 (Cents)
            }],
            returnUrl: "https://leca.celsosilva.com.br/",
            completionUrl: "https://leca.celsosilva.com.br/",
            customer: {
              name: userName,
              email: verifiedEmail,
              taxId: "36713044808",
              // Provided by user
              cellphone: "11972509876"
            }
          })
        });
        let abacateData;
        try {
          abacateData = await abacateRes.json();
        } catch (e) {
          return new Response(JSON.stringify({ error: "AbacatePay returned invalid JSON", status: abacateRes.status }), {
            status: 500,
            headers: corsHeaders
          });
        }
        if (!abacateData) {
          return new Response(JSON.stringify({ error: "Empty response from AbacatePay" }), {
            status: 500,
            headers: corsHeaders
          });
        }
        const hasError = !abacateRes.ok || abacateData.error;
        if (hasError) {
          return new Response(JSON.stringify({
            error: abacateData.error || "AbacatePay API Error",
            details: abacateData
          }), {
            status: abacateRes.status || 400,
            headers: corsHeaders
          });
        }
        const checkoutUrl = abacateData.data?.url;
        if (!checkoutUrl) {
          return new Response(JSON.stringify({
            error: "Checkout URL not found in AbacatePay response",
            details: abacateData
          }), {
            status: 500,
            headers: corsHeaders
          });
        }
        return new Response(JSON.stringify({ url: checkoutUrl }), {
          headers: { ...corsHeaders, "content-type": "application/json" }
        });
      }
      if (path === "/api/webhook/abacate" && request.method === "POST") {
        const body = await request.json();
        if (body.event === "billing.paid") {
          const email = body.data?.customer?.email;
          if (email) {
            await env.DB.prepare("UPDATE users SET is_premium = 1 WHERE email = ?").bind(email.toLowerCase()).run();
            console.log(`[AbacatePay] User ${email} upgraded to Premium!`);
          }
        }
        return new Response("OK", { headers: corsHeaders });
      }
      if (path.startsWith("/api/tasks")) {
        const verifiedEmail = await verifyGoogleToken(token);
        const headerEmail = request.headers.get("X-User-Email");
        if (!verifiedEmail || verifiedEmail !== headerEmail?.toLowerCase()) {
          return new Response("Unauthorized - Invalid Token or Email Mismatch", { status: 401, headers: corsHeaders });
        }
        const emailLower = verifiedEmail;
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC"
          ).bind(emailLower).all();
          return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, "content-type": "application/json" }
          });
        }
        if (request.method === "POST") {
          const body = await request.json();
          const { uuid, name, targetFreq, completions } = body;
          if (!uuid || !name) return new Response("Missing required fields", { status: 400, headers: corsHeaders });
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
            emailLower,
            name,
            targetFreq || 1,
            JSON.stringify(completions || []),
            (/* @__PURE__ */ new Date()).toISOString()
          ).run();
          return new Response("OK", { headers: corsHeaders });
        }
        const match = path.match(/^\/api\/tasks\/([^\/]+)$/);
        if (request.method === "DELETE" && match) {
          const uuid = match[1];
          await env.DB.prepare("DELETE FROM tasks WHERE uuid = ? AND user_email = ?").bind(uuid, emailLower).run();
          return new Response("Deleted", { headers: corsHeaders });
        }
      }
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("[Worker Error]", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
