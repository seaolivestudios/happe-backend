if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const emailTransporter = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

async function sendEmail(to, subject, html) {
  if (emailTransporter) {
    await emailTransporter.sendMail({ from: `Happ-E <${process.env.EMAIL_USER}>`, to, subject, html });
  } else {
    console.log(`[EMAIL - no transport configured] To: ${to} | ${subject} | ${html}`);
  }
}

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

// --- Shop items catalogue ---
const SHOP_ITEMS = [
  { id: 'happy_burst',    name: 'Happy Burst',    description: 'The classic happy faces explosion', price: 0,   category: 'effect', icon: 'happy' },
  { id: 'firework',       name: 'Firework',       description: 'Rockets launch and explode in colour', price: 100, category: 'effect', icon: 'sparkles' },
  { id: 'sunshine_burst', name: 'Sunshine Burst', description: 'Golden rays radiate like a sunrise', price: 75,  category: 'effect', icon: 'sunny' },
  { id: 'heart_flutter',  name: 'Heart Flutter',  description: 'Golden hearts float upward',         price: 75,  category: 'effect', icon: 'heart' },
  { id: 'star_shower',    name: 'Star Shower',    description: 'Stars shoot in all directions',      price: 75,  category: 'effect', icon: 'star' },
  { id: 'blue_burst',     name: 'Blue Burst',     description: 'Electric blue explosion of energy',  price: 50,  category: 'effect', icon: 'water' },
  { id: 'red_burst',      name: 'Red Burst',      description: 'Bold red burst of excitement',       price: 50,  category: 'effect', icon: 'flame' },
];

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

fastify.post('/auth/forgot-password', async (request, reply) => {
  const { email } = request.body;
  if (!email) return reply.status(400).send({ error: 'Email required' });
  try {
    const result = await pool.query('SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (result.rows.length === 0) return { success: true };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query('UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3', [code, expires, result.rows[0].id]);
    await sendEmail(email, 'Your Happ-E password reset code',
      `<p>Hi ${result.rows[0].name},</p><p>Your password reset code is: <strong>${code}</strong></p><p>This code expires in 15 minutes. If you didn't request this, ignore this email.</p>`
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
  }
});

fastify.post('/auth/reset-password', async (request, reply) => {
  const { email, code, newPassword } = request.body;
  if (!email || !code || !newPassword) return reply.status(400).send({ error: 'Email, code, and new password required' });
  if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND password_reset_token = $2 AND password_reset_expires > NOW()',
      [email, code]
    );
    if (result.rows.length === 0) return reply.status(400).send({ error: 'Invalid or expired code' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2', [hash, result.rows[0].id]);
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
      'SELECT id, name, email, handle, bio, category, location, website, avatar_url, verified, created_at, coins, selected_effect FROM users WHERE id = $1',
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
  const { name, bio, category, location, website, avatar_url, handle } = request.body;
  try {
    if (handle) {
      const normalized = handle.startsWith('@') ? handle : `@${handle}`;
      const conflict = await pool.query(
        'SELECT id FROM users WHERE LOWER(handle) = LOWER($1) AND id != $2',
        [normalized, request.user.id]
      );
      if (conflict.rows.length > 0) {
        return reply.status(400).send({ error: 'Handle already taken' });
      }
      const result = await pool.query(
        'UPDATE users SET name = $1, bio = $2, category = $3, location = $4, website = $5, avatar_url = COALESCE($6, avatar_url), handle = $7 WHERE id = $8 RETURNING id, name, email, handle, bio, category, location, website, avatar_url',
        [name, bio, category, location, website, avatar_url ?? null, normalized, request.user.id]
      );
      return { success: true, user: result.rows[0] };
    }
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
      SELECT c.id, c.user_id, c.text, c.created_at, u.name, u.handle, u.avatar_url
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
    // Award coins: 50 for widescreen/supportive video, 10 for any other post
    const coinReward = (widescreen === true || widescreen === 'true') ? 50 : 10;
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinReward, request.user.id]);
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/posts', async (request, reply) => {
  const { category, mood, since, following, trending, cursor, limit: limitStr } = request.query;
  const sinceDate = since ? new Date(since) : null;
  const sinceValid = sinceDate && !isNaN(sinceDate.getTime());
  const limit = Math.min(parseInt(limitStr) || 20, 50);
  const cursorId = cursor ? parseInt(cursor) : null;

  // shared SELECT fragment
  const SELECT = `SELECT p.*, u.name, u.handle, u.avatar_url, u.id as user_id, u.verified,
    COUNT(DISTINCT s.id) as smile_count,
    COUNT(DISTINCT c.id) as comment_count
  FROM posts p
  JOIN users u ON p.user_id = u.id
  LEFT JOIN smiles s ON p.id = s.post_id
  LEFT JOIN comments c ON p.id = c.post_id`;

  try {
    let result;

    if (trending === 'true') {
      const params = cursorId ? [limit + 1, cursorId] : [limit + 1];
      result = await pool.query(`
        ${SELECT}
        ${cursorId ? 'WHERE p.id < $2' : ''}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
        ORDER BY (
          (COUNT(DISTINCT s.id) * 2 + COUNT(DISTINCT c.id)) /
          POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 + 2, 1.8)
        ) DESC, p.created_at DESC
        LIMIT $1
      `, params);
    } else if (following === 'true') {
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (sinceValid) params.push(sinceDate.toISOString());
        if (cursorId) params.push(cursorId);
        params.push(limit + 1);
        result = await pool.query(`
          ${SELECT}
          WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
          ${sinceValid ? `AND p.created_at > $2::timestamptz` : ''}
          ${cursorId ? `AND p.id < $${sinceValid ? 3 : 2}` : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
          LIMIT $${params.length}
        `, params);
      } else {
        result = { rows: [] };
      }
    } else if (mood === 'true') {
      let userId = null;
      try { await request.jwtVerify(); userId = request.user.id; } catch {}
      if (userId) {
        const params = [userId];
        if (cursorId) params.push(cursorId);
        params.push(limit + 1);
        result = await pool.query(`
          ${SELECT}
          WHERE p.category = ANY(SELECT unnest(interests) FROM users WHERE id = $1)
          ${cursorId ? `AND p.id < $2` : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
          LIMIT $${params.length}
        `, params);
      } else {
        const params = cursorId ? [cursorId, limit + 1] : [limit + 1];
        result = await pool.query(`
          ${SELECT}
          ${cursorId ? 'WHERE p.id < $1' : ''}
          GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
          ORDER BY p.created_at DESC
          LIMIT $${cursorId ? 2 : 1}
        `, params);
      }
    } else if (category) {
      const params = [category];
      if (cursorId) params.push(cursorId);
      params.push(limit + 1);
      result = await pool.query(`
        ${SELECT}
        WHERE LOWER(p.category) = LOWER($1)
        ${cursorId ? 'AND p.id < $2' : ''}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
        ORDER BY p.created_at DESC
        LIMIT $${params.length}
      `, params);
    } else {
      const params = [];
      if (sinceValid) params.push(sinceDate.toISOString());
      if (cursorId) params.push(cursorId);
      params.push(limit + 1);
      const whereClause = sinceValid && cursorId
        ? `WHERE p.created_at > $1::timestamptz AND p.id < $2`
        : sinceValid ? `WHERE p.created_at > $1::timestamptz`
        : cursorId ? `WHERE p.id < $1`
        : '';
      result = await pool.query(`
        ${SELECT}
        ${whereClause}
        GROUP BY p.id, u.name, u.handle, u.avatar_url, u.id, u.verified
        ORDER BY p.created_at DESC
        LIMIT $${params.length}
      `, params);
    }

    const rows = result.rows ?? [];
    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && posts.length > 0 ? String(posts[posts.length - 1].id) : null;
    return { success: true, posts, has_more: hasMore, next_cursor: nextCursor };
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
      // Deduct 1 coin for un-smiling (floor at 0)
      await pool.query('UPDATE users SET coins = GREATEST(coins - 1, 0) WHERE id = $1', [request.user.id]);
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
    // Award 1 coin to the smiler
    await pool.query('UPDATE users SET coins = coins + 1 WHERE id = $1', [request.user.id]);
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
    const post = await pool.query('SELECT user_id, created_at, widescreen FROM posts WHERE id = $1', [id]);
    if (post.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    if (String(post.rows[0].user_id) !== String(request.user.id)) {
      return reply.status(403).send({ error: 'Not your post' });
    }
    await pool.query('DELETE FROM notifications WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM smiles WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM comments WHERE post_id = $1', [id]);
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    // Deduct coins if post was created within the last 24 hours
    const ageMs = Date.now() - new Date(post.rows[0].created_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      const coinPenalty = post.rows[0].widescreen ? 50 : 10;
      await pool.query('UPDATE users SET coins = GREATEST(coins - $1, 0) WHERE id = $2', [coinPenalty, request.user.id]);
    }
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
    // Award 5 coins to the commenter — only for their FIRST comment on this post
    const prevComments = await pool.query(
      'SELECT id FROM comments WHERE user_id = $1 AND post_id = $2 AND id != $3',
      [request.user.id, id, result.rows[0].id]
    );
    if (prevComments.rows.length === 0) {
      await pool.query('UPDATE users SET coins = coins + 5 WHERE id = $1', [request.user.id]);
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
      `SELECT posts.id, posts.type, posts.text, posts.image_url, posts.video_url, posts.created_at,
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

fastify.get('/follows/following', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url
       FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY u.name ASC`,
      [request.user.id]
    );
    return { users: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Coins & Shop ---

fastify.get('/coins', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query('SELECT coins, selected_effect FROM users WHERE id = $1', [request.user.id]);
    return { coins: result.rows[0]?.coins ?? 0, selected_effect: result.rows[0]?.selected_effect ?? 'happy_burst' };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/shop/items', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const unlockRes = await pool.query('SELECT item_id FROM user_unlocks WHERE user_id = $1', [request.user.id]);
    const userRes = await pool.query('SELECT selected_effect FROM users WHERE id = $1', [request.user.id]);
    const ownedIds = new Set(unlockRes.rows.map(r => r.item_id));
    ownedIds.add('happy_burst'); // always owned
    const selected = userRes.rows[0]?.selected_effect ?? 'happy_burst';
    const items = SHOP_ITEMS.map(item => ({
      ...item,
      owned: ownedIds.has(item.id),
      equipped: item.id === selected,
    }));
    return { items };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.post('/shop/purchase/:itemId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { itemId } = request.params;
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return reply.status(404).send({ error: 'Item not found' });
  if (item.price === 0) return reply.status(400).send({ error: 'Item is free' });
  try {
    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [request.user.id]);
    const coins = userRes.rows[0]?.coins ?? 0;
    if (coins < item.price) return reply.status(400).send({ error: 'Not enough coins' });
    // Check already owned
    const existing = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, itemId]);
    if (existing.rows.length > 0) return reply.status(400).send({ error: 'Already owned' });
    await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [item.price, request.user.id]);
    await pool.query('INSERT INTO user_unlocks (user_id, item_id) VALUES ($1, $2)', [request.user.id, itemId]);
    const updated = await pool.query('SELECT coins FROM users WHERE id = $1', [request.user.id]);
    return { success: true, coins: updated.rows[0].coins };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.put('/shop/select-effect', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { effectId } = request.body;
  if (!SHOP_ITEMS.find(i => i.id === effectId)) return reply.status(404).send({ error: 'Effect not found' });
  try {
    // Must own it (or be free)
    const item = SHOP_ITEMS.find(i => i.id === effectId);
    if (item.price > 0) {
      const owned = await pool.query('SELECT id FROM user_unlocks WHERE user_id = $1 AND item_id = $2', [request.user.id, effectId]);
      if (owned.rows.length === 0) return reply.status(403).send({ error: 'Not owned' });
    }
    await pool.query('UPDATE users SET selected_effect = $1 WHERE id = $2', [effectId, request.user.id]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/shop/my-unlocks', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const unlockRes = await pool.query('SELECT item_id FROM user_unlocks WHERE user_id = $1', [request.user.id]);
    const userRes = await pool.query('SELECT selected_effect FROM users WHERE id = $1', [request.user.id]);
    const unlocks = ['happy_burst', ...unlockRes.rows.map(r => r.item_id)];
    return { unlocks, selected_effect: userRes.rows[0]?.selected_effect ?? 'happy_burst' };
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
      `SELECT posts.id, posts.type, posts.text, posts.image_url, posts.video_url, posts.created_at,
              COUNT(DISTINCT s.id) as smile_count
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
    const { text, gif_url } = request.body;
    if (!text?.trim() && !gif_url) return reply.status(400).send({ error: 'Message text or gif required' });
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, text, gif_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [me, other, text?.trim() ?? '', gif_url ?? null]
    );
    const [sender, receiver] = await Promise.all([
      pool.query('SELECT name FROM users WHERE id = $1', [me]),
      pool.query('SELECT push_token FROM users WHERE id = $1', [other]),
    ]);
    if (receiver.rows[0]?.push_token) {
      const preview = gif_url ? 'Sent a GIF' : (text?.trim() ?? '');
      await sendPush(receiver.rows[0].push_token, sender.rows[0]?.name ?? 'Someone', preview, { type: 'message', userId: String(me) });
    }
    return { success: true, message: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/messages/unread-count', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND NOT read',
      [request.user.id]
    );
    return { success: true, count: parseInt(result.rows[0].count) || 0 };
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

// --- Comment deletion ---

fastify.delete('/posts/:postId/comments/:commentId', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { postId, commentId } = request.params;
  try {
    const check = await pool.query('SELECT user_id FROM comments WHERE id = $1 AND post_id = $2', [commentId, postId]);
    if (check.rows.length === 0) return reply.status(404).send({ error: 'Comment not found' });
    if (String(check.rows[0].user_id) !== String(request.user.id)) return reply.status(403).send({ error: 'Forbidden' });
    await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post reporting ---

fastify.post('/posts/:id/report', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { reason } = request.body;
  try {
    await pool.query(
      'INSERT INTO reports (reporter_id, post_id, reason) VALUES ($1, $2, $3) ON CONFLICT (reporter_id, post_id) DO UPDATE SET reason = EXCLUDED.reason',
      [request.user.id, request.params.id, reason ?? 'unspecified']
    );
    const [reporter, post] = await Promise.all([
      pool.query('SELECT name, email FROM users WHERE id = $1', [request.user.id]),
      pool.query('SELECT p.text, p.image_url, u.name as author FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = $1', [request.params.id]),
    ]);
    await sendEmail(
      'oops@happe.com',
      `Post reported — ${reason ?? 'unspecified'}`,
      `<p><b>Reported by:</b> ${reporter.rows[0]?.name} (${reporter.rows[0]?.email})</p>
       <p><b>Post author:</b> ${post.rows[0]?.author}</p>
       <p><b>Post text:</b> ${post.rows[0]?.text ?? '(no text)'}</p>
       <p><b>Reason:</b> ${reason ?? 'unspecified'}</p>
       <p><b>Post ID:</b> ${request.params.id}</p>`
    );
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Blocked users ---

fastify.post('/users/:id/block', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const blockedId = parseInt(request.params.id);
  if (blockedId === request.user.id) return reply.status(400).send({ error: 'Cannot block yourself' });
  try {
    await pool.query(
      'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, blockedId]
    );
    await pool.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [request.user.id, blockedId]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.delete('/users/:id/block', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    await pool.query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [request.user.id, parseInt(request.params.id)]);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

fastify.get('/users/blocked', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.handle, u.avatar_url FROM blocked_users b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [request.user.id]
    );
    return { success: true, blocked: result.rows };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Notification preferences ---

fastify.put('/profile/me/notifications', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { push, inspire, comments, likes } = request.body;
  try {
    const prefs = { push: !!push, inspire: !!inspire, comments: !!comments, likes: !!likes };
    await pool.query('UPDATE users SET notification_preferences = $1::jsonb WHERE id = $2', [JSON.stringify(prefs), request.user.id]);
    return { success: true, preferences: prefs };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post editing ---

fastify.put('/posts/:id', async (request, reply) => {
  try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  const { text } = request.body;
  try {
    const check = await pool.query('SELECT user_id FROM posts WHERE id = $1', [request.params.id]);
    if (check.rows.length === 0) return reply.status(404).send({ error: 'Post not found' });
    if (String(check.rows[0].user_id) !== String(request.user.id)) return reply.status(403).send({ error: 'Forbidden' });
    const result = await pool.query('UPDATE posts SET text = $1 WHERE id = $2 RETURNING *', [text, request.params.id]);
    return { success: true, post: result.rows[0] };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- Post search ---

fastify.get('/posts/search', async (request, reply) => {
  const { q } = request.query;
  if (!q || q.trim().length === 0) return { success: true, posts: [] };
  const term = `%${q.trim().toLowerCase()}%`;
  try {
    const result = await pool.query(
      `SELECT p.id, p.type, p.text, p.image_url, p.video_url, p.created_at,
              u.id as user_id, u.name, u.handle, u.avatar_url,
              COUNT(DISTINCT s.id) as smile_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN smiles s ON p.id = s.post_id
       WHERE LOWER(p.text) LIKE $1
       GROUP BY p.id, u.id, u.name, u.handle, u.avatar_url
       ORDER BY p.created_at DESC
       LIMIT 30`,
      [term]
    );
    return { success: true, posts: result.rows };
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

// TEMP admin route — will be removed after use
fastify.post('/admin/give-coins', async (request, reply) => {
  if (request.headers['x-admin-secret'] !== 'happe-admin-2026') return reply.status(403).send({ error: 'Forbidden' });
  const { handle, coins } = request.body;
  try {
    const result = await pool.query(
      `UPDATE users SET coins = coins + $1 WHERE LOWER(handle) = LOWER($2) RETURNING id, handle, coins`,
      [coins, handle]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { success: true, user: result.rows[0] };
  } catch (err) {
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(10) DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP DEFAULT NULL;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"push":true,"inspire":true,"comments":true,"likes":true}'::jsonb;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id SERIAL PRIMARY KEY,
      blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(blocker_id, blocked_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      reason TEXT NOT NULL DEFAULT 'unspecified',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(reporter_id, post_id)
    );
  `);
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
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS gif_url TEXT DEFAULT NULL;`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS widescreen BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_effect VARCHAR(50) DEFAULT 'happy_burst';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_unlocks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_id VARCHAR(50) NOT NULL,
      purchased_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, item_id)
    );
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

start();// Tue May 19 23:35:04 EDT 2026
