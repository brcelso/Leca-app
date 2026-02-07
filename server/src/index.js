import { AutoRouter, cors } from 'itty-router';

const { preflight, corsify } = cors();
const router = AutoRouter({
  before: [preflight]
});

// Middleware to verify User identity (Simplified for local dev)
const withAuth = async (request, env) => {
  const authHeader = request.headers.get('Authorization');
  const userEmail = request.headers.get('X-User-Email'); // Fallback for testing

  // In production, we would verify the JWT from 'Bearer <token>'
  // But for 'modo dev' without a real Client ID yet, we use the header
  if (!userEmail) {
    return new Response('Unauthorized - Missing User Email', { status: 401 });
  }

  request.userEmail = userEmail;
};

// GET all tasks for a user
router.get('/api/tasks', withAuth, async (request, env) => {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM tasks WHERE user_email = ?'
    ).bind(request.userEmail).all();

    return Response.json(results);
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

// UPSERT a task
router.post('/api/tasks', withAuth, async (request, env) => {
  try {
    const task = await request.json();

    await env.DB.prepare(`
      INSERT INTO tasks (uuid, user_email, name, target_freq, completions, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        name = excluded.name,
        target_freq = excluded.target_freq,
        completions = excluded.completions,
        updated_at = excluded.updated_at
    `).bind(
      task.uuid,
      request.userEmail,
      task.name,
      task.targetFreq,
      JSON.stringify(task.completions),
      new Date().toISOString()
    ).run();

    return new Response('OK', { status: 200 });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

// DELETE a task
router.delete('/api/tasks/:uuid', withAuth, async (request, env) => {
  try {
    const { uuid } = request.params;
    await env.DB.prepare('DELETE FROM tasks WHERE uuid = ? AND user_email = ?')
      .bind(uuid, request.userEmail)
      .run();

    return new Response('Deleted', { status: 200 });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
});

export default {
  fetch: (...args) => router.fetch(...args).then(corsify)
};
