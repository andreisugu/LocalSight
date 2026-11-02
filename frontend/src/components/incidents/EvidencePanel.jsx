import { useId } from 'react';
import { Download, MapPin } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import SafeImage from '../common/SafeImage';
import EventTimeline from './EventTimeline';
import { snapshotAlt, snapshotCaption, snapshotDownload } from '../../utils/incidentDetail';

// Left column: the frame the rule fired on, its download, and the timeline that explains
// how the alert travelled. `SafeImage` keeps the box when the in-tab engine has no frame
// yet; the download link only exists for a real URL. The frame carries a text alternative
// (camera, zone, blur) and the caption is the visible description of the same picture, so
// the evidence is not image-only.
export default function EvidencePanel({ event }) {
  const { themeStyles } = useTheme();
  const captionId = useId();
  const snapshot = snapshotDownload(event);

  return (
    <section
      aria-label="Dovada incidentului"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="rounded-xl border p-4 shadow-lg flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-mono">
        <span className="font-bold uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <MapPin size={14} className="text-[#D73833] shrink-0" aria-hidden="true" />
          <span className="break-words">
            Camera: {event.camera_id} ({event.zone_id})
          </span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span style={{ color: themeStyles.textMuted }}>Durată: {event.duration_s}s</span>
          {snapshot.downloadable && (
            <a
              href={snapshot.url}
              download={snapshot.fileName}
              title="Descarcă dovada (JPEG cu fețele blurate)"
              className="no-print text-cyan-700 dark:text-[#33E1FF] hover:underline flex items-center gap-1 font-bold"
            >
              <Download size={13} aria-hidden="true" /> Descarcă
            </a>
          )}
        </span>
      </div>

      <figure
        aria-labelledby={captionId}
        className="relative flex-1 min-h-[260px] rounded-lg overflow-hidden bg-black border border-slate-700"
      >
        <SafeImage
          src={event.snapshot_url}
          alt={snapshotAlt(event)}
          className="w-full h-full object-cover text-xs p-6"
          iconSize={36}
        />
        <figcaption
          id={captionId}
          className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] px-2 py-1 bg-black/80 text-white font-mono text-[10px] rounded border border-white/20"
        >
          {snapshotCaption(event)}
        </figcaption>
      </figure>

      <EventTimeline event={event} />
    </section>
  );
}
