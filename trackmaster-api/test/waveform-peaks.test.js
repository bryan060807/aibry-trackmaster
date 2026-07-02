import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWaveformPeaks, waveformPathForAudioPath } from '../src/waveform-peaks.js';

test('buildWaveformPeaks extracts normalized peaks from PCM WAV audio', () => {
  const wav = makeWav16Mono([0, 32767, -32768, 16384]);
  const waveform = buildWaveformPeaks(wav, { format: 'wav', peakCount: 4 });

  assert.equal(waveform.version, 1);
  assert.equal(waveform.format, 'wav');
  assert.equal(waveform.source, 'pcm');
  assert.equal(waveform.sampleRate, 44100);
  assert.equal(waveform.channels, 1);
  assert.equal(waveform.bitsPerSample, 16);
  assert.equal(waveform.peakCount, 4);
  assert.deepEqual(waveform.peaks, [0, 1, 1, 0.5]);
});

test('buildWaveformPeaks returns an honest unsupported marker for MP3', () => {
  const waveform = buildWaveformPeaks(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]), { format: 'mp3' });

  assert.equal(waveform.version, 1);
  assert.equal(waveform.format, 'mp3');
  assert.equal(waveform.source, 'none');
  assert.equal(waveform.reason, 'unsupported_format');
  assert.deepEqual(waveform.peaks, []);
});

test('waveformPathForAudioPath returns deterministic sidecar path', () => {
  assert.equal(waveformPathForAudioPath('track.wav'), 'track.wav.peaks.json');
});

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
