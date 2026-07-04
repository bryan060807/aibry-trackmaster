import React, { useState } from 'react';
import { X, Download, Music, FileAudio } from 'lucide-react';
import type { ExportMetadata } from '../lib/dataService';
import { buildComparatorHandoffUrl } from '../utils/comparatorHandoff';

export type ExportFormat = 'wav' | 'mp3' | 'flac';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, bitrate: number, metadata: ExportMetadata) => void;
  accentBg: string;
  accentClass: string;
  isExporting: boolean;
  canExport: boolean;
  comparatorNotes?: string;
}

const METADATA_FIELDS: Array<{ key: keyof ExportMetadata; label: string; placeholder: string }> = [
  { key: 'artist', label: 'Artist', placeholder: 'Bryan Miller' },
  { key: 'title', label: 'Title', placeholder: 'Final Master' },
  { key: 'album', label: 'Album', placeholder: 'Album or project name' },
  { key: 'genre', label: 'Genre', placeholder: 'Rock, Hip-Hop, Podcast...' },
  { key: 'year', label: 'Year / Date', placeholder: '2026' },
  { key: 'comment', label: 'Comment', placeholder: 'Mastering notes' },
  { key: 'copyright', label: 'Copyright', placeholder: '© 2026 Your Name' },
];

export function ExportModal({ isOpen, onClose, onExport, accentBg, accentClass, isExporting, canExport, comparatorNotes }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('flac');
  const [bitrate, setBitrate] = useState<number>(320);
  const [metadata, setMetadata] = useState<ExportMetadata>({});

  if (!isOpen) return null;

  const updateMetadata = (key: keyof ExportMetadata, value: string) => {
    setMetadata(prev => ({ ...prev, [key]: value }));
  };

  const copyComparatorNotes = async () => {
    if (!comparatorNotes) return;
    await navigator.clipboard?.writeText(comparatorNotes).catch((err) => {
      console.warn('Could not copy comparator notes', err);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border-2 border-zinc-800 rounded-sm w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b-2 border-zinc-900 bg-[#111]">
          <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-zinc-100">Export Track</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* Format Selection */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Format</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setFormat('flac')}
                className={`flex flex-col items-center justify-center p-4 rounded-sm border-2 transition-all ${format === 'flac' ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-600'}`}
              >
                <FileAudio size={24} className="mb-2" />
                <span className="font-mono font-bold uppercase tracking-wider text-zinc-300">FLAC</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">RouteNote</span>
              </button>
              <button
                onClick={() => setFormat('wav')}
                className={`flex flex-col items-center justify-center p-4 rounded-sm border-2 transition-all ${format === 'wav' ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-600'}`}
              >
                <FileAudio size={24} className="mb-2" />
                <span className="font-mono font-bold uppercase tracking-wider text-zinc-300">WAV</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">Lossless</span>
              </button>
              <button
                onClick={() => setFormat('mp3')}
                className={`flex flex-col items-center justify-center p-4 rounded-sm border-2 transition-all ${format === 'mp3' ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-600'}`}
              >
                <Music size={24} className="mb-2" />
                <span className="font-mono font-bold uppercase tracking-wider text-zinc-300">MP3</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">320k</span>
              </button>
            </div>
          </div>

          {/* Bitrate Selection (Only for MP3) */}
          {format === 'mp3' && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Bitrate</label>
              <div className="grid grid-cols-3 gap-2">
                {[128, 192, 320].map(br => (
                  <button
                    key={br}
                    onClick={() => setBitrate(br)}
                    className={`py-2 rounded-sm border-2 transition-all text-xs font-mono font-bold uppercase tracking-wider ${bitrate === br ? `border-current bg-zinc-900 ${accentClass} shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]` : 'border-zinc-800 bg-black text-zinc-600 hover:bg-zinc-900'}`}
                  >
                    {br}k
                  </button>
                ))}
              </div>
            </div>
          )}

          {comparatorNotes && (
            <div className="space-y-3 border border-zinc-800 bg-black rounded-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-[10px] font-bold font-mono uppercase tracking-widest ${accentClass}`}>Comparator Handoff</p>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 mt-1">Last render notes are ready to paste into TrackMaster Comparator.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyComparatorNotes} className="px-3 py-1.5 rounded-sm border border-zinc-700 bg-zinc-900 text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-300 hover:text-zinc-100">Copy Notes</button>
                  <a href={buildComparatorHandoffUrl(comparatorNotes)} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-sm border border-zinc-700 bg-zinc-900 text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-300 hover:text-zinc-100">Send to Comparator</a>
                </div>
              </div>
              <pre className="max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap text-[10px] font-mono text-zinc-500 leading-relaxed">{comparatorNotes}</pre>
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <label className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest">Metadata</label>
              <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 text-right">Optional</span>
            </div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 leading-relaxed">
              WAV embeds RIFF INFO metadata. FLAC embeds Vorbis comments. MP3 metadata tagging is not active yet.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {METADATA_FIELDS.map(field => (
                <label key={field.key} className={field.key === 'comment' ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
                  <span className="block text-[9px] font-bold font-mono text-zinc-500 uppercase tracking-widest">{field.label}</span>
                  <input
                    value={metadata[field.key] || ''}
                    onChange={(event) => updateMetadata(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-black border-2 border-zinc-800 rounded-sm px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t-2 border-zinc-900 bg-[#111] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-sm font-mono font-bold text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => canExport && onExport(format, bitrate, metadata)}
            disabled={isExporting || !canExport}
            title={canExport ? 'Render the loaded track' : 'Load a track before exporting'}
            className={`flex items-center gap-2 px-6 py-2 rounded-sm font-mono font-bold text-xs uppercase tracking-widest transition-all ${accentBg} text-black hover:opacity-90 disabled:opacity-50 shadow-[0_2px_5px_rgba(0,0,0,0.5)] active:shadow-none active:translate-y-[1px]`}
          >
            {isExporting ? 'Rendering...' : 'Render'}
            {!isExporting && <Download size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
