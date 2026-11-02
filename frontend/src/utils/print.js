// "Export PDF" is the browser's print dialog (Save as PDF), not a PDF writer: the print
// stylesheet in src/index.css hides the app chrome (`.no-print`) and paints the page on
// white. The document title is what the dialog proposes as the file name, so it is swapped
// for the export name and put back when the dialog closes.

const PRINT_FINISHED_EVENT = 'afterprint';

/**
 * Opens the print dialog with `fileName` as the suggested document title.
 * The previous title is restored on `afterprint`, whatever the user chose.
 */
export function printAsPdf(fileName) {
  const previousTitle = document.title;

  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener(PRINT_FINISHED_EVENT, restoreTitle);
  };

  document.title = fileName;
  window.addEventListener(PRINT_FINISHED_EVENT, restoreTitle);
  window.print();
}
