import React from 'react';
import { BookOpen, CheckCircle2, Gauge, Headphones, Layers3, Route, Target, X } from 'lucide-react';

export type GuideTopic = 'quick-start' | 'clean-streaming' | 'loud-master' | 'stereo-low-mono' | 'export-compare' | 'troubleshooting' | 'listening-checklist' | 'module-reference';

interface GuideDrawerProps {
  open: boolean;
  topic: GuideTopic;
  onTopicChange: (topic: GuideTopic) => void;
  onClose: () => void;
  accentClass: string;
  accentBg: string;
}

const TOPICS: Array<{ id: GuideTopic; label: string; icon: React.ReactNode }> = [
  { id: 'quick-start', label: 'Quick Start', icon: <BookOpen size={14} /> },
  { id: 'clean-streaming', label: 'Clean Streaming', icon: <Target size={14} /> },
  { id: 'loud-master', label: 'Loud Master', icon: <Gauge size={14} /> },
  { id: 'stereo-low-mono', label: 'Stereo / Low Mono', icon: <Headphones size={14} /> },
  { id: 'export-compare', label: 'Export / Compare', icon: <Route size={14} /> },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: <CheckCircle2 size={14} /> },
  { id: 'listening-checklist', label: 'Listening Check', icon: <Headphones size={14} /> },
  { id: 'module-reference', label: 'Module Reference', icon: <Layers3 size={14} /> },
];

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 leading-relaxed">
      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-zinc-500" />
      <span>{children}</span>
    </li>
  );
}

function GuideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-black border border-zinc-800 rounded-sm p-4 space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-300">{title}</h3>
      <div className="text-xs text-zinc-500 leading-relaxed font-mono space-y-3">{children}</div>
    </section>
  );
}

function TopicContent({ topic, accentClass }: { topic: GuideTopic; accentClass: string }) {
  if (topic === 'clean-streaming') {
    return (
      <>
        <GuideCard title="Goal">
          <p>Make a clear, balanced master that survives Spotify, Apple, YouTube, car speakers, earbuds, and phones without sounding smashed.</p>
          <p className={accentClass}>Target: about -12 to -10 LUFS with a -1.0 dBTP ceiling.</p>
        </GuideCard>
        <GuideCard title="Workflow">
          <ol className="space-y-3">
            <Step>Start with the Clean Streaming Master preset.</Step>
            <Step>Keep Input Gain near 0 dB unless the mix is very quiet or already clipping.</Step>
            <Step>Use EQ in small moves. Try less than 2 dB at a time.</Step>
            <Step>Use soft clip lightly. Keep Soft Clip around 0.05 to 0.15 for transparent control.</Step>
            <Step>Leave Limiter Ceiling at -1.0 dB for safe streaming exports.</Step>
            <Step>Export WAV or FLAC, then check Last Export Analysis.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Red Flags">
          <p>Harsh highs, pumping, or a thin chorus usually means too much compression, too much high shelf, or too much clipping.</p>
        </GuideCard>
      </>
    );
  }

  if (topic === 'loud-master') {
    return (
      <>
        <GuideCard title="Goal">
          <p>Push a master loud while keeping punch and avoiding ugly clipping. This is for aggressive trapmetal, punk, metal, industrial, or demos that need energy.</p>
          <p className={accentClass}>Target: about -9 to -7 LUFS. Ceiling can be -0.5 or -0.3 dBTP if intentionally hot.</p>
        </GuideCard>
        <GuideCard title="Workflow">
          <ol className="space-y-3">
            <Step>Start with AIBRY Trapmetal Loud or Heavy Metal.</Step>
            <Step>Increase Input Gain slowly until the master feels more forward.</Step>
            <Step>Use Soft Clip before pushing Output Gain. Soft Clip catches peaks before the limiter works too hard.</Step>
            <Step>Watch Gain Reduction. A little movement is good; constant heavy reduction can flatten drums.</Step>
            <Step>Use bypass on Saturation, Soft Clip, and Limiter to hear what each one is actually doing.</Step>
            <Step>Export and compare against the original before deciding it is better.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Red Flags">
          <p>If cymbals turn fizzy, vocals spit, or the kick loses impact, back off Soft Clip, Output Gain, or high EQ.</p>
        </GuideCard>
      </>
    );
  }

  if (topic === 'stereo-low-mono') {
    return (
      <>
        <GuideCard title="What It Does">
          <p>Stereo Width changes how wide the master feels. Low Mono reinforces low-frequency mono content so bass and kick stay centered.</p>
        </GuideCard>
        <GuideCard title="Safe Starting Points">
          <ol className="space-y-3">
            <Step>Leave Stereo Width at 1.00 for neutral.</Step>
            <Step>Try 1.05 to 1.15 for a subtle wider master.</Step>
            <Step>Use Low Mono around 25% to 60% below 90 to 140 Hz for bass-heavy music.</Step>
            <Step>Bypass Stereo / Low Mono often. If the center gets weaker, reduce width.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Avoid">
          <p>Extreme width can make vocals, kicks, or snares feel hollow. Too much low mono can make the low end feel louder or thicker than intended.</p>
        </GuideCard>
      </>
    );
  }

  if (topic === 'export-compare') {
    return (
      <>
        <GuideCard title="Current Comparator Flow">
          <p>TrackMaster currently exports the mastered file, generates analysis, creates Comparator notes, and opens Comparator. Direct auto-loading into Comparator is not implemented yet.</p>
        </GuideCard>
        <GuideCard title="Manual Compare Workflow">
          <ol className="space-y-3">
            <Step>Export WAV or FLAC from TrackMaster.</Step>
            <Step>Open the Export modal again after render.</Step>
            <Step>Copy the Comparator Handoff notes.</Step>
            <Step>Open Comparator.</Step>
            <Step>Load the original mix into Source Mix and the exported master into Mastered.</Step>
            <Step>Use Match Loudness before judging which one is actually better.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Planned Upgrade">
          <p>The next Comparator integration should pass original track, mastered track, settings, analysis, and notes as one comparison session so Comparator opens preloaded.</p>
        </GuideCard>
      </>
    );
  }

  if (topic === 'troubleshooting') {
    return (
      <>
        <GuideCard title="It Got Louder But Worse">
          <ol className="space-y-3">
            <Step>Turn on Match Loudness in Comparator before judging.</Step>
            <Step>Back off Output Gain first, then Soft Clip.</Step>
            <Step>Bypass Limiter, Soft Clip, and Saturation one at a time to find the damage.</Step>
            <Step>If the kick lost punch, reduce compression or clipping.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Harsh Or Fizzy Highs">
          <ol className="space-y-3">
            <Step>Reduce High Shelf or saturation drive.</Step>
            <Step>Lower Input Gain if the whole chain is being hit too hard.</Step>
            <Step>Use the loud preset as a starting point, not a finish line.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Weak Center Or Strange Stereo">
          <ol className="space-y-3">
            <Step>Return Stereo Width to 1.00.</Step>
            <Step>Reduce Low Mono if the low end feels over-thick.</Step>
            <Step>Use the Stereo / Low Mono bypass to confirm the change is helping.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Export Looks Clipped">
          <ol className="space-y-3">
            <Step>Set Limiter Ceiling back to -1.0 dB.</Step>
            <Step>Reduce Output Gain or Input Gain.</Step>
            <Step>Use less Soft Clip if clip samples remain high.</Step>
          </ol>
        </GuideCard>
      </>
    );
  }

  if (topic === 'listening-checklist') {
    return (
      <>
        <GuideCard title="Before You Export">
          <ol className="space-y-3">
            <Step>Listen to the loudest chorus or drop first. That section tells the truth about clipping and limiter stress.</Step>
            <Step>Toggle bypass on Soft Clip, Saturation, Dynamics, and Limiter. Keep only the changes that improve the track.</Step>
            <Step>Check the vocal center. If vocals feel smaller, reduce Stereo Width.</Step>
            <Step>Check kick and bass on headphones and speakers. If the low end feels cloudy, reduce Low Mono or Input Gain.</Step>
            <Step>Use Output Gain for final push, not as a fix for weak EQ or weak compression.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="After You Export">
          <ol className="space-y-3">
            <Step>Read Last Export Analysis before judging the file.</Step>
            <Step>If True Peak Estimate is near or above 0 dB, lower the limiter ceiling or output gain.</Step>
            <Step>If Integrated LUFS is much louder than your goal, compare carefully. Louder can trick your ear.</Step>
            <Step>Load original and mastered files into Comparator and turn on Match Loudness.</Step>
            <Step>Only keep the master if it feels better when volume-matched.</Step>
          </ol>
        </GuideCard>
        <GuideCard title="Three Playback Checks">
          <p>Use headphones for detail, speakers for balance, and phone/laptop playback for translation. A strong master should still feel clear on weak playback systems.</p>
        </GuideCard>
      </>
    );
  }

  if (topic === 'module-reference') {
    return (
      <>
        <GuideCard title="Signal Flow">
          <p>Input Gain → EQ → Dynamics → Saturation → Delay/Reverb → Soft Clipper → Stereo / Low Mono → Output Gain → Limiter → Analysis / Export.</p>
        </GuideCard>
        <GuideCard title="Modules">
          <ul className="space-y-3">
            <Step>Input Gain sets how hard the mix hits the chain.</Step>
            <Step>EQ shapes low, mid, and high balance.</Step>
            <Step>Dynamics glues the mix and controls movement.</Step>
            <Step>Saturation adds harmonics and density.</Step>
            <Step>Soft Clip catches fast peaks before the limiter.</Step>
            <Step>Stereo / Low Mono controls width and bass center.</Step>
            <Step>Limiter ceiling protects final peak level.</Step>
          </ul>
        </GuideCard>
        <GuideCard title="Bypass And Reset">
          <p>Bypass is session-only and is for auditioning. Reset returns a module to its safe default without changing the whole preset.</p>
        </GuideCard>
      </>
    );
  }

  return (
    <>
      <GuideCard title="Fastest Way To Use TrackMaster">
        <ol className="space-y-3">
          <Step>Load a mix.</Step>
          <Step>Pick a preset close to the goal.</Step>
          <Step>Adjust Input Gain, EQ, Soft Clip, Stereo Width, and Ceiling in small moves.</Step>
          <Step>Use bypass buttons to make sure each module is helping.</Step>
          <Step>Export WAV or FLAC.</Step>
          <Step>Read Last Export Analysis and compare with the original.</Step>
        </ol>
      </GuideCard>
      <GuideCard title="Targets">
        <p>Clean streaming: -12 to -10 LUFS, -1.0 dBTP ceiling.</p>
        <p>Aggressive loud: -9 to -7 LUFS, -0.5 or -0.3 dBTP only when intentionally hot.</p>
      </GuideCard>
      <GuideCard title="Best Rule">
        <p>Do not trust louder by itself. Use Comparator and loudness match before deciding the master is better.</p>
      </GuideCard>
    </>
  );
}

export function GuideDrawer({ open, topic, onTopicChange, onClose, accentClass, accentBg }: GuideDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-xl bg-[#111] border-l-2 border-zinc-800 shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="h-full flex flex-col">
          <div className="p-5 border-b-2 border-zinc-900 bg-[#181818] flex items-start justify-between gap-4">
            <div>
              <p className={`text-[10px] font-mono font-bold uppercase tracking-[0.24em] ${accentClass}`}>TrackMaster Guide</p>
              <h2 className="mt-2 text-xl font-black uppercase tracking-widest text-zinc-100">Mastering Manual</h2>
              <p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-zinc-600">Practical workflows, safe ranges, and compare-first habits.</p>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 transition-colors" aria-label="Close guide">
              <X size={22} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 border-b border-zinc-900 bg-black/30">
            {TOPICS.map(item => (
              <button
                key={item.id}
                onClick={() => onTopicChange(item.id)}
                className={`flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest transition-all ${topic === item.id ? `${accentBg} text-black border-transparent` : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
            <TopicContent topic={topic} accentClass={accentClass} />
          </div>
        </div>
      </aside>
    </div>
  );
}
