if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

fastify.register(cors, { origin: true, credentials: true });
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'happe-secret-key',
});

async function sendPush(pushToken, title, body, data = {}) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: 'default' }),
    });
  } catch (err) {
    console.error('Push send error:', err.message);
  }
}

fastify.get('/', async () => ({
  status: 'ok',
  message: 'Happ-E API is running',
  version: '1.0.0'
}));

fastify.post('/auth/register', async (request, reply) => {
  const { name, email, password } = request.body;
  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'All fields required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(400).send({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const handle = '@' + name.toLowerCase().replace(/\s/g, '') + Math.floor(Math.random() * 999);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, handle) VALUES ($1, $2, $3, $4) RETURNING id, name, email, handle',
      [name, email, passwordHash, handle]
    );
    const user = result.rows[0];
    const token = fastify.jwt.sign({ id: user.id, email: user.email, handle: user.handle });
    return { success: true, token, user };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'No account found' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Incorrect password' });
    }
    const token = fastify.jwt.sign({ id: user.id, email: user.email, handle: user.handle });
    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, handle: user.handle, onboarded: user.onboarded ?? false } };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/push-token', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { pushToken } = request.body;
  if (!pushToken) return reply.status(400).send({ error: 'pushToken required' });
  try {
    await pool.query('UPDATE users SET push_token = $1 WHERE id = $2', [pushToken, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/change-password', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { currentPassword, newPassword } = request.body;
  if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'Both passwords required' });
  if (newPassword.length < 8) return reply.status(400).send({ error: 'New password must be at least 8 characters' });
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.delete('/auth/account', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { password } = request.body;
  if (!password) return reply.status(400).send({ error: 'Password required' });
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) return reply.status(401).send({ error: 'Incorrect password' });
    const uid = request.user.id;
    await pool.query('DELETE FROM notifications WHERE user_id = $1 OR actor_id = $1', [uid]);
    await pool.query('DELETE FROM smiles WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM comments WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM follows WHERE follower_id = $1 OR following_id = $1', [uid]);
    await pool.query('DELETE FROM posts WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

// GET /profile/me
fastify.get('/profile/me', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'SELECT id, name, email, handle, bio, category, location, website, avatar_url, verified, created_at FROM users WHERE id = $1',
      [request.user.id]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const postCount = await pool.query('SELECT COUNT(*) FROM posts WHERE user_id = $1', [request.user.id]);
    const followerCount = await pool.query('SELECT COUNT(*) FROM follows WHERE following_id = $1', [request.user.id]);
    const followingCount = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [request.user.id]);
    return {
      success: true,
      user: {
        ...result.rows[0],
        posts: parseInt(postCount.rows[0].count) || 0,
        followers: parseInt(followerCount.rows[0].count) || 0,
        following: parseInt(followingCount.rows[0].count) || 0,
      }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

// PUT /profile/me
fastify.put('/profile/me', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { name, bio, category, location, website, avatar_url } = request.body;
  try {
    const result = await pool.query(
      'UPDATE users SET name = $1, bio = $2, category = $3, location = $4, website = $5, avatar_url = COALESCE($6, avatar_url) WHERE id = $7 RETURNING id, name, email, handle, bio, category, location, website, avatar_url',
      [name, bio, category, location, website, avatar_url ?? null, request.user.id]
    );
    return { success: true, user: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.get('/posts/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const result = await pool.query(`
      SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
        COUNT(DISTINCT s.id) as smile_count,
        COUNT(DISTINCT c.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN smiles s ON p.id = s.post_id
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE p.id = $1
      GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
    `, [id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    const comments = await pool.query(`
      SELECT c.text, c.created_at, u.name, u.handle, u.avatar_url
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [id]);
    return { success: true, post: { ...result.rows[0], comments: comments.rows } };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/posts', async (request, reply) => {
  const { type, text, image_url, video_url, widescreen, author, category } = request.body;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO posts (user_id, type, text, image_url, video_url, widescreen, author_quote, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [request.user.id, type, text, image_url, video_url, widescreen || false, author || null, category || null]
    );
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/posts', async (request, reply) => {
  const { category, mood, since, following } = request.query;
  const sinceDate = since ? new Date(since) : null;
  const sinceValid = sinceDate && !isNaN(sinceDate.getTime());
  try {
    let result;
    if (following === 'true') {
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (sinceValid) params.push(sinceDate.toISOString());
        result = await pool.query(`
          SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
            COUNT(DISTINCT s.id) as smile_count,
            COUNT(DISTINCT c.id) as comment_count
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN smiles s ON p.id = s.post_id
          LEFT JOIN comments c ON p.id = c.post_id
          WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
          ${sinceValid ? 'AND p.created_at > $2::timestamptz' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
          LIMIT 100
        `, params);
      } else {
        result = { rows: [] };
      }
    } else if (mood === 'true') {
      // For You feed — filter by authenticated user's interests
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (sinceValid) params.push(sinceDate.toISOString());
        result = await pool.query(`
          SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
            COUNT(DISTINCT s.id) as smile_count,
            COUNT(DISTINCT c.id) as comment_count
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN smiles s ON p.id = s.post_id
          LEFT JOIN comments c ON p.id = c.post_id
          WHERE p.category = ANY(
            SELECT unnest(interests) FROM users WHERE id = $1
          )${sinceValid ? ' AND p.created_at > $2::timestamptz' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
          LIMIT 100
        `, params);
      } else {
        const params = sinceValid ? [sinceDate.toISOString()] : [];
        result = await pool.query(`
          SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
            COUNT(DISTINCT s.id) as smile_count,
            COUNT(DISTINCT c.id) as comment_count
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN smiles s ON p.id = s.post_id
          LEFT JOIN comments c ON p.id = c.post_id
          ${sinceValid ? 'WHERE p.created_at > $1::timestamptz' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC LIMIT 50
        `, params);
      }
    } else if (category) {
      const params = [category];
      if (sinceValid) params.push(sinceDate.toISOString());
      result = await pool.query(`
          SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
            COUNT(DISTINCT s.id) as smile_count,
            COUNT(DISTINCT c.id) as comment_count
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN smiles s ON p.id = s.post_id
          LEFT JOIN comments c ON p.id = c.post_id
          WHERE LOWER(p.category) = LOWER($1)${sinceValid ? ' AND p.created_at > $2::timestamptz' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
        `, params);
    } else {
      const params = sinceValid ? [sinceDate.toISOString()] : [];
      result = await pool.query(`
          SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
            COUNT(DISTINCT s.id) as smile_count,
            COUNT(DISTINCT c.id) as comment_count
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN smiles s ON p.id = s.post_id
          LEFT JOIN comments c ON p.id = c.post_id
          ${sinceValid ? 'WHERE p.created_at > $1::timestamptz' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
        `, params);
    }
    return { success: true, posts: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Could not fetch posts' });
  }
});

fastify.post('/posts/:id/smile', async (request, reply) => {
  const { id } = request.params;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const existing = await pool.query('SELECT id FROM smiles WHERE user_id = $1 AND post_id = $2', [request.user.id, id]);
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM smiles WHERE user_id = $1 AND post_id = $2', [request.user.id, id]);
      return { success: true, action: 'removed' };
    }
    await pool.query('INSERT INTO smiles (user_id, post_id) VALUES ($1, $2)', [request.user.id, id]);
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (post.rows.length > 0 && post.rows[0].user_id !== request.user.id) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, $2, $3, $4)',
        [post.rows[0].user_id, 'smile', request.user.id, id]
      );
      const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
      const owner = await pool.query('SELECT push_token FROM users WHERE id = $1', [post.rows[0].user_id]);
      if (owner.rows[0]?.push_token) {
        const actorName = actor.rows[0]?.name ?? 'Someone';
        await sendPush(owner.rows[0].push_token, 'Happ-E', `${actorName} smiled at your post 😊`, { type: 'smile', postId: String(id) });
      }
    }
    return { success: true, action: 'added' };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/posts/:id', async (request, reply) => {
  const { id } = request.params;
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (post.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    if (String(post.rows[0].user_id) !== String(request.user.id)) {
      return reply.status(403).send({ error: 'Not your post' });
    }
    await pool.query('DELETE FROM notifications WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM smiles WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM comments WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/posts/:id/comment', async (request, reply) => {
  const { id } = request.params;
  const { text } = request.body;
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO comments (user_id, post_id, text) VALUES ($1, $2, $3) RETURNING *',
      [request.user.id, id, text]
    );
    const post = await pool.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (post.rows.length > 0 && post.rows[0].user_id !== request.user.id) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, actor_id, post_id) VALUES ($1, $2, $3, $4)',
        [post.rows[0].user_id, 'comment', request.user.id, id]
      );
      const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
      const owner = await pool.query('SELECT push_token FROM users WHERE id = $1', [post.rows[0].user_id]);
      if (owner.rows[0]?.push_token) {
        const actorName = actor.rows[0]?.name ?? 'Someone';
        await sendPush(owner.rows[0].push_token, 'Happ-E', `${actorName} commented on your post`, { type: 'comment', postId: String(id) });
      }
    }
    return { success: true, comment: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// GET /profile/me/interests
fastify.get('/profile/me/interests', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query('SELECT interests FROM users WHERE id = $1', [request.user.id]);
    return { success: true, interests: result.rows[0]?.interests ?? [] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// PUT /profile/me/interests
fastify.put('/profile/me/interests', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { interests } = request.body;
  if (!Array.isArray(interests) || interests.length < 3) {
    return reply.status(400).send({ error: 'Select at least 3 interests' });
  }
  try {
    await pool.query('UPDATE users SET interests = $1 WHERE id = $2', [interests, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// POST /onboarding/complete
fastify.post('/onboarding/complete', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { interests } = request.body;
  if (!Array.isArray(interests) || interests.length < 3) {
    return reply.status(400).send({ error: 'Select at least 3 interests' });
  }
  try {
    await pool.query(
      'UPDATE users SET interests = $1, onboarded = true WHERE id = $2',
      [interests, request.user.id]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// GET /profile/me/posts
fastify.get('/profile/me/posts', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      `SELECT id, type, text, image_url, video_url, created_at,
              COUNT(DISTINCT s.id) as smile_count
       FROM posts
       LEFT JOIN smiles s ON posts.id = s.post_id
       WHERE posts.user_id = $1
       GROUP BY posts.id
       ORDER BY posts.created_at DESC`,
      [request.user.id]
    );
    return { success: true, posts: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Follows ---

fastify.post('/follows/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  if (parseInt(id) === request.user.id) return reply.status(400).send({ error: 'Cannot follow yourself' });
  try {
    await pool.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, id]
    );
    await pool.query(
      'INSERT INTO notifications (user_id, type, actor_id) VALUES ($1, $2, $3)',
      [id, 'follow', request.user.id]
    );
    const actor = await pool.query('SELECT name FROM users WHERE id = $1', [request.user.id]);
    const followed = await pool.query('SELECT push_token FROM users WHERE id = $1', [id]);
    if (followed.rows[0]?.push_token) {
      const actorName = actor.rows[0]?.name ?? 'Someone';
      await sendPush(followed.rows[0].push_token, 'Happ-E', `${actorName} started following you`, { type: 'follow' });
    }
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/follows/:id/check', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  try {
    const result = await pool.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [request.user.id, id]
    );
    return { following: result.rows.length > 0 };
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/follows/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { id } = request.params;
  try {
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [request.user.id, id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- User search ---

fastify.get('/users/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const result = await pool.query(
      `SELECT id, name, handle, bio, category, location, avatar_url, verified, created_at FROM users WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    const postCount = await pool.query('SELECT COUNT(*) FROM posts WHERE user_id = $1', [id]);
    const followerCount = await pool.query('SELECT COUNT(*) FROM follows WHERE following_id = $1', [id]);
    const followingCount = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [id]);
    const posts = await pool.query(
      `SELECT id, type, text, image_url, video_url, created_at, COUNT(DISTINCT s.id) as smile_count
       FROM posts LEFT JOIN smiles s ON posts.id = s.post_id
       WHERE posts.user_id = $1 GROUP BY posts.id ORDER BY posts.created_at DESC`,
      [id]
    );
    return {
      success: true,
      user: {
        ...result.rows[0],
        posts: parseInt(postCount.rows[0].count) || 0,
        followers: parseInt(followerCount.rows[0].count) || 0,
        following: parseInt(followingCount.rows[0].count) || 0,
      },
      userPosts: posts.rows,
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/search', async (request, reply) => {
  const { q } = request.query;
  if (!q || q.trim().length === 0) return { success: true, users: [] };
  const term = `%${q.trim().toLowerCase()}%`;
  try {
    const result = await pool.query(
      `SELECT id, name, handle, category, avatar_url, verified FROM users
       WHERE LOWER(name) LIKE $1 OR LOWER(handle) LIKE $1 OR LOWER(category) LIKE $1
       LIMIT 30`,
      [term]
    );
    return { success: true, users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/suggested', async (request, reply) => {
  try {
    const result = await pool.query(
      `SELECT id, name, handle, category, avatar_url, verified FROM users ORDER BY created_at DESC LIMIT 20`
    );
    return { success: true, users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Notifications ---

fastify.get('/notifications', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT n.id, n.type, n.read, n.created_at, n.post_id, n.actor_id,
              u.name as actor_name, u.handle as actor_handle, u.avatar_url as actor_avatar_url
       FROM notifications n
       JOIN users u ON n.actor_id = u.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [request.user.id]
    );
    return { success: true, notifications: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/notifications/read-all', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Messages ---

fastify.get('/messages', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const userId = request.user.id;
    const result = await pool.query(`
      SELECT DISTINCT ON (partner_id)
        CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END as partner_id,
        m.text as last_message,
        m.created_at as last_at,
        m.sender_id,
        u.name, u.handle, u.avatar_url
      FROM messages m
      JOIN users u ON u.id = (CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END)
      WHERE m.sender_id = $1 OR m.receiver_id = $1
      ORDER BY partner_id, m.created_at DESC
    `, [userId]);
    const unread = await pool.query(
      'SELECT sender_id as partner_id, COUNT(*) as count FROM messages WHERE receiver_id = $1 AND NOT read GROUP BY sender_id',
      [userId]
    );
    const unreadMap = {};
    unread.rows.forEach(r => { unreadMap[r.partner_id] = parseInt(r.count); });
    const conversations = result.rows
      .map(r => ({ ...r, unread: unreadMap[r.partner_id] ?? 0 }))
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
    return { success: true, conversations };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/messages/:userId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const me = request.user.id;
    const other = request.params.userId;
    const result = await pool.query(`
      SELECT m.id, m.sender_id, m.receiver_id, m.text, m.created_at, m.read,
        s.name as sender_name, s.handle as sender_handle, s.avatar_url as sender_avatar
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [me, other]);
    return { success: true, messages: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/messages/:userId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const me = request.user.id;
    const other = request.params.userId;
    const { text } = request.body;
    if (!text?.trim()) return reply.status(400).send({ error: 'Message text required' });
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, text) VALUES ($1, $2, $3) RETURNING *',
      [me, other, text.trim()]
    );
    const [sender, receiver] = await Promise.all([
      pool.query('SELECT name FROM users WHERE id = $1', [me]),
      pool.query('SELECT push_token FROM users WHERE id = $1', [other]),
    ]);
    if (receiver.rows[0]?.push_token) {
      await sendPush(receiver.rows[0].push_token, sender.rows[0]?.name ?? 'Someone', text.trim(), { type: 'message', userId: String(me) });
    }
    return { success: true, message: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/messages/:userId/read', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query(
      'UPDATE messages SET read = true WHERE sender_id = $1 AND receiver_id = $2 AND NOT read',
      [request.params.userId, request.user.id]
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Sparks ---

const SPARK_PROMPTS = [
  "Show us your workspace right now — messy or not.",
  "What's the last thing you made with your hands?",
  "Share a tool you couldn't live without.",
  "Show us something you made that you're proud of.",
  "What does your creative process look like?",
  "Show us a work in progress.",
  "Share your favorite spot to create.",
  "What's the hardest thing you've ever made?",
  "Show us something you made as a gift.",
  "What got you started in your craft?",
  "Share a before and after of your latest project.",
  "Show us your most-used piece of gear.",
  "What's something you're still learning?",
  "Share a recent mistake that taught you something.",
  "Show us your creative setup.",
];

fastify.get('/sparks/current', async (request, reply) => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const responseCount = await pool.query(
      `SELECT COUNT(*) FROM posts WHERE spark_prompt = $1`, [prompt]
    );
    return {
      success: true,
      spark: {
        prompt,
        responses: parseInt(responseCount.rows[0].count) || 0,
      }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/sparks/current/responses', async (request, reply) => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.handle, u.avatar_url,
              COUNT(DISTINCT s.id) as smile_count,
              COUNT(DISTINCT c.id) as comment_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN smiles s ON p.id = s.post_id
       LEFT JOIN comments c ON p.id = c.post_id
       WHERE p.spark_prompt = $1
       GROUP BY p.id, u.name, u.handle, u.avatar_url
       ORDER BY smile_count DESC
       LIMIT 20`,
      [prompt]
    );
    return { success: true, responses: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/sparks/current/respond', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { text, image_url, video_url, type } = request.body;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = SPARK_PROMPTS[dayOfYear % SPARK_PROMPTS.length];
  try {
    const result = await pool.query(
      'INSERT INTO posts (user_id, type, text, image_url, video_url, spark_prompt) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [request.user.id, type || 'image', text, image_url || null, video_url || null, prompt]
    );
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      handle VARCHAR(100) UNIQUE NOT NULL,
      bio TEXT DEFAULT '',
      category VARCHAR(100) DEFAULT '',
      location VARCHAR(100) DEFAULT '',
      website VARCHAR(255) DEFAULT '',
      verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(20) NOT NULL,
      text TEXT,
      image_url TEXT,
      video_url TEXT,
      widescreen BOOLEAN DEFAULT false,
      author_quote TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS smiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      follower_id INTEGER REFERENCES users(id),
      following_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower_id, following_id)
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255) DEFAULT '';`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS spark_prompt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT '{}';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      type VARCHAR(20) NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      read BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages(sender_id, receiver_id);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read);
  `);
  console.log('Database ready');
};

const start = async () => {
  try {
    console.log('Starting Happ-E server...');
    await initDB();
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('Happ-E server running');
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    process.exit(1);
  }
};

start();