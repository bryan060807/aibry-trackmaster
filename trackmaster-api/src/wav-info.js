const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

const INFO_TAGS = new Map([
  ['artist', 'IART'],
  ['title', 'INAM'],
  ['album', 'IPRD'],
  ['genre', 'IGNR'],
  ['date', 'ICRD'],
  ['comment', 'ICMT'],
  ['copyright', 'ICOP'],
  ['software', 'ISFT'],
]);

export function isRiffWav(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= RIFF_HEADER_BYTES
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WAVE';
}

export function injectWavInfoMetadata(input, metadata = {}) {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError('WAV input must be a Buffer');
  }
  if (!isRiffWav(input)) {
    throw new Error('Input is not a RIFF/WAVE buffer');
  }

  const chunks = parseRiffChunks(input);
  const infoChunk = buildListInfoChunk(metadata);
  const outputChunks = [];
  let inserted = false;

  for (const chunk of chunks) {
    if (isListInfoChunk(input, chunk)) {
      continue;
    }

    if (!inserted && chunk.id === 'data') {
      outputChunks.push(infoChunk);
      inserted = true;
    }

    outputChunks.push(input.subarray(chunk.start, chunk.endWithPadding));
  }

  if (!inserted) {
    outputChunks.push(infoChunk);
  }

  const body = Buffer.concat(outputChunks);
  const output = Buffer.alloc(RIFF_HEADER_BYTES + body.length);
  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVE', 8, 'ascii');
  body.copy(output, RIFF_HEADER_BYTES);
  return output;
}

export function injectWavInfoMetadataIfPossible(input, metadata = {}) {
  if (!isRiffWav(input)) return input;
  return injectWavInfoMetadata(input, metadata);
}

function parseRiffChunks(buffer) {
  const chunks = [];
  let offset = RIFF_HEADER_BYTES;

  while (offset + CHUNK_HEADER_BYTES <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      throw new Error(`Invalid WAV chunk ${id}: declared size exceeds file length`);
    }

    const endWithPadding = dataEnd + (size % 2);
    if (endWithPadding > buffer.length) {
      throw new Error(`Invalid WAV chunk ${id}: missing pad byte`);
    }

    chunks.push({ id, start: offset, dataStart, dataEnd, endWithPadding, size });
    offset = endWithPadding;
  }

  if (offset !== buffer.length) {
    throw new Error('Invalid WAV: trailing partial chunk header');
  }

  return chunks;
}

function isListInfoChunk(buffer, chunk) {
  return chunk.id === 'LIST'
    && chunk.size >= 4
    && buffer.toString('ascii', chunk.dataStart, chunk.dataStart + 4) === 'INFO';
}

function buildListInfoChunk(metadata) {
  const tags = {
    artist: metadata.artist,
    title: metadata.title,
    album: metadata.album,
    genre: metadata.genre,
    date: metadata.date,
    comment: metadata.comment,
    copyright: metadata.copyright,
    software: metadata.software || 'TrackMaster v1.0',
  };

  const subChunks = [];
  for (const [key, id] of INFO_TAGS.entries()) {
    const value = normalizeInfoValue(tags[key]);
    if (!value) continue;
    subChunks.push(buildInfoSubChunk(id, value));
  }

  if (!subChunks.length) {
    subChunks.push(buildInfoSubChunk('ISFT', 'TrackMaster v1.0'));
  }

  const payload = Buffer.concat([Buffer.from('INFO', 'ascii'), ...subChunks]);
  const header = Buffer.alloc(CHUNK_HEADER_BYTES);
  header.write('LIST', 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function buildInfoSubChunk(id, value) {
  if (!/^[A-Z0-9 ]{4}$/.test(id)) {
    throw new Error(`Invalid INFO tag id: ${id}`);
  }

  const valueBytes = Buffer.from(`${value}\0`, 'utf8');
  const header = Buffer.alloc(CHUNK_HEADER_BYTES);
  header.write(id, 0, 'ascii');
  header.writeUInt32LE(valueBytes.length, 4);
  const padding = valueBytes.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, valueBytes, padding]);
}

function normalizeInfoValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
}
