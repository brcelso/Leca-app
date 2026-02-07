import { Router, cors } from 'itty-router';

// 1. CORS Setup
const { preflight, corsify } = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-User-Email'],
});

const router = Router();

// 2. Auth Middleware
const withAuth = (request) => {
  const userEmail = request.headers.get('X-User-Email');
  if (!userEmail) {
    return new Response('Unauthorized - Missing User Email', { status: 401 });
  }
  request.userEmail = userEmail;
};

// 3. Logger & Preflight
router.all('*', (request) => {
  console.log('[Worker Request]', request.method, request.url);
  return preflight(request);
});

// 4. API Routes
// Health Check
router.get('/', () => new Response('Leca API v6 - Online 🥂', {
  status: 200,
  headers: { 'content-type': 'text/plain; charset=UTF-8' }
}));

// GET all tasks
router.get('/api/tasks', withAuth, async (request, env) => {
  const { results } = await env.DB.prepare(
    'SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC'
  ).bind(request.userEmail).all();
  return new Response(JSON.stringify(results), {
    headers: { 'content-type': 'application/json' }
  });
});

// UPSERT a task
router.post('/api/tasks', withAuth, async (request, env) => {
  try {
    const body = await request.json();
    const { uuid, name, targetFreq, completions } = body;

    if (!uuid || !name) {
      return new Response('Missing required fields', { status: 400 });
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
      request.userEmail,
      name,
      targetFreq || 1,
      JSON.stringify(completions || []),
      new Date().toISOString()
    ).run();

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Worker POST Error]', err);
    return new Response('Sync Error: ' + err.message, { status: 500 });
  }
});

// DEBUG endpoint
router.get('/api/debug', async (request, env) => {
  try {
    const tasksCountRes = await env.DB.prepare('SELECT COUNT(*) as total FROM tasks').first();
    const tasksCount = tasksCountRes ? tasksCountRes.total : 0;
    const users = await env.DB.prepare('SELECT email, last_login FROM users ORDER BY last_login DESC LIMIT 5').all();

    return new Response(JSON.stringify({
      status: 'online',
      database: 'connected',
      stats: { tasks: tasksCount },
      recent_logins: users.results,
      server_time: new Date().toISOString(),
      request_url: request.url
    }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
});

// LOGIN tracking endpoint
router.post('/api/login', async (request, env) => {
  try {
    const { email, name, picture } = await request.json();
    if (!email) return new Response('Email required', { status: 400 });

    await env.DB.prepare(`
      INSERT INTO users (email, name, picture, last_login)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        picture = excluded.picture,
        last_login = CURRENT_TIMESTAMP
    `).bind(email, name, picture).run();

    return new Response('Login Tracked', { status: 200 });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
});

// DELETE a task
router.delete('/api/tasks/:uuid', withAuth, async (request, env) => {
  const { uuid } = request.params;
  await env.DB.prepare('DELETE FROM tasks WHERE uuid = ? AND user_email = ?')
    .bind(uuid, request.userEmail)
    .run();
  return new Response('Deleted', { status: 200 });
});

// 404 Handler
router.all('*', () => new Response('404 Not Found 🥂', { status: 404 }));

// 5. Final Export
export default {
  fetch: (request, env, ctx) => router.handle(request, env, ctx).then(corsify)
};
