
// Vanilla Worker Router - Zero Dependencies 🥂

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
};

// 0. Helper: Verify Google Token
async function verifyGoogleToken(token) {
  if (!token || token === 'local-dev-token') return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    if (!res.ok) return null;
    const payload = await res.json();
    return payload.email?.toLowerCase();
  } catch (e) {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Health Check
      if (path === '/' || path === '') {
        return new Response('Leca API v7.1 (Secure Checkout) - Online 🥂', {
          headers: { ...corsHeaders, 'content-type': 'text/plain; charset=UTF-8' }
        });
      }

      // Security Check: Get Token
      const authHeader = request.headers.get('Authorization') || '';
      let token = authHeader.replace('Bearer ', '');

      // Allow token in query param for debug access via browser link
      if (!token && path === '/api/debug') {
        token = url.searchParams.get('auth_token');
      }

      // 2. Debug Endpoint (Secured)
      if (path === '/api/debug' && request.method === 'GET') {
        const verifiedEmail = await verifyGoogleToken(token);
        const headerEmail = request.headers.get('X-User-Email') || url.searchParams.get('email');

        // Strict Check: Only show debug for your own account
        if (!verifiedEmail || verifiedEmail !== headerEmail?.toLowerCase()) {
          return new Response('Unauthorized Debug Access', { status: 401, headers: corsHeaders });
        }

        let stats = {
          tasks: null,
          user_exists: false,
          global: { total_tasks: 0, total_users: 0 }
        };

        const globalTasks = 0; // Hidden for privacy
        const globalUsers = 0; // Hidden for privacy
        stats.global.total_tasks = 0;
        stats.global.total_users = 0;

        if (verifiedEmail) {
          const userRow = await env.DB.prepare('SELECT is_premium, created_at FROM users WHERE email = ?').bind(verifiedEmail).first();
          stats.user_exists = !!userRow;
          stats.is_premium = userRow?.is_premium === 1;
          stats.created_at = userRow?.created_at;
          const count = await env.DB.prepare('SELECT COUNT(*) as total FROM tasks WHERE user_email = ?').bind(verifiedEmail).first();
          stats.tasks = count?.total || 0;
          // For compatibility, mirror user stats to 'global' structure so frontend shows something useful
          stats.global.total_tasks = stats.tasks;
          stats.global.total_users = 1; // Just you
        }

        return new Response(JSON.stringify({
          status: 'online',
          database: 'connected',
          verified_user: verifiedEmail,
          stats: stats,
          server_time: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }

      // 3. Login Endpoint
      if (path === '/api/login' && request.method === 'POST') {
        const verifiedEmail = await verifyGoogleToken(token);
        let { email, name, picture } = await request.json();

        if (!verifiedEmail || verifiedEmail !== email?.toLowerCase()) {
          return new Response('Unauthorized Login attempt', { status: 401, headers: corsHeaders });
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

        const userRow = await env.DB.prepare('SELECT created_at FROM users WHERE email = ?').bind(emailLower).first();

        return new Response(JSON.stringify({
          success: true,
          created_at: userRow?.created_at
        }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }

      // 3.1. Mercado Pago Checkout Endpoint
      if (path === '/api/checkout' && request.method === 'POST') {
        const verifiedEmail = await verifyGoogleToken(token);
        if (!verifiedEmail) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        const accessToken = env.MP_ACCESS_TOKEN;
        if (!accessToken) {
          return new Response('Mercado Pago Access Token not configured', { status: 500, headers: corsHeaders });
        }

        // Create Preference in Mercado Pago
        const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            items: [
              {
                title: 'Leca Pro - Acesso Vitalício (Teste)',
                quantity: 1,
                unit_price: 5.00,
                currency_id: 'BRL'
              }
            ],
            payer: {
              email: verifiedEmail
            },
            payment_methods: {
              included_payment_methods: [{ id: 'pix' }],
              installments: 1
            },
            binary_mode: true, // Aprovação direta sem review
            back_urls: {
              success: `https://brcelso.github.io/Leca-app/`,
              failure: `https://brcelso.github.io/Leca-app/`,
              pending: `https://brcelso.github.io/Leca-app/`
            },
            auto_return: 'approved',
            notification_url: 'https://leca-server.celsosilvajunior90.workers.dev/api/webhook/mercadopago',
            external_reference: verifiedEmail
          })
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
          return new Response(JSON.stringify({ error: 'Mercado Pago API Error', details: mpData }), {
            status: mpRes.status,
            headers: corsHeaders
          });
        }

        const checkoutUrl = mpData.init_point;
        if (!checkoutUrl) {
          return new Response(JSON.stringify({ error: 'Checkout URL not found' }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ url: checkoutUrl }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }

      // 3.2. Mercado Pago Webhook Endpoint
      if (path === '/api/webhook/mercadopago' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
          await env.DB.prepare('INSERT INTO debug_logs (message, payload) VALUES (?, ?)')
            .bind('MP Webhook RECEIVED', JSON.stringify(body))
            .run();
        } catch (e) {
          return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
        }

        // Mercado Pago sends a notification with an ID, we need to fetch the payment details
        if (body.type === 'payment' && body.data && body.data.id) {
          const paymentId = body.data.id;
          const accessToken = env.MP_ACCESS_TOKEN;

          const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });

          if (paymentRes.ok) {
            const paymentData = await paymentRes.json();
            if (paymentData.status === 'approved') {
              const email = paymentData.external_reference || paymentData.payer?.email;
              if (email) {
                const emailLower = email.toLowerCase();
                await env.DB.prepare('UPDATE users SET is_premium = 1 WHERE email = ?')
                  .bind(emailLower)
                  .run();
                await env.DB.prepare('INSERT INTO debug_logs (message, payload) VALUES (?, ?)')
                  .bind('Upgrade SUCCESS', 'MP Payment approved for: ' + emailLower)
                  .run();
              }
            }
          }
        }

        return new Response('OK', { headers: corsHeaders });
      }

      // 4. Tasks Endpoints
      if (path.startsWith('/api/tasks')) {
        const verifiedEmail = await verifyGoogleToken(token);
        const headerEmail = request.headers.get('X-User-Email');

        if (!verifiedEmail || verifiedEmail !== headerEmail?.toLowerCase()) {
          return new Response('Unauthorized - Invalid Token or Email Mismatch', { status: 401, headers: corsHeaders });
        }

        const emailLower = verifiedEmail;

        // GET Tasks
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare(
            'SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC'
          ).bind(emailLower).all();
          return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, 'content-type': 'application/json' }
          });
        }

        // POST Tasks (Upsert)
        if (request.method === 'POST') {
          const body = await request.json();
          const { uuid, name, targetFreq, completions, createdAt } = body;

          if (!uuid || !name) return new Response('Missing required fields', { status: 400, headers: corsHeaders });

          const now = new Date().toISOString();
          const taskCreatedAt = createdAt || now;

          await env.DB.prepare(`
            INSERT INTO tasks (uuid, user_email, name, target_freq, completions, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
              name = excluded.name,
              target_freq = excluded.target_freq,
              completions = excluded.completions,
              created_at = CASE 
                WHEN excluded.created_at < tasks.created_at THEN excluded.created_at 
                ELSE tasks.created_at 
              END,
              updated_at = excluded.updated_at
          `).bind(
            uuid, emailLower, name, targetFreq || 1,
            JSON.stringify(completions || []),
            taskCreatedAt,
            now
          ).run();

          return new Response('OK', { headers: corsHeaders });
        }

        // DELETE Task
        const match = path.match(/^\/api\/tasks\/([^\/]+)$/);
        if (request.method === 'DELETE' && match) {
          const uuid = match[1];
          await env.DB.prepare('DELETE FROM tasks WHERE uuid = ? AND user_email = ?')
            .bind(uuid, emailLower)
            .run();
          return new Response('Deleted', { headers: corsHeaders });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err) {
      console.error('[Worker Error]', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }
  }
};
