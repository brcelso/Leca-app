
// Vanilla Worker Router - Zero Dependencies 🥂

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
};

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
        return new Response('Leca API v6 - Online 🥂', {
          headers: { ...corsHeaders, 'content-type': 'text/plain; charset=UTF-8' }
        });
      }

      // 2. Debug Endpoint
      if (path === '/api/debug' && request.method === 'GET') {
        const count = await env.DB.prepare('SELECT COUNT(*) as total FROM tasks').first();
        const users = await env.DB.prepare('SELECT email, last_login FROM users ORDER BY last_login DESC LIMIT 5').all();

        return new Response(JSON.stringify({
          status: 'online',
          database: 'connected',
          stats: { tasks: count?.total || 0 },
          recent_logins: users?.results || [],
          server_time: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }

      // 3. Login Endpoint
      if (path === '/api/login' && request.method === 'POST') {
        const { email, name, picture } = await request.json();
        if (!email) return new Response('Email required', { status: 400, headers: corsHeaders });

        await env.DB.prepare(`
          INSERT INTO users (email, name, picture, last_login)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            picture = excluded.picture,
            last_login = CURRENT_TIMESTAMP
        `).bind(email, name, picture).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' }
        });
      }

      // 4. Tasks Endpoints
      // Auth Check for Tasks
      if (path.startsWith('/api/tasks')) {
        const userEmail = request.headers.get('X-User-Email');
        if (!userEmail) {
          return new Response('Unauthorized - Missing X-User-Email header', { status: 401, headers: corsHeaders });
        }

        // GET Tasks
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare(
            'SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC'
          ).bind(userEmail).all();
          return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, 'content-type': 'application/json' }
          });
        }

        // POST Tasks (Upsert)
        if (request.method === 'POST') {
          const body = await request.json();
          const { uuid, name, targetFreq, completions } = body;

          if (!uuid || !name) return new Response('Missing required fields', { status: 400, headers: corsHeaders });

          await env.DB.prepare(`
            INSERT INTO tasks (uuid, user_email, name, target_freq, completions, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
              name = excluded.name,
              target_freq = excluded.target_freq,
              completions = excluded.completions,
              updated_at = excluded.updated_at
          `).bind(
            uuid, userEmail, name, targetFreq || 1,
            JSON.stringify(completions || []),
            new Date().toISOString()
          ).run();

          return new Response('OK', { headers: corsHeaders });
        }

        // DELETE Task
        // Match /api/tasks/:uuid
        const match = path.match(/^\/api\/tasks\/([^\/]+)$/);
        if (request.method === 'DELETE' && match) {
          const uuid = match[1];
          await env.DB.prepare('DELETE FROM tasks WHERE uuid = ? AND user_email = ?')
            .bind(uuid, userEmail)
            .run();
          return new Response('Deleted', { headers: corsHeaders });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err) {
      console.error('[Worker Error]', err);
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }
  }
};
