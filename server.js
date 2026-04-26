require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');

// Register plugins
fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'happe-secret-key-change-in-production',
});

// Health check route
fastify.get('/', async (request, reply) => {
  return { 
    status: 'ok', 
    message: 'Happ-E API is running',
    version: '1.0.0'
  };
});

// Auth routes
fastify.post('/auth/register', async (request, reply) => {
  const { name, email, password } = request.body;
  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'Name, email and password are required' });
  }
  const token = fastify.jwt.sign({ email, name });
  return { 
    success: true, 
    token,
    user: { name, email, handle: '@' + name.toLowerCase().replace(/\s/g, '') }
  };
});

fastify.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }
  const token = fastify.jwt.sign({ email });
  return { 
    success: true, 
    token,
    user: { email, name: 'Stephen', handle: '@stephen' }
  };
});

// Posts routes
fastify.get('/posts', async (request, reply) => {
  return {
    success: true,
    posts: [
      { id: '1', user: '@stephen', name: 'Stephen Olmo', text: 'First project of the year done.', type: 'post', image: 'https://picsum.photos/seed/wood1/600/750', widescreen: true, smiles: 12, comments: [] },
      { id: '2', user: '✦ Inspire', text: '"The secret of getting ahead is getting started."', author: '— Mark Twain', type: 'inspire', smiles: 34, comments: [], widescreen: true },
    ]
  };
});

fastify.post('/posts/:id/smile', async (request, reply) => {
  const { id } = request.params;
  return { success: true, postId: id, message: 'Smile recorded' };
});

fastify.post('/posts/:id/comment', async (request, reply) => {
  const { id } = request.params;
  const { text, user } = request.body;
  return { success: true, postId: id, comment: { user, text, id: Date.now().toString() } };
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('Happ-E server running on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();