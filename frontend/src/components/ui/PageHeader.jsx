import { useTheme } from '../../context/ThemeContext';

// Title + optional subtitle + actions, matching the heading block the views already use.
// The heading level stays the caller's choice (`as`), because some screens open with an h1
// and the list screens use an h2.
export default function PageHeader({
  as: Tag = 'h2',
  title,
  subtitle,
  icon: Icon,
  actions,
  className = '',
  titleClassName = '',
}) {
  const { themeStyles } = useTheme();

  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`.trim()}>
      <div className="min-w-0">
        <Tag
          style={{ color: themeStyles.textColor }}
          className={`flex items-center gap-2 text-xl font-black uppercase tracking-tight ${titleClassName}`.trim()}
        >
          {Icon && <Icon size={20} aria-hidden="true" className="shrink-0" />}
          <span className="truncate">{title}</span>
        </Tag>
        {subtitle && (
          <p style={{ color: themeStyles.textMuted }} className="mt-1 text-xs leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
