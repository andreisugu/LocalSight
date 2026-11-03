// Archive & Backup: the local, offline copy of what the browser remembers.
//
// The static build has no backend, so the durable store in IndexedDB is the only copy of an
// incident and its snapshot. This screen exports it as one JSON file and imports it back
// after a wipe, a new machine or a cleared profile. There is no upload, no server call and
// no third-party host: the file is read from and written to the browser's own storage.
//
// The pure file logic lives in `services/evidenceArchive.js` (file shape, strict base64,
// validation, summary) and the IndexedDB seam in `services/evidenceArchiveDb.js` (one
// readonly read, one readwrite transaction). This module owns the layout and the copy.
//
// Import is replace-only. The screen shows what the file adds, repeats and conflicts with,
// and what would be lost, then waits for an explicit confirmation. Nothing is written
// until that click; a failed write aborts the transaction and leaves the previous data.
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  HardDrive,
  Upload,
} from 'lucide-react';
import { useSecurity } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import { Panel } from '../ui';
import {
  ARCHIVE_LIMITS,
  archiveFilename,
  parseArchive,
  serializeArchive,
  summarizeImport,
} from '../../services/evidenceArchive';
import { readLocalEvidence, replaceLocalEvidence } from '../../services/evidenceArchiveDb';

const INK = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-[#FFEB33]',
  bad: 'text-[#B91C1C] dark:text-[#FF8A80]',
};

const MUTED_INK = 'text-slate-500 dark:text-slate-400';

/** A stored message already ends with a period; do not print a second one. */
const sentence = (message) => String(message || '').trim().replace(/[.!?]+$/, '');

const ACTION =
  'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEB33] disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY =
  'bg-[#D73833] text-white shadow hover:bg-[#B91C1C]';

const SECONDARY =
  'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10';

/** Approximate size of the stored blobs plus records; same shape as the Settings panel. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1 incident" / "3 incidente"; the screen never prints a bare number. */
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function formatExportedAt(value) {
  if (typeof value !== 'string') return 'dată necunoscută';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'dată necunoscută';
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** One honest count: label, number, and what it means. */
function CountTile({ testId, label, value, hint, mono = true }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        data-testid={testId}
        className={`mt-0.5 text-lg font-black leading-tight ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </dd>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

/** Romanian agreement for the three comparison counters. */
const newWord = (count) => (count === 1 ? 'nou' : 'noi');
const sameWord = (count) => (count === 1 ? 'identic' : 'identice');
const differentWord = (count) => (count === 1 ? 'diferit' : 'diferite');

/** One row of the import summary: what the file has, and how it relates to what is local. */
function SummaryRow({ label, one, many, bucket }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-200 py-2 last:border-b-0 dark:border-white/10">
      <span className="text-xs font-semibold">{label}</span>
      <span className="font-mono text-xs tabular-nums">
        {plural(bucket.total, one, many)} în fișier
        {' · '}
        <span className={INK.ok}>
          {bucket.new} {newWord(bucket.new)}
        </span>
        {' · '}
        <span className={MUTED_INK}>
          {bucket.duplicate} {sameWord(bucket.duplicate)}
        </span>
        {' · '}
        <span className={bucket.conflicting > 0 ? INK.warn : MUTED_INK}>
          {bucket.conflicting} {differentWord(bucket.conflicting)}
        </span>
      </span>
    </li>
  );
}

/** The local counts, read from the store the provider hydrated, never invented. */
function LocalCounts({ localEvidence }) {
  const { stats, hydrated, retention, supported } = localEvidence;
  // An unavailable store has no counts; printing 0 would read as "nothing stored".
  const value = (count) => (!supported ? '—' : hydrated ? count : 'se citește…');
  const eventsValue = !supported
    ? '—'
    : hydrated
      ? `${stats.count} / ${retention.maxEvents}`
      : 'se citește…';
  const bytesValue = !supported
    ? '—'
    : hydrated
      ? formatBytes(stats.bytes)
      : 'se citește…';
  return (
    <Panel
      title="Ce există acum în acest browser"
      icon={Database}
      size="card"
      className="space-y-3"
      data-testid="archive-local-counts"
    >
      <p className="text-xs leading-snug text-slate-600 dark:text-slate-400">
        Sursa este IndexedDB-ul acestui browser. Arhiva nu are o copie pe server: fișierul
        JSON pe care îl descarci este singura copie din afara tabului.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile
          testId="archive-count-events"
          label="Incidente"
          value={eventsValue}
          hint="salvate în IndexedDB"
        />
        <CountTile
          testId="archive-count-evidence"
          label="Snapshot-uri"
          value={value(stats.evidenceCount)}
          hint="imagini blurate, base64 în fișier"
        />
        <CountTile
          testId="archive-count-acks"
          label="Confirmări"
          value={value(stats.ackCount)}
          hint="status, operator, fals pozitiv"
        />
        <CountTile
          testId="archive-count-bytes"
          label="Dimensiune"
          value={bytesValue}
          hint="aproximativ, în browser"
          mono={false}
        />
      </dl>
      <p className={`text-[11px] leading-snug ${MUTED_INK}`}>
        {supported
          ? 'Doar în acest browser. Retenția păstrează cele mai noi incidente și le șterge pe cele vechi, împreună cu snapshot-ul și confirmarea lor.'
          : 'IndexedDB este indisponibil (mod privat, stocare blocată sau alt tab ține baza deschisă). Fără el nu există nici export, nici import.'}
      </p>
    </Panel>
  );
}

const ArchiveView = () => {
  const { localEvidence } = useSecurity();
  const { themeStyles } = useTheme();
  const [status, setStatus] = useState({ tone: 'idle', message: '' });
  // One operation at a time: 'export' | 'file' | 'replace' | null. A single flag would
  // make the export button claim it is exporting while an import is being parsed.
  const [busy, setBusy] = useState(null);
  const isBusy = busy !== null;
  const [pending, setPending] = useState(null);
  const fileRef = useRef(null);
  const summaryRef = useRef(null);

  // The provider hydrates once on boot; a visit after an operator action must not show a
  // stale count, so ask the store again when the screen opens.
  const { refreshStats } = localEvidence;
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Move focus to the summary the moment it exists: a keyboard or screen-reader user chose
  // a file and must land on the consequence, not stay on the picker.
  useEffect(() => {
    if (pending) summaryRef.current?.focus();
  }, [pending]);

  const report = (tone, message) => setStatus({ tone, message });

  const exportArchive = async () => {
    if (isBusy) return;
    setBusy('export');
    report('working', 'Se citesc incidentele, snapshot-urile și confirmările din acest browser…');
    try {
      const local = await readLocalEvidence();
      if (!local.supported) {
        throw new Error('IndexedDB este indisponibil, deci nu există date de exportat.');
      }
      const archive = await serializeArchive({
        events: local.events,
        evidence: local.evidence,
        acks: local.acks,
        meta: local.meta,
      });
      const text = JSON.stringify(archive, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = archiveFilename(new Date());
      link.click();
      // The browser copies the blob when the click is handled; revoking right away is what
      // the report CSV export does too, and it keeps the tab from leaking object URLs.
      URL.revokeObjectURL(url);

      const counts = archive.counts;
      const skipped = local.skipped.events + local.skipped.evidence + local.skipped.acks;
      const parts = [
        `Arhivă descărcată: ${plural(counts.events, 'incident', 'incidente')}`,
        plural(counts.evidence, 'snapshot', 'snapshot-uri'),
        plural(counts.acks, 'confirmare', 'confirmări'),
      ];
      if (skipped > 0) {
        parts.push(`${plural(skipped, 'rând corupt', 'rânduri corupte')} ignorate`);
      }
      if (blob.size > ARCHIVE_LIMITS.maxBytes) {
        parts.push(
          `fișierul are ${formatBytes(blob.size)} și depășește limita de import de 50 MB`
        );
      }
      report('ok', `${parts.join(' · ')}. Fișierul rămâne local.`);
    } catch (error) {
      report('error', `Exportul a eșuat: ${sentence(error?.message) || 'eroare necunoscută'}.`);
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (changeEvent) => {
    const file = changeEvent.target.files?.[0];
    // Clear the input so choosing the same file again after a fix still fires `change`.
    changeEvent.target.value = '';
    if (!file) return;
    setPending(null);
    setBusy('file');
    report('working', `Se citește ${file.name}…`);
    try {
      if (file.size > ARCHIVE_LIMITS.maxBytes) {
        throw new Error(
          `Fișierul are ${formatBytes(file.size)} și depășește limita de 50 MB.`
        );
      }
      const text = await file.text();
      const parsed = parseArchive(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const local = await readLocalEvidence();
      if (!local.supported) {
        throw new Error('IndexedDB este indisponibil, deci importul nu poate scrie.');
      }
      setPending({
        fileName: file.name,
        archive: parsed.archive,
        summary: summarizeImport(local, parsed.archive),
      });
      report('ok', `Fișier valid. Verifică rezumatul, apoi confirmă înlocuirea datelor locale.`);
    } catch (error) {
      setPending(null);
      report('error', `Import respins: ${sentence(error?.message) || 'fișier invalid'}. Nu s-a scris nimic.`);
    } finally {
      setBusy(null);
    }
  };

  const cancelImport = () => {
    setPending(null);
    if (fileRef.current) fileRef.current.value = '';
    report('idle', 'Import anulat. Datele locale au rămas neschimbate.');
  };

  const replaceLocalData = async () => {
    if (!pending || isBusy) return;
    setBusy('replace');
    report('working', 'Se scriu datele în IndexedDB, într-o singură tranzacție…');
    try {
      const written = await replaceLocalEvidence(pending.archive);
      report(
        'ok',
        `Import finalizat: ${plural(written.events, 'incident', 'incidente')} · ${plural(
          written.evidence,
          'snapshot',
          'snapshot-uri'
        )} · ${plural(written.acks, 'confirmare', 'confirmări')}. Pagina se reîncarcă pentru a citi datele.`
      );
      // The provider hydrated before this write; a reload is the documented way to make it
      // read the replaced database and rebuild the snapshot object URLs.
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setBusy(null);
      report(
        'error',
        `${sentence(error?.message || 'Scrierea a eșuat')}. Datele locale au rămas neschimbate.`
      );
    }
  };

  const statusInk = status.tone === 'error'
    ? INK.bad
    : status.tone === 'ok'
      ? INK.ok
      : status.tone === 'working'
        ? INK.warn
        : MUTED_INK;
  const muted = { color: themeStyles.textMuted };

  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
            <Archive size={20} className="shrink-0 text-[#D73833]" aria-hidden="true" />
            Arhivă &amp; Backup
          </h2>
          <p className="text-xs leading-snug" style={muted}>
            Copie de siguranță pentru incidentele, snapshot-urile și confirmările salvate doar
            în acest browser. Exportul scrie un fișier JSON pe disc; importul îl citește înapoi.
            Nimic nu pleacă în rețea.
          </p>
        </header>

        {/* One live region for both actions: the operator hears the result without a dialog. */}
        <p
          data-testid="archive-status"
          data-tone={status.tone}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`min-h-[1.25rem] text-xs font-semibold leading-snug ${statusInk}`}
        >
          {status.message}
        </p>

        <LocalCounts localEvidence={localEvidence} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Export"
            icon={Download}
            size="card"
            className="flex flex-col gap-3"
            data-testid="archive-export-panel"
          >
            <p className="text-xs leading-snug text-slate-600 dark:text-slate-400">
              Fișierul conține incidentele, snapshot-urile ca imagine base64 și confirmările
              operatorului. Este singura copie din afara browserului: păstrează-l undeva sigur.
            </p>
            <ul className={`list-inside list-disc text-[11px] leading-snug ${MUTED_INK}`}>
              <li>Incidentele, exact cum apar în listă.</li>
              <li>Snapshot-urile blurate, cu tipul lor MIME.</li>
              <li>Confirmările, fals pozitivele și redeschiderile.</li>
            </ul>
            <button
              type="button"
              data-testid="archive-export"
              onClick={exportArchive}
              disabled={isBusy || !localEvidence.supported}
              className={`${ACTION} ${PRIMARY} mt-auto w-full sm:w-auto`}
            >
              <Download size={15} aria-hidden="true" />
              {busy === 'export' ? 'Se pregătește…' : 'Descarcă arhiva JSON'}
            </button>
          </Panel>

          <Panel
            title="Import"
            icon={Upload}
            size="card"
            className="flex flex-col gap-3"
            data-testid="archive-import-panel"
          >
            <p className="text-xs leading-snug text-slate-600 dark:text-slate-400">
              Alege un fișier creat de LocalSight. Importul <strong>înlocuiește</strong> datele
              locale: nu fuzionează și nu păstrează nimic din ce este acum în browser.
            </p>
            <div className="space-y-1">
              <div className="rounded-lg focus-within:ring-2 focus-within:ring-[#FFEB33]">
                <label
                  htmlFor="archive-file-input"
                  data-testid="archive-import"
                  className={`${ACTION} ${SECONDARY} w-full cursor-pointer sm:w-auto`}
                >
                  <FileJson size={15} aria-hidden="true" />
                  Alege fișier JSON…
                </label>
                <input
                  ref={fileRef}
                  id="archive-file-input"
                  data-testid="archive-file"
                  type="file"
                  accept="application/json,.json"
                  onChange={chooseFile}
                  disabled={isBusy}
                  aria-describedby="archive-import-limit"
                  className="sr-only"
                />
              </div>
              <p id="archive-import-limit" className={`text-[11px] leading-snug ${MUTED_INK}`}>
                Maximum 50 MB, schema 1, până la {ARCHIVE_LIMITS.maxEvents} incidente. Un fișier
                gol sau corupt este respins fără nicio scriere.
              </p>
            </div>

            {pending && (
              <section
                ref={summaryRef}
                tabIndex={-1}
                data-testid="archive-summary"
                aria-labelledby="archive-summary-title"
                className="space-y-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-[#1F1F1F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D73833] dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-[#F5F5F5]"
              >
                <h3 id="archive-summary-title" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                  <AlertTriangle size={14} aria-hidden="true" className={INK.warn} />
                  Rezumatul importului
                </h3>
                <p className="break-words text-[11px] leading-snug">
                  <span className="font-mono">{pending.fileName}</span>
                  {' · exportat '}
                  {formatExportedAt(pending.archive.exported_at)}
                </p>
                <ul>
                  <SummaryRow
                    label="Incidente"
                    one="incident"
                    many="incidente"
                    bucket={pending.summary.events}
                  />
                  <SummaryRow
                    label="Snapshot-uri"
                    one="snapshot"
                    many="snapshot-uri"
                    bucket={pending.summary.evidence}
                  />
                  <SummaryRow
                    label="Confirmări"
                    one="confirmare"
                    many="confirmări"
                    bucket={pending.summary.acks}
                  />
                </ul>
                <p className="text-[11px] font-semibold leading-snug" role="alert">
                  Înlocuirea șterge din acest browser {plural(pending.summary.current.events, 'incident', 'incidente')},{' '}
                  {plural(pending.summary.current.evidence, 'snapshot', 'snapshot-uri')} și{' '}
                  {plural(pending.summary.current.acks, 'confirmare', 'confirmări')}. Nu se poate
                  anula din aplicație.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    data-testid="archive-replace"
                    onClick={replaceLocalData}
                    disabled={isBusy}
                    className={`${ACTION} ${PRIMARY} w-full sm:w-auto`}
                  >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {busy === 'replace' ? 'Se importă…' : 'Înlocuiește datele locale'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelImport}
                    disabled={isBusy}
                    className={`${ACTION} ${SECONDARY} w-full sm:w-auto`}
                  >
                    Renunță
                  </button>
                </div>
              </section>
            )}
          </Panel>
        </div>

        <Panel title="Limitele acestei copii" icon={HardDrive} size="md" className="space-y-1.5">
          <ul className="space-y-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
            <li>
              <strong>Doar acest browser.</strong> Arhiva nu ajunge pe un server și nu poate fi
              restaurată din altă parte decât din fișierul descărcat.
            </li>
            <li>
              <strong>Snapshot-urile urmează incidentul.</strong> Retenția (ultimele{' '}
              {localEvidence.retention.maxEvents} incidente, maximum{' '}
              {localEvidence.retention.maxAgeDays} zile) șterge și imaginea și confirmarea.
            </li>
            <li>
              <strong>Fișierul este text simplu.</strong> Snapshot-urile sunt base64, deci
              fișierul este cu aproximativ o treime mai mare decât imaginile. Limita de import
              este {formatBytes(ARCHIVE_LIMITS.maxBytes)}.
            </li>
            <li>
              <strong>Fără merge.</strong> Importul rescrie starea locală cu ce este în fișier;
              ce nu e în fișier nu rămâne.
            </li>
          </ul>
        </Panel>
      </section>
    </div>
  );
};

export default ArchiveView;
