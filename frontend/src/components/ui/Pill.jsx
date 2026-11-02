import React from 'react';
import { toneClass } from './tone.js';

// Three shapes cover the chips in the chrome: a rounded count, the compact mono tag used
// inside menus, and a bare segment for a two-part badge where the wrapper owns the shape.
const SHAPES = {
  pill: 'rounded-full px-1.5 py-0.5 text-[10px]',
  tag: 'rounded px-1.5 text-[10px] font-mono',
  plain: '',
};

/**
 * Small status chip. `tone` and `variant` pick a signal pair; `shape` and `className`
 * carry the layout the caller already needs (menu tag, attention count, footer status).
 */
export default function Pill({
  as: Tag = 'span',
  tone = 'neutral',
  variant = 'solid',
  shape = 'pill',
  mono = false,
  title,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'inline-flex shrink-0 items-center gap-1 font-bold',
    toneClass(tone, variant),
    SHAPES[shape] ?? SHAPES.pill,
    mono ? 'font-mono' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag title={title} className={classes} {...rest}>
      {children}
    </Tag>
  );
}

export { Pill as Badge };
