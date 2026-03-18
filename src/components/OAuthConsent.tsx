import React, { useEffect, useState } from 'react';
import { ShieldCheck, Activity, Lock } from 'lucide-react';
import { motion } from 'motion/react';

interface OAuthConsentProps {
  accentBg: string;
  accentClass: string;
}

export const OAuthConsent: React.FC<OAuthConsentProps> = ({ accentBg, accentClass }) => {
  const [status, setStatus] = useState('Initializing Handshake...');

  useEffect(() => {
    // Step 1: Initial delay to simulate security check
    const timer1 = setTimeout(() => setStatus('Verifying Credentials...'), 800);
    // Step 2: Finalizing
    const timer2 = setTimeout(() => setStatus('Access Granted. Redirecting...'), 1600);
    // Step 3: Redirect back to home after the animation
    const timer3 = setTimeout(() => {
      window.location.href = '/';
    }, 2400);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center font-mono p-4">
      {/* Decorative background logo */}
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none">
        <span className="text-[20vw] font-black tracking-tighter uppercase italic">AIBRY</span>
      </div>

      <div className="w-full max-w-md relative">
        {/* Hardware Rack Panel Aesthetic */}
        <div className="rack-panel p-10 border-2 border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden bg-[#151515]">
          {/* Rack Screws */}
          <div className="absolute top-3 left-3 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700 shadow-inner flex items-center justify-center">
            <div className="w-full h-[1px] bg-zinc-800 rotate-45"></div>
          </div>
          <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700 shadow-inner flex items-center justify-center">
            <div className="w-full h-[1px] bg-zinc-800 -rotate-45"></div>
          </div>
          <div className="absolute bottom-3 left-3 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700 shadow-inner flex items-center justify-center">
            <div className="w-full h-[1px] bg-zinc-800 -rotate-45"></div>
          </div>
          <div className="absolute bottom-3 right-3 w-3 h-3 rounded-full bg-zinc-900 border border-zinc-700 shadow-inner flex items-center justify-center">
            <div className="w-full h-[1px] bg-zinc-800 rotate-45"></div>
          </div>

          {/* Content */}
          <div className="relative z-10 text-center">
            <div className={`w-20 h-20 mx-auto mb-6 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner`}>
              <ShieldCheck size={40} className={`${accentClass} animate-pulse`} />
            </div>

            <h2 className="text-xl font-bold uppercase tracking-[0.3em] mb-2 text-zinc-100 italic">
              Auth_Consent
            </h2>
            
            <div className="flex items-center justify-center gap-2 mb-8">
               <Activity size={12} className="text-zinc-600" />
               <span className="text-zinc-500 text-[10px] uppercase tracking-widest leading-none">
                 System_Handshake_Active
               </span>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Status:</span>
                <span className={`text-[10px] font-bold uppercase ${accentClass}`}>{status}</span>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full bg-black border border-zinc-800 h-3 rounded-sm p-[2px] shadow-inner">
                <motion.div 
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2.2, ease: "easeInOut" }}
                  className={`h-full ${accentBg} rounded-sm shadow-[0_0_10px_rgba(0,0,0,0.5)]`}
                  style={{
                    backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent)',
                    backgroundSize: '10px 10px'
                  }}
                />
              </div>

              <div className="pt-4 flex items-center justify-center gap-6 opacity-30">
                <Lock size={14} />
                <div className="h-px w-12 bg-zinc-700" />
                <ShieldCheck size={14} />
              </div>
            </div>
          </div>
        </div>
        
        {/* Serial Tag */}
        <div className="mt-4 text-center">
          <span className="text-[8px] font-mono text-zinc-700 uppercase tracking-[0.5em]">
            AIBRY Hardware Security Module // v2.0.26
          </span>
        </div>
      </div>
    </div>
  );
};