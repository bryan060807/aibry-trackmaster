import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Play, Pause, SkipBack, Download, Settings2, Sliders, 
  Activity, Waves, Repeat, Flame, Trash2, ListMusic, Clock, HelpCircle,
  LogIn, LogOut, ShieldCheck
} from 'lucide-react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { Visualizer } from './components/Visualizer';
import { PresetManager } from './components/PresetManager';
import { ExportModal } from './components/ExportModal';
import { Tooltip } from './components/Tooltip';
import { History } from './components/History';
import { OAuthConsent } from './components/OAuthConsent';
import { AuthScreen } from './components/AuthScreen';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { supabase } from './lib/supabase';
import { motion, AnimatePresence } from 'motion/react';

const THEMES = [
  { name: 'Amber', value: '#fbbf24', class: 'text-amber-400', bg: 'bg-amber-400' },
  { name: 'Red', value: '#ef4444', class: 'text-red-500', bg: 'bg-red-500' },
  { name: 'Green', value: '#22c55e', class: 'text-green-500', bg: 'bg-green-500' },
  { name: 'Cyan', value: '#06b6d4', class: 'text-cyan-400', bg: 'bg-cyan-400' },
];

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const RackScrew = ({ className }: { className?: string }) => (
  <div className={`absolute w-2.5 h-2.5 rounded-full rack-screw flex items-center justify-center ${className}`}>
    <div className="w-full h-[1px] bg-black/50 rotate-45"></div>
  </div>
);

export default function App() {
  const {
    play, pause, stop, seek, exportTrack, addToQueue, removeFromQueue,
    isPlaying, currentTime, duration, params, setParams, analyser,
    hasAudio, isExporting, queue, currentIndex
  } = useAudioEngine();

  const [accent, setAccent] = useState(THEMES[0]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [helpMode, setHelpMode] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const path = window.location.pathname;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/oauth/consent` }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addToQueue(e.target.files);
    }
  };

  const handleParamChange = (key: keyof typeof params, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // ROUTING
  if (path === '/oauth/consent') return <OAuthConsent accentBg={accent.bg} accentClass={accent.class} />;
  if (path === '/privacy') return <PrivacyPolicy />;
  if (path === '/tos') return <TermsOfService />;

  if (authLoading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <Activity size={32} className={`${accent.class} animate-spin`} />
    </div>
  );

  if (!session) return <AuthScreen onLogin={handleLogin} accentClass={accent.class} accentBg={accent.bg} />;

  return (
    <div className="min-h-screen bg-[#111] text-zinc-100 font-sans selection:bg-zinc-800 flex flex-col">
      {/* HEADER */}
      <header className="border-b-4 border-zinc-900 bg-[#1a1a1a] sticky top-0 z-50 shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded bg-zinc-900 border border-zinc-700 shadow-inner ${accent.class}`}><Activity size={20} /></div>
            <div className="relative h-12 w-32 flex items-center justify-center bg-[#0a0a0a] border border-zinc-800 rounded-sm overflow-hidden group shadow-inner ml-2">
              <img src="/logo.png" alt="Logo" className="absolute inset-0 w-full h-full object-contain z-20 opacity-90" />
              <div className="hidden absolute inset-0 flex items-center justify-center z-10 w-full h-full bg-[#050505]">
                <span className="font-logo text-3xl tracking-widest text-red-700">AIBRY</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-sm shadow-inner">
                <div className="text-right">
                  <p className="text-[9px] font-mono text-zinc-500 uppercase leading-none mb-1">Authenticated</p>
                  <p className="text-[10px] font-mono font-bold text-zinc-200 truncate max-w-[120px]">{session.user.email}</p>
                </div>
                <button onClick={handleLogout} className="p-1.5 text-zinc-500 hover:text-red-500 transition-colors"><LogOut size={16} /></button>
            </div>
            <PresetManager currentParams={params} onLoadPreset={setParams} accentClass={accent.class} accentBg={accent.bg} />
            <div className="hidden md:flex gap-2 bg-zinc-900 rounded-full p-1 border border-zinc-800">
              {THEMES.map(t => (
                <button key={t.name} onClick={() => setAccent(t)} className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${t.bg} ${accent.name === t.name ? 'ring-2 ring-zinc-400' : 'opacity-50'}`} />
              ))}
            </div>
            <button onClick={() => setShowExportModal(true)} disabled={!hasAudio || isExporting} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm transition-all ${hasAudio && !isExporting ? `${accent.bg} text-zinc-950` : 'bg-zinc-800 text-zinc-500'}`}>
              {isExporting ? <Activity size={16} className="animate-spin" /> : <Download size={16} />}
              <span className="hidden sm:inline">Export Track</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 flex-grow">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* VISUALIZER */}
          <div className="lg:col-span-2 h-96 rack-panel p-4 flex flex-col relative overflow-hidden">
            <RackScrew className="top-2 left-2" /><RackScrew className="top-2 right-2" /><RackScrew className="bottom-2 left-2" /><RackScrew className="bottom-2 right-2" />
            <div className="flex justify-between items-center mb-4 z-10 px-2 pt-1">
              <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Activity size={14} /> Spectrum Analysis</h2>
              {hasAudio && <div className="font-mono text-[10px] font-bold text-zinc-400 bg-black border border-zinc-800 px-2 py-1 rounded-sm shadow-inner min-w-[80px] text-center">{formatTime(currentTime)} / {formatTime(duration)}</div>}
            </div>
            <div className="flex-1 relative bg-black border-2 border-zinc-900 rounded-sm p-1 overflow-hidden shadow-inner">
               <Visualizer analyser={analyser} isPlaying={isPlaying} accentColor={accent.value} />
            </div>
          </div>

          {/* TRANSPORT */}
          <div className="h-96 rack-panel p-5 flex flex-col relative">
            <RackScrew className="top-2 left-2" /><RackScrew className="top-2 right-2" /><RackScrew className="bottom-2 left-2" /><RackScrew className="bottom-2 right-2" />
            <h2 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest mb-4">Transport</h2>
            <div className="space-y-4 mb-6">
                <input type="range" min={0} max={duration || 100} value={currentTime} onChange={(e) => seek(parseFloat(e.target.value))} disabled={!hasAudio} className="w-full fader" />
                <div className="flex items-center justify-center gap-4">
                    <button onClick={stop} disabled={!hasAudio} className="p-2.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 transition-all"><SkipBack size={18} /></button>
                    <button onClick={isPlaying ? pause : play} disabled={!hasAudio} className={`p-4 rounded-sm border border-zinc-800 shadow-lg active:translate-y-[1px] transition-all ${hasAudio ? 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-600'}`}>
                      {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                    </button>
                </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden border-t border-zinc-800 pt-4">
               <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2"><ListMusic size={12} className={accent.class} /> Queue ({queue.length})</h3>
                <input type="file" multiple accept="audio/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                <button onClick={() => fileInputRef.current?.click()} className={`text-[9px] font-bold font-mono uppercase px-2 py-1 rounded-sm border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 transition-colors ${accent.class}`}>+ Add</button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {queue.map((file, idx) => (
                  <div key={idx} className={`p-2 rounded-sm border flex items-center justify-between mb-1 transition-colors ${idx === currentIndex ? 'bg-black border-zinc-700' : 'bg-zinc-900/40 border-transparent'}`}>
                    <span className={`text-[10px] font-mono truncate max-w-[120px] ${idx === currentIndex ? 'text-zinc-100' : 'text-zinc-500'}`}>{file.name}</span>
                    <button onClick={() => removeFromQueue(idx)} className="p-1 text-zinc-600 hover:text-red-500 transition-all"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CLOUD LOGS */}
          <div className="h-96 rack-panel p-5 flex flex-col relative overflow-hidden">
            <RackScrew className="top-2 left-2" /><RackScrew className="top-2 right-2" /><RackScrew className="bottom-2 left-2" /><RackScrew className="bottom-2 right-2" />
            <div className="flex items-center gap-2 mb-4 border-b border-zinc-800 pb-2">
              <Clock size={12} className={accent.class} />
              <h3 className="text-[10px] font-bold font-mono text-zinc-400 uppercase tracking-widest">Mastering Logs</h3>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1"><History accentClass={accent.class} /></div>
          </div>
        </div>

        {/* FULL 6-UNIT PROCESSING GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
          {/* 1. EQ */}
          <RackPanel icon={<Sliders size={16} />} title="Equalizer" accentClass={accent.class}>
            <ControlSlider label="Low Shelf" value={params.eqLow} min={-12} max={12} step={0.1} unit="dB" onChange={(v: any) => handleParamChange('eqLow', v)} accentClass={accent.class} />
            <ControlSlider label="Mid Peak" value={params.eqMid} min={-12} max={12} step={0.1} unit="dB" onChange={(v: any) => handleParamChange('eqMid', v)} accentClass={accent.class} />
            <ControlSlider label="High Shelf" value={params.eqHigh} min={-12} max={12} step={0.1} unit="dB" onChange={(v: any) => handleParamChange('eqHigh', v)} accentClass={accent.class} />
          </RackPanel>

          {/* 2. DYNAMICS */}
          <RackPanel icon={<Settings2 size={16} />} title="Dynamics" accentClass={accent.class}>
            <ControlSlider label="Threshold" value={params.compThreshold} min={-60} max={0} step={1} unit="dB" onChange={(v: any) => handleParamChange('compThreshold', v)} accentClass={accent.class} />
            <ControlSlider label="Ratio" value={params.compRatio} min={1} max={20} step={0.5} unit=":1" onChange={(v: any) => handleParamChange('compRatio', v)} accentClass={accent.class} />
          </RackPanel>

          {/* 3. SATURATION */}
          <RackPanel icon={<Flame size={16} />} title="Saturation" accentClass={accent.class}>
            <ControlSlider label="Drive" value={params.saturationDrive} min={1} max={50} step={1} unit="" onChange={(v: any) => handleParamChange('saturationDrive', v)} accentClass={accent.class} />
            <ControlSlider label="Mix" value={params.saturationMix} min={0} max={1} step={0.05} unit="" onChange={(v: any) => handleParamChange('saturationMix', v)} accentClass={accent.class} />
          </RackPanel>

          {/* 4. DELAY */}
          <RackPanel icon={<Repeat size={16} />} title="Delay" accentClass={accent.class}>
            <ControlSlider label="Time" value={params.delayTime} min={0.01} max={2.0} step={0.01} unit="s" onChange={(v: any) => handleParamChange('delayTime', v)} accentClass={accent.class} />
            <ControlSlider label="Feedback" value={params.delayFeedback} min={0} max={0.9} step={0.05} unit="" onChange={(v: any) => handleParamChange('delayFeedback', v)} accentClass={accent.class} />
            <ControlSlider label="Mix" value={params.delayMix} min={0} max={1} step={0.05} unit="" onChange={(v: any) => handleParamChange('delayMix', v)} accentClass={accent.class} />
          </RackPanel>

          {/* 5. REVERB */}
          <RackPanel icon={<Waves size={16} />} title="Reverb" accentClass={accent.class}>
            <ControlSlider label="Decay" value={params.reverbDecay} min={0.1} max={5.0} step={0.1} unit="s" onChange={(v: any) => handleParamChange('reverbDecay', v)} accentClass={accent.class} />
            <ControlSlider label="Mix" value={params.reverbMix} min={0} max={1} step={0.05} unit="" onChange={(v: any) => handleParamChange('reverbMix', v)} accentClass={accent.class} />
          </RackPanel>

          {/* 6. OUTPUT & LIMITER */}
          <RackPanel icon={<Activity size={16} />} title="Output & Limiter" accentClass={accent.class}>
            <ControlSlider label="Makeup Gain" value={params.makeupGain} min={0} max={24} step={0.5} unit="dB" onChange={(v: any) => handleParamChange('makeupGain', v)} accentClass={accent.class} />
            <div className="mt-8 p-3 rounded-sm bg-black border border-zinc-800 flex items-start gap-3 shadow-inner">
              <div className={`mt-1 w-1.5 h-1.5 rounded-full ${accent.bg}`} style={{ boxShadow: `0 0 8px ${accent.value}` }} />
              <div>
                <h4 className="text-[10px] font-mono font-bold text-zinc-300 mb-1 uppercase tracking-wider">Limiter Active</h4>
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Ceiling at -0.1dB</p>
              </div>
            </div>
          </RackPanel>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-zinc-900 bg-[#0d0d0d] py-6 px-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 opacity-30">
          <ShieldCheck size={12} /><p className="text-[9px] font-mono uppercase tracking-[0.3em]">Hardware Handshake v2.0.26 // AIBRY Studio</p>
        </div>
        <div className="flex gap-6 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          <button onClick={() => window.location.href = '/privacy'} className="hover:text-zinc-100 transition-colors">Privacy_Protocol</button>
          <button onClick={() => window.location.href = '/tos'} className="hover:text-zinc-100 transition-colors">Service_Terms</button>
          <a href="https://github.com/aibry/trackmaster" className="hover:text-zinc-100 transition-colors">Source_Code</a>
        </div>
      </footer>

      <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} onExport={exportTrack} accentBg={accent.bg} accentClass={accent.class} isExporting={isExporting} />
      
      <button onClick={() => setHelpMode(!helpMode)} className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl transition-all z-[60] ${helpMode ? accent.bg + ' text-zinc-950 scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100'}`}>
        <HelpCircle size={24} />
      </button>
    </div>
  );
}

function RackPanel({ icon, title, children, accentClass }: any) {
  return (
    <div className="rack-panel p-6 h-full relative">
      <RackScrew className="top-2 left-2" /><RackScrew className="top-2 right-2" /><RackScrew className="bottom-2 left-2" /><RackScrew className="bottom-2 right-2" />
      <div className="flex items-center gap-2 mb-6 pb-4 border-b border-zinc-800">
        <span className={accentClass}>{icon}</span><h3 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-widest">{title}</h3>
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

function ControlSlider({ label, value, min, max, step, unit, onChange, accentClass }: any) {
  return (
    <div className="flex flex-col gap-2 group">
      <div className="flex justify-between items-center">
        <label className="text-[10px] uppercase tracking-widest font-mono text-zinc-400 group-hover:text-zinc-300 transition-colors">{label}</label>
        <span className={`text-[10px] font-mono font-bold ${accentClass}`}>{value > 0 && unit === 'dB' ? '+' : ''}{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full fader" />
    </div>
  );
}