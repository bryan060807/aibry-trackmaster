import React from 'react';
import { LogIn, ShieldCheck, Activity, Lock } from 'lucide-react';
import { motion } from 'motion/react';

interface AuthScreenProps {
  onLogin: () => void;
  accentClass: string;
  accentBg: string;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin, accentClass, accentBg }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex items-center justify-center p-4 font-mono">
      {/* Background Aesthetic */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none flex items-center justify-center overflow-hidden">
        <span className="text-[30vw] font-black italic select-none">AIBRY</span>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rack-panel p-10 border-2 border-zinc-800 shadow-[0_0_100px_rgba(0,0,0,0.8)] relative bg-[#151515]"
      >
        {/* Decorative Screws */}
        <div className="absolute top-4 left-4 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner" />
        <div className="absolute top-4 right-4 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner" />
        <div className="absolute bottom-4 left-4 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner" />
        <div className="absolute bottom-4 right-4 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner" />

        <div className="text-center relative z-10">
          <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner">
            <Lock size={32} className={accentClass} />
          </div>

          <h1 className="text-2xl font-bold uppercase tracking-[0.4em] text-zinc-100 mb-2 italic">
            System_Locked
          </h1>
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-10">
            Authorization Required to Access Mastering Rack
          </p>

          <button
            onClick={onLogin}
            className={`w-full group relative flex items-center justify-center gap-3 py-4 rounded-sm font-bold uppercase tracking-widest transition-all overflow-hidden ${accentBg} text-zinc-950 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-black/50`}
          >
            <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <LogIn size={18} className="relative z-10" />
            <span className="relative z-10">Initialize_Handshake</span>
          </button>

          <div className="mt-8 flex items-center justify-center gap-4 opacity-20">
            <Activity size={14} />
            <div className="h-px w-10 bg-zinc-700" />
            <ShieldCheck size={14} />
            <div className="h-px w-10 bg-zinc-700" />
            <Activity size={14} />
          </div>
        </div>
      </motion.div>
    </div>
  );
};