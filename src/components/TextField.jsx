import { useId } from 'react'

export default function TextField({ label, error, className = '', ...props }) {
  const id = useId()
  return (
    <div className="field">
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}
      <input
        id={id}
        className={['field-input', error ? 'has-error' : '', className].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}
