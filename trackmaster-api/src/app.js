import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAuth } from './auth.js';
import { clientKey } from './request.js';
import { jsonError } from './responses.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';
import { createPresetsRouter } from './routes/presets.js';
import { createTracksRouter } from './routes/tracks.js';

export function createApp({ config, repositories }) {
  const app = express();
  const auth = createAuth({ config, repositories });

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(createSecurityHeaders(config));

  if (config.corsOrigin) {
    app.use(createCorsHeaders(config));
  }

  app.use('/api', rateLimit({
    windowMs: config.apiRateWindowMs,
    limit: config.apiRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
  }));

  mountBrowserAuthRoutes(app, '/auth', { auth, config, repositories });
  mountApiRoutes(app, '/api', { auth, config, repositories });
  mountApiRoutes(app, '/api/v1', { auth, config, repositories });
  app.use(createErrorHandler());

  return app;
}

function createSecurityHeaders(config) {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.production) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

function createCorsHeaders(config) {
  return (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Prefer, X-Album, X-Async-Export, X-Artist, X-Comment, X-Copyright, X-Date, X-Duration-Seconds, X-File-Name, X-Format, X-Genre, X-Release-Date, X-Release-Year, X-Title, X-Track-Album, X-Track-Artist, X-Track-Comment, X-Track-Genre, X-Track-Title, X-Year');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function mountBrowserAuthRoutes(app, authPath, context) {
  const { config } = context;
  const authLimiter = rateLimit({
    windowMs: config.authRateWindowMs,
    limit: config.authRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
  });

  app.use(authPath, authLimiter);
  app.use(authPath, express.json({ limit: '16kb' }));
  app.use(authPath, createAuthRouter(context));
}

function mountApiRoutes(app, basePath, context) {
  const { auth, config } = context;
  const authLimiter = rateLimit({
    windowMs: config.authRateWindowMs,
    limit: config.authRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
  });

  app.use(`${basePath}/auth`, authLimiter);
  app.use(`${basePath}/auth`, express.json({ limit: '16kb' }));
  app.use(`${basePath}/presets`, auth.authenticate, express.json({ limit: '128kb' }));
  app.use(`${basePath}/tracks`, auth.authenticate, express.raw({
    type: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/x-flac'],
    limit: config.uploadLimit,
  }));

  app.use(basePath, createHealthRouter(context));
  app.use(`${basePath}/auth`, createAuthRouter(context));
  app.use(`${basePath}/tracks`, createTracksRouter({ ...context, basePath }));
  app.use(`${basePath}/presets`, createPresetsRouter(context));
}

function createErrorHandler() {
  return (err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      jsonError(res, 400, 'Malformed JSON body');
      return;
    }
    if (err?.type === 'entity.too.large') {
      jsonError(res, 413, 'Request body is too large');
      return;
    }
    if (err?.message === 'Preset params are required') {
      jsonError(res, 400, err.message);
      return;
    }
    console.error(err);
    jsonError(res, 500, 'Internal server error');
  };
}
