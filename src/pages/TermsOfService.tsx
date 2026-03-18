import React from 'react';
import { Scale, Activity, ArrowLeft, Download } from 'lucide-react';

export const TermsOfService = () => {
  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-400 font-mono p-4 md:p-10 print:bg-white print:text-black">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-12 border-b border-zinc-800 pb-6 print:border-black">
          <div className="flex items-center gap-4">
            <Scale className="text-amber-400 print:text-black" size={32} />
            <div>
              <h1 className="text-xl font-bold text-white uppercase tracking-[0.3em] print:text-black">Service_Terms</h1>
              <p className="text-[10px] uppercase text-zinc-500">Manual_Revision: 2.0.26</p>
            </div>
          </div>
          <div className="flex gap-4 print:hidden">
            <button onClick={handlePrint} className="flex items-center gap-2 text-[10px] uppercase hover:text-white transition-colors border border-zinc-800 px-3 py-1.5 rounded-sm">
              <Download size={14} /> [ Export_Terms ]
            </button>
            <button onClick={() => window.location.href = '/'} className="flex items-center gap-2 text-[10px] uppercase hover:text-white transition-colors border border-zinc-800 px-3 py-1.5 rounded-sm">
              <ArrowLeft size={14} /> [ Back_to_Rack ]
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-1">
          <div className="rack-panel p-6 border border-zinc-800 bg-[#111] print:bg-transparent print:border-black">
            <h3 className="text-white text-[10px] font-bold uppercase mb-3 tracking-widest text-amber-400 print:text-black">// LICENSURE</h3>
            <p className="text-[11px] leading-relaxed">
              Software is provided under MIT License. AIBRY Studio remains your hardware-abstracted mastering partner.
            </p>
          </div>
          {/* ... Add the other sections from the previous TOS code here ... */}
        </div>
      </div>
    </div>
  );
};