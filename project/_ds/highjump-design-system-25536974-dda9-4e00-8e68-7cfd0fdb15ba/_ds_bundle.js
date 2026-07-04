/* @ds-bundle: {"format":3,"namespace":"HighJumpDesignSystem_255369","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"627d792007e9","components/core/Button.jsx":"185c61acacbb","components/core/Card.jsx":"12cdfa8fd0cc","components/core/Input.jsx":"1c7dbb1e6589","components/core/Tag.jsx":"a8bfb09333f9"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.HighJumpDesignSystem_255369 = window.HighJumpDesignSystem_255369 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const badgeVariants = {
  default: {
    background: 'var(--bg-elevated)',
    color: 'var(--fg-2)',
    border: '1px solid var(--border)'
  },
  accent: {
    background: 'var(--color-accent-faint)',
    color: 'var(--color-accent)',
    border: '1px solid var(--color-accent-glow)'
  },
  success: {
    background: 'var(--color-success-faint)',
    color: 'var(--color-success)',
    border: '1px solid rgba(61,214,140,0.3)'
  },
  warning: {
    background: 'var(--color-warning-faint)',
    color: 'var(--color-warning)',
    border: '1px solid rgba(255,179,71,0.3)'
  },
  error: {
    background: 'var(--color-error-faint)',
    color: 'var(--color-error)',
    border: '1px solid rgba(255,87,87,0.3)'
  },
  solid: {
    background: 'var(--fg-1)',
    color: 'var(--bg)',
    border: '1px solid transparent'
  }
};
function Badge({
  children,
  variant = 'default',
  size = 'md',
  dot = false,
  style,
  ...props
}) {
  const v = badgeVariants[variant] || badgeVariants.default;
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
    ...style
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: base
  }, props), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: '50%',
      background: 'currentColor',
      display: 'inline-block',
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const btnVariants = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--fg-on-accent)',
    border: '2px solid var(--color-accent)'
  },
  secondary: {
    background: 'transparent',
    color: 'var(--fg-1)',
    border: '2px solid var(--border-strong)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--fg-2)',
    border: '2px solid transparent'
  },
  danger: {
    background: 'var(--color-error)',
    color: '#ffffff',
    border: '2px solid var(--color-error)'
  }
};
const btnSizes = {
  sm: {
    padding: '5px 12px',
    fontSize: '11px',
    borderRadius: 'var(--radius-sm)',
    gap: '5px'
  },
  md: {
    padding: '9px 18px',
    fontSize: '13px',
    borderRadius: 'var(--radius-sm)',
    gap: '6px'
  },
  lg: {
    padding: '13px 26px',
    fontSize: '15px',
    borderRadius: 'var(--radius-sm)',
    gap: '8px'
  }
};
function Button({
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
  const [hov, setHov] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const v = btnVariants[variant] || btnVariants.primary;
  const s = btnSizes[size] || btnSizes.md;
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
    ...style
  };
  return /*#__PURE__*/React.createElement(As, _extends({
    style: base,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => !disabled && setHov(true),
    onMouseLeave: () => {
      setHov(false);
      setPress(false);
    },
    onMouseDown: () => !disabled && setPress(true),
    onMouseUp: () => setPress(false)
  }, props), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0
    }
  }, icon), children, iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0
    }
  }, iconRight));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const cardVariants = {
  default: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'none'
  },
  elevated: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-md)'
  },
  bordered: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-strong)',
    boxShadow: 'none'
  },
  accent: {
    background: 'var(--color-accent-faint)',
    border: '1px solid var(--border-accent)',
    boxShadow: 'none'
  }
};
const cardPaddings = {
  none: '0',
  sm: 'var(--space-4)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)'
};
function Card({
  children,
  variant = 'default',
  padding = 'md',
  interactive = false,
  onClick,
  style,
  ...props
}) {
  const [hov, setHov] = React.useState(false);
  const v = cardVariants[variant] || cardVariants.default;
  const base = {
    borderRadius: 'var(--radius-md)',
    padding: cardPaddings[padding] || cardPaddings.md,
    transition: 'all 200ms cubic-bezier(0,0,0.2,1)',
    cursor: interactive ? 'pointer' : 'default',
    ...v,
    ...(interactive && hov ? {
      borderColor: 'var(--border-accent)',
      transform: 'translateY(-3px)',
      boxShadow: 'var(--shadow-accent)'
    } : {}),
    ...style
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: base,
    onClick: onClick,
    onMouseEnter: () => interactive && setHov(true),
    onMouseLeave: () => interactive && setHov(false)
  }, props), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  error,
  hint,
  type = 'text',
  placeholder,
  value,
  onChange,
  disabled = false,
  required = false,
  multiline = false,
  rows = 4,
  style,
  inputStyle,
  ...props
}) {
  const [focused, setFocused] = React.useState(false);
  const fieldBase = {
    display: 'block',
    width: '100%',
    background: 'var(--bg-elevated)',
    border: error ? '1px solid var(--color-error)' : focused ? '1px solid var(--border-accent)' : '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 14px',
    fontFamily: 'var(--font-body)',
    fontSize: '14px',
    lineHeight: 'var(--leading-normal)',
    color: disabled ? 'var(--fg-3)' : 'var(--fg-1)',
    outline: 'none',
    resize: multiline ? 'vertical' : 'none',
    transition: 'border-color 150ms, box-shadow 150ms',
    cursor: disabled ? 'not-allowed' : 'text',
    boxShadow: focused && !error ? '0 0 0 3px var(--color-accent-faint)' : 'none',
    ...inputStyle
  };
  const labelStyle = {
    display: 'block',
    fontFamily: 'var(--font-body)',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--fg-2)',
    marginBottom: '6px'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-accent)',
      marginLeft: 4
    }
  }, "*")), multiline ? /*#__PURE__*/React.createElement("textarea", _extends({
    style: fieldBase,
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    disabled: disabled,
    rows: rows,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, props)) : /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    style: fieldBase,
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, props)), error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: '12px',
      color: 'var(--color-error)',
      marginTop: 5
    }
  }, error), hint && !error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: '12px',
      color: 'var(--fg-3)',
      marginTop: 5
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tagVariants = {
  outline: {
    background: 'transparent',
    color: 'var(--fg-3)',
    border: '1px solid var(--border)'
  },
  filled: {
    background: 'var(--bg-elevated)',
    color: 'var(--fg-2)',
    border: '1px solid transparent'
  },
  accent: {
    background: 'var(--color-accent-faint)',
    color: 'var(--color-accent)',
    border: '1px solid transparent'
  }
};
function Tag({
  children,
  variant = 'outline',
  onClick,
  style,
  ...props
}) {
  const [hov, setHov] = React.useState(false);
  const clickable = !!onClick;
  const v = tagVariants[variant] || tagVariants.outline;
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
    ...(clickable && hov ? {
      background: 'var(--color-accent-faint)',
      color: 'var(--color-accent)',
      borderColor: 'var(--border-accent)'
    } : {}),
    ...style
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: base,
    onClick: onClick,
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false)
  }, props), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Tag = __ds_scope.Tag;

})();
