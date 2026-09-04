import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCalendarFeed } from '../lib/calendar.js'
import { fetchPromos } from '../lib/promos.js'
import Modal from '../components/Modal.jsx'

const WD = ['일', '월', '화', '수', '목', '금', '토']
const SRC_LABEL = { gcal: '구글 캘린더', promo: '기획전' }

function pad(n) {
  return String(n).padStart(2, '0')
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Calendar() {
  const navigate = useNavigate()
  const today = new Date()
  const todayStr = ymd(today)
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [feed, setFeed] = useState([])
  const [promos, setPromos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [show, setShow] = useState({ gcal: true, promo: true })
  const [dayModal, setDayModal] = useState(null)
  const [evModal, setEvModal] = useState(null)
  const [hoverId, setHoverId] = useState(null) // 마우스 올린 일정 id (이어진 막대 전부 강조)
  const [expanded, setExpanded] = useState(() => new Set()) // 펼친 주 인덱스

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [f, p] = await Promise.all([
        fetchCalendarFeed().catch((e) => {
          if (alive) setErr(e.message || String(e))
          return []
        }),
        fetchPromos().catch(() => []),
      ])
      if (!alive) return
      setFeed(f)
      setPromos(p)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const events = useMemo(() => {
    const list = []
    if (show.gcal) {
      for (const e of feed) {
        list.push({
          id: 'g-' + e.uid,
          title: e.title,
          start: e.start,
          end: e.end,
          time: e.allDay ? null : e.time,
          source: 'gcal',
        })
      }
    }
    if (show.promo) {
      for (const p of promos) {
        const s = p.start_date || p.end_date
        if (!s) continue
        list.push({
          id: 'p-' + p.id,
          title: p.title,
          start: s,
          end: p.end_date || s,
          time: null,
          source: 'promo',
          sub: p.channel,
        })
      }
    }
    return list
  }, [feed, promos, show])

  const first = new Date(cursor.y, cursor.m, 1)
  const gridStart = new Date(cursor.y, cursor.m, 1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7))

  const eventsOn = (dstr) =>
    events
      .filter((e) => dstr >= e.start && dstr <= e.end)
      .sort((a, b) => {
        const rank = { gcal: 0, promo: 1 }
        if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source]
        return (a.start || '').localeCompare(b.start || '')
      })

  const MAX_LANES = 4
  function placeWeek(week, isExpanded) {
    const cap = isExpanded ? Infinity : MAX_LANES
    const ws = ymd(week[0])
    const we = ymd(week[6])
    const inWeek = events
      .filter((e) => e.end >= ws && e.start <= we)
      .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
    const lanes = []
    const bars = []
    for (const e of inWeek) {
      let sc = 0
      let ec = 6
      for (let i = 0; i < 7; i++) {
        if (ymd(week[i]) === e.start) sc = i
        if (ymd(week[i]) === e.end) ec = i
      }
      if (e.start < ws) sc = 0
      if (e.end > we) ec = 6
      let lane = lanes.findIndex((l) => l.every(([s, en]) => ec < s || sc > en))
      if (lane === -1) {
        lane = lanes.length
        lanes.push([])
      }
      lanes[lane].push([sc, ec])
      if (lane < cap) {
        bars.push({
          ev: e,
          lane,
          sc,
          ec,
          contL: e.start < ws,
          contR: e.end > we,
          anchor: e.start < ws ? ws : e.start,
        })
      }
    }
    const shown = week.map((d, di) => bars.filter((b) => di >= b.sc && di <= b.ec).length)
    const overflow = week.map((d, di) => {
      const dstr = ymd(d)
      const total = events.filter((x) => dstr >= x.start && dstr <= x.end).length
      return Math.max(0, total - shown[di])
    })
    return { bars, overflow, shown, laneCount: Math.min(lanes.length, cap) }
  }

  const toggleWeek = (wi) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(wi)) next.delete(wi)
      else next.add(wi)
      return next
    })

  const move = (delta) => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
    setExpanded(new Set())
  }
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }))

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">일정</h1>
          <p className="page-desc">구글 캘린더 · 기획전 · 업무 마감을 한눈에</p>
        </div>
        <div className="head-actions">
          <button
            className="chip-toggle"
            onClick={() => {
              setCursor({ y: today.getFullYear(), m: today.getMonth() })
              setExpanded(new Set())
            }}
          >
            오늘
          </button>
          <div className="cal-nav">
            <button onClick={() => move(-1)} aria-label="이전 달">
              ‹
            </button>
            <strong>
              {cursor.y}. {cursor.m + 1}
            </strong>
            <button onClick={() => move(1)} aria-label="다음 달">
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="cal-legend">
        {['gcal', 'promo'].map((k) => (
          <button
            key={k}
            className={'leg leg-' + k + (show[k] ? '' : ' off')}
            onClick={() => toggle(k)}
          >
            <i />
            {SRC_LABEL[k]}
          </button>
        ))}
      </div>

      {err && <div className="banner-error">{err}</div>}

      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : (
        <div className="cal-wrap">
          <div className="cal-grid cal-dow">
            {WD.map((w, i) => (
              <div key={w} className={'cal-dowcell' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>
                {w}
              </div>
            ))}
          </div>
          <div className={'cal-body' + (hoverId ? ' has-hover' : '')}>
            {weeks.map((week, wi) => {
              const isExp = expanded.has(wi)
              const placed = placeWeek(week, isExp)
              const anyMore = placed.overflow.some((n) => n > 0)
              const contentRows = Math.max(4, placed.laneCount + (anyMore || isExp ? 1 : 0))
              return (
                <div
                  className={'cal-week' + (isExp ? ' expanded' : '')}
                  key={wi}
                  style={{ gridTemplateRows: `22px repeat(${contentRows}, 21px)` }}
                >
                  {week.map((d, di) => {
                    const dstr = ymd(d)
                    const inMonth = d.getMonth() === cursor.m
                    const evs = eventsOn(dstr)
                    return (
                      <button
                        key={'bg' + dstr}
                        className={
                          'cal-daybg' +
                          (inMonth ? '' : ' dim') +
                          (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '')
                        }
                        style={{ gridColumn: di + 1, gridRow: '1 / -1' }}
                        onClick={() => evs.length && setDayModal({ dstr, evs })}
                      />
                    )
                  })}
                  {week.map((d, di) => (
                    <span
                      key={'n' + di}
                      className={
                        'cal-date' +
                        (d.getMonth() === cursor.m ? '' : ' dim') +
                        (ymd(d) === todayStr ? ' today' : '') +
                        (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '')
                      }
                      style={{ gridColumn: di + 1, gridRow: 1 }}
                    >
                      {d.getDate()}
                    </span>
                  ))}
                  {placed.bars.map((b, i) => (
                    <span
                      key={b.ev.id + i}
                      className={
                        'cal-bar ' +
                        b.ev.source +
                        (b.contL ? ' cont-l' : '') +
                        (b.contR ? ' cont-r' : '') +
                        (hoverId === b.ev.id ? ' hot' : '')
                      }
                      style={{ gridColumn: `${b.sc + 1} / span ${b.ec - b.sc + 1}`, gridRow: b.lane + 2 }}
                      onMouseEnter={() => setHoverId(b.ev.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEvModal(b.ev)
                      }}
                    >
                      {b.ev.time && <em>{b.ev.time}</em>} {b.ev.title}
                    </span>
                  ))}
                  {!isExp &&
                    placed.overflow.map((n, di) =>
                      n > 0 ? (
                        <button
                          key={'m' + di}
                          className="cal-more"
                          style={{ gridColumn: di + 1, gridRow: placed.shown[di] + 2 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleWeek(wi)
                          }}
                        >
                          +{n}
                        </button>
                      ) : null,
                    )}
                  {isExp && (
                    <button
                      className="cal-collapse"
                      style={{ gridColumn: '1 / -1', gridRow: contentRows + 1 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleWeek(wi)
                      }}
                    >
                      접기 ▴
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dayModal && (
        <Modal
          title={dayModal.dstr.replace(/-/g, '. ')}
          width={420}
          onClose={() => setDayModal(null)}
          footer={null}
        >
          <div className="day-list">
            {dayModal.evs.map((e) => (
              <button
                key={e.id}
                className="day-item"
                onClick={() => {
                  setDayModal(null)
                  setEvModal(e)
                }}
              >
                <span className={'day-dot ' + e.source} />
                <div>
                  <p className="day-title">
                    {e.time && <span className="day-time">{e.time}</span>} {e.title}
                  </p>
                  <p className="day-sub">
                    {SRC_LABEL[e.source]}
                    {e.sub ? ` · ${e.sub}` : ''}
                    {e.start !== e.end ? ` · ${e.start.slice(5)} ~ ${e.end.slice(5)}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {evModal && (
        <Modal title="일정" width={380} onClose={() => setEvModal(null)} footer={null}>
          <div className="ev-card">
            <span className={'ev-tag ' + evModal.source}>{SRC_LABEL[evModal.source]}</span>
            <h3 className="ev-title">
              {evModal.time && <span className="ev-time">{evModal.time}</span>}
              {evModal.title}
            </h3>
            <dl className="ev-meta">
              <div>
                <dt>날짜</dt>
                <dd>
                  {evModal.start === evModal.end
                    ? evModal.start.replace(/-/g, '. ')
                    : `${evModal.start.replace(/-/g, '. ')} – ${evModal.end.replace(/-/g, '. ')}`}
                </dd>
              </div>
              {evModal.sub && (
                <div>
                  <dt>채널</dt>
                  <dd>{evModal.sub}</dd>
                </div>
              )}
            </dl>
            {evModal.source === 'promo' && (
              <button className="ev-go" onClick={() => navigate('/promos')}>
                기획전 관리에서 보기 →
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
