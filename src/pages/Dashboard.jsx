import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { fetchProducts, fetchListings } from '../lib/db.js'
import { fetchPromos } from '../lib/promos.js'
import { fetchSeedings } from '../lib/seeding.js'
import { fetchCalendarFeed } from '../lib/calendar.js'

const PROMO_STATUS = { review: '검토', applied: '신청함', confirmed: '확정', running: '진행 중' }
const OPEN_PROMO = new Set(['review', 'applied', 'confirmed'])

function pad(n) {
  return String(n).padStart(2, '0')
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dLabel(iso) {
  const [, m, d] = iso.split('-')
  return `${+m}/${+d}`
}
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((t - now) / 86400000)
}
function dTag(n) {
  if (n < 0) return `D+${-n}`
  if (n === 0) return 'D-DAY'
  return `D-${n}`
}

export default function Dashboard() {
  const { user } = useAuth()
  const name = user?.user_metadata?.name || user?.email?.split('@')[0] || ''

  const [data, setData] = useState({ products: [], listings: [], promos: [], seedings: [], events: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [products, listings, promos, seedings, events] = await Promise.all([
        fetchProducts().catch(() => []),
        fetchListings().catch(() => []),
        fetchPromos().catch(() => []),
        fetchSeedings().catch(() => []),
        fetchCalendarFeed().catch(() => []),
      ])
      if (!alive) return
      setData({ products, listings, promos, seedings, events })
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekEnd = new Date(today)
  weekEnd.setDate(today.getDate() + 6)
  const todayStr = ymd(today)
  const weekEndStr = ymd(weekEnd)

  // ── 최저가 미달 ──
  const priceAlerts = useMemo(() => {
    const { products, listings } = data
    const byId = new Map(products.map((p) => [p.id, p]))
    const lmap = new Map()
    for (const l of listings) lmap.set(l.product_id + ':' + l.channel_id, l)
    const eff = (l) => (l?.coupon_price != null ? l.coupon_price : l?.price ?? null)
    const out = []
    for (const p of products) {
      const base = p.base_product_id ? byId.get(p.base_product_id) : null
      const off = base ? p.price_offset || 0 : 0
      const floor = base ? (base.base_price != null ? base.base_price + off : null) : p.base_price
      if (floor == null) continue
      const srcId = base ? base.id : p.id
      let worst = null
      for (const l of listings) {
        if (l.product_id !== srcId) continue
        const v = eff(l)
        if (v == null) continue
        const adj = v + off
        if (adj < floor && (worst == null || adj < worst)) worst = adj
      }
      if (worst != null) out.push({ name: p.name, floor, worst })
    }
    return out.sort((a, b) => a.worst - a.floor - (b.worst - b.floor))
  }, [data])

  // ── 마감 임박 기획전 ──
  const promoSoon = useMemo(
    () =>
      data.promos
        .filter((p) => OPEN_PROMO.has(p.status) && p.submit_due && daysUntil(p.submit_due) <= 14 && daysUntil(p.submit_due) >= -3)
        .sort((a, b) => a.submit_due.localeCompare(b.submit_due)),
    [data.promos],
  )
  const applyPending = useMemo(
    () => data.promos.filter((p) => p.apply_status === 'pending'),
    [data.promos],
  )
  const promoRunning = useMemo(
    () => data.promos.filter((p) => p.status === 'running').length,
    [data.promos],
  )

  // ── 시딩 대기 ──
  const seedShip = data.seedings.filter((s) => s.status === 'accepted')
  const seedPost = data.seedings.filter((s) => s.status === 'shipped')

  // ── 이번 주 일정 (구글 캘린더 + 기획전) ──
  const weekEvents = useMemo(() => {
    const list = []
    for (const e of data.events) {
      if (e.end >= todayStr && e.start <= weekEndStr) {
        list.push({ start: e.start, end: e.end, title: e.title, time: e.allDay ? null : e.time, src: 'gcal' })
      }
    }
    for (const p of data.promos) {
      const s = p.start_date || p.end_date
      if (!s) continue
      const en = p.end_date || s
      if (en >= todayStr && s <= weekEndStr) list.push({ start: s, end: en, title: p.title, src: 'promo' })
    }
    return list.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
  }, [data, todayStr, weekEndStr])

  if (loading) {
    return (
      <div className="page">
        <div className="loading-row">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  const now = new Date()
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][now.getDay()]}요일`

  return (
    <div className="page">
      <h1 className="page-title">안녕하세요{name ? `, ${name}님` : ''}</h1>
      <p className="page-desc">{dateStr}</p>

      <div className="dash-stats">
        <StatCard to="/promos" label="마감 임박 기획전" value={promoSoon.length} tone={promoSoon.length ? 'warn' : ''} />
        <StatCard to="/promos" label="신청가 승인 대기" value={applyPending.length} tone={applyPending.length ? 'warn' : ''} />
        <StatCard to="/prices" label="최저가 미달" value={priceAlerts.length} tone={priceAlerts.length ? 'danger' : ''} />
        <StatCard to="/seeding" label="시딩 업로드 대기" value={seedPost.length} />
      </div>

      <div className="dash-grid">
        <Section title="이번 주 일정" to="/calendar" empty={weekEvents.length === 0 && '이번 주 등록된 일정이 없어요'}>
          {weekEvents.slice(0, 7).map((e, i) => (
            <div className="dash-row" key={i}>
              <span className="dash-date">{dLabel(e.start)}</span>
              <span className={'dash-dot ' + e.src} />
              <span className="dash-txt">
                {e.time && <em>{e.time} </em>}
                {e.title}
              </span>
            </div>
          ))}
          {weekEvents.length > 7 && <p className="dash-more">외 {weekEvents.length - 7}건</p>}
        </Section>

        <Section
          title="마감 임박 기획전"
          to="/promos"
          empty={promoSoon.length === 0 && '임박한 자료 마감이 없어요'}
        >
          {promoSoon.slice(0, 6).map((p) => {
            const n = daysUntil(p.submit_due)
            return (
              <div className="dash-row" key={p.id}>
                <span className={'dash-dtag' + (n <= 3 ? ' hot' : '')}>{dTag(n)}</span>
                <span className="dash-txt">
                  {p.title}
                  <em> · {p.channel} · {PROMO_STATUS[p.status]}</em>
                </span>
              </div>
            )
          })}
          {promoRunning > 0 && <p className="dash-more">진행 중 {promoRunning}건</p>}
        </Section>

        <Section title="최저가 미달" to="/prices" empty={priceAlerts.length === 0 && '모든 채널이 최저가 이상이에요'}>
          {priceAlerts.slice(0, 6).map((a, i) => (
            <div className="dash-row" key={i}>
              <span className="dash-txt">{a.name}</span>
              <span className="dash-num">
                <b>{a.worst.toLocaleString('ko-KR')}</b> / {a.floor.toLocaleString('ko-KR')}
              </span>
            </div>
          ))}
          {priceAlerts.length > 6 && <p className="dash-more">외 {priceAlerts.length - 6}건</p>}
        </Section>

        <Section title="시딩 진행" to="/seeding" empty={seedShip.length + seedPost.length === 0 && '발송·업로드 대기 없음'}>
          {seedShip.length > 0 && (
            <p className="dash-sub">발송 대기 {seedShip.length}명</p>
          )}
          {seedShip.slice(0, 3).map((s) => (
            <div className="dash-row" key={s.id}>
              <span className="dash-dot seed-ship" />
              <span className="dash-txt">{s.name}<em> · {s.product || '제품 미정'}</em></span>
            </div>
          ))}
          {seedPost.length > 0 && <p className="dash-sub" style={{ marginTop: 10 }}>업로드 대기 {seedPost.length}명</p>}
          {seedPost.slice(0, 3).map((s) => (
            <div className="dash-row" key={s.id}>
              <span className="dash-dot seed-post" />
              <span className="dash-txt">{s.name}<em> · {s.product || ''}</em></span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  )
}

function StatCard({ to, label, value, sub, tone }) {
  return (
    <Link to={to} className={'dash-stat' + (tone ? ' ' + tone : '')}>
      <span className="dash-stat-label">{label}</span>
      <span className="dash-stat-value">
        {value}
        {sub && <em>{sub}</em>}
      </span>
    </Link>
  )
}

function Section({ title, to, empty, children }) {
  return (
    <section className="dash-sec">
      <header className="dash-sec-head">
        <h2>{title}</h2>
        <Link to={to}>전체 →</Link>
      </header>
      {empty ? <p className="dash-empty">{empty}</p> : <div className="dash-list">{children}</div>}
    </section>
  )
}
