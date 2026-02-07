import { AutoRouter, cors } from 'itty-router';

const { preflight, corsify } = cors({
  origin: '*',
  headers: {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
  }
});

const router = AutoRouter();

router.all('*', (request) => {
  console.log('[Request]', request.method, request.url);
  console.log('Headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));
  return preflight(request);
});
const withAuth = (request) => {
  const userEmail = request.headers.get('X-User-Email');
  if (!userEmail) {
    return new Response('Unauthorized - Missing User Email', { status: 401 });
  }
  request.userEmail = userEmail;
};

// Common CORS handling
router.all('*', preflight);

// GET all tasks for a user
router.get('/api/tasks', withAuth, async (request, env) => {
  const { results } = await env.DB.prepare(
    'SELECT * FROM tasks WHERE user_email = ? ORDER BY created_at DESC'
  ).bind(request.userEmail).all();
  return results;
});

router.post('/api/tasks', withAuth, async (request, env) => {
  try {
    const body = await request.json();
    const { uuid, name, targetFreq, completions } = body;
    const email = request.userEmail;

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
      email,
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

// DEBUB endpoint (Public for visibility during dev)
router.get('/api/debug', async (request, env) => {
  const tasksCount = await env.DB.prepare('SELECT COUNT(*) as total FROM tasks').first('total');
  const users = await env.DB.prepare('SELECT email, last_login FROM users ORDER BY last_login DESC LIMIT 5').all();
  return Response.json({
    status: 'online',
    database: 'connected',
    stats: { tasks: tasksCount },
    recent_logins: users.results,
    server_time: new Date().toISOString()
  });
});

// LOGIN tracking endpoint
router.post('/api/login', async (request, env) => {
  try {
    const { email, name, picture } = await request.json();
    if (!email) return new Response('Email required', { status: 400 });

    await env.DB.prepare(`
      INSERT INTO users (email, name, picture, last_login)
      VALUES (?, ?, ?, ?)
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

export default {
  fetch: (request, env, ctx) => router.fetch(request, env, ctx).then(corsify)
};
