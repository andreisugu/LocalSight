import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';

// Everything that can receive focus inside the dialog, in DOM order. The textarea is the
// first control on purpose: the note is the only input the operator has to type.
const FOCUSABLE =
  'textarea, input, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// A real modal, not a box that claims to be one. While it is open:
//  - focus moves into the first control,
//  - Tab / Shift+Tab cycle inside the dialog,
//  - Escape closes it,
//  - the rest of the document is `inert` (out of the tab order and the a11y tree),
//  - closing restores focus to whatever opened it.
// It is portalled to <body> because `inert` is applied to the dialog's siblings: rendering
// it inside the app shell would make its own ancestors inert as well.
export default function FalsePositiveDialog({ onSubmit, onCancel }) {
  const { themeStyles } = useTheme();
  const [note, setNote] = useState('');
  const dialogRef = useRef(null);
  // The effect below must run exactly once per mount: a parent re-render would otherwise
  // re-run it, steal focus back to the textarea and forget the element to return to.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previouslyFocused = document.activeElement;

    // Background inert: everything at body level except this dialog's own root.
    const siblings = Array.from(document.body.children).filter((node) => !node.contains(dialog));
    const restore = siblings.map((node) => ({
      node,
      inert: node.hasAttribute('inert'),
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
    for (const { node } of restore) {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }

    const first = dialog.querySelector(FOCUSABLE);
    first?.focus();

    // Escape always closes; the listener is on the document so it also works when focus
    // has drifted to the dialog container itself.
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current();
    };
    document.addEventListener('keydown', closeOnEscape, true);

    return () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      for (const { node, inert, ariaHidden } of restore) {
        if (!inert) node.removeAttribute('inert');
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      }
      // Focus returns to the trigger, not to <body>.
      if (
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
    // Mount/unmount only: see the `cancelRef` note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab / Shift+Tab never leave the dialog.
  const trapTab = (event) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="false-positive-title"
      aria-describedby="false-positive-description"
      ref={dialogRef}
      onKeyDown={trapTab}
      // Clicking the dimmed backdrop closes; a click inside the card does not bubble up
      // to this handler as the target, so nothing is cancelled by accident.
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div
        style={{
          backgroundColor: themeStyles.panelBg,
          borderColor: themeStyles.panelBorder,
          color: themeStyles.textColor,
        }}
        className="w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-2xl"
      >
        <h3 id="false-positive-title" className="text-sm font-bold uppercase">
          Feedback fals pozitiv pentru echipa AI
        </h3>
        <p id="false-positive-description" style={{ color: themeStyles.textMuted }} className="text-xs">
          Explică de ce detecția a fost eronată, pentru antrenarea viitoare a modelului:
        </p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ex: Tehnicianul purta dopuri interne de urechi, nu căști externe..."
          aria-label="Motivul falsului pozitiv"
          rows={3}
          className="w-full rounded-lg border border-[#64748B] bg-white p-2.5 text-xs text-[#1F1F1F] placeholder-slate-600 dark:border-white/20 dark:bg-black/30 dark:text-slate-100 dark:placeholder-slate-400"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#64748B] px-3 py-1.5 text-xs font-semibold text-[#1F1F1F] transition-colors hover:bg-slate-100 dark:border-white/30 dark:text-slate-200 dark:hover:bg-white/10"
          >
            Anulează
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note)}
            className="rounded-lg bg-amber-700 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-800"
          >
            Trimite Feedback
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
