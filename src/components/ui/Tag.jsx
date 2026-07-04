import { useState } from 'react';

const variants = {
  outline: { background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)' },
  filled: { background: 'var(--bg-elevated)', color: 'var(--fg-2)', border: '1px solid transparent' },
  accent: { background: 'var(--color-accent-faint)', color: 'var(--color-accent)', border: '1px solid transparent' },
};

export default function Tag({ children, variant = 'outline', onClick, style, ...props }) {
  const [hov, setHov] = useState(false);
  const clickable = !!onClick;
  const v = variants[variant] || variants.outline;
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: '500',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    lineHeight: 1,
    letterSpacing: '0.02em',
    transition: 'all 150ms ease-out',
    cursor: clickable ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
    ...v,
    ...(clickable && hov
      ? { background: 'var(--color-accent-faint)', color: 'var(--color-accent)', borderColor: 'var(--border-accent)' }
      : {}),
    ...style,
  };

  return (
    <span
      style={base}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      {...props}
    >
      {children}
    </span>
  );
}
