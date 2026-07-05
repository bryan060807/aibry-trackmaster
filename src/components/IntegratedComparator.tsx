import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Headphones, Pause, Play, Repeat, RotateCcw } from 'lucide-react';
import {
  clamp,
  getComparableDuration,
  getSyncedDeckTime,
  shouldCorrectDeckDrift,
} from './integratedComparatorModel';

type CompareMode = 'A' | 'B' | 'blend' | 'diff';

type IntegratedComparatorProps = {
  sourceFile?: File | null;
  masteredBlob?: Blob | null;
  masteredFileName?: string;
  notes?: string;
  accentClass: string;
  accentBg: string;
};

type Deck = 'A' | 'B';

type AudioGraph = {
  ctx: AudioContext;
  sourceA: MediaElementAudioSourceNode;
  sourceB: MediaElementAudioSourceNode;
  gainA: GainNode;
  gainB: GainNode;
  masterGain: GainNode;
  analyser: AnalyserNode;
};

const DEFAULT_TRIM = 0.8;
const DIFF_GAIN = 0.35;

function equalPowerA(amount: number) {
  return Math.cos(clamp(amount, 0, 1) * Math.PI / 2);
}

function equalPowerB(amount: number) {
  return Math.sin(clamp(amount, 0, 1) * Math.PI / 2);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function estimateRms(blob: Blob) {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    let sumSquares = 0;
    let sampleCount = 0;
    const step = Math.max(1, Math.floor(buffer.length / 250000));

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index += step) {
        const sample = samples[index];
        sumSquares += sample * sample;
        sampleCount += 1;
      }
    }

    return sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export function IntegratedComparator({ sourceFile, masteredBlob, masteredFileName, notes, accentClass, accentBg }: IntegratedComparatorProps) {
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const animationRef = useRef<number | null>(null);

  const [mode, setMode] = useState<CompareMode>('A');
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimA, setTrimA] = useState(DEFAULT_TRIM);
  const [trimB, setTrimB] = useState(DEFAULT_TRIM);
  const [volume, setVolume] = useState(DEFAULT_TRIM);
  const [blendAmount, setBlendAmount] = useState(0.5);
  const [matchLoudness, setMatchLoudness] = useState(false);
  const [monoCheck, setMonoCheck] = useState(false);
  const [nudgeB, setNudgeB] = useState(0);
  const [looping, setLooping] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rms, setRms] = useState<Record<Deck, number | null>>({ A: null, B: null });
  const [meter, setMeter] = useState({ peak: 0, rms: 0, clipped: false });
  const [playbackError, setPlaybackError] = useState('');

  const sourceUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : '', [sourceFile]);
  const masteredUrl = useMemo(() => masteredBlob ? URL.createObjectURL(masteredBlob) : '', [masteredBlob]);
  const ready = Boolean(sourceFile && masteredBlob);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => () => {
    if (masteredUrl) URL.revokeObjectURL(masteredUrl);
  }, [masteredUrl]);

  useEffect(() => {
    let active = true;
    setRms({ A: null, B: null });
    if (!sourceFile || !masteredBlob) return;

    Promise.all([estimateRms(sourceFile), estimateRms(masteredBlob)])
      .then(([nextA, nextB]) => {
        if (active) setRms({ A: nextA, B: nextB });
      })
      .catch((err) => console.warn('Comparator RMS estimate failed', err));

    return () => {
      active = false;
    };
  }, [sourceFile, masteredBlob]);

  useEffect(() => {
    const audioA = audioARef.current;
    const audioB = audioBRef.current;
    if (!audioA || !audioB) return;

    setIsPlaying(false);
    setPlaybackError('');
    setCurrentTime(0);
    setDuration(0);
    setLoopStart(0);
    setLoopEnd(null);

    const updateDuration = () => {
      const nextDuration = getComparableDuration(audioA.duration, audioB.duration);
      setDuration(nextDuration);
      setLoopEnd(previous => previous === null && nextDuration > 0 ? nextDuration : previous);
    };
    const stopPlayback = () => {
      audioA.pause();
      audioB.pause();
      setIsPlaying(false);
    };
    const handlePlaybackError = () => {
      if (!ready) return;
      stopPlayback();
      setPlaybackError('Comparator playback failed. Re-export the master or reload the source track.');
    };

    audioA.addEventListener('loadedmetadata', updateDuration);
    audioB.addEventListener('loadedmetadata', updateDuration);
    audioA.addEventListener('ended', stopPlayback);
    audioB.addEventListener('ended', stopPlayback);
    audioA.addEventListener('error', handlePlaybackError);
    audioB.addEventListener('error', handlePlaybackError);
    updateDuration();

    return () => {
      stopPlayback();
      audioA.removeEventListener('loadedmetadata', updateDuration);
      audioB.removeEventListener('loadedmetadata', updateDuration);
      audioA.removeEventListener('ended', stopPlayback);
      audioB.removeEventListener('ended', stopPlayback);
      audioA.removeEventListener('error', handlePlaybackError);
      audioB.removeEventListener('error', handlePlaybackError);
    };
  }, [sourceUrl, masteredUrl]);

  useEffect(() => {
    if (!ready || !audioARef.current || !audioBRef.current || graphRef.current) return;

    const ctx = new AudioContext();
    const sourceA = ctx.createMediaElementSource(audioARef.current);
    const sourceB = ctx.createMediaElementSource(audioBRef.current);
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    sourceA.connect(gainA).connect(masterGain);
    sourceB.connect(gainB).connect(masterGain);
    masterGain.connect(analyser).connect(ctx.destination);
    graphRef.current = { ctx, sourceA, sourceB, gainA, gainB, masterGain, analyser };

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      graphRef.current = null;
      void ctx.close();
    };
  }, [ready]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const rmsA = rms.A;
    const rmsB = rms.B;
    const rmsTarget = rmsA && rmsB ? Math.min(rmsA, rmsB) : null;
    const loudnessGainA = matchLoudness && rmsTarget && rmsA ? clamp(rmsTarget / rmsA, 0.25, 4) : 1;
    const loudnessGainB = matchLoudness && rmsTarget && rmsB ? clamp(rmsTarget / rmsB, 0.25, 4) : 1;
    let routeA = 0;
    let routeB = 0;

    if (mode === 'A') routeA = 1;
    if (mode === 'B') routeB = 1;
    if (mode === 'blend') {
      routeA = equalPowerA(blendAmount);
      routeB = equalPowerB(blendAmount);
    }
    if (mode === 'diff') {
      routeA = DIFF_GAIN;
      routeB = -DIFF_GAIN;
    }

    graph.gainA.channelCount = monoCheck ? 1 : 2;
    graph.gainB.channelCount = monoCheck ? 1 : 2;
    graph.gainA.channelCountMode = 'explicit';
    graph.gainB.channelCountMode = 'explicit';

    const monoGain = monoCheck ? 0.707 : 1;
    const now = graph.ctx.currentTime;
    graph.gainA.gain.setTargetAtTime(volume * trimA * loudnessGainA * routeA * monoGain, now, 0.012);
    graph.gainB.gain.setTargetAtTime(volume * trimB * loudnessGainB * routeB * monoGain, now, 0.012);
    graph.masterGain.gain.setTargetAtTime(1, now, 0.012);
  }, [blendAmount, matchLoudness, mode, monoCheck, rms, trimA, trimB, volume]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const updateMeter = () => {
      const data = new Float32Array(graph.analyser.fftSize);
      graph.analyser.getFloatTimeDomainData(data);
      let peak = 0;
      let sumSquares = 0;
      for (const sample of data) {
        const abs = Math.abs(sample);
        peak = Math.max(peak, abs);
        sumSquares += sample * sample;
      }
      const audioA = audioARef.current;
      const audioB = audioBRef.current;
      const timeline = audioA?.currentTime ?? 0;
      setCurrentTime(timeline);

      if (isPlaying && audioA && audioB) {
        const expectedBTime = getSyncedDeckTime(timeline, nudgeB, audioB.duration);
        if (shouldCorrectDeckDrift(audioB.currentTime, expectedBTime)) {
          audioB.currentTime = expectedBTime;
        }
      }

      if (looping && audioA && audioB) {
        const effectiveLoopEnd = loopEnd ?? duration;
        if (effectiveLoopEnd > loopStart && timeline >= effectiveLoopEnd) {
          audioA.currentTime = loopStart;
          audioB.currentTime = Math.max(0, loopStart + nudgeB / 1000);
        }
      }

      setMeter({ peak, rms: Math.sqrt(sumSquares / data.length), clipped: peak >= 0.98 });
      animationRef.current = requestAnimationFrame(updateMeter);
    };

    updateMeter();
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [duration, isPlaying, looping, loopEnd, loopStart, nudgeB, ready]);

  const syncDecks = (time = audioARef.current?.currentTime ?? 0) => {
    const audioA = audioARef.current;
    const audioB = audioBRef.current;
    if (!audioA || !audioB) return;
    const safeTime = getSyncedDeckTime(time, 0, duration || Number.MAX_SAFE_INTEGER);
    audioA.currentTime = safeTime;
    audioB.currentTime = getSyncedDeckTime(safeTime, nudgeB, audioB.duration);
    setCurrentTime(safeTime);
  };

  const seek = (time: number) => {
    syncDecks(time);
  };

  useEffect(() => {
    if (!isPlaying) return;
    syncDecks(currentTime);
  }, [nudgeB]);

  const togglePlay = async () => {
    const graph = graphRef.current;
    const audioA = audioARef.current;
    const audioB = audioBRef.current;
    if (!ready || !graph || !audioA || !audioB) return;

    if (isPlaying) {
      audioA.pause();
      audioB.pause();
      setIsPlaying(false);
      return;
    }

    setPlaybackError('');
    try {
      if (graph.ctx.state === 'suspended') await graph.ctx.resume();
      syncDecks();
      await Promise.all([audioA.play(), audioB.play()]);
      setIsPlaying(true);
    } catch (err) {
      audioA.pause();
      audioB.pause();
      setIsPlaying(false);
      setPlaybackError('Comparator playback was blocked or the audio could not be decoded.');
      console.warn('Comparator playback failed', err);
    }
  };

  const resetComparator = () => {
    setMode('A');
    setTrimA(DEFAULT_TRIM);
    setTrimB(DEFAULT_TRIM);
    setVolume(DEFAULT_TRIM);
    setBlendAmount(0.5);
    setMatchLoudness(false);
    setMonoCheck(false);
    setNudgeB(0);
    setLooping(false);
    setLoopStart(0);
    setLoopEnd(duration || null);
    setCurrentTime(0);
    setPlaybackError('');
    audioARef.current?.pause();
    audioBRef.current?.pause();
    if (audioARef.current) audioARef.current.currentTime = 0;
    if (audioBRef.current) audioBRef.current.currentTime = 0;
    setIsPlaying(false);
  };

  const copyNotes = async () => {
    if (!notes) return;
    await navigator.clipboard?.writeText(notes).catch((err) => console.warn('Could not copy comparator notes', err));
  };

  return (
    <section className="rack-panel p-5 relative overflow-hidden">
      <audio ref={audioARef} src={sourceUrl} preload="metadata" className="hidden" />
      <audio ref={audioBRef} src={masteredUrl} preload="metadata" className="hidden" />

      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4 mb-4">
        <div>
          <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Headphones size={14} /> Integrated Comparator</h2>
          <p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-zinc-600">Compare the loaded original against the last rendered master without leaving TrackMaster.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetComparator} aria-label="Reset comparator" title="Reset comparator" className="px-3 py-2 rounded-sm border border-zinc-800 bg-black text-zinc-500 hover:text-zinc-100"><RotateCcw size={14} /></button>
          <button onClick={togglePlay} disabled={!ready} className={`flex items-center gap-2 px-4 py-2 rounded-sm font-mono font-bold text-[10px] uppercase tracking-widest ${ready ? `${accentBg} text-black` : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>

      {!ready && (
        <div className="bg-black border border-zinc-800 rounded-sm p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500 leading-relaxed">
          Load a track and export a master first. The comparator will use the current source file as A and the last rendered export as B.
        </div>
      )}

      {playbackError && (
        <div role="alert" className="mt-4 border border-red-900/60 bg-red-950/30 rounded-sm p-3 text-[10px] font-mono uppercase tracking-wider text-red-300">
          {playbackError}
        </div>
      )}

      <div className="bg-black border border-zinc-800 rounded-sm p-4 mt-4 space-y-3">
        <div className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          <span>{formatTime(currentTime)}</span>
          <span className={ready ? accentClass : 'text-zinc-700'}>{mode === 'A' ? 'Source Mix' : mode === 'B' ? 'Mastered' : mode === 'blend' ? 'Blend Monitor' : 'Difference Monitor'}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(1, duration)}
          step="0.01"
          value={Math.min(currentTime, Math.max(1, duration))}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={!ready}
          className="w-full fader"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="bg-black border border-zinc-800 rounded-sm p-4 space-y-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-500">Source Mix</p>
          <p className="text-xs font-mono text-zinc-300 truncate">{sourceFile?.name || 'Waiting for source'}</p>
          <label className="block text-[9px] font-mono uppercase tracking-widest text-zinc-600">Trim A {trimA.toFixed(2)}</label>
          <input type="range" min="0" max="1.5" step="0.01" value={trimA} onChange={(event) => setTrimA(Number(event.target.value))} className="w-full fader" />
        </div>
        <div className="bg-black border border-zinc-800 rounded-sm p-4 space-y-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-500">Mastered</p>
          <p className="text-xs font-mono text-zinc-300 truncate">{masteredFileName || 'Waiting for export'}</p>
          <label className="block text-[9px] font-mono uppercase tracking-widest text-zinc-600">Trim B {trimB.toFixed(2)}</label>
          <input type="range" min="0" max="1.5" step="0.01" value={trimB} onChange={(event) => setTrimB(Number(event.target.value))} className="w-full fader" />
        </div>
        <div className="bg-black border border-zinc-800 rounded-sm p-4 space-y-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">Output Meter</p>
          <div className="h-3 bg-zinc-900 rounded-sm overflow-hidden border border-zinc-800">
            <div className={`h-full ${meter.clipped ? 'bg-red-500' : accentBg}`} style={{ width: `${Math.min(100, meter.peak * 100)}%` }} />
          </div>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${meter.clipped ? 'text-red-400' : accentClass}`}>Peak {(meter.peak * 100).toFixed(0)}% / RMS {(meter.rms * 100).toFixed(0)}%</p>
          <label className="block text-[9px] font-mono uppercase tracking-widest text-zinc-600">Master {volume.toFixed(2)}</label>
          <input type="range" min="0" max="1.2" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-full fader" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 font-mono text-[10px] uppercase tracking-widest">
        {(['A', 'B', 'blend', 'diff'] as CompareMode[]).map(nextMode => (
          <button key={nextMode} onClick={() => setMode(nextMode)} className={`py-4 rounded-sm border-2 transition-all shadow-inner ${mode === nextMode ? `${accentBg} text-black border-transparent` : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-100 hover:border-zinc-700'}`}>
            <span className="block text-[8px] opacity-60 mb-1">{nextMode === 'A' ? 'Deck A' : nextMode === 'B' ? 'Deck B' : nextMode === 'blend' ? 'A+B' : 'Null'}</span>
            {nextMode === 'A' ? 'Source Mix' : nextMode === 'B' ? 'Mastered' : nextMode === 'blend' ? 'Blend' : 'Difference'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <label className="bg-black border border-zinc-800 rounded-sm p-3 space-y-2">
          <span className="flex justify-between text-[9px] font-mono uppercase tracking-widest text-zinc-600"><span>Blend</span><span>{Math.round(blendAmount * 100)}%</span></span>
          <input type="range" min="0" max="1" step="0.01" value={blendAmount} onChange={(event) => setBlendAmount(Number(event.target.value))} className="w-full fader" />
        </label>
        <label className="bg-black border border-zinc-800 rounded-sm p-3 space-y-2">
          <span className="flex justify-between text-[9px] font-mono uppercase tracking-widest text-zinc-600"><span>Nudge B</span><span>{nudgeB} ms</span></span>
          <input type="range" min="-100" max="100" step="1" value={nudgeB} onChange={(event) => setNudgeB(Number(event.target.value))} className="w-full fader" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMatchLoudness(value => !value)} className={`rounded-sm border px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest ${matchLoudness ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10' : 'border-zinc-800 text-zinc-600 bg-black'}`}>Match Loudness</button>
          <button onClick={() => setMonoCheck(value => !value)} className={`rounded-sm border px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest ${monoCheck ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-zinc-800 text-zinc-600 bg-black'}`}>Mono Check</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <button
          onClick={() => setLooping(value => !value)}
          disabled={!ready}
          className={`flex items-center justify-center gap-2 rounded-sm border px-3 py-3 text-[9px] font-mono font-bold uppercase tracking-widest ${looping ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10' : 'border-zinc-800 text-zinc-600 bg-black hover:text-zinc-100 disabled:opacity-50'}`}
        >
          <Repeat size={13} />
          Loop
        </button>
        <label className="bg-black border border-zinc-800 rounded-sm p-3 space-y-2">
          <span className="flex justify-between text-[9px] font-mono uppercase tracking-widest text-zinc-600"><span>Loop Start</span><span>{formatTime(loopStart)}</span></span>
          <input type="range" min="0" max={Math.max(1, duration)} step="0.01" value={Math.min(loopStart, Math.max(1, duration))} onChange={(event) => setLoopStart(Math.min(Number(event.target.value), loopEnd ?? duration))} className="w-full fader" />
        </label>
        <label className="bg-black border border-zinc-800 rounded-sm p-3 space-y-2">
          <span className="flex justify-between text-[9px] font-mono uppercase tracking-widest text-zinc-600"><span>Loop End</span><span>{formatTime(loopEnd ?? duration)}</span></span>
          <input type="range" min="0" max={Math.max(1, duration)} step="0.01" value={Math.min(loopEnd ?? duration, Math.max(1, duration))} onChange={(event) => setLoopEnd(Math.max(Number(event.target.value), loopStart))} className="w-full fader" />
        </label>
      </div>

      {notes && (
        <div className="mt-4 bg-black border border-zinc-800 rounded-sm p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className={`text-[10px] font-mono font-bold uppercase tracking-widest ${accentClass}`}>Comparator Notes</p>
            <button onClick={copyNotes} className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-zinc-800 bg-zinc-900 text-[9px] font-mono uppercase tracking-widest text-zinc-400 hover:text-zinc-100"><Copy size={12} /> Copy</button>
          </div>
          <pre className="max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap text-[10px] font-mono text-zinc-500 leading-relaxed">{notes}</pre>
        </div>
      )}
    </section>
  );
}
