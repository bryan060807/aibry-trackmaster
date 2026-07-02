import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parentPort } from 'node:worker_threads';
import { injectWavInfoMetadataIfPossible } from './wav-info.js';
import { buildWaveformPeaks, waveformPathForAudioPath } from './waveform-peaks.js';

if (!parentPort) {
  throw new Error('track-export-worker must run inside a worker thread');
}

parentPort.on('message', async (message) => {
  let tempInputPath = '';
  try {
    const input = Buffer.from(message.audio);
    const output = message.format === 'wav'
      ? injectWavInfoMetadataIfPossible(input, message.metadata)
      : input;
    const waveformInput = message.format === 'flac' ? input : output;
    const waveform = buildWaveformPeaks(waveformInput, {
      format: message.format === 'flac' ? 'wav' : message.format,
      peakCount: message.peakCount,
    });
    const waveformPath = waveformPathForAudioPath(message.absolute);

    fs.mkdirSync(path.dirname(message.absolute), { recursive: true });

    if (message.format === 'flac') {
      tempInputPath = path.join(path.dirname(message.absolute), `.${path.basename(message.absolute)}.${randomUUID()}.input.wav`);
      fs.writeFileSync(tempInputPath, input, { flag: 'wx', mode: 0o640 });
      encodeFlacWithFfmpeg({ inputPath: tempInputPath, outputPath: message.absolute, metadata: message.metadata });
    } else {
      fs.writeFileSync(message.absolute, output, { flag: 'wx', mode: 0o640 });
    }

    fs.writeFileSync(waveformPath, JSON.stringify(waveform), { flag: 'wx', mode: 0o640 });
    const stat = fs.statSync(message.absolute);
    parentPort.postMessage({
      ok: true,
      sizeBytes: stat.size,
      waveformBytes: Buffer.byteLength(JSON.stringify(waveform)),
      waveformPeakCount: waveform.peakCount,
      waveformSource: waveform.source,
    });
  } catch (err) {
    try {
      if (message?.absolute) {
        fs.rmSync(message.absolute, { force: true });
        fs.rmSync(waveformPathForAudioPath(message.absolute), { force: true });
      }
    } catch {
      // Ignore cleanup errors; the main thread records the worker failure.
    }
    parentPort.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : 'Audio export worker failed',
    });
  } finally {
    if (tempInputPath) {
      fs.rmSync(tempInputPath, { force: true });
    }
  }
});

function encodeFlacWithFfmpeg({ inputPath, outputPath, metadata = {} }) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-ar', '44100',
    '-ac', '2',
    '-sample_fmt', 's16',
    ...flacMetadataArgs(metadata),
    '-c:a', 'flac',
    outputPath,
  ];

  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    throw new Error('FLAC export requires ffmpeg on the TrackMaster API host PATH.');
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(detail || 'ffmpeg FLAC encoding failed.');
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error('ffmpeg did not create a FLAC output file.');
  }
}

function flacMetadataArgs(metadata = {}) {
  const fields = [
    ['artist', 'artist'],
    ['title', 'title'],
    ['album', 'album'],
    ['genre', 'genre'],
    ['date', 'date'],
    ['comment', 'comment'],
    ['copyright', 'copyright'],
    ['software', 'encoded_by'],
  ];
  const args = [];
  for (const [key, tag] of fields) {
    const value = normalizeMetadataValue(metadata[key]);
    if (value) args.push('-metadata', `${tag}=${value}`);
  }
  if (!args.some((value) => value === 'encoded_by=TrackMaster v1.0')) {
    args.push('-metadata', 'encoded_by=TrackMaster v1.0');
  }
  return args;
}

function normalizeMetadataValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
}
