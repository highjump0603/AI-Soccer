const variants = {
  default: { background: 'var(--bg-elevated)', color: 'var(--fg-2)', border: '1px solid var(--border)' },
  accent: { background: 'var(--color-accent-faint)', color: 'var(--color-accent)', border: '1px solid var(--color-accent-glow)' },
  success: { background: 'var(--color-success-faint)', color: 'var(--color-success)', border: '1px solid rgba(61,214,140,0.3)' },
  warning: { background: 'var(--color-warning-faint)', color: 'var(--color-warning)', border: '1px solid rgba(255,179,71,0.3)' },
  error: { background: 'var(--color-error-faint)', color: 'var(--color-error)', border: '1px solid rgba(255,87,87,0.3)' },
  solid: { background: 'var(--fg-1)', color: 'var(--bg)', border: '1px solid transparent' },
};

export default function Badge({ children, variant = 'default', size = 'md', dot = false, style, ...props }) {
  const v = variants[variant] || variants.default;
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: 'var(--font-body)',
    fontWeight: '600',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    borderRadius: 'var(--radius-sm)',
    padding: size === 'sm' ? '2px 7px' : '3px 9px',
    fontSize: size === 'sm' ? '10px' : '11px',
    lineHeight: 1,
    ...v,
    ...style,
  };

  return (
    <span style={base} {...props}>
      {dot && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', flexShrink: 0 }} />
      )}
      {children}
    </span>
  );
}
