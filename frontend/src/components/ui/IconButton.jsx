// Icon-only buttons are easy to ship without an accessible name. `label` is required and
// becomes the aria-label; `title` is the hover hint and defaults to the same text. Sizes
// map to the icon scale and the padding used by the chrome; `active` exposes a pressed
// state without imposing a look, so a toggle can style it through `activeClassName`.
const SIZES = {
  sm: { icon: 13, padding: 'p-0.5' },
  md: { icon: 16, padding: 'p-2' },
  lg: { icon: 18, padding: 'p-2' },
};

export default function IconButton({
  icon: Icon,
  label,
  title = label,
  size = 'md',
  active = false,
  activeClassName = '',
  className = '',
  iconClassName = '',
  type = 'button',
  ...rest
}) {
  const spec = SIZES[size] || SIZES.md;
  const classes = [
    'flex shrink-0 items-center justify-center',
    spec.padding,
    active ? activeClassName : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      title={title}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      className={classes}
      {...rest}
    >
      <Icon size={spec.icon} aria-hidden="true" className={iconClassName} />
    </button>
  );
}
