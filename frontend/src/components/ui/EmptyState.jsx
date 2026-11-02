import { useTheme } from '../../context/ThemeContext';

// The shared "nothing here" card: one icon, one sentence, one way out. It matches the
// incident empty state, so a new screen does not have to redraw the same surface.
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) {
  const { themeStyles } = useTheme();

  return (
    <div className={`flex items-center justify-center p-6 ${className}`.trim()}>
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="w-full max-w-sm space-y-3 rounded-xl border p-6 text-center shadow-lg"
      >
        {Icon && (
          <Icon
            size={28}
            aria-hidden="true"
            className="mx-auto"
            style={{ color: themeStyles.textMuted }}
          />
        )}
        <p className="font-black text-base uppercase tracking-tight">{title}</p>
        {description && (
          <p style={{ color: themeStyles.textMuted }} className="text-xs leading-relaxed">
            {description}
          </p>
        )}
        {action && <div className="flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
