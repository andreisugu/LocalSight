import React from 'react';
import { Info } from 'lucide-react';
import { useSecurity } from '../../context/SecurityContext';

export default function Toast() {
  const { toastMessage } = useSecurity();

  if (!toastMessage) return null;

  return (
    <div className="no-print fixed bottom-5 right-5 z-50 bg-slate-900/95 text-white px-4 py-3 rounded-xl shadow-2xl border border-[#FFEB33]/70 flex items-center gap-3 animate-bounce-short font-sans text-xs md:text-sm backdrop-blur-md select-none max-w-[calc(100vw-2.5rem)] sm:max-w-md">
      <Info size={18} className="text-[#FFEB33] shrink-0" />
      {/* Un mesaj poate conține un nume arbitrar de lung (F7): se rupe pe cuvinte și se
          limitează la 3 rânduri, ca să nu depășească cardul. */}
      <span className="leading-snug min-w-0 break-words line-clamp-3" title={toastMessage}>
        {toastMessage}
      </span>
    </div>
  );
}
