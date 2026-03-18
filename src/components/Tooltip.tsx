import React from 'react';
import { Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  children: React.ReactNode;
  text: string;
  isActive: boolean;
  accentClass: string;
  accentBg?: string;
}

export function Tooltip({ children, text, isActive, accentClass, accentBg }: TooltipProps) {
  return (
    <div className="relative group h-full">
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`absolute -inset-2 border-2 border-dashed ${accentClass} opacity-60 rounded-sm pointer-events-none z-10 ${accentBg ? accentBg.replace('bg-', 'bg-opacity-10 bg-') : ''}`} 
          >
            <div className={`absolute top-0 right-0 -mt-3 -mr-3 p-1.5 rounded-sm ${accentBg || 'bg-zinc-700'} text-black shadow-lg animate-bounce`}>
              <Info size={16} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className={`relative z-20 transition-transform duration-300 ${isActive ? 'scale-[0.98]' : ''}`}>
        {children}
      </div>
      
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-6 w-80 p-5 bg-black text-zinc-300 text-xs font-mono rounded-sm shadow-2xl pointer-events-none z-50 border border-zinc-700"
          >
            <div className="flex items-start gap-3">
              <Info size={24} className={`shrink-0 mt-0.5 ${accentClass}`} />
              <div className="leading-relaxed space-y-2">
                {text.split('\n\n').map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
