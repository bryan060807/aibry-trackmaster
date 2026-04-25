#!/usr/bin/env node

import jwt from 'jsonwebtoken';

const baseUrl = process.env.TRACKMASTER_API_BASE_URL || 'http://127.0.0.1:3004';
const jwtSecret = process.env.TRACKMASTER_JWT_SECRET || 'trackmaster-local-dev-secret-change-me';
const jwtExpiresIn = process.env.TRACKMASTER_JWT_EXPIRES_IN || '12h';
const userId = process.env.TRACKMASTER_VALIDATION_USER_ID || 'legacy-local-user';
const userEmail = process.env.TRACKMASTER_VALIDATION_USER_EMAIL || 'legacy@trackmaster.local';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const token = jwt.sign({ sub: userId, email: userEmail }, jwtSecret, {
  expiresIn: jwtExpiresIn,
  issuer: 'trackmaster-api',
  audience: 'trackmaster-web',
});

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = text;
    }
  }
  return { response, body };
}

async function main() {
  const health = await fetchJson(`${baseUrl}/api/health`);
  if (!health.response.ok || health.body?.ok !== true) {
    fail(`Health check failed: ${health.response.status} ${JSON.stringify(health.body)}`);
  }

  const headers = { Authorization: `Bearer ${token}` };
  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers });
  if (!me.response.ok || me.body?.user?.id !== userId) {
    fail(`auth/me validation failed: ${me.response.status} ${JSON.stringify(me.body)}`);
  }

  const tracks = await fetchJson(`${baseUrl}/api/tracks`, { headers });
  if (!tracks.response.ok || !Array.isArray(tracks.body?.tracks)) {
    fail(`tracks validation failed: ${tracks.response.status} ${JSON.stringify(tracks.body)}`);
  }

  const presets = await fetchJson(`${baseUrl}/api/presets`, { headers });
  if (!presets.response.ok || !Array.isArray(presets.body?.presets)) {
    fail(`presets validation failed: ${presets.response.status} ${JSON.stringify(presets.body)}`);
  }

  console.log(JSON.stringify({
    baseUrl,
    user: me.body.user,
    tracks: tracks.body.tracks.length,
    presets: presets.body.presets.length,
  }, null, 2));
}

main().catch((error) => fail(error.message));
