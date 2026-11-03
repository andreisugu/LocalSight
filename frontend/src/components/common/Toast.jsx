import { Info as InfoIcon } from 'lucide-react';
import { useSecurity } from '../../context/SecurityContext'; // owns toastMessage and its 3.8 s timer
import { useTheme } from '../../context/ThemeContext';
// Accessible toast. SecurityContext owns the message and its timer (`showToast`) and exposes
// no dismiss method, so there is no close button that could end up dead. The live region
// stays mounted while empty, which is what makes later insertions announced reliably. Long
// operator names are clamped to three lines instead of stretching the card.
const REGION_CLASSES =
  'no-print pointer-events-none fixed bottom-5 right-5 z-50 max-w-[calc(100vw-2.5rem)] sm:max-w-md';
const CARD_CLASSES =
  'flex items-start gap-3 rounded-xl border px-4 py-3 font-sans text-xs shadow-2xl backdrop-blur-md md:text-sm';
const cardStyle = (isDarkMode, themeStyles) => ({
  backgroundColor: isDarkMode ? 'rgba(24, 24, 24, 0.96)' : 'rgba(255, 255, 255, 0.98)',
  borderColor: themeStyles.accentColor,
  color: themeStyles.textColor,
});
const Toast = () => {
  const { toastMessage } = useSecurity();
  const { isDarkMode, themeStyles } = useTheme();
  return <div role="status" aria-live="polite" aria-atomic="true" className={REGION_CLASSES}>
    {toastMessage ? <div style={cardStyle(isDarkMode, themeStyles)} className={CARD_CLASSES}>
      <InfoIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: themeStyles.accentColor }} />
      <span className="line-clamp-3 min-w-0 flex-1 break-words leading-snug" title={toastMessage}>
        {toastMessage}
      </span>
    </div> : null}
  </div>;
};
export default Toast;
