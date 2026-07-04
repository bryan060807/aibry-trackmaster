import { useState, useEffect, useRef, useCallback, type SetStateAction } from 'react';
import { audioBufferToWav, audioBufferToMp3 } from '../utils/exportUtils';
import { downloadTrack, uploadTrack, type ExportMetadata } from '../lib/dataService';

export interface MasteringParams {
  inputGain: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  compThreshold: number;
  compRatio: number;
  makeupGain: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  reverbDecay: number;
  reverbMix: number;
  saturationDrive: number;
  saturationMix: number;
  softClipperAmount: number;
  softClipperTrim: number;
  stereoWidth: number;
  lowMonoFrequency: number;
  lowMonoAmount: number;
  outputGain: number;
  limiterCeiling: number;
}

export interface MasteringMeters {
  peakDb: number;
  rmsDb: number;
  gainReductionDb: number;
  limiterCeilingDb: number;
  clipping: boolean;
}

export interface MasteringAnalysis {
  peakDb: number;
  truePeakDb: number;
  rmsDb: number;
  integratedLufs: number;
  shortTermLufs: number;
  momentaryLufs: number;
  loudnessEstimateLufs: number;
  crestFactorDb: number;
  clippingSamples: number;
  clipping: boolean;
}

export type MasteringModuleKey = 'eq' | 'dynamics' | 'saturation' | 'delay' | 'reverb' | 'softClipper' | 'stereo' | 'limiter';

export type MasteringBypasses = Record<MasteringModuleKey, boolean>;

const DEFAULT_BYPASSES: MasteringBypasses = {
  eq: false,
  dynamics: false,
  saturation: false,
  delay: false,
  reverb: false,
  softClipper: false,
  stereo: false,
  limiter: false,
};

const DEFAULT_PARAMS: MasteringParams = {
  inputGain: 0,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compThreshold: -14,
  compRatio: 1.5,
  makeupGain: 0,
  delayTime: 0.3,
  delayFeedback: 0.2,
  delayMix: 0,
  reverbDecay: 1.5,
  reverbMix: 0,
  saturationDrive: 1,
  saturationMix: 0,
  softClipperAmount: 0,
  softClipperTrim: 0,
  stereoWidth: 1,
  lowMonoFrequency: 120,
  lowMonoAmount: 0,
  outputGain: 0,
  limiterCeiling: -1,
};

const DEFAULT_METERS: MasteringMeters = {
  peakDb: -Infinity,
  rmsDb: -Infinity,
  gainReductionDb: 0,
  limiterCeilingDb: DEFAULT_PARAMS.limiterCeiling,
  clipping: false,
};

type ParamInput = Partial<MasteringParams>;

export function normalizeMasteringParams(params: ParamInput): MasteringParams {
  return { ...DEFAULT_PARAMS, ...params };
}

function generateImpulseResponse(ctx: BaseAudioContext, duration: number, decay: number) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i += 1) {
    const multiplier = Math.pow(1 - i / length, decay);
    left[i] = (Math.random() * 2 - 1) * multiplier;
    right[i] = (Math.random() * 2 - 1) * multiplier;
  }

  return impulse;
}

function makeDistortionCurve(amount: number) {
  const nSamples = 44100;
  const curve = new Float32Array(nSamples);
  const drive = Math.max(0.001, amount);

  for (let i = 0; i < nSamples; i += 1) {
    const x = i * 2 / nSamples - 1;
    curve[i] = Math.tanh(x * drive);
  }

  return curve;
}

function makeSoftClipperCurve(amount: number) {
  const nSamples = 44100;
  const curve = new Float32Array(nSamples);
  const normalizedAmount = Math.max(0, amount);
  const drive = 1 + normalizedAmount * 12;
  const normalizer = Math.tanh(drive);

  for (let i = 0; i < nSamples; i += 1) {
    const x = i * 2 / nSamples - 1;
    curve[i] = normalizedAmount <= 0 ? x : Math.tanh(x * drive) / normalizer;
  }

  return curve;
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

function amplitudeToDb(amplitude: number) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

function calculateMeanSquare(buffer: AudioBuffer, startSample: number, sampleLength: number) {
  let sumSquares = 0;
  let sampleCount = 0;
  const safeStart = Math.max(0, startSample);
  const safeEnd = Math.min(buffer.length, safeStart + sampleLength);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = safeStart; i < safeEnd; i += 1) {
      const sample = samples[i];
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }

  return sumSquares / Math.max(1, sampleCount);
}

function meanSquareToLufs(meanSquare: number) {
  if (!Number.isFinite(meanSquare) || meanSquare <= 0) return -Infinity;
  return -0.691 + 10 * Math.log10(meanSquare);
}

function calculateGatedIntegratedLoudness(buffer: AudioBuffer) {
  const blockLength = Math.max(1, Math.floor(buffer.sampleRate * 0.4));
  const hopLength = Math.max(1, Math.floor(buffer.sampleRate * 0.1));
  const blockMeanSquares: number[] = [];

  for (let start = 0; start < buffer.length; start += hopLength) {
    const meanSquare = calculateMeanSquare(buffer, start, blockLength);
    if (meanSquareToLufs(meanSquare) > -70) blockMeanSquares.push(meanSquare);
  }

  if (blockMeanSquares.length === 0) return -Infinity;

  const preliminaryMeanSquare = blockMeanSquares.reduce((sum, value) => sum + value, 0) / blockMeanSquares.length;
  const relativeGate = meanSquareToLufs(preliminaryMeanSquare) - 10;
  const gated = blockMeanSquares.filter(value => meanSquareToLufs(value) > relativeGate);
  const integratedMeanSquare = (gated.length > 0 ? gated : blockMeanSquares).reduce((sum, value) => sum + value, 0) / Math.max(1, gated.length || blockMeanSquares.length);
  return meanSquareToLufs(integratedMeanSquare);
}

function estimateTruePeak(buffer: AudioBuffer) {
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) {
      const current = samples[i];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      for (let step = 0; step < 4; step += 1) {
        const interpolated = current + (next - current) * (step / 4);
        const abs = Math.abs(interpolated);
        if (abs > peak) peak = abs;
      }
    }
  }

  return peak;
}

function analyzeRenderedBuffer(buffer: AudioBuffer): MasteringAnalysis {
  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  let clippingSamples = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      if (abs >= 0.999) clippingSamples += 1;
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
  const peakDb = amplitudeToDb(peak);
  const truePeakDb = amplitudeToDb(estimateTruePeak(buffer));
  const rmsDb = amplitudeToDb(rms);
  const integratedLufs = calculateGatedIntegratedLoudness(buffer);
  const shortTermWindow = Math.min(buffer.length, Math.max(1, Math.floor(buffer.sampleRate * 3)));
  const momentaryWindow = Math.min(buffer.length, Math.max(1, Math.floor(buffer.sampleRate * 0.4)));
  const shortTermLufs = meanSquareToLufs(calculateMeanSquare(buffer, Math.max(0, buffer.length - shortTermWindow), shortTermWindow));
  const momentaryLufs = meanSquareToLufs(calculateMeanSquare(buffer, Math.max(0, buffer.length - momentaryWindow), momentaryWindow));

  return {
    peakDb,
    truePeakDb,
    rmsDb,
    integratedLufs,
    shortTermLufs,
    momentaryLufs,
    loudnessEstimateLufs: integratedLufs,
    crestFactorDb: Number.isFinite(peakDb) && Number.isFinite(rmsDb) ? peakDb - rmsDb : 0,
    clippingSamples,
    clipping: clippingSamples > 0 || truePeakDb >= -0.3,
  };
}

function formatAnalysisValue(value: number, suffix: string) {
  if (!Number.isFinite(value)) return `-∞ ${suffix}`;
  return `${value.toFixed(1)} ${suffix}`;
}

function buildComparatorNotes(fileName: string, params: MasteringParams, analysis: MasteringAnalysis, metadata: ExportMetadata) {
  return [
    `Track: ${metadata.title?.trim() || fileName}`,
    `Preset: ${metadata.comment?.trim() || 'Current TrackMaster settings'}`,
    `Limiter Ceiling: ${params.limiterCeiling.toFixed(1)} dB`,
    `Sample Peak: ${formatAnalysisValue(analysis.peakDb, 'dBFS')}`,
    `True Peak Estimate: ${formatAnalysisValue(analysis.truePeakDb, 'dBTP')}`,
    `Integrated Loudness: ${formatAnalysisValue(analysis.integratedLufs, 'LUFS')}`,
    `Short-Term Loudness: ${formatAnalysisValue(analysis.shortTermLufs, 'LUFS')}`,
    `Momentary Loudness: ${formatAnalysisValue(analysis.momentaryLufs, 'LUFS')}`,
    `RMS: ${formatAnalysisValue(analysis.rmsDb, 'dBFS')}`,
    `Crest Factor: ${formatAnalysisValue(analysis.crestFactorDb, 'dB')}`,
    `Clipping Samples: ${analysis.clippingSamples}`,
    `Input Gain: ${params.inputGain.toFixed(1)} dB`,
    `Output Gain: ${params.outputGain.toFixed(1)} dB`,
    `Soft Clip: ${params.softClipperAmount.toFixed(2)}`,
    `Stereo Width: ${params.stereoWidth.toFixed(2)}`,
    `Low Mono: ${(params.lowMonoAmount * 100).toFixed(0)}% below ${params.lowMonoFrequency.toFixed(0)} Hz`,
    'Notes: Compare original mix against this master in TrackMaster Comparator.',
  ].join('\n');
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  if (typeof window === 'undefined') return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface ProcessingGraph<TContext extends BaseAudioContext> {
  input: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  saturation: WaveShaperNode;
  saturationDry: GainNode;
  saturationWet: GainNode;
  dry: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  delayWet: GainNode;
  convolver: ConvolverNode;
  reverbWet: GainNode;
  softClipper: WaveShaperNode;
  softClipperTrim: GainNode;
  stereoSplitter: ChannelSplitterNode;
  stereoMerger: ChannelMergerNode;
  leftStereoGain: GainNode;
  rightStereoGain: GainNode;
  lowMonoFilter: BiquadFilterNode;
  lowMonoGain: GainNode;
  outputGain: GainNode;
  limiter: DynamicsCompressorNode;
  analyser?: AnalyserNode;
  destination: AudioNode;
  context: TContext;
}

function applyProcessingParams(graph: ProcessingGraph<BaseAudioContext>, params: MasteringParams, bypasses: MasteringBypasses = DEFAULT_BYPASSES) {
  graph.input.gain.value = dbToGain(params.inputGain);
  graph.eqLow.gain.value = bypasses.eq ? 0 : params.eqLow;
  graph.eqMid.gain.value = bypasses.eq ? 0 : params.eqMid;
  graph.eqHigh.gain.value = bypasses.eq ? 0 : params.eqHigh;
  graph.compressor.threshold.value = bypasses.dynamics ? 0 : params.compThreshold;
  graph.compressor.ratio.value = bypasses.dynamics ? 1 : params.compRatio;
  graph.makeup.gain.value = dbToGain(bypasses.dynamics ? 0 : params.makeupGain);
  graph.saturation.curve = makeDistortionCurve(params.saturationDrive);
  graph.saturationDry.gain.value = bypasses.saturation ? 1 : 1 - params.saturationMix;
  graph.saturationWet.gain.value = bypasses.saturation ? 0 : params.saturationMix;
  graph.delay.delayTime.value = params.delayTime;
  graph.feedback.gain.value = bypasses.delay ? 0 : params.delayFeedback;
  graph.delayWet.gain.value = bypasses.delay ? 0 : params.delayMix;
  graph.reverbWet.gain.value = bypasses.reverb ? 0 : params.reverbMix;
  graph.softClipper.curve = makeSoftClipperCurve(bypasses.softClipper ? 0 : params.softClipperAmount);
  graph.softClipperTrim.gain.value = dbToGain(bypasses.softClipper ? 0 : params.softClipperTrim);
  graph.leftStereoGain.gain.value = bypasses.stereo ? 1 : params.stereoWidth;
  graph.rightStereoGain.gain.value = bypasses.stereo ? 1 : params.stereoWidth;
  graph.lowMonoFilter.frequency.value = params.lowMonoFrequency;
  graph.lowMonoGain.gain.value = bypasses.stereo ? 0 : params.lowMonoAmount;
  graph.outputGain.gain.value = dbToGain(params.outputGain);
  graph.limiter.threshold.value = bypasses.limiter ? 0 : params.limiterCeiling;
  graph.limiter.knee.value = 0;
  graph.limiter.ratio.value = bypasses.limiter ? 1 : 20;
  graph.limiter.attack.value = 0.003;
  graph.limiter.release.value = 0.08;
}

function createProcessingGraph<TContext extends BaseAudioContext>(ctx: TContext, params: MasteringParams, destination: AudioNode, includeAnalyser: boolean, bypasses: MasteringBypasses = DEFAULT_BYPASSES): ProcessingGraph<TContext> {
  const input = ctx.createGain();

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 150;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1000;
  eqMid.Q.value = 0.9;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 4000;

  const compressor = ctx.createDynamicsCompressor();
  compressor.attack.value = 0.015;
  compressor.release.value = 0.18;

  const makeup = ctx.createGain();
  const saturation = ctx.createWaveShaper();
  saturation.oversample = '4x';
  const saturationDry = ctx.createGain();
  const saturationWet = ctx.createGain();

  const dry = ctx.createGain();
  const delay = ctx.createDelay(5.0);
  const feedback = ctx.createGain();
  const delayWet = ctx.createGain();
  const convolver = ctx.createConvolver();
  const reverbWet = ctx.createGain();
  convolver.buffer = generateImpulseResponse(ctx, params.reverbDecay, 2);

  const softClipper = ctx.createWaveShaper();
  softClipper.oversample = '4x';
  const softClipperTrim = ctx.createGain();
  const stereoSplitter = ctx.createChannelSplitter(2);
  const stereoMerger = ctx.createChannelMerger(2);
  const leftStereoGain = ctx.createGain();
  const rightStereoGain = ctx.createGain();
  const lowMonoFilter = ctx.createBiquadFilter();
  lowMonoFilter.type = 'lowpass';
  const lowMonoGain = ctx.createGain();
  const outputGain = ctx.createGain();

  const limiter = ctx.createDynamicsCompressor();
  const analyser = includeAnalyser ? ctx.createAnalyser() : undefined;
  if (analyser) analyser.fftSize = 2048;

  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(saturationDry);
  makeup.connect(saturation);
  saturation.connect(saturationWet);
  saturationDry.connect(dry);
  saturationWet.connect(dry);
  dry.connect(delay);
  dry.connect(convolver);
  dry.connect(softClipper);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(softClipper);
  convolver.connect(reverbWet);
  reverbWet.connect(softClipper);
  softClipper.connect(softClipperTrim);
  softClipperTrim.connect(stereoSplitter);
  stereoSplitter.connect(leftStereoGain, 0);
  stereoSplitter.connect(rightStereoGain, 1);
  leftStereoGain.connect(stereoMerger, 0, 0);
  rightStereoGain.connect(stereoMerger, 0, 1);
  softClipperTrim.connect(lowMonoFilter);
  lowMonoFilter.connect(lowMonoGain);
  lowMonoGain.connect(stereoMerger, 0, 0);
  lowMonoGain.connect(stereoMerger, 0, 1);
  stereoMerger.connect(outputGain);
  outputGain.connect(limiter);

  if (analyser) {
    limiter.connect(analyser);
    analyser.connect(destination);
  } else {
    limiter.connect(destination);
  }

  const graph: ProcessingGraph<TContext> = {
    input,
    eqLow,
    eqMid,
    eqHigh,
    compressor,
    makeup,
    saturation,
    saturationDry,
    saturationWet,
    dry,
    delay,
    feedback,
    delayWet,
    convolver,
    reverbWet,
    softClipper,
    softClipperTrim,
    stereoSplitter,
    stereoMerger,
    leftStereoGain,
    rightStereoGain,
    lowMonoFilter,
    lowMonoGain,
    outputGain,
    limiter,
    analyser,
    destination,
    context: ctx,
  };

  applyProcessingParams(graph, params, bypasses);
  return graph;
}

export function useAudioEngine() {
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [params, setParamsState] = useState<MasteringParams>(DEFAULT_PARAMS);
  const [isExporting, setIsExporting] = useState(false);
  const [fileName, setFileName] = useState<string>('mastered_track');
  const [audioError, setAudioError] = useState<string | null>(null);
  const [meters, setMeters] = useState<MasteringMeters>(DEFAULT_METERS);
  const [lastAnalysis, setLastAnalysis] = useState<MasteringAnalysis | null>(null);
  const [lastComparatorNotes, setLastComparatorNotes] = useState<string>('');
  const [bypasses, setBypasses] = useState<MasteringBypasses>(DEFAULT_BYPASSES);
  const [queue, setQueue] = useState<File[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const graphRef = useRef<ProcessingGraph<AudioContext> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentIndexRef = useRef<number>(-1);
  const queueRef = useRef<File[]>([]);
  const paramsRef = useRef<MasteringParams>(DEFAULT_PARAMS);
  const bypassesRef = useRef<MasteringBypasses>(DEFAULT_BYPASSES);
  const prevReverbDecayRef = useRef<number>(DEFAULT_PARAMS.reverbDecay);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef<number>(0);
  const meterBufferRef = useRef<Float32Array | null>(null);

  const setParams = useCallback((next: SetStateAction<MasteringParams>) => {
    setParamsState((previous) => {
      const resolved = typeof next === 'function'
        ? (next as (value: MasteringParams) => MasteringParams)(previous)
        : next;
      return normalizeMasteringParams(resolved);
    });
  }, []);

  const toggleBypass = useCallback((module: MasteringModuleKey) => {
    setBypasses(previous => ({ ...previous, [module]: !previous[module] }));
  }, []);

  const resetModule = useCallback((module: MasteringModuleKey) => {
    setParamsState((previous) => {
      const next = { ...previous };
      if (module === 'eq') {
        next.eqLow = DEFAULT_PARAMS.eqLow;
        next.eqMid = DEFAULT_PARAMS.eqMid;
        next.eqHigh = DEFAULT_PARAMS.eqHigh;
      }
      if (module === 'dynamics') {
        next.compThreshold = DEFAULT_PARAMS.compThreshold;
        next.compRatio = DEFAULT_PARAMS.compRatio;
        next.makeupGain = DEFAULT_PARAMS.makeupGain;
      }
      if (module === 'saturation') {
        next.saturationDrive = DEFAULT_PARAMS.saturationDrive;
        next.saturationMix = DEFAULT_PARAMS.saturationMix;
      }
      if (module === 'delay') {
        next.delayTime = DEFAULT_PARAMS.delayTime;
        next.delayFeedback = DEFAULT_PARAMS.delayFeedback;
        next.delayMix = DEFAULT_PARAMS.delayMix;
      }
      if (module === 'reverb') {
        next.reverbDecay = DEFAULT_PARAMS.reverbDecay;
        next.reverbMix = DEFAULT_PARAMS.reverbMix;
      }
      if (module === 'softClipper') {
        next.softClipperAmount = DEFAULT_PARAMS.softClipperAmount;
        next.softClipperTrim = DEFAULT_PARAMS.softClipperTrim;
      }
      if (module === 'stereo') {
        next.stereoWidth = DEFAULT_PARAMS.stereoWidth;
        next.lowMonoFrequency = DEFAULT_PARAMS.lowMonoFrequency;
        next.lowMonoAmount = DEFAULT_PARAMS.lowMonoAmount;
      }
      if (module === 'limiter') {
        next.limiterCeiling = DEFAULT_PARAMS.limiterCeiling;
        next.outputGain = DEFAULT_PARAMS.outputGain;
      }
      return normalizeMasteringParams(next);
    });
  }, []);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    bypassesRef.current = bypasses;
  }, [bypasses]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const initializeAudioEngine = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume().catch((err) => {
          console.warn('Audio context resume was blocked', err);
        });
      }
      return audioContextRef.current;
    }

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      setAudioError('This browser does not support the Web Audio API.');
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContextCtor();
    } catch (err) {
      console.error('Failed to initialize audio engine', err);
      setAudioError('The browser blocked audio engine initialization. Try a current desktop browser.');
      return;
    }

    audioContextRef.current = ctx;
    setAudioContext(ctx);
    graphRef.current = createProcessingGraph(ctx, paramsRef.current, ctx.destination, true, bypassesRef.current);
    prevReverbDecayRef.current = paramsRef.current.reverbDecay;
    setAudioError(null);
    return ctx;
  }, []);

  useEffect(() => {
    return () => {
      const ctx = audioContextRef.current;
      try {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (sourceNodeRef.current) {
          sourceNodeRef.current.onended = null;
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        }
        if (ctx && ctx.state !== 'closed') void ctx.close();
      } catch (err) {
        console.warn('Audio engine cleanup failed', err);
      }
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    const ctx = audioContextRef.current;
    if (!graph || !ctx) return;

    try {
      if (graph.convolver && prevReverbDecayRef.current !== params.reverbDecay) {
        graph.convolver.buffer = generateImpulseResponse(ctx, params.reverbDecay, 2);
        prevReverbDecayRef.current = params.reverbDecay;
      }
      applyProcessingParams(graph, params, bypasses);
      setMeters(prev => ({ ...prev, limiterCeilingDb: params.limiterCeiling }));
    } catch (err) {
      console.error('Failed to update audio parameters', err);
      setAudioError('Audio controls could not be applied in this browser session.');
    }
  }, [params, bypasses]);

  const updateMeters = useCallback(() => {
    const graph = graphRef.current;
    const analyser = graph?.analyser;
    if (!analyser) return;

    let meterBuffer = meterBufferRef.current;
    if (!meterBuffer || meterBuffer.length !== analyser.fftSize) {
      meterBuffer = new Float32Array(analyser.fftSize);
      meterBufferRef.current = meterBuffer;
    }

    analyser.getFloatTimeDomainData(meterBuffer);
    let peak = 0;
    let sumSquares = 0;

    for (let i = 0; i < meterBuffer.length; i += 1) {
      const sample = meterBuffer[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / meterBuffer.length);
    const peakDb = amplitudeToDb(peak);
    setMeters({
      peakDb,
      rmsDb: amplitudeToDb(rms),
      gainReductionDb: graph.compressor.reduction ?? 0,
      limiterCeilingDb: paramsRef.current.limiterCeiling,
      clipping: peakDb >= -0.3,
    });
  }, []);

  const updateProgress = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !isPlaying) return;

    const time = ctx.currentTime - startTimeRef.current;
    if (time >= duration) {
      setCurrentTime(duration);
      setIsPlaying(false);
      pauseTimeRef.current = 0;
      return;
    }

    setCurrentTime(time);
    updateMeters();
    if (typeof window !== 'undefined') {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [duration, isPlaying, updateMeters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, updateProgress]);

  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch (err) {
        console.warn('Stop failed', err);
      } finally {
        sourceNodeRef.current = null;
      }
    }
    setIsPlaying(false);
    pauseTimeRef.current = 0;
    setCurrentTime(0);
    setMeters(prev => ({ ...DEFAULT_METERS, limiterCeilingDb: prev.limiterCeilingDb }));
  }, []);

  const loadAudio = useCallback(async (file: File, ctx = audioContextRef.current): Promise<boolean> => {
    if (!ctx) {
      setAudioError('Audio engine is not ready yet.');
      return false;
    }

    try {
      stop();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      setDuration(buffer.duration);
      setCurrentTime(0);
      pauseTimeRef.current = 0;
      setFileName(file.name.replace(/\.[^/.]+$/, ''));
      setAudioError(null);
      return true;
    } catch (err) {
      console.error('Failed to load audio file', err);
      setAudioBuffer(null);
      setDuration(0);
      setCurrentTime(0);
      setAudioError('That file could not be decoded as browser-supported audio.');
      return false;
    }
  }, [stop]);

  const addToQueue = useCallback(async (files: FileList) => {
    const ctx = await initializeAudioEngine();
    if (!ctx) {
      setAudioError(prev => prev || 'Audio engine could not be started.');
      return;
    }

    const newFiles = Array.from(files);
    if (newFiles.length === 0) return;

    if (currentIndexRef.current === -1) {
      const loaded = await loadAudio(newFiles[0], ctx);
      if (!loaded) return;
      setQueue(prev => [...prev, ...newFiles]);
      setCurrentIndex(0);
      return;
    }

    setQueue(prev => [...prev, ...newFiles]);
  }, [initializeAudioEngine, loadAudio]);

  const removeFromQueue = useCallback((index: number) => {
    setQueue(prev => {
      const updated = prev.filter((_, i) => i !== index);
      const activeIndex = currentIndexRef.current;
      if (index === activeIndex) {
        stop();
        setCurrentIndex(-1);
      } else if (index < activeIndex) {
        setCurrentIndex(activeIndex - 1);
      }
      return updated;
    });
  }, [stop]);

  const play = useCallback(async () => {
    const ctx = await initializeAudioEngine();
    const graph = graphRef.current;
    if (!ctx || !audioBuffer || !graph?.input) return;

    try {
      if (ctx.state === 'suspended') await ctx.resume();
      if (sourceNodeRef.current) stop();

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(graph.input);

      source.onended = () => {
        if (sourceNodeRef.current === source) {
          sourceNodeRef.current = null;
          setIsPlaying(false);
          const activeIndex = currentIndexRef.current;
          const activeQueue = queueRef.current;
          if (activeIndex !== -1 && activeIndex < activeQueue.length - 1) {
            const nextIdx = activeIndex + 1;
            setCurrentIndex(nextIdx);
            void loadAudio(activeQueue[nextIdx]);
          }
        }
      };

      source.start(0, pauseTimeRef.current);
      startTimeRef.current = ctx.currentTime - pauseTimeRef.current;
      sourceNodeRef.current = source;
      setIsPlaying(true);
    } catch (err) {
      console.error('Playback failed', err);
      setIsPlaying(false);
      setAudioError('Playback failed. Try reloading the audio file.');
    }
  }, [audioBuffer, initializeAudioEngine, loadAudio, stop]);

  const pause = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !sourceNodeRef.current) return;

    try {
      sourceNodeRef.current.stop();
      pauseTimeRef.current = ctx.currentTime - startTimeRef.current;
    } catch (err) {
      console.warn('Pause failed', err);
    } finally {
      sourceNodeRef.current = null;
      setIsPlaying(false);
    }
  }, []);

  const seek = useCallback((time: number) => {
    const wasPlaying = isPlaying;
    if (wasPlaying) stop();
    pauseTimeRef.current = time;
    setCurrentTime(time);
    if (wasPlaying) void play();
  }, [isPlaying, play, stop]);

  const exportTrack = useCallback(async (format: 'wav' | 'mp3' | 'flac' = 'flac', bitrate: number = 320, metadata: ExportMetadata = {}) => {
    if (!audioBuffer) return;
    setIsExporting(true);

    try {
      if (typeof OfflineAudioContext === 'undefined') {
        throw new Error('Offline rendering is not supported in this browser.');
      }

      const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      const graph = createProcessingGraph(offlineCtx, paramsRef.current, offlineCtx.destination, false, bypassesRef.current);
      source.connect(graph.input);
      source.start(0);
      const renderedBuffer = await offlineCtx.startRendering();
      const analysis = analyzeRenderedBuffer(renderedBuffer);
      const comparatorNotes = buildComparatorNotes(fileName, paramsRef.current, analysis, metadata);
      setLastAnalysis(analysis);
      setLastComparatorNotes(comparatorNotes);

      const uploadBlob = format === 'mp3'
        ? await audioBufferToMp3(renderedBuffer, bitrate)
        : audioBufferToWav(renderedBuffer);

      const extension = format;
      const safeFileName = `${fileName}_mastered.${extension}`;
      const enrichedMetadata: ExportMetadata = {
        ...metadata,
        comment: [
          metadata.comment,
          comparatorNotes,
          `TrackMaster settings: limiter ceiling ${paramsRef.current.limiterCeiling.toFixed(1)} dB, soft clip ${paramsRef.current.softClipperAmount.toFixed(2)}, stereo width ${paramsRef.current.stereoWidth.toFixed(2)}, low mono ${(paramsRef.current.lowMonoAmount * 100).toFixed(0)}%, output gain ${paramsRef.current.outputGain.toFixed(1)} dB.`,
        ].filter(Boolean).join('\n\n'),
      };

      const { track } = await uploadTrack(uploadBlob, {
        fileName: safeFileName,
        format,
        durationSeconds: renderedBuffer.duration,
        metadata: enrichedMetadata,
      });
      const downloadBlob = await downloadTrack(track.id);
      triggerBrowserDownload(downloadBlob, track.fileName || safeFileName);
    } catch (err) {
      console.error('Export failed', err);
      setAudioError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  }, [audioBuffer, fileName]);

  return {
    play,
    pause,
    stop,
    seek,
    exportTrack,
    addToQueue,
    removeFromQueue,
    isPlaying,
    currentTime,
    duration,
    params,
    setParams,
    bypasses,
    toggleBypass,
    resetModule,
    meters,
    lastAnalysis,
    lastComparatorNotes,
    analyser: graphRef.current?.analyser || null,
    audioReady: Boolean(audioContext),
    hasAudio: Boolean(audioBuffer),
    isExporting,
    queue,
    currentIndex,
    audioError,
  };
}
