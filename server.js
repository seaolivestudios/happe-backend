if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

fastify.register(cors, { origin: true, credentials: true });
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'happe-secret-key',
});

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
    return { success: true, token, user: { id: user.id, name: user.name, email: user.email, handle: user.handle } };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Server error' });
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