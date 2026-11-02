// LocalSight - Design System & Tokeni Oficiali
// Schema oficială Coolors:
// 1. Carbon Black: #1F1F1F (Fundal Dark Mode & Text Light Mode)
// 2. Scarlet Rush: #D73833 (Alerte Critice, Stop, Risc Major)
// 3. Bright Lemon: #FFEB33 (Avertismente, Atenție, Motor ON)
// 4. Frosted Blue: #7EDEED (Accent, Informare, EIP, Acțiuni Primare)
// 5. White Smoke:  #F5F5F5 (Fundal Light Mode & Text Dark Mode)

export const THEME_CONFIG = {
  // Paleta Dark Mode (Veritabil Dark Mode neutru, fără tentă albastră/violetă)
  dark: {
    appBg: '#1F1F1F',           // Carbon Black
    panelBg: '#282828',         // Gri neutru profund
    panelBorder: 'rgba(255, 255, 255, 0.10)',
    navBg: '#181818',           // Bară neutră închisă
    navBorder: 'rgba(255, 255, 255, 0.10)',
    accentColor: '#FFEB33',     // Bright Lemon (galben oficial Coolors)
    accentHover: '#FDD835',
    textColor: '#F5F5F5',       // White Smoke (WCAG > 10:1 pe #1F1F1F)
    textMuted: '#9E9E9E',       // Gri neutru lizibil
    cardBg: '#2D2D2D',          // Card neutru
    cardHover: '#363636',
    inputBg: '#1C1C1C',
    badgeBg: 'rgba(255, 235, 51, 0.20)',
    modalOverlay: 'rgba(0, 0, 0, 0.85)'
  },
  // Paleta Light Mode: Fundal alb pur #FFFFFF & Accent albastru #7EDEED conform cerinței
  light: {
    appBg: '#FFFFFF',           // Fundal alb conform cerinței
    panelBg: '#FFFFFF',         // Panouri albe
    panelBorder: '#E5E7EB',
    navBg: '#FFFFFF',           // Header alb
    navBorder: '#E5E7EB',
    accentColor: '#FFEB33',     // Accente galbene conform cerinței
    accentHover: '#FDD835',
    textColor: '#1F1F1F',       // Carbon Black pe alb
    textMuted: '#64748B',       // Slate lizibil
    cardBg: '#FFFFFF',
    cardHover: '#F8FAFC',
    inputBg: '#FFFFFF',
    badgeBg: 'rgba(255, 235, 51, 0.25)',
    modalOverlay: 'rgba(15, 23, 42, 0.65)'
  }
};

// Culori de Semnalizare Industrială & Aeroportuară (Folosite EXCLUSIV pentru status, acțiuni și alerte)
export const SIGNAL_COLORS = {
  RED_CRITICAL: '#D73833',      // Scarlet Rush oficial Coolors (incidente critice, pericol major, oprire)
  AMBER_WARNING: '#FFEB33',     // Bright Lemon oficial Coolors (avertismente, atenționări motor activ)
  GREEN_SAFE: '#388E3C',        // Condiții sigure, prim-ajutor, confirmări (Verificare completă)
  BLUE_MANDATORY: '#7EDEED',    // Frosted Blue oficial Coolors (acțiuni obligatorii, EIP, informare)
  FROSTED_BLUE: '#7EDEED'       // Frosted Blue oficial Coolors
};

// Tokeni oficiali de stare și severitate (Decizie Canonică N06)
export const STATUS_TOKENS = {
  // Severitate
  CRITICAL: {
    color: '#D73833',
    bg: '#FEF2F2',
    bgDark: 'rgba(215, 56, 51, 0.22)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: '#D73833',
    borderDark: 'rgba(215, 56, 51, 0.60)',
    dot: '#D73833',
    label: 'CRITICAL'
  },
  WARNING: {
    color: '#FFEB33',
    bg: '#FFFBEB',
    bgDark: 'rgba(255, 235, 51, 0.18)',
    text: '#1F1F1F',
    textDark: '#FFEB33',
    border: '#FFEB33',
    borderDark: 'rgba(255, 235, 51, 0.60)',
    dot: '#FFEB33',
    label: 'WARNING'
  },
  // Stările incidentului (decizia operatorului)
  open: {
    color: '#D73833',
    bg: '#FEF2F2',
    bgDark: 'rgba(215, 56, 51, 0.20)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: '#D73833',
    label: 'Deschis'
  },
  acknowledged: {
    color: '#388E3C',
    bg: '#F0FDF4',
    bgDark: 'rgba(56, 142, 60, 0.18)',
    text: '#1B5E20',
    textDark: '#81C784',
    border: '#A7F3D0',
    label: 'Confirmat'
  },
  false_positive: {
    color: '#64748B',
    bg: '#F1F5F9',
    bgDark: 'rgba(100, 116, 139, 0.18)',
    text: '#334155',
    textDark: '#94A3B8',
    border: '#CBD5E1',
    label: 'Fals Pozitiv'
  },
  escalated: {
    color: '#D73833',
    bg: '#FEE2E2',
    bgDark: 'rgba(215, 56, 51, 0.30)',
    text: '#991B1B',
    textDark: '#FF8A80',
    border: '#D73833',
    label: 'Escaladat (Urgență)'
  },
  resolved: {
    color: '#388E3C',
    bg: '#F0FDF4',
    bgDark: 'rgba(56, 142, 60, 0.18)',
    text: '#1B5E20',
    textDark: '#81C784',
    border: '#86EFAC',
    label: 'Rezolvat'
  }
};