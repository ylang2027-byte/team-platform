export function initial(s) {
  const t = String(s || '').trim()
  return t ? t[0].toUpperCase() : '?'
}

export default function Avatar({ name, email, url, size = 34, className = '' }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (url) {
    return (
      <img
        className={('avatar avatar-img ' + className).trim()}
        style={style}
        src={url}
        alt={name || ''}
      />
    )
  }
  return (
    <span className={('avatar ' + className).trim()} style={style}>
      {initial(name || email)}
    </span>
  )
}
