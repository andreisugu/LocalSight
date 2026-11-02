import { useRef, useState } from 'react';
import { Camera, ImageOff, Radio } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

/**
 * Re-encode an uploaded frame as JPEG before it enters the zone. It never leaves the
 * tab: the mock build keeps a local preview, and the real edge receives the file.
 */
async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('conversia în JPEG a eșuat');
  return new File([blob], 'referinta.jpg', { type: 'image/jpeg' });
}

/**
 * The frame the polygon is drawn on: the camera's demo still, the saved reference or
 * an uploaded (already blurred) image. Uploads stay local.
 */
export default function ZoneReferencePanel({
  referenceUrl,
  usingDemoReference,
  hasZone,
  uploading,
  capturing,
  capturedAt,
  onUpload,
  onCaptureFromLive,
  onClear,
  onError,
}) {
  const { isDarkMode, themeStyles } = useTheme();
  const inputRef = useRef(null);
  const [preparing, setPreparing] = useState(false);

  const busy = uploading || capturing || preparing;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPreparing(true);
    try {
      await onUpload(await toJpeg(file));
    } catch (error) {
      onError(`Încărcarea referinței a eșuat: ${error.message}`);
    } finally {
      setPreparing(false);
    }
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <section
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border p-4 shadow-lg space-y-2 text-xs"
    >
      <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
        <Camera size={16} className="text-[#D73833] dark:text-[#FFEB33]" /> Cadru de referință
      </h3>
      <p style={{ color: themeStyles.textMuted }} className="text-[11px] leading-snug">
        Cadrul pe care desenezi zonele. Folosește doar un cadru <b>deja blurat</b> — nicio față nu
        trebuie să ajungă aici.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
        aria-label="Încarcă un cadru de referință"
      />

      {referenceUrl ? (
        <div className="space-y-2">
          <img
            key={referenceUrl}
            src={referenceUrl}
            alt="Referință"
            className="w-full rounded-lg border border-slate-200 dark:border-white/10"
          />
          <p className="text-[10px] font-mono" style={{ color: themeStyles.textMuted }}>
            {usingDemoReference ? 'cadru demo · primul frame din clip' : 'cadru salvat al zonei'}
            {capturedAt ? ` · actualizat la ${capturedAt}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={openPicker}
              disabled={busy || !hasZone}
              className="py-1.5 rounded bg-[#D73833] hover:bg-[#b82e2a] disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
            >
              {preparing ? 'Se pregătește…' : uploading ? 'Se încarcă…' : 'Înlocuiește'}
            </button>
            <button
              data-testid="reference-from-live"
              onClick={onCaptureFromLive}
              disabled={busy || !hasZone}
              className="py-1.5 rounded disabled:opacity-50 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]"
            >
              <Radio size={12} /> {capturing ? 'se preia…' : 'Din live'}
            </button>
            <button
              onClick={onClear}
              disabled={!hasZone || busy}
              className="col-span-2 py-1.5 rounded border border-red-500/40 text-red-500 dark:text-red-300 hover:bg-red-500/10 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
            >
              <ImageOff size={12} /> Șterge
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={openPicker}
            disabled={!hasZone || busy}
            className={`w-full py-5 rounded-lg border-2 border-dashed text-[11px] font-mono flex flex-col items-center gap-1 disabled:opacity-40 transition-colors ${
              isDarkMode
                ? 'border-white/20 text-slate-300 hover:border-[#FFEB33]/60'
                : 'border-slate-300 text-slate-600 hover:border-[#D73833]/60'
            }`}
          >
            <Camera size={18} />
            {preparing || uploading ? 'se încarcă…' : hasZone ? 'încarcă imagine (JPG/PNG)' : 'salvează zona întâi'}
          </button>
          <button
            data-testid="reference-from-live"
            onClick={onCaptureFromLive}
            disabled={!hasZone || busy}
            className="w-full py-2 rounded-lg disabled:opacity-40 text-[11px] font-bold flex items-center justify-center gap-1.5 shadow transition-colors bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]"
            title="Ia ultimul cadru din live; fețele sunt deja blurate la edge"
          >
            <Radio size={13} /> {capturing ? 'se preia din live…' : 'Captură din live'}
          </button>
        </div>
      )}
    </section>
  );
}
