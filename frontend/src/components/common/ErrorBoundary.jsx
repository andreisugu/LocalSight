import React from 'react';
import { SIGNAL_COLORS, THEME_CONFIG } from '../../constants/theme';

// ErrorBoundary - ultima plasă de siguranță a interfeței.
// Fără ea, o excepție aruncată în render (de exemplu o iconiță importată greșit)
// demontează tot arborele React și vizitatorul rămâne cu o pagină neagră, fără
// nicio explicație. Aici eroarea este prinsă, logată o singură dată și explicată
// în română, cu două ieșiri: reîncărcare sau întoarcere la Live.
//
// Componenta stă în main.jsx, în afara providerilor, deci nu poate folosi
// useTheme. Tokenii se citesc direct din constants/theme.js, iar modul se
// detectează de pe <html class="dark">, cu dark ca implicit (tema de bază).
//
// Deliberat fără importuri de iconițe: exact o iconiță nedefinită a produs
// incidentul pe care componenta trebuie să îl prindă, iar un import rupt aici
// ar strica plasa de siguranță însăși.

function currentThemeStyles() {
  const isDark =
    typeof document === 'undefined' || document.documentElement.classList.contains('dark');
  return isDark ? THEME_CONFIG.dark : THEME_CONFIG.light;
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    // componentDidCatch se apelează o dată per eroare, dar steagul garantează
    // că nu ajunge niciodată mai mult de un log pentru aceeași prăbușire.
    this.logged = false;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (this.logged) return;
    this.logged = true;
    // Niciodată înghițită: mesajul și stack-ul ajung în consolă pentru suport.
    console.error({
      message: error?.message || String(error),
      stack: error?.stack || info?.componentStack || '',
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleBackToLive = (event) => {
    event.preventDefault();
    // Navigare completă, nu prin router: arborele React este într-o stare
    // invalidă, deci pornim o încărcare curată de la rădăcina aplicației.
    window.location.assign(import.meta.env.BASE_URL || '/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const themeStyles = currentThemeStyles();
    const message = error?.message || String(error);

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{ backgroundColor: themeStyles.appBg, color: themeStyles.textColor }}
        className="h-screen w-screen flex items-center justify-center p-6 antialiased"
      >
        <div
          style={{
            backgroundColor: themeStyles.panelBg,
            borderColor: themeStyles.panelBorder,
            color: themeStyles.textColor,
          }}
          className="w-full max-w-lg rounded-xl border p-6 space-y-4 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              style={{
                backgroundColor: SIGNAL_COLORS.RED_CRITICAL,
                color: THEME_CONFIG.dark.textColor,
              }}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-lg leading-none"
            >
              !
            </span>
            <div className="space-y-1">
              <h1 className="text-lg font-bold leading-tight">Ceva s-a rupt în interfață</h1>
              <p className="text-sm leading-snug" style={{ color: themeStyles.textMuted }}>
                Pagina poate fi reîncărcată pentru a continua.
              </p>
            </div>
          </div>

          <pre
            style={{
              backgroundColor: themeStyles.inputBg,
              borderColor: themeStyles.panelBorder,
              color: themeStyles.textMuted,
            }}
            className="max-h-24 overflow-auto rounded-lg border p-2.5 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words select-text"
          >
            {message}
          </pre>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                backgroundColor: themeStyles.accentColor,
                color: '#1F1F1F',
              }}
              className="px-4 py-2 rounded-lg text-xs font-bold hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FFEB33] transition"
            >
              Reîncarcă pagina
            </button>
            <a
              href={import.meta.env.BASE_URL || '/'}
              onClick={this.handleBackToLive}
              className="text-xs font-bold underline underline-offset-2 hover:opacity-80"
              style={{ color: SIGNAL_COLORS.FROSTED_BLUE }}
            >
              înapoi la Live
            </a>
          </div>
        </div>
      </div>
    );
  }
}
