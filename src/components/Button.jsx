export default function Button({ children, variant = 'primary', size, loading, disabled, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className].filter(Boolean).join(' ')
  return (
    <button className={classes} disabled={loading || disabled} {...props}>
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : children}
    </button>
  )
}
