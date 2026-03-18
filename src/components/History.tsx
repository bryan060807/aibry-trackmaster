import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Download, Clock, Music, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Track {
  id: string;
  file_name: string;
  created_at: string;
  storage_path: string;
}

export function History({ accentClass }: { accentClass: string }) {
  const [history, setHistory] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) setHistory(data);
    setLoading(false);
  };

  const downloadFile = async (track: Track) => {
    setProcessingId(track.id);
    try {
      const { data, error } = await supabase.storage
        .from('audio-files')
        .download(track.storage_path);
        
      if (error) throw error;
      
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Mastered_${track.file_name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Cloud download failed", err);
    } finally {
      setProcessingId(null);
    }
  };

  const deleteTrack = async (track: Track) => {
    if (!confirm(`Permanently delete "${track.file_name}" from cloud storage?`)) return;
    
    setProcessingId(track.id);
    try {
      // 1. Delete from Storage Bucket
      const { error: storageError } = await supabase.storage
        .from('audio-files')
        .remove([track.storage_path]);

      if (storageError) throw storageError;

      // 2. Delete from Database Table
      const { error: dbError } = await supabase
        .from('tracks')
        .delete()
        .eq('id', track.id);

      if (dbError) throw dbError;

      // 3. Update UI
      setHistory(prev => prev.filter(t => t.id !== track.id));
    } catch (err) {
      console.error("Deletion failed", err);
      alert("Failed to delete track");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-zinc-600 font-mono text-[10px] uppercase tracking-widest">
        <Loader2 size={12} className="animate-spin" />
        Syncing_Logs...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {history.map((track) => (
          <motion.div 
            key={track.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, x: -20 }}
            className="bg-black/40 border border-zinc-800/50 p-3 rounded-sm flex items-center justify-between group hover:border-zinc-700/50 transition-colors"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <Music size={14} className={`${accentClass} opacity-50 group-hover:opacity-100 transition-opacity`} />
              <div className="overflow-hidden">
                <p className="text-[10px] font-mono font-bold text-zinc-300 truncate max-w-[120px] uppercase tracking-wider">
                  {track.file_name}
                </p>
                <div className="flex items-center gap-2 opacity-40">
                  <Clock size={10} />
                  <span className="text-[8px] font-mono">
                    {new Date(track.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              <button 
                onClick={() => downloadFile(track)}
                disabled={!!processingId}
                className="p-2 hover:bg-zinc-800 rounded-sm transition-all group/btn"
                title="Download"
              >
                {processingId === track.id ? (
                  <Loader2 size={14} className={`animate-spin ${accentClass}`} />
                ) : (
                  <Download size={14} className="text-zinc-500 group-hover/btn:text-zinc-200" />
                )}
              </button>

              <button 
                onClick={() => deleteTrack(track)}
                disabled={!!processingId}
                className="p-2 hover:bg-red-500/10 rounded-sm transition-all group/trash"
                title="Delete from Cloud"
              >
                <Trash2 size={14} className="text-zinc-600 group-hover/trash:text-red-500" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      
      {history.length === 0 && (
        <div className="text-center py-10 space-y-2 opacity-20">
          <Music size={24} className="mx-auto" />
          <p className="text-[9px] font-mono uppercase tracking-[0.2em]">No Logs Detected</p>
        </div>
      )}
    </div>
  );
}