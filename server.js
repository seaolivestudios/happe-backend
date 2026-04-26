require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const { pool, initDB } = require('./database');

fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'happe-secret-key-change-in-production',
});

fastify.get('/', async (request, reply) => {
  return {
    status: 'ok',
    message: 'Happ-E API is running',
    version: '1.0.0'
  };
});

fastify.post('/auth/register', async (request, reply) => {
  const { name, email, password } = request.body;
  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'Name, email and password are required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(400).send({ error: 'An account with this email already exists' });
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
    return reply.status(500).send({ error: 'Server error. Please try again.' });
  }
});

fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'No account found with this email' });
    }
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Incorrect password' });
    }
    const token = fastify.jwt.sign({ id: user.id, email: user.email, handle: user.handle });
    return {
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, handle: user.handle }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error. Please try again.' });
  }
});

fastify.get('/posts', async (request, reply) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name, u.handle,
        COUNT(DISTINCT s.id) as smile_count,
        COUNT(DISTINCT c.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN smiles s ON p.id = s.post_id
      LEFT JOIN comments c ON p.id = c.post_id
      GROUP BY p.id, u.name, u.handle
      ORDER BY p.created_at DESC
    `);
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
    await pool.query(
      'INSERT INTO smiles (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [request.user.id, id]
    );
    return { success: true };
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
});

fastify.post('/posts/:id/comment', async (request, reply) => {
  const { id } = request.params;
  const { text } = request.body;
  try {
    await request.jwtVerify();
    const result = await pool.query(
      'INSERT INTO comments (user_id, post_id, text) VALUES ($1, $2, $3) RETURNING *',
      [request.user.id, id, text]
    );
    return { success: true, comment: result.rows[0] };
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
});

const start = async () => {
  try {
    await initDB();
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('Happ-E server running');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();