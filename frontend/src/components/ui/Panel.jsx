import { useTheme } from '../../context/ThemeContext';

// A titled surface with an optional leading icon and trailing actions. `size` only changes
// density: `sm` is the sidebar footer card, `menu` is a dropdown surface, `md` the default
// panel. Callers can override the surface through `style` (for example the accent border
// the footer card has always used).
const SIZES = {
  sm: 'space-y-1.5 p-2.5 text-[11px]',
  md: 'space-y-2 p-3',
  menu: 'space-y-1 p-2 font-sans text-xs',
};

const DEFAULT_TITLE = 'font-black uppercase tracking-tight';

export default function Panel({
  as: Tag = 'div',
  title,
  icon: Icon,
  actions,
  children,
  size = 'md',
  className = '',
  headerClassName = '',
  titleClassName = DEFAULT_TITLE,
  style,
  ...rest
}) {
  const { themeStyles } = useTheme();
  const hasHeader = Boolean(title || Icon || actions);

  return (
    <Tag
      style={{
        backgroundColor: themeStyles.panelBg,
        borderColor: themeStyles.panelBorder,
        color: themeStyles.textColor,
        ...style,
      }}
      className={`rounded-xl border ${SIZES[size] || SIZES.md} ${className}`.trim()}
      {...rest}
    >
      {hasHeader && (
        <div className={`flex items-center justify-between gap-2 ${headerClassName}`.trim()}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {Icon && (
              <Icon
                size={16}
                aria-hidden="true"
                className="shrink-0 text-amber-500 dark:text-[#FFEB33]"
              />
            )}
            {title && <span className={`min-w-0 ${titleClassName}`.trim()}>{title}</span>}
          </span>
          {actions && <span className="shrink-0">{actions}</span>}
        </div>
      )}
      {children}
    </Tag>
  );
}
