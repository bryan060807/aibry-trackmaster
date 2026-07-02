import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExportQueueFullError, ExportWorkerPool } from '../export-worker-pool.js';
import { asyncHandler } from '../request.js';
import { jsonError } from '../responses.js';
import { resolveStoredPath, safeBaseName, safeFormat, storagePathFor } from '../storage.js';
import { injectWavInfoMetadataIfPossible } from '../wav-info.js';
import { buildWaveformPeaks, waveformPathForAudioPath } from '../waveform-peaks.js';

const exportJobs = new Map();
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;
const EXPORT_WORKER_URL = new URL('../track-export-worker.js', import.meta.url);
const exportWorkerPool = new ExportWorkerPool({
  workerUrl: EXPORT_WORKER_URL,
  size: process.env.TRACKMASTER_EXPORT_WORKER_POOL_SIZE,
  maxQueue: process.env.TRACKMASTER_EXPORT_WORKER_QUEUE_MAX,
});

function mapTrack(track, basePath) {
  return {
    id: track.id,
    fileName: track.fileName,
    createdAt: track.createdAt,
    storagePath: track.storagePath,
    status: track.status,
    durationSeconds: track.durationSeconds,
    sizeBytes: track.sizeBytes,
    format: track.format,
    downloadUrl: `${basePath}/tracks/${encodeURIComponent(track.id)}/download`,
    waveformUrl: `${basePath}/tracks/${encodeURIComponent(track.id)}/waveform`,
  };
}

function mapJob(job, basePath) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    track: job.track ? mapTrack(job.track, basePath) : null,
    statusUrl: `${basePath}/tracks/jobs/${encodeURIComponent(job.id)}`,
  };
}

export function createTracksRouter({ config, basePath, repositories }) {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await repositories.tracks.listForUser(req.user.id);
    res.json({ tracks: rows.map((row) => mapTrack(row, basePath)) });
  }));

  router.get('/jobs/:jobId', asyncHandler(async (req, res) => {
    pruneExportJobs();
    const job = exportJobs.get(req.params.jobId);
    if (!job || job.userId !== req.user.id) {
      jsonError(res, 404, 'Export job not found');
      return;
    }
    res.json({ job: mapJob(job, basePath) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const request = parseTrackUploadRequest(req, res, config);
    if (!request) return;

    if (shouldUseAsyncExport(req) || request.format === 'flac') {
      try {
        const job = startExportJob({ request, repositories });
        res.status(202).json({ job: mapJob(job, basePath) });
      } catch (err) {
        if (err instanceof ExportQueueFullError) {
          jsonError(res, 503, err.message);
          return;
        }
        throw err;
      }
      return;
    }

    const audio = prepareAudioBuffer(request.body, request.format, request.metadata);
    fs.mkdirSync(path.dirname(request.absolute), { recursive: true });
    fs.writeFileSync(request.absolute, audio, { flag: 'wx', mode: 0o640 });

    try {
      const row = await repositories.tracks.create({
        id: request.id,
        userId: request.userId,
        fileName: request.displayName,
        storagePath: request.relative,
        status: 'mastered',
        durationSeconds: request.durationSeconds,
        sizeBytes: audio.length,
        format: request.format,
      });
      res.status(201).json({ track: mapTrack(row, basePath) });
    } catch (err) {
      fs.rmSync(request.absolute, { force: true });
      throw err;
    }
  }));

  router.get('/:id/waveform', asyncHandler(async (req, res) => {
    const row = await repositories.tracks.findForUser(req.params.id, req.user.id);
    if (!row) {
      jsonError(res, 404, 'Track not found');
      return;
    }

    const absolute = resolveStoredPath(config, row.storagePath);
    if (!absolute || !fs.existsSync(absolute)) {
      jsonError(res, 404, 'Track file not found');
      return;
    }

    const waveformPath = waveformPathForAudioPath(absolute);
    let waveform;
    if (fs.existsSync(waveformPath)) {
      try {
        waveform = JSON.parse(fs.readFileSync(waveformPath, 'utf8'));
      } catch {
        waveform = null;
        fs.rmSync(waveformPath, { force: true });
      }
    }
    if (!waveform) {
      const audio = fs.readFileSync(absolute);
      waveform = buildWaveformPeaks(audio, { format: row.format });
      fs.writeFileSync(waveformPath, JSON.stringify(waveform), { flag: 'wx', mode: 0o640 });
    }

    res.json({ waveform });
  }));

  router.get('/:id/download', asyncHandler(async (req, res) => {
    const row = await repositories.tracks.findForUser(req.params.id, req.user.id);
    if (!row) {
      jsonError(res, 404, 'Track not found');
      return;
    }

    const absolute = resolveStoredPath(config, row.storagePath);
    if (!absolute || !fs.existsSync(absolute)) {
      jsonError(res, 404, 'Track file not found');
      return;
    }

    const stat = fs.statSync(absolute);
    const range = parseRangeHeader(req.header('Range'), stat.size);
    res.setHeader('Accept-Ranges', 'bytes');

    if (!range) {
      res.type(contentTypeForFormat(row.format));
      res.download(absolute, row.fileName);
      return;
    }

    if (!range.satisfiable) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.sendStatus(416);
      return;
    }

    res.status(206);
    res.setHeader('Content-Type', contentTypeForFormat(row.format));
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader('Content-Disposition', `inline; filename="${encodeHeaderFileName(row.fileName)}"`);
    fs.createReadStream(absolute, { start: range.start, end: range.end }).pipe(res);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const row = await repositories.tracks.findForUser(req.params.id, req.user.id);
    if (!row) {
      jsonError(res, 404, 'Track not found');
      return;
    }

    const absolute = resolveStoredPath(config, row.storagePath);
    if (absolute && fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
      fs.rmSync(waveformPathForAudioPath(absolute), { force: true });
    }

    await repositories.tracks.deleteForUser(req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  return router;
}

function parseTrackUploadRequest(req, res, config) {
  const id = randomUUID();
  const format = safeFormat(req.header('X-Format'));
  if (!format) {
    jsonError(res, 400, 'Unsupported audio export format');
    return null;
  }

  const contentType = String(req.header('Content-Type') || '').split(';')[0].toLowerCase();
  const expectedTypes = format === 'wav'
    ? new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])
    : format === 'flac'
      ? new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac'])
      : new Set(['audio/mpeg', 'audio/mp3']);
  if (!expectedTypes.has(contentType)) {
    jsonError(res, 415, 'Audio content type does not match the export format');
    return null;
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    jsonError(res, 400, 'Audio payload is required');
    return null;
  }

  const displayName = `${safeBaseName(req.header('X-File-Name'))}_mastered.${format}`;
  const durationSeconds = parseDurationSeconds(req.header('X-Duration-Seconds'));
  const { relative, absolute } = storagePathFor(config, req.user.id, id, displayName, format);

  return {
    id,
    userId: req.user.id,
    format,
    displayName,
    durationSeconds,
    relative,
    absolute,
    body: req.body,
    metadata: readWavMetadataHeaders(req, displayName),
  };
}

function shouldUseAsyncExport(req) {
  return req.query.async === '1'
    || req.query.async === 'true'
    || req.header('X-Async-Export') === '1'
    || req.header('Prefer') === 'respond-async';
}

function startExportJob({ request, repositories }) {
  pruneExportJobs();
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    userId: request.userId,
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    error: null,
    track: null,
  };

  const audio = request.body.buffer.slice(
    request.body.byteOffset,
    request.body.byteOffset + request.body.byteLength,
  );

  const fail = (err) => {
    fs.rmSync(request.absolute, { force: true });
    fs.rmSync(waveformPathForAudioPath(request.absolute), { force: true });
    job.status = 'failed';
    job.updatedAt = new Date().toISOString();
    job.error = err instanceof Error ? err.message : String(err || 'Audio export failed');
  };

  const exportResult = exportWorkerPool.run({
    absolute: request.absolute,
    format: request.format,
    metadata: request.metadata,
    audio,
  }, [audio]);

  exportJobs.set(job.id, job);

  exportResult
    .then(async (message) => {
      try {
        if (!message?.ok) {
          fail(message?.error || 'Audio export failed');
          return;
        }
        const row = await repositories.tracks.create({
          id: request.id,
          userId: request.userId,
          fileName: request.displayName,
          storagePath: request.relative,
          status: 'mastered',
          durationSeconds: request.durationSeconds,
          sizeBytes: message.sizeBytes,
          format: request.format,
        });
        job.status = 'completed';
        job.track = row;
        job.updatedAt = new Date().toISOString();
      } catch (err) {
        fail(err);
      }
    })
    .catch(fail);

  return job;
}

function parseRangeHeader(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || size <= 0) return { satisfiable: false };

  let start;
  let end;
  if (match[1] === '' && match[2] === '') return { satisfiable: false };

  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { satisfiable: false };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return { satisfiable: false };
  }

  return { satisfiable: true, start, end: Math.min(end, size - 1) };
}

function contentTypeForFormat(format) {
  if (format === 'mp3') return 'audio/mpeg';
  if (format === 'flac') return 'audio/flac';
  return 'audio/wav';
}

function encodeHeaderFileName(fileName) {
  return String(fileName).replace(/["\\\r\n]/g, '_');
}

function prepareAudioBuffer(body, format, metadata) {
  return format === 'wav' ? injectWavInfoMetadataIfPossible(body, metadata) : body;
}

function parseDurationSeconds(value) {
  const durationSeconds = Number.parseFloat(value || '');
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 86400
    ? durationSeconds
    : null;
}

function readWavMetadataHeaders(req, displayName) {
  return {
    artist: req.header('X-Artist') || req.header('X-Track-Artist') || '',
    title: req.header('X-Title') || req.header('X-Track-Title') || displayName.replace(/_mastered\.wav$/i, ''),
    album: req.header('X-Album') || req.header('X-Track-Album') || '',
    genre: req.header('X-Genre') || req.header('X-Track-Genre') || '',
    date: req.header('X-Date') || req.header('X-Year') || req.header('X-Release-Date') || req.header('X-Release-Year') || '',
    comment: req.header('X-Comment') || req.header('X-Track-Comment') || '',
    copyright: req.header('X-Copyright') || '',
    software: 'TrackMaster v1.0',
  };
}

function pruneExportJobs() {
  const cutoff = Date.now() - MAX_JOB_AGE_MS;
  for (const [id, job] of exportJobs.entries()) {
    if (Date.parse(job.updatedAt || job.createdAt) < cutoff) {
      exportJobs.delete(id);
    }
  }
}
