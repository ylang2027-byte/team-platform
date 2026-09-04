import { useEffect, useState } from 'react'
import { subscribeToasts } from '../lib/toast.js'

export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(
    () =>
      subscribeToasts((item) => {
        setItems((s) => [...s, item])
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== item.id)), 3400)
      }),
    [],
  )

  return (
    <div className="toaster">
      {items.map((i) => (
        <div key={i.id} className={`toast toast-${i.type}`}>
          {i.message}
        </div>
      ))}
    </div>
  )
}
