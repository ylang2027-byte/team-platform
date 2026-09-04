import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { fetchMyNotifications, markRead, subscribeNotifications } from '../lib/notifications.js'
import { toast } from '../lib/toast.js'

function rel(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.round(s / 60)}분 전`
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`
  return `${Math.round(s / 86400)}일 전`
}

export default function NotifBar() {
  const { profile, user, isMock } = useAuth()
  const me = profile?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || ''
  const [items, setItems] = useState([])
  const [collapsed, setCollapsed] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    if (!me) return
    try {
      const all = await fetchMyNotifications(me)
      setItems(all.filter((i) => !i.read))
    } catch {
      // ignore
    }
  }, [me])

  useEffect(() => {
    load()
    const unsub = subscribeNotifications(me, () => {
      load()
      toast('새 알림', 'ok')
    })
    return unsub
  }, [me, load])

  // 알림 없으면 자동으로 접고, 생기면 펼침
  useEffect(() => {
    setCollapsed(items.length === 0)
  }, [items.length])

  if (isMock) return null

  function open(it) {
    markRead([it.id])
    setItems((x) => x.filter((y) => y.id !== it.id))
    if (it.link) navigate(it.link)
  }
  function dismiss(e, it) {
    e.stopPropagation()
    markRead([it.id])
    setItems((x) => x.filter((y) => y.id !== it.id))
  }

  const empty = items.length === 0

  return (
    <div className={'notifbar' + (empty ? ' is-empty' : '') + (collapsed ? ' is-collapsed' : '')}>
      <div className="notifbar-inner">
        <div className="notifbar-bar">
          <span className="notifbar-label">
            알림
            {!empty && <span className="notifbar-count">{items.length}</span>}
          </span>
          <button
            className="notifbar-collapse"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '알림 펼치기' : '알림 접기'}
          >
            {collapsed ? '펼치기 ▾' : '접기 ▴'}
          </button>
        </div>

        <div className={'notifbar-collapsible' + (collapsed ? ' collapsed' : '')}>
          <div className="notifbar-clip">
            <div className="notifbar-list">
              {empty && <div className="notifbar-empty">새 알림이 없어요</div>}
              {items.map((it) => (
              <div
                key={it.id}
                className="notifbar-item"
                onClick={() => open(it)}
                role="button"
                tabIndex={0}
              >
                <span className="notifbar-dot" />
                <span className="notifbar-text">
                  <b>{it.title}</b>
                  {it.body && <span className="notifbar-body"> · {it.body}</span>}
                </span>
                <span className="notifbar-time">{rel(it.created_at)}</span>
                <button
                  className="notifbar-x"
                  onClick={(e) => dismiss(e, it)}
                  aria-label="알림 닫기"
                  title="닫기"
                >
                  ✕
                </button>
              </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
