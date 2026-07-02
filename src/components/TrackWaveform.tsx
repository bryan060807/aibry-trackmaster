import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Waves } from 'lucide-react';
import { getTrackWaveform, type TrackRecord, type TrackWaveform as TrackWaveformData } from '../lib/dataService';

interface TrackWaveformProps {
  track: TrackRecord;
  accentClass: string;
}

export function TrackWaveform({ track, accentClass }: TrackWaveformProps) {
  const [waveform, setWaveform] = useState<TrackWaveformData | null>(null);
  const [loading, setLoading] = useState(Boolean(track.waveformUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!track.waveformUrl) {
      setWaveform(null);
      setLoading(false);
      setError('No waveform');
      return;
    }

    setLoading(true);
    setError(null);

    getTrackWaveform(track)
      .then(({ waveform }) => {
        if (cancelled) return;
        setWaveform(waveform);
        setError(waveform.peaks?.length ? null : waveform.reason || 'No peaks');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Waveform unavailable', err);
        setWaveform(null);
        setError('Waveform unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [track]);

  const bars = useMemo(() => downsamplePeaks(waveform?.peaks || [], 72), [waveform]);

  if (loading) {
    return (
      <div className="mt-2 flex h-8 items-center gap-2 rounded-sm border border-zinc-900/80 bg-black/30 px-2 text-[8px] font-mono uppercase tracking-widest text-zinc-600">
        <Loader2 size={10} className="animate-spin" />
        Loading waveform
      </div>
    );
  }

  if (!bars.length) {
    return (
      <div className="mt-2 flex h-8 items-center gap-2 rounded-sm border border-zinc-900/80 bg-black/30 px-2 text-[8px] font-mono uppercase tracking-widest text-zinc-700">
        <Waves size={10} />
        {error || 'No waveform'}
      </div>
    );
  }

  return (
    <div
      className="mt-2 flex h-10 items-center gap-[2px] rounded-sm border border-zinc-900/80 bg-black/40 px-2"
      title={waveformSummary(track, waveform)}
      aria-label={waveformSummary(track, waveform)}
    >
      {bars.map((peak, index) => (
        <span
          key={`${track.id}-${index}`}
          className={`block flex-1 rounded-full bg-current ${accentClass}`}
          style={{ height: `${Math.max(8, Math.round(peak * 100))}%`, opacity: 0.2 + peak * 0.65 }}
        />
      ))}
    </div>
  );
}

function downsamplePeaks(peaks: number[], targetCount: number) {
  if (!Array.isArray(peaks) || peaks.length === 0) return [];
  if (peaks.length <= targetCount) return peaks.map(normalizePeak);

  const output: number[] = [];
  const bucketSize = peaks.length / targetCount;

  for (let i = 0; i < targetCount; i += 1) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) {
      max = Math.max(max, normalizePeak(peaks[j]));
    }
    output.push(max);
  }

  return output;
}

function normalizePeak(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.abs(value)));
}

function waveformSummary(track: TrackRecord, waveform: TrackWaveformData | null) {
  const duration = track.durationSeconds ? formatDuration(track.durationSeconds) : 'unknown duration';
  const format = track.format?.toUpperCase() || waveform?.format?.toUpperCase() || 'audio';
  return `${format} waveform, ${duration}`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}
