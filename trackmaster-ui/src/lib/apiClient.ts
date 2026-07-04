import type { MasteringParams } from '../../../src/hooks/useAudioEngine';
import {
  apiFetch,
  clearLegacyAuthToken,
  getAuthToken,
  getAibryIdLoginUrl,
  getCurrentUser,
  login,
  logout,
  parseJson,
  register,
  type AuthResult,
  type AuthUser,
} from './sessionClient';

export type { AuthResult, AuthUser };
export { getAibryIdLoginUrl, getAuthToken, getCurrentUser, login, logout, register };

export interface TrackRecord {
  id: string;
  fileName: string;
  createdAt: string;
  storagePath: string;
  status: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  format: string | null;
  downloadUrl: string;
  waveformUrl?: string;
}

export interface TrackWaveform {
  version: number;
  format: string;
  source: string;
  reason?: string;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  peakCount: number;
  durationSeconds?: number;
  peaks: number[];
}

export interface ExportMetadata {
  artist?: string;
  title?: string;
  album?: string;
  genre?: string;
  year?: string;
  comment?: string;
  copyright?: string;
}

interface ExportJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  error: string | null;
  track: TrackRecord | null;
  statusUrl: string;
}

export interface ApiPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isCustom?: boolean;
  params: MasteringParams;
}

// TODO: Generate these types and paths from the API contract once /api/v1 is the primary surface.
export async function downloadTrack(id: string) {
  const response = await apiFetch(`/api/tracks/${encodeURIComponent(id)}/download`);
  if (!response.ok) {
    if (response.status === 401) clearLegacyAuthToken();
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === 'string' ? payload.error : 'Download failed';
    throw new Error(message);
  }
  return response.blob();
}

export async function listTracks() {
  return parseJson<{ tracks: TrackRecord[] }>(await apiFetch('/api/tracks'));
}

export async function getTrackWaveform(track: TrackRecord) {
  if (!track.waveformUrl) {
    throw new Error('Waveform is unavailable for this track.');
  }
  return parseJson<{ waveform: TrackWaveform }>(await apiFetch(track.waveformUrl));
}

export async function uploadTrack(blob: Blob, options: { fileName: string; format: string; durationSeconds: number; metadata?: ExportMetadata }) {
  const headers: Record<string, string> = {
    'Content-Type': blob.type || 'application/octet-stream',
    'X-File-Name': options.fileName,
    'X-Format': options.format,
    'X-Duration-Seconds': String(options.durationSeconds),
  };

  const metadataHeaders: Array<[keyof ExportMetadata, string]> = [
    ['artist', 'X-Artist'],
    ['title', 'X-Title'],
    ['album', 'X-Album'],
    ['genre', 'X-Genre'],
    ['year', 'X-Year'],
    ['comment', 'X-Comment'],
    ['copyright', 'X-Copyright'],
  ];

  for (const [key, header] of metadataHeaders) {
    const value = options.metadata?.[key]?.trim().replace(/[\r\n]+/g, ' | ');
    if (value) headers[header] = value;
  }

  const uploadPath = options.format === 'flac' ? '/api/tracks?async=1' : '/api/tracks';
  const payload = await parseJson<{ track?: TrackRecord; job?: ExportJob }>(await apiFetch(uploadPath, {
    method: 'POST',
    headers,
    body: blob,
  }));

  if (payload.track) return { track: payload.track };
  if (payload.job) return { track: await waitForExportJob(payload.job) };
  throw new Error('Track upload failed');
}

async function waitForExportJob(initialJob: ExportJob) {
  let job = initialJob;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (job.status === 'completed' && job.track) return job.track;
    if (job.status === 'failed') {
      throw new Error(job.error || 'Track export failed');
    }
    await delay(500);
    const payload = await parseJson<{ job: ExportJob }>(await apiFetch(job.statusUrl));
    job = payload.job;
  }
  throw new Error('Track export did not finish in time');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deleteTrack(id: string) {
  await parseJson<{ ok: true }>(await apiFetch(`/api/tracks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
}

export async function listPresets() {
  return parseJson<{ presets: ApiPreset[] }>(await apiFetch('/api/presets'));
}

export async function createPreset(name: string, params: MasteringParams) {
  return parseJson<{ preset: ApiPreset }>(await apiFetch('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
  }));
}

export async function deletePreset(id: string) {
  await parseJson<{ ok: true }>(await apiFetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
}
