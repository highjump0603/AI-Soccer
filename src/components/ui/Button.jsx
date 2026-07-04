import { useState } from 'react';

const variants = {
  primary: { background: 'var(--color-accent)', color: 'var(--fg-on-accent)', border: '2px solid var(--color-accent)' },
  secondary: { background: 'transparent', color: 'var(--fg-1)', border: '2px solid var(--border-strong)' },
  ghost: { background: 'transparent', color: 'var(--fg-2)', border: '2px solid transparent' },
  danger: { background: 'var(--color-error)', color: '#ffffff', border: '2px solid var(--color-error)' },
};

const sizes = {
  sm: { padding: '5px 12px', fontSize: '11px', borderRadius: 'var(--radius-sm)', gap: '5px' },
  md: { padding: '9px 18px', fontSize: '13px', borderRadius: 'var(--radius-sm)', gap: '6px' },
  lg: { padding: '13px 26px', fontSize: '15px', borderRadius: 'var(--radius-sm)', gap: '8px' },
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  icon,
  iconRight,
  onClick,
  style,
  as: As = 'button',
  ...props
}) {
  const [hov, setHov] = useState(false);
  const [press, setPress] = useState(false);
  const v = variants[variant] || variants.primary;
  const s = sizes[size] || sizes.md;

  let bg = v.background;
  let borderColor = v.border;
  let color = v.color;
  let boxShadow = 'none';
  let transform = 'scale(1)';

  if (!disabled) {
    if (press) {
      bg = variant === 'primary' ? 'var(--interactive-press)' : 'var(--color-accent-faint)';
      borderColor = variant === 'primary' ? '2px solid var(--interactive-press)' : '2px solid var(--border-accent)';
      transform = 'scale(0.97)';
    } else if (hov) {
      if (variant === 'primary') {
        bg = 'var(--interactive-hover)';
        borderColor = '2px solid var(--interactive-hover)';
        boxShadow = 'var(--shadow-accent)';
      } else {
        bg = 'var(--color-accent-faint)';
        borderColor = '2px solid var(--border-accent)';
        color = 'var(--fg-accent)';
      }
    }
  }

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-body)',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    lineHeight: 1,
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.38 : 1,
    width: fullWidth ? '100%' : 'auto',
    whiteSpace: 'nowrap',
    transition: 'all 200ms cubic-bezier(0,0,0.2,1)',
    ...v,
    ...s,
    background: bg,
    border: borderColor,
    color,
    boxShadow,
    transform,
    ...style,
  };

  return (
    <As
      style={base}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => !disabled && setHov(true)}
      onMouseLeave={() => { setHov(false); setPress(false); }}
      onMouseDown={() => !disabled && setPress(true)}
      onMouseUp={() => setPress(false)}
      {...props}
    >
      {icon && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
      {children}
      {iconRight && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{iconRight}</span>}
    </As>
  );
}
