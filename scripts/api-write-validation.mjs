#!/usr/bin/env node

const baseUrl = process.env.TRACKMASTER_API_BASE_URL || 'http://127.0.0.1:3004';
const runId = process.env.TRACKMASTER_VALIDATION_RUN_ID || `${Date.now()}`;
const email = process.env.TRACKMASTER_VALIDATION_EMAIL || `write-${runId}@trackmaster.local`;
const password = process.env.TRACKMASTER_VALIDATION_PASSWORD || `TrackMaster-Write-${runId}!`;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return text;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await parseResponse(response);
  return { response, body };
}

function makeWavPayload() {
  const payload = Buffer.alloc(44);
  payload.write('RIFF', 0, 'ascii');
  payload.writeUInt32LE(36, 4);
  payload.write('WAVE', 8, 'ascii');
  payload.write('fmt ', 12, 'ascii');
  payload.writeUInt32LE(16, 16);
  payload.writeUInt16LE(1, 20);
  payload.writeUInt16LE(1, 22);
  payload.writeUInt32LE(44100, 24);
  payload.writeUInt32LE(88200, 28);
  payload.writeUInt16LE(2, 32);
  payload.writeUInt16LE(16, 34);
  payload.write('data', 36, 'ascii');
  payload.writeUInt32LE(0, 40);
  return payload;
}

async function main() {
  const register = await fetchJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (register.response.status !== 201 || !register.body?.token || register.body?.user?.email !== email) {
    fail(`register failed: ${register.response.status} ${JSON.stringify(register.body)}`);
  }

  const duplicate = await fetchJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (duplicate.response.status !== 409) {
    fail(`duplicate register parity failed: ${duplicate.response.status} ${JSON.stringify(duplicate.body)}`);
  }

  const login = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.response.status !== 200 || !login.body?.token || login.body?.user?.id !== register.body.user.id) {
    fail(`login failed: ${login.response.status} ${JSON.stringify(login.body)}`);
  }

  const authHeaders = { Authorization: `Bearer ${login.body.token}` };

  const me = await fetchJson(`${baseUrl}/api/auth/me`, { headers: authHeaders });
  if (me.response.status !== 200 || me.body?.user?.email !== email) {
    fail(`auth/me after register failed: ${me.response.status} ${JSON.stringify(me.body)}`);
  }

  const createPreset = await fetchJson(`${baseUrl}/api/presets`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Validation Preset ${runId}`,
      params: {
        eqLow: 1,
        eqMid: -1,
        eqHigh: 2,
        compThreshold: -12,
        compRatio: 2,
        makeupGain: 3,
        delayTime: 0.4,
        delayFeedback: 0.3,
        delayMix: 0.2,
        reverbDecay: 1.8,
        reverbMix: 0.25,
        saturationDrive: 4,
        saturationMix: 0.35,
      },
    }),
  });
  if (createPreset.response.status !== 201 || !createPreset.body?.preset?.id) {
    fail(`preset create failed: ${createPreset.response.status} ${JSON.stringify(createPreset.body)}`);
  }

  const updatePreset = await fetchJson(`${baseUrl}/api/presets/${encodeURIComponent(createPreset.body.preset.id)}`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Validation Preset ${runId} Updated`,
      params: {
        ...createPreset.body.preset.params,
        compRatio: 3,
        makeupGain: 4,
      },
    }),
  });
  if (updatePreset.response.status !== 200 || updatePreset.body?.preset?.name !== `Validation Preset ${runId} Updated`) {
    fail(`preset update failed: ${updatePreset.response.status} ${JSON.stringify(updatePreset.body)}`);
  }

  const createTrack = await fetchJson(`${baseUrl}/api/tracks`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'audio/wav',
      'X-Format': 'wav',
      'X-File-Name': `validation-${runId}.wav`,
      'X-Duration-Seconds': '1.25',
    },
    body: makeWavPayload(),
  });
  if (createTrack.response.status !== 201 || createTrack.body?.track?.format !== 'wav') {
    fail(`track create failed: ${createTrack.response.status} ${JSON.stringify(createTrack.body)}`);
  }

  const download = await fetch(`${baseUrl}/api/tracks/${encodeURIComponent(createTrack.body.track.id)}/download`, {
    headers: authHeaders,
  });
  const downloadBytes = await download.arrayBuffer();
  if (download.status !== 200 || downloadBytes.byteLength !== 44) {
    fail(`track download failed: ${download.status} bytes=${downloadBytes.byteLength}`);
  }

  const listAfterWrites = await fetchJson(`${baseUrl}/api/tracks`, { headers: authHeaders });
  if (listAfterWrites.response.status !== 200 || !Array.isArray(listAfterWrites.body?.tracks) || listAfterWrites.body.tracks.length !== 1) {
    fail(`track list after create failed: ${listAfterWrites.response.status} ${JSON.stringify(listAfterWrites.body)}`);
  }

  const deleteTrack = await fetchJson(`${baseUrl}/api/tracks/${encodeURIComponent(createTrack.body.track.id)}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  if (deleteTrack.response.status !== 200 || deleteTrack.body?.ok !== true) {
    fail(`track delete failed: ${deleteTrack.response.status} ${JSON.stringify(deleteTrack.body)}`);
  }

  const deletePreset = await fetchJson(`${baseUrl}/api/presets/${encodeURIComponent(createPreset.body.preset.id)}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  if (deletePreset.response.status !== 200 || deletePreset.body?.ok !== true) {
    fail(`preset delete failed: ${deletePreset.response.status} ${JSON.stringify(deletePreset.body)}`);
  }

  const finalTracks = await fetchJson(`${baseUrl}/api/tracks`, { headers: authHeaders });
  const finalPresets = await fetchJson(`${baseUrl}/api/presets`, { headers: authHeaders });
  if (finalTracks.response.status !== 200 || finalTracks.body?.tracks?.length !== 0) {
    fail(`final track list failed: ${finalTracks.response.status} ${JSON.stringify(finalTracks.body)}`);
  }
  if (finalPresets.response.status !== 200 || finalPresets.body?.presets?.length !== 0) {
    fail(`final preset list failed: ${finalPresets.response.status} ${JSON.stringify(finalPresets.body)}`);
  }

  console.log(JSON.stringify({
    baseUrl,
    email,
    userId: register.body.user.id,
    duplicateRegisterStatus: duplicate.response.status,
    presetId: createPreset.body.preset.id,
    trackId: createTrack.body.track.id,
    trackDownloadBytes: downloadBytes.byteLength,
    finalTracks: finalTracks.body.tracks.length,
    finalPresets: finalPresets.body.presets.length,
  }, null, 2));
}

main().catch((error) => fail(error.message));
