const DEFAULT_PEAK_COUNT = 512;
const MAX_PEAK_COUNT = 4096;

export function waveformPathForAudioPath(audioPath) {
  return `${audioPath}.peaks.json`;
}

export function buildWaveformPeaks(audio, { format, peakCount = DEFAULT_PEAK_COUNT } = {}) {
  const count = clampPeakCount(peakCount);
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    return emptyWaveform({ format, peakCount: count, reason: 'empty_audio' });
  }

  if (format === 'wav' || isRiffWav(audio)) {
    return buildPcmWavPeaks(audio, count);
  }

  return emptyWaveform({ format, peakCount: count, reason: 'unsupported_format' });
}

function buildPcmWavPeaks(audio, peakCount) {
  const parsed = parsePcmWav(audio);
  if (!parsed) {
    return emptyWaveform({ format: 'wav', peakCount, reason: 'unsupported_wav' });
  }

  const { bitsPerSample, channels, dataStart, dataSize, sampleRate } = parsed;
  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channels;
  const totalFrames = Math.floor(dataSize / frameBytes);
  if (totalFrames <= 0) {
    return emptyWaveform({ format: 'wav', peakCount, reason: 'empty_pcm' });
  }

  const buckets = Math.min(peakCount, totalFrames);
  const peaks = new Array(buckets).fill(0);

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const startFrame = Math.floor((bucket * totalFrames) / buckets);
    const endFrame = Math.max(startFrame + 1, Math.floor(((bucket + 1) * totalFrames) / buckets));
    let peak = 0;

    for (let frame = startFrame; frame < endFrame; frame += 1) {
      const frameOffset = dataStart + frame * frameBytes;
      for (let channel = 0; channel < channels; channel += 1) {
        const sampleOffset = frameOffset + channel * bytesPerSample;
        const amplitude = readSampleAmplitude(audio, sampleOffset, bitsPerSample);
        if (amplitude > peak) peak = amplitude;
      }
    }

    peaks[bucket] = roundPeak(peak);
  }

  return {
    version: 1,
    format: 'wav',
    source: 'pcm',
    sampleRate,
    channels,
    bitsPerSample,
    peakCount: peaks.length,
    durationSeconds: roundSeconds(totalFrames / sampleRate),
    peaks,
  };
}

function parsePcmWav(buffer) {
  if (!isRiffWav(buffer)) return null;

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) return null;

    if (id === 'fmt ' && size >= 16) {
      fmt = {
        audioFormat: buffer.readUInt16LE(dataStart),
        channels: buffer.readUInt16LE(dataStart + 2),
        sampleRate: buffer.readUInt32LE(dataStart + 4),
        bitsPerSample: buffer.readUInt16LE(dataStart + 14),
      };
    } else if (id === 'data') {
      data = { dataStart, dataSize: size };
    }

    offset = dataEnd + (size % 2);
  }

  if (!fmt || !data) return null;
  if (fmt.audioFormat !== 1) return null;
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) return null;
  if (!Number.isFinite(fmt.channels) || fmt.channels < 1 || fmt.channels > 32) return null;
  if (!Number.isFinite(fmt.sampleRate) || fmt.sampleRate <= 0) return null;

  return { ...fmt, ...data };
}

function readSampleAmplitude(buffer, offset, bitsPerSample) {
  if (offset < 0 || offset >= buffer.length) return 0;

  if (bitsPerSample === 8) {
    return Math.abs((buffer.readUInt8(offset) - 128) / 128);
  }
  if (bitsPerSample === 16 && offset + 2 <= buffer.length) {
    return Math.abs(buffer.readInt16LE(offset) / 32768);
  }
  if (bitsPerSample === 24 && offset + 3 <= buffer.length) {
    const raw = buffer.readUIntLE(offset, 3);
    const signed = raw & 0x800000 ? raw - 0x1000000 : raw;
    return Math.abs(signed / 8388608);
  }
  if (bitsPerSample === 32 && offset + 4 <= buffer.length) {
    return Math.abs(buffer.readInt32LE(offset) / 2147483648);
  }
  return 0;
}

function emptyWaveform({ format, peakCount, reason }) {
  return {
    version: 1,
    format: format || 'unknown',
    source: 'none',
    reason,
    peakCount: 0,
    peaks: [],
  };
}

function isRiffWav(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WAVE';
}

function clampPeakCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PEAK_COUNT;
  return Math.max(32, Math.min(MAX_PEAK_COUNT, parsed));
}

function roundPeak(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function roundSeconds(value) {
  return Number(value.toFixed(3));
}
