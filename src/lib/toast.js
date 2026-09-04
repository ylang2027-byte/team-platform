let listeners = []
let seq = 0

export function toast(message, type = 'info') {
  const item = { id: ++seq, message, type }
  listeners.forEach((fn) => fn(item))
}

export function subscribeToasts(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}
