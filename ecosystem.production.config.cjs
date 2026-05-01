function isPlaceholderValue(value) {
  return /REPLACE_|REPLACE-|CHANGE_ME|CHANGE-ME|<approved|placeholder/i.test(value);
}

function readOptionalEnv(name, fallback) {
  const value = process.env[name];
  if (!value || !value.trim()) return fallback;

  const trimmed = value.trim();
  if (isPlaceholderValue(trimmed)) {
    throw new Error(`${name} must not use a placeholder value.`);
  }

  return trimmed;
}

function readRequiredEnv(name, { minLength = 1 } = {}) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} must be set in the environment before starting the Windows production PM2 runtime.`);
  }

  const trimmed = value.trim();
  if (isPlaceholderValue(trimmed)) {
    throw new Error(`${name} must be set to an approved non-placeholder value before starting the Windows production PM2 runtime.`);
  }
  if (trimmed.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long.`);
  }

  return trimmed;
}

const apiPort = readOptionalEnv('TRACKMASTER_API_PORT', '3004');
const apiHost = readOptionalEnv('TRACKMASTER_HOST', '127.0.0.1');
const uiPort = readOptionalEnv('TRACKMASTER_UI_PORT', '3000');
const uiHost = readOptionalEnv('TRACKMASTER_UI_HOST', '127.0.0.1');

module.exports = {
  apps: [
    {
      name: 'trackmaster-api',
      cwd: __dirname,
      script: 'server/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: apiPort,
        TRACKMASTER_HOST: apiHost,
        TRACKMASTER_DATA_DIR: readRequiredEnv('TRACKMASTER_DATA_DIR'),
        TRACKMASTER_REPOSITORY_BACKEND: 'postgres',
        TRACKMASTER_POSTGRES_URL: readRequiredEnv('TRACKMASTER_POSTGRES_URL'),
        TRACKMASTER_POSTGRES_POOL_MAX: readOptionalEnv('TRACKMASTER_POSTGRES_POOL_MAX', '5'),
        TRACKMASTER_JWT_SECRET: readRequiredEnv('TRACKMASTER_JWT_SECRET', { minLength: 32 }),
        TRACKMASTER_JWT_EXPIRES_IN: readOptionalEnv('TRACKMASTER_JWT_EXPIRES_IN', '12h'),
        TRACKMASTER_SESSION_COOKIE: readOptionalEnv('TRACKMASTER_SESSION_COOKIE', 'tm_session'),
        TRACKMASTER_SESSION_EXPIRES_IN_SECONDS: readOptionalEnv('TRACKMASTER_SESSION_EXPIRES_IN_SECONDS', '43200'),
        TRACKMASTER_API_RATE_WINDOW_MS: readOptionalEnv('TRACKMASTER_API_RATE_WINDOW_MS', '60000'),
        TRACKMASTER_API_RATE_LIMIT: readOptionalEnv('TRACKMASTER_API_RATE_LIMIT', '240'),
        TRACKMASTER_AUTH_RATE_WINDOW_MS: readOptionalEnv('TRACKMASTER_AUTH_RATE_WINDOW_MS', '900000'),
        TRACKMASTER_AUTH_RATE_LIMIT: readOptionalEnv('TRACKMASTER_AUTH_RATE_LIMIT', '20'),
        TRACKMASTER_UPLOAD_LIMIT: readOptionalEnv('TRACKMASTER_UPLOAD_LIMIT', '120mb'),
        CORS_ORIGIN: readOptionalEnv('CORS_ORIGIN', ''),
      },
    },
    {
      name: 'trackmaster-ui',
      cwd: __dirname,
      script: 'server/static-web.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        HOST: uiHost,
        PORT: uiPort,
      },
    },
  ],
};
