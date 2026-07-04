import { useState } from 'react';

const variants = {
  default: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'none' },
  elevated: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' },
  bordered: { background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', boxShadow: 'none' },
  accent: { background: 'var(--color-accent-faint)', border: '1px solid var(--border-accent)', boxShadow: 'none' },
};

const paddings = {
  none: '0',
  sm: 'var(--space-4)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

export default function Card({
  children,
  variant = 'default',
  padding = 'md',
  interactive = false,
  onClick,
  style,
  className,
  ...props
}) {
  const [hov, setHov] = useState(false);
  const v = variants[variant] || variants.default;
  const base = {
    borderRadius: 'var(--radius-md)',
    padding: paddings[padding] || paddings.md,
    transition: 'all 200ms cubic-bezier(0,0,0.2,1)',
    cursor: interactive ? 'pointer' : 'default',
    ...v,
    ...(interactive && hov
      ? { borderColor: 'var(--border-accent)', transform: 'translateY(-3px)', boxShadow: 'var(--shadow-accent)' }
      : {}),
    ...style,
  };

  return (
    <div
      className={className}
      style={base}
      onClick={onClick}
      onMouseEnter={() => interactive && setHov(true)}
      onMouseLeave={() => interactive && setHov(false)}
      {...props}
    >
      {children}
    </div>
  );
}
