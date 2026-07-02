import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createRepositories } from '../src/repositories/index.js';
import { ensureStorage } from '../src/storage.js';

const PASSWORD = 'correct horse battery staple';
const JWT_SECRET = 'trackmaster-test-secret-32-characters';

let context;

beforeEach(async () => {
  context = await createTestContext();
});

afterEach(async () => {
  if (context) {
    await context.close();
    context = null;
  }
});

test('register, restore cookie session, logout, and reject revoked cookie', async () => {
  const register = await request('/api/auth/register', {
    method: 'POST',
    json: {
      email: 'register@example.com',
      password: PASSWORD,
    },
  });

  assert.equal(register.response.status, 201);
  assert.equal(register.body.user.email, 'register@example.com');
  assert.ok(register.body.token);
  assert.ok(register.body.session?.expiresAt);

  const cookie = sessionCookie(register.response);
  assert.match(cookie, /^tm_session=/);

  const session = await request('/api/auth/session', { cookie });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.user.email, 'register@example.com');
  assert.equal(session.body.authMode, 'cookie-session');

  const logout = await request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.response.status, 200);
  assert.deepEqual(logout.body, { ok: true });
  assert.match(logout.response.headers.get('set-cookie') || '', /Max-Age=0/);

  const revoked = await request('/api/auth/session', { cookie });
  assert.equal(revoked.response.status, 401);
  assert.equal(revoked.body.error, 'Authentication required');
});

test('login issues a cookie session and JWT fallback remains valid after cookie logout', async () => {
  await registerUser('login@example.com');

  const login = await request('/api/auth/login', {
    method: 'POST',
    json: {
      email: 'login@example.com',
      password: PASSWORD,
    },
  });

  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.email, 'login@example.com');
  assert.ok(login.body.token);

  const cookie = sessionCookie(login.response);
  const cookieSession = await request('/api/auth/session', { cookie });
  assert.equal(cookieSession.response.status, 200);
  assert.equal(cookieSession.body.authMode, 'cookie-session');

  const logout = await request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.response.status, 200);

  const jwtSession = await request('/api/auth/session', {
    token: login.body.token,
  });
  assert.equal(jwtSession.response.status, 200);
  assert.equal(jwtSession.body.user.email, 'login@example.com');
  assert.equal(jwtSession.body.authMode, 'jwt-bearer');
});

test('AIBRY ID routes are mounted at app-origin and api-origin paths but disabled by default', async () => {
  const browserLogin = await request('/auth/aibry-id/login');
  assert.equal(browserLogin.response.status, 404);
  assert.equal(browserLogin.body.error, 'aibry_id_disabled');

  const apiLogin = await request('/api/auth/aibry-id/login');
  assert.equal(apiLogin.response.status, 404);
  assert.deepEqual(apiLogin.body, browserLogin.body);
});

test('preset CRUD works through repository-backed routes', async () => {
  const { cookie } = await registerUser('presets@example.com');

  const empty = await request('/api/presets', { cookie });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body, { presets: [] });

  const created = await request('/api/presets', {
    method: 'POST',
    cookie,
    json: {
      name: 'Test Preset',
      params: presetParams(),
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.preset.name, 'Test Preset');
  assert.equal(created.body.preset.params.eqLow, 1);

  const listed = await request('/api/presets', { cookie });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.presets.length, 1);
  assert.equal(listed.body.presets[0].id, created.body.preset.id);

  const updated = await request(`/api/presets/${created.body.preset.id}`, {
    method: 'PUT',
    cookie,
    json: {
      name: 'Updated Preset',
      params: { ...presetParams(), eqLow: 2 },
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.preset.name, 'Updated Preset');
  assert.equal(updated.body.preset.params.eqLow, 2);

  const deleted = await request(`/api/presets/${created.body.preset.id}`, {
    method: 'DELETE',
    cookie,
  });
  assert.equal(deleted.response.status, 200);
  assert.deepEqual(deleted.body, { ok: true });

  const afterDelete = await request('/api/presets', { cookie });
  assert.deepEqual(afterDelete.body, { presets: [] });
});

test('track history CRUD stores, downloads, lists, and deletes exported audio', async () => {
  const { cookie } = await registerUser('tracks@example.com');

  const upload = await request('/api/tracks', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'audio/wav',
      'X-File-Name': 'Example Track',
      'X-Format': 'wav',
      'X-Duration-Seconds': '1.25',
    },
    body: Buffer.from([1, 2, 3, 4]),
  });
  assert.equal(upload.response.status, 201);
  assert.equal(upload.body.track.fileName, 'Example_Track_mastered.wav');
  assert.equal(upload.body.track.sizeBytes, 4);

  const listed = await request('/api/tracks', { cookie });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.tracks.length, 1);
  assert.equal(listed.body.tracks[0].id, upload.body.track.id);

  const download = await rawRequest(`/api/tracks/${upload.body.track.id}/download`, { cookie });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).toString('hex'), '01020304');

  const partial = await rawRequest(`/api/tracks/${upload.body.track.id}/download`, {
    cookie,
    headers: { Range: 'bytes=1-2' },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 1-2/4');
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString('hex'), '0203');

  const deleted = await request(`/api/tracks/${upload.body.track.id}`, {
    method: 'DELETE',
    cookie,
  });
  assert.equal(deleted.response.status, 200);
  assert.deepEqual(deleted.body, { ok: true });

  const afterDelete = await request('/api/tracks', { cookie });
  assert.deepEqual(afterDelete.body, { tracks: [] });
});

test('track waveform endpoint returns PCM peak JSON for WAV audio', async () => {
  const { cookie } = await registerUser('waveform@example.com');
  const audio = makeWav16Mono([0, 32767, -32768, 16384]);

  const upload = await request('/api/tracks', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'audio/wav',
      'X-File-Name': 'Waveform Track',
      'X-Format': 'wav',
      'X-Duration-Seconds': '0.001',
    },
    body: audio,
  });

  assert.equal(upload.response.status, 201);
  assert.match(upload.body.track.waveformUrl, /^\/api\/tracks\//);

  const waveform = await request(upload.body.track.waveformUrl, { cookie });
  assert.equal(waveform.response.status, 200);
  assert.equal(waveform.body.waveform.source, 'pcm');
  assert.equal(waveform.body.waveform.format, 'wav');
  assert.equal(waveform.body.waveform.peakCount, 4);
  assert.deepEqual(waveform.body.waveform.peaks, [0, 1, 1, 0.5]);
});

test('async track export reports job completion and stores the exported audio', async () => {
  const { cookie } = await registerUser('async-tracks@example.com');
  const audio = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3, 4]);

  const accepted = await request('/api/tracks?async=1', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-File-Name': 'Async Track',
      'X-Format': 'mp3',
      Prefer: 'respond-async',
    },
    body: audio,
  });

  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.job.status, 'processing');
  assert.match(accepted.body.job.statusUrl, /^\/api\/tracks\/jobs\//);

  const job = await pollExportJob(accepted.body.job, cookie);

  assert.equal(job.status, 'completed');
  assert.equal(job.error, null);
  assert.equal(job.track.fileName, 'Async_Track_mastered.mp3');
  assert.equal(job.track.sizeBytes, audio.length);

  const download = await rawRequest(job.track.downloadUrl, { cookie });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), audio);
});

test('async FLAC export encodes RouteNote-ready audio and Vorbis metadata', { skip: !hasFfmpeg() }, async () => {
  const { cookie } = await registerUser('flac-metadata@example.com');
  const audio = makeWav16Mono([0, 32767, -32768, 16384, 8192, -8192]);

  const accepted = await request('/api/tracks?async=1', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'audio/wav',
      'X-File-Name': 'Metadata Track',
      'X-Format': 'flac',
      'X-Duration-Seconds': '0.001',
      'X-Artist': 'Bryan Miller',
      'X-Title': 'Final Final',
      'X-Album': 'The Violence of Spring',
      'X-Genre': 'Alternative Metal',
      'X-Year': '2026',
      'X-Comment': 'TrackMaster FLAC metadata test',
      'X-Copyright': '© 2026 Bryan Miller',
      Prefer: 'respond-async',
    },
    body: audio,
  });

  assert.equal(accepted.response.status, 202);
  const job = await pollExportJob(accepted.body.job, cookie, { attempts: 100, delayMs: 50 });

  assert.equal(job.status, 'completed');
  assert.equal(job.error, null);
  assert.equal(job.track.fileName, 'Metadata_Track_mastered.flac');
  assert.equal(job.track.format, 'flac');
  assert.match(job.track.waveformUrl, /^\/api\/tracks\//);

  const download = await rawRequest(job.track.downloadUrl, { cookie });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'audio/flac');

  const flac = Buffer.from(await download.arrayBuffer());
  assert.equal(flac.subarray(0, 4).toString('ascii'), 'fLaC');

  const streamInfo = parseFlacStreamInfo(flac);
  assert.equal(streamInfo.sampleRate, 44100);
  assert.equal(streamInfo.channels, 2);
  assert.equal(streamInfo.bitsPerSample, 16);

  assert.ok(bufferIncludesUtf8(flac, 'artist=Bryan Miller'));
  assert.ok(bufferIncludesUtf8(flac, 'title=Final Final'));
  assert.ok(bufferIncludesUtf8(flac, 'album=The Violence of Spring'));
  assert.ok(bufferIncludesUtf8(flac, 'genre=Alternative Metal'));
  assert.ok(bufferIncludesUtf8(flac, 'date=2026'));
  assert.ok(bufferIncludesAnyUtf8(flac, [
    'comment=TrackMaster FLAC metadata test',
    'COMMENT=TrackMaster FLAC metadata test',
    'description=TrackMaster FLAC metadata test',
    'DESCRIPTION=TrackMaster FLAC metadata test',
  ]));
  assert.ok(bufferIncludesUtf8(flac, 'copyright=© 2026 Bryan Miller'));
  assert.ok(bufferIncludesUtf8(flac, 'encoded_by=TrackMaster v1.0'));
});

test('authenticated users cannot access each other presets or track exports', async () => {
  const owner = await registerUser('owner@example.com');
  const other = await registerUser('other@example.com');

  const ownerPreset = await request('/api/presets', {
    method: 'POST',
    cookie: owner.cookie,
    json: {
      name: 'Owner Preset',
      params: presetParams(),
    },
  });
  assert.equal(ownerPreset.response.status, 201);

  const otherPresets = await request('/api/presets', { cookie: other.cookie });
  assert.equal(otherPresets.response.status, 200);
  assert.deepEqual(otherPresets.body, { presets: [] });

  const otherPresetUpdate = await request(`/api/presets/${ownerPreset.body.preset.id}`, {
    method: 'PUT',
    cookie: other.cookie,
    json: {
      name: 'Other Update',
      params: presetParams({ eqLow: 5 }),
    },
  });
  assert.equal(otherPresetUpdate.response.status, 404);
  assert.equal(otherPresetUpdate.body.error, 'Preset not found');

  const otherPresetDelete = await request(`/api/presets/${ownerPreset.body.preset.id}`, {
    method: 'DELETE',
    cookie: other.cookie,
  });
  assert.equal(otherPresetDelete.response.status, 404);
  assert.equal(otherPresetDelete.body.error, 'Preset not found');

  const ownerPresets = await request('/api/presets', { cookie: owner.cookie });
  assert.equal(ownerPresets.body.presets.length, 1);
  assert.equal(ownerPresets.body.presets[0].id, ownerPreset.body.preset.id);

  const ownerTrack = await request('/api/tracks', {
    method: 'POST',
    cookie: owner.cookie,
    headers: {
      'Content-Type': 'audio/wav',
      'X-File-Name': 'Owner Track',
      'X-Format': 'wav',
      'X-Duration-Seconds': '3',
    },
    body: Buffer.from([9, 8, 7, 6]),
  });
  assert.equal(ownerTrack.response.status, 201);

  const otherTracks = await request('/api/tracks', { cookie: other.cookie });
  assert.equal(otherTracks.response.status, 200);
  assert.deepEqual(otherTracks.body, { tracks: [] });

  const otherTrackDownload = await request(`/api/tracks/${ownerTrack.body.track.id}/download`, {
    cookie: other.cookie,
  });
  assert.equal(otherTrackDownload.response.status, 404);
  assert.equal(otherTrackDownload.body.error, 'Track not found');

  const otherTrackDelete = await request(`/api/tracks/${ownerTrack.body.track.id}`, {
    method: 'DELETE',
    cookie: other.cookie,
  });
  assert.equal(otherTrackDelete.response.status, 404);
  assert.equal(otherTrackDelete.body.error, 'Track not found');

  const ownerDownload = await rawRequest(`/api/tracks/${ownerTrack.body.track.id}/download`, {
    cookie: owner.cookie,
  });
  assert.equal(ownerDownload.status, 200);
  assert.equal(Buffer.from(await ownerDownload.arrayBuffer()).toString('hex'), '09080706');

  const ownerTrackDelete = await request(`/api/tracks/${ownerTrack.body.track.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(ownerTrackDelete.response.status, 200);
  assert.deepEqual(ownerTrackDelete.body, { ok: true });
});

test('/api/v1 aliases health, auth/session, presets, and tracks behavior', async () => {
  const { cookie } = await registerUser('v1@example.com');

  const health = await request('/api/health');
  const healthV1 = await request('/api/v1/health');
  assert.equal(health.response.status, 200);
  assert.equal(healthV1.response.status, 200);
  assert.deepEqual(healthV1.body, health.body);

  const session = await request('/api/auth/session', { cookie });
  const sessionV1 = await request('/api/v1/auth/session', { cookie });
  assert.equal(sessionV1.response.status, 200);
  assert.deepEqual(sessionV1.body, session.body);

  const presetV1 = await request('/api/v1/presets', {
    method: 'POST',
    cookie,
    json: {
      name: 'Alias Preset',
      params: presetParams(),
    },
  });
  assert.equal(presetV1.response.status, 201);

  const presets = await request('/api/presets', { cookie });
  const presetsV1 = await request('/api/v1/presets', { cookie });
  assert.deepEqual(presetsV1.body, presets.body);

  const uploadV1 = await request('/api/v1/tracks', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-File-Name': 'Alias Track',
      'X-Format': 'mp3',
      'X-Duration-Seconds': '2',
    },
    body: Buffer.from([5, 6, 7]),
  });
  assert.equal(uploadV1.response.status, 201);
  assert.match(uploadV1.body.track.downloadUrl, /^\/api\/v1\/tracks\//);

  const tracks = await request('/api/tracks', { cookie });
  const tracksV1 = await request('/api/v1/tracks', { cookie });
  assert.equal(tracks.response.status, 200);
  assert.equal(tracksV1.response.status, 200);
  assert.equal(tracks.body.tracks.length, tracksV1.body.tracks.length);
  assert.equal(tracks.body.tracks[0].id, tracksV1.body.tracks[0].id);
});

async function registerUser(email) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { email, password: PASSWORD },
  });
  assert.equal(response.response.status, 201);
  return {
    cookie: sessionCookie(response.response),
    token: response.body.token,
    user: response.body.user,
  };
}

async function pollExportJob(initialJob, cookie, options = {}) {
  const attempts = options.attempts || 50;
  const delayMs = options.delayMs || 20;
  let job = initialJob;

  for (let attempt = 0; attempt < attempts && job.status === 'processing'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const status = await request(job.statusUrl, { cookie });
    assert.equal(status.response.status, 200);
    job = status.body.job;
  }

  return job;
}

function hasFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return result.status === 0;
}

function parseFlacStreamInfo(buffer) {
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'fLaC');
  let offset = 4;

  while (offset + 4 <= buffer.length) {
    const header = buffer[offset];
    const type = header & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const payloadStart = offset + 4;
    const payloadEnd = payloadStart + length;
    assert.ok(payloadEnd <= buffer.length, 'FLAC metadata block exceeds buffer size');

    if (type === 0) {
      const payload = buffer.subarray(payloadStart, payloadEnd);
      assert.equal(payload.length, 34);
      const packed = payload.readBigUInt64BE(10);
      return {
        sampleRate: Number((packed >> 44n) & 0xfffffn),
        channels: Number(((packed >> 41n) & 0x7n) + 1n),
        bitsPerSample: Number(((packed >> 36n) & 0x1fn) + 1n),
      };
    }

    offset = payloadEnd;
  }

  throw new Error('FLAC STREAMINFO block not found');
}

function bufferIncludesUtf8(buffer, text) {
  return buffer.includes(Buffer.from(text, 'utf8'));
}

function bufferIncludesAnyUtf8(buffer, values) {
  return values.some((value) => bufferIncludesUtf8(buffer, value));
}

function makeWav16Mono(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));

  const fmtPayload = Buffer.alloc(16);
  fmtPayload.writeUInt16LE(1, 0);
  fmtPayload.writeUInt16LE(1, 2);
  fmtPayload.writeUInt32LE(44100, 4);
  fmtPayload.writeUInt32LE(88200, 8);
  fmtPayload.writeUInt16LE(2, 12);
  fmtPayload.writeUInt16LE(16, 14);

  const body = Buffer.concat([makeChunk('fmt ', fmtPayload), makeChunk('data', data)]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

function makeChunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function presetParams() {
  return {
    eqLow: 1,
    eqMid: 0,
    eqHigh: -1,
    compThreshold: -14,
    compRatio: 2,
    makeupGain: 1,
    delayTime: 0.3,
    delayFeedback: 0.2,
    delayMix: 0,
    reverbDecay: 1.5,
    reverbMix: 0,
    saturationDrive: 1,
    saturationMix: 0,
  };
}

async function createTestContext() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackmaster-api-test-'));
  const config = {
    projectRoot: dataDir,
    port: 0,
    host: '127.0.0.1',
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'trackmaster.sqlite'),
    uploadLimit: '10mb',
    corsOrigin: '',
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: '12h',
    effectiveJwtSecret: JWT_SECRET,
    sessionCookieName: 'tm_session',
    sessionExpiresSeconds: 3600,
    apiRateWindowMs: 60000,
    apiRateLimit: 10000,
    authRateWindowMs: 60000,
    authRateLimit: 10000,
    production: false,
    legacyUserId: 'legacy-local-user',
  };

  ensureStorage(config);
  const db = openDatabase(config);
  const repositories = createRepositories(db);
  const app = createApp({ config, repositories });
  const server = await listen(app);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await closeServer(server);
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function sessionCookie(response) {
  const header = response.headers.get('set-cookie') || '';
  assert.match(header, /HttpOnly/);
  return header.split(';')[0];
}

async function request(pathname, options = {}) {
  const response = await rawRequest(pathname, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function rawRequest(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }
  if (options.cookie) {
    headers.set('Cookie', options.cookie);
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  return fetch(`${context.baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
}
