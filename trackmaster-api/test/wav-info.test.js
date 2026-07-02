import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injectWavInfoMetadata, injectWavInfoMetadataIfPossible, isRiffWav } from '../src/wav-info.js';

test('injectWavInfoMetadata inserts LIST INFO before data and recalculates RIFF size', () => {
  const wav = makeWav({ data: Buffer.from([1, 2, 3, 4]) });
  const output = injectWavInfoMetadata(wav, {
    artist: 'AIBRY',
    title: 'Example Track',
    software: 'TrackMaster v1.0',
  });

  assert.equal(isRiffWav(output), true);
  assert.equal(output.readUInt32LE(4), output.length - 8);
  const listOffset = output.indexOf(Buffer.from('LIST', 'ascii'));
  assert.ok(listOffset > 0);
  assert.equal(output.toString('ascii', listOffset + 8, listOffset + 12), 'INFO');
  assert.ok(output.indexOf(Buffer.from('IART', 'ascii')) > 0);
  assert.ok(output.indexOf(Buffer.from('INAM', 'ascii')) > 0);
  assert.ok(output.indexOf(Buffer.from('ISFT', 'ascii')) > 0);
  assert.ok(output.indexOf(Buffer.from('IPRD', 'ascii')) === -1);
  assert.ok(output.indexOf(Buffer.from('LIST', 'ascii')) < output.indexOf(Buffer.from('data', 'ascii')));
  assert.equal(output.subarray(output.length - 4).toString('hex'), '01020304');
});

test('injectWavInfoMetadata preserves non-INFO chunks and handles odd INFO padding', () => {
  const junkPayload = Buffer.from([9, 8, 7]);
  const wav = makeWav({
    extraChunks: [makeChunk('JUNK', junkPayload)],
    data: Buffer.from([1, 2]),
  });

  const output = injectWavInfoMetadata(wav, { title: 'Odd' });

  assert.equal(output.readUInt32LE(4), output.length - 8);
  assert.ok(output.indexOf(Buffer.from('JUNK', 'ascii')) > 0);
  assert.ok(output.indexOf(Buffer.from('INAM', 'ascii')) > 0);
  assert.equal(output.length % 2, 0);
});

test('injectWavInfoMetadata writes expanded optional LIST INFO metadata', () => {
  const wav = makeWav({ data: Buffer.from([1, 2]) });
  const output = injectWavInfoMetadata(wav, {
    artist: 'AIBRY',
    title: 'Example Track',
    album: 'Example Album',
    genre: 'Rock',
    date: '2026',
    comment: 'Approved master',
    copyright: '© AIBRY',
  });
  const text = output.toString('latin1');

  assert.ok(text.includes('IART'));
  assert.ok(text.includes('INAM'));
  assert.ok(text.includes('IPRD'));
  assert.ok(text.includes('IGNR'));
  assert.ok(text.includes('ICRD'));
  assert.ok(text.includes('ICMT'));
  assert.ok(text.includes('ICOP'));
  assert.ok(text.includes('Example Album'));
  assert.ok(text.includes('Approved master'));
});

test('injectWavInfoMetadata replaces existing LIST INFO instead of duplicating it', () => {
  const existingInfo = makeListInfoChunk('Old Title');
  const wav = makeWav({ extraChunks: [existingInfo], data: Buffer.from([1, 2]) });
  const output = injectWavInfoMetadata(wav, { title: 'New Title' });
  const text = output.toString('latin1');

  assert.equal(text.includes('Old Title'), false);
  assert.equal(text.includes('New Title'), true);
  assert.equal(countOccurrences(text, 'LIST'), 1);
});

test('injectWavInfoMetadataIfPossible leaves non-WAV buffers unchanged for compatibility', () => {
  const input = Buffer.from([1, 2, 3]);
  assert.equal(injectWavInfoMetadataIfPossible(input), input);
});

function makeWav({ extraChunks = [], data }) {
  const fmtPayload = Buffer.alloc(16);
  fmtPayload.writeUInt16LE(1, 0);
  fmtPayload.writeUInt16LE(1, 2);
  fmtPayload.writeUInt32LE(44100, 4);
  fmtPayload.writeUInt32LE(88200, 8);
  fmtPayload.writeUInt16LE(2, 12);
  fmtPayload.writeUInt16LE(16, 14);

  const chunks = [makeChunk('fmt ', fmtPayload), ...extraChunks, makeChunk('data', data)];
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

function makeListInfoChunk(title) {
  const value = Buffer.from(`${title}\0`, 'utf8');
  const subHeader = Buffer.alloc(8);
  subHeader.write('INAM', 0, 'ascii');
  subHeader.writeUInt32LE(value.length, 4);
  const payload = Buffer.concat([Buffer.from('INFO', 'ascii'), subHeader, value, value.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
  return makeChunk('LIST', payload);
}

function makeChunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}
