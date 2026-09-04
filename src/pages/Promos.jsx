import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import {
  fetchPromos,
  createPromo,
  updatePromo,
  deletePromo,
  fetchPromoProducts,
  savePromoProducts,
  fetchPromoCoupons,
  savePromoCoupons,
} from '../lib/promos.js'
import { fetchProducts, fetchListings } from '../lib/db.js'
import { fetchProfiles } from '../lib/settings.js'
import { notify } from '../lib/notifications.js'
import { toast } from '../lib/toast.js'
import { useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'

const nf2 = new Intl.NumberFormat('ko-KR')
const toInt = (s) => {
  const d = String(s ?? '').replace(/[^0-9]/g, '')
  return d === '' ? null : parseInt(d, 10)
}
const add = (v, off) => (v != null ? v + off : null)
// 연동 제품까지 고려한 정상가 / 최저가 / 채널 최저 판매가(쿠폰 전)
function resolvePrices(p, byId, lbp) {
  const base = p.base_product_id ? byId.get(p.base_product_id) : null
  const off = base ? p.price_offset || 0 : 0
  const srcId = base ? base.id : p.id
  const src = base || p
  const chPrices = (lbp?.get(srcId) || [])
    .map((l) => l.price)
    .filter((v) => v != null)
    .map((v) => v + off)
  return {
    list: add(src.list_price, off),
    floor: add(src.base_price, off),
    channelMin: chPrices.length ? Math.min(...chPrices) : null,
  }
}
function roundPrice(n) {
  if (n == null) return null
  return Math.round(n / 10) * 10
}

// ── 쿠폰 스택 계산 ──
function couponDiscount(cur, c) {
  if ((c.min_order || 0) > 0 && cur < c.min_order) return 0
  if (c.kind === 'fixed') return Math.min(c.value || 0, cur)
  let d = Math.round((cur * (c.value || 0)) / 100)
  if (c.max_discount) d = Math.min(d, c.max_discount)
  return d
}
// 신청가 → { customer: 고객 최종가, ourCost: 우리 쿠폰 분담액, used: 적용된 쿠폰명[] }
// 규칙: 기본 그룹에서 1개 + 중복 그룹에서 1개, 각 그룹에서 할인액이 가장 큰 것만
function bestOfGroup(cur, list) {
  let bestC = null
  let bestD = 0
  for (const c of list) {
    const d = couponDiscount(cur, c)
    if (d > bestD) {
      bestD = d
      bestC = c
    }
  }
  return { bestC, bestD }
}
function computeFinal(applyPrice, coupons) {
  let cur = applyPrice
  let ourCost = 0
  const used = []
  const base = coupons.filter((c) => c.grp === 'base')
  const stack = coupons.filter((c) => c.grp !== 'base')
  for (const group of [base, stack]) {
    if (!group.length) continue
    const { bestC, bestD } = bestOfGroup(cur, group)
    if (bestC) {
      cur -= bestD
      ourCost += Math.round((bestD * (bestC.our_share || 0)) / 100)
      used.push(bestC.name)
    }
  }
  return { customer: Math.round(cur), ourCost, used }
}
// "2.5만원" "18만" "30,000원" → 숫자
function parseWon(s) {
  const t = String(s).replace(/,/g, '')
  let m = t.match(/([\d.]+)\s*만/)
  if (m) return Math.round(parseFloat(m[1]) * 10000)
  m = t.match(/(\d{3,})\s*원?/)
  return m ? parseInt(m[1], 10) : null
}
// 기획전 안내 메일 텍스트 → 쿠폰 행 자동 인식 (완벽하지 않음, 확인·수정 필요)
// 분담률(우리가 내는 %) 추출. "파트너 60 : 29CM 40", "파트너사 = 60", "29CM 100% 부담", "파트너 100% 부담"
function parseShare(line) {
  if (/29CM\s*100\s*%?\s*부?담?/i.test(line)) return 0
  if (/파트너\s*사?\s*100\s*%?\s*부담/i.test(line)) return 100
  const m = line.match(/파트너\s*사?\s*[=:]?\s*(\d{1,3})\s*[:：]\s*29CM/i) || line.match(/파트너\s*사?\s*[=:]?\s*(\d{1,3})/)
  if (m) return Math.min(100, parseInt(m[1], 10))
  return null
}
function parseCoupons(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[*_>│|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const out = []
  let cur = null
  const flush = () => {
    if (cur && cur.name && (cur.value || cur.kind === 'fixed')) out.push(cur)
    cur = null
  }
  for (const line of lines) {
    const pctM = line.match(/(\d+(?:\.\d+)?)\s*%/)
    const pct = pctM && !/(부담|타사)/.test(line) ? pctM : null // "100% 부담"·"타사 15%"는 할인율 아님
    const prose = /(합니다|됩니다|가능|경우|위해|예를|진행\s*시|통한|바랍니다|주세요|불가|정의|리프레시|목적|극대화|유도)/.test(
      line,
    )
    const isTitle =
      !prose &&
      /(쿠폰|타임딜|균일가)/.test(line) &&
      line.length < 55 &&
      /(^\[?\d|쿠폰\s*[:：(]|쿠폰$|쿠폰\s*운영|타임딜)/.test(line) &&
      !/(최대\s*할인|최소\s*주문|발급|사용\s*기간|수량|노출|운영안|참여|가이드|분담율|분담률)/.test(line)
    if (isTitle) {
      flush()
      // 중복 사용 "가능"이라고 명시된 경우만 stack, 나머지는 전부 base(택1)
      const stackable = /(중복\s*(적용|사용)?\s*가능|함께\s*사용|스택|장바구니\s*쿠폰과\s*중복)/.test(line)
      cur = {
        name: line
          .replace(/^[-•·\s]+/, '')
          .replace(/^\[[^\]]{0,8}\]\s*/, '')
          .replace(/[:：(].*$/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40),
        kind: 'percent',
        value: 0,
        max_discount: null,
        min_order: null,
        grp: stackable ? 'stack' : 'base',
        our_share: 0,
      }
      if (pct) cur.value = parseInt(pct[1], 10)
      else if (/(정액|만원|,\d{3}원)/.test(line)) {
        cur.kind = 'fixed'
        cur.value = parseWon(line) || 0
      }
      const sh = parseShare(line)
      if (sh != null) cur.our_share = sh
      continue
    }
    if (!cur) continue
    if (/최대\s*할인/.test(line)) {
      const v = parseWon(line)
      if (v) cur.max_discount = v
    }
    if (/최소\s*주문\s*금액/.test(line) || /최소주문금액/.test(line)) {
      const v = parseWon(line)
      if (v) cur.min_order = v
    }
    const sh = parseShare(line)
    if (sh != null) cur.our_share = sh
    if (pct && cur.kind === 'percent' && !cur.value) cur.value = parseInt(pct[1], 10)
    if (cur.kind === 'fixed' && !cur.value) {
      const v = parseWon(line)
      if (v) cur.value = v
    }
  }
  flush()
  return out
}

// 고객 최종가 ≈ target 이 되는 신청가 역산 (이분탐색, 100원 올림)
function solveApply(target, list, coupons) {
  if (target == null) return null
  let lo = target
  let hi = Math.max((list || 0) * 1.6, target * 4)
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2
    if (computeFinal(mid, coupons).customer < target) lo = mid
    else hi = mid
  }
  return Math.ceil(hi / 100) * 100
}

const CHANNELS = ['무신사', '29CM', 'W컨셉', '지그재그', '네이버', '자사몰', '기타']
const STATUS = [
  { id: 'review', label: '검토' },
  { id: 'applied', label: '신청함' },
  { id: 'confirmed', label: '확정' },
  { id: 'running', label: '진행 중' },
  { id: 'done', label: '종료' },
  { id: 'skip', label: '미진행' },
]
const statusLabel = Object.fromEntries(STATUS.map((s) => [s.id, s.label]))
const OPEN_STATUS = new Set(['review', 'applied', 'confirmed'])
// 승인 흐름에 따라 기획전 상태를 앞으로만 올림 (뒤로는 안 되돌림)
const STATUS_ORDER = ['review', 'applied', 'confirmed', 'running', 'done']
function bumpStatus(cur, target) {
  const c = STATUS_ORDER.indexOf(cur)
  const t = STATUS_ORDER.indexOf(target)
  if (t === -1) return null
  if (c === -1 || c < t) return target
  return null
}
// 반려 시: 승인으로 올라갔던 '신청함'·'확정'만 '검토'로 되돌림 (진행 중/종료는 그대로)
function demoteOnReject(cur) {
  return cur === 'applied' || cur === 'confirmed' ? 'review' : null
}

function fmt(iso) {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return `${+m}/${+d}`
}
function fmtDT(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`
}
function dueInfo(iso, status) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((due - now) / 86400000)
  const text = `${m}/${d}`
  if (!OPEN_STATUS.has(status)) return { text, level: 'muted' }
  if (diff < 0) return { text, level: 'over', tag: `D+${-diff}` }
  if (diff <= 3) return { text, level: 'soon', tag: diff === 0 ? 'D-DAY' : `D-${diff}` }
  return { text, level: 'none', tag: `D-${diff}` }
}

function readErr(e) {
  const m = e?.message || String(e)
  if (/apply_(created|updated)_at/i.test(m)) {
    return "'apply_created_at' 칸이 없습니다. supabase/migrations/0018_apply_timestamps.sql 을 실행한 뒤 새로고침하세요."
  }
  if (/apply_status|apply_note/i.test(m) && /(column|schema cache|does not exist|Could not find)/i.test(m)) {
    return "신청가 승인 칸이 없습니다. supabase/migrations/0013_apply_approval.sql 을 실행하세요."
  }
  if (/does not exist/i.test(m) || /Could not find the table/i.test(m) || /schema cache/i.test(m)) {
    return 'DB 테이블이 없습니다. supabase/migrations/0007_promos.sql 을 SQL Editor에서 실행하세요.'
  }
  if (/JWT|not authenticated/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return m
}

const APPLY_BADGE = {
  pending: { t: '승인 대기', c: 'warn' },
  approved: { t: '승인됨', c: 'ok' },
  rejected: { t: '반려됨', c: 'danger' },
}

export default function Promos() {
  const { user, profile, isAdmin } = useAuth()
  const me = profile?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || ''

  const [promos, setPromos] = useState([])
  const [products, setProducts] = useState([])
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [applyModal, setApplyModal] = useState(null)
  const [statFilter, setStatFilter] = useState(null) // null | open | applied | running | pending
  const [adminNames, setAdminNames] = useState([])
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    try {
      const [ps, prods, ls, profs] = await Promise.all([
        fetchPromos(),
        fetchProducts().catch(() => []),
        fetchListings().catch(() => []),
        fetchProfiles().catch(() => []),
      ])
      setPromos(ps)
      setProducts(prods)
      setListings(ls)
      setAdminNames(profs.filter((p) => p.role === 'admin' && p.name).map((p) => p.name))
      setError('')
    } catch (e) {
      setError(readErr(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // /promos?apply=<id> 딥링크 → 신청가 화면 바로 열기
  useEffect(() => {
    const id = params.get('apply')
    if (id && promos.some((p) => p.id === id)) {
      setApplyModal({ id })
      params.delete('apply')
      setParams(params, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promos])

  const assignees = useMemo(
    () => [...new Set(promos.map((p) => p.assignee).filter(Boolean))].sort(),
    [promos],
  )

  const isOpen = (p) => OPEN_STATUS.has(p.status) || p.status === 'running'

  const stats = useMemo(
    () => ({
      open: promos.filter(isOpen).length,
      applied: promos.filter((p) => p.status === 'applied').length,
      running: promos.filter((p) => p.status === 'running').length,
      pending: promos.filter((p) => p.apply_status === 'pending').length,
      rejected: promos.filter((p) => p.apply_status === 'rejected').length,
    }),
    [promos],
  )

  const rows = useMemo(() => {
    let list
    if (statFilter === 'all') list = [...promos]
    else if (statFilter === 'open') list = promos.filter(isOpen)
    else if (statFilter === 'applied') list = promos.filter((p) => p.status === 'applied')
    else if (statFilter === 'running') list = promos.filter((p) => p.status === 'running')
    else if (statFilter === 'pending') list = promos.filter((p) => p.apply_status === 'pending')
    else if (statFilter === 'rejected') list = promos.filter((p) => p.apply_status === 'rejected')
    else list = promos.filter((p) => isOpen(p) || p.apply_status === 'rejected')
    return [...list].sort((a, b) => {
      const ad = a.submit_due || '9999-12-31'
      const bd = b.submit_due || '9999-12-31'
      if (ad !== bd) return ad < bd ? -1 : 1
      return (a.start_date || '') < (b.start_date || '') ? -1 : 1
    })
  }, [promos, statFilter])

  const soonCount = promos.filter((p) => {
    const di = dueInfo(p.submit_due, p.status)
    return di && (di.level === 'soon' || di.level === 'over')
  }).length

  async function save(values) {
    if (modal.mode === 'edit') {
      const row = await updatePromo(modal.promo.id, values)
      setPromos((ps) => ps.map((x) => (x.id === row.id ? row : x)))
      toast('저장했어요', 'ok')
      setModal(null)
    } else {
      const row = await createPromo({ ...values, created_by: me })
      setPromos((ps) => [...ps, row])
      toast('추가했어요 — 이어서 신청가를 작성하세요', 'ok')
      setModal(null)
      setApplyModal(row) // 등록 직후 바로 신청가 계산 화면
    }
  }
  async function remove() {
    const id = modal.promo.id
    await deletePromo(id)
    setPromos((ps) => ps.filter((x) => x.id !== id))
    setModal(null)
    toast('삭제했어요', 'ok')
  }

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">기획전</h1>
          <p className="page-desc">
            진행·검토 중 {stats.open}건
            {soonCount > 0 && <span className="desc-flag"> · 마감 임박 {soonCount}건</span>}
          </p>
        </div>
        <div className="head-actions">
          <Button size="sm" onClick={() => setModal({ mode: 'new' })}>
            ＋ 기획전 추가
          </Button>
        </div>
      </div>

      {!loading && (
        <div className="dash-stats promo-stats">
          {[
            { k: 'all', label: '전체', v: promos.length },
            { k: 'open', label: '진행 중인 기획전', v: stats.open },
            { k: 'applied', label: '신청 완료', v: stats.applied },
            { k: 'running', label: '진행 중', v: stats.running },
            { k: 'pending', label: '승인 대기', v: stats.pending, tone: stats.pending ? 'warn' : '' },
            { k: 'rejected', label: '반려', v: stats.rejected, tone: stats.rejected ? 'danger' : '' },
          ].map((s) => (
            <button
              key={s.k}
              className={
                'dash-stat' + (s.tone ? ' ' + s.tone : '') + (statFilter === s.k ? ' active' : '')
              }
              onClick={() => setStatFilter((f) => (f === s.k ? null : s.k))}
            >
              <span className="dash-stat-label">{s.label}</span>
              <span className="dash-stat-value">{s.v}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder-title">표시할 기획전이 없어요</p>
          <p>‘＋ 기획전 추가’로 등록하세요.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ptable promos">
            <thead>
              <tr>
                <th>상태</th>
                <th>채널</th>
                <th className="col-name">기획전명</th>
                <th className="num">자료 마감</th>
                <th className="num">진행 기간</th>
                <th>할인 조건</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const di = dueInfo(p.submit_due, p.status)
                return (
                  <tr
                    key={p.id}
                    className="promo-row"
                    onClick={() => setModal({ mode: 'edit', promo: p })}
                  >
                    <td>
                      <span className={'pstat pstat-' + p.status}>{statusLabel[p.status]}</span>
                    </td>
                    <td>{p.channel || '—'}</td>
                    <td className="col-name">
                      {p.title}
                      {APPLY_BADGE[p.apply_status] && (
                        <span className={'apply-badge ' + APPLY_BADGE[p.apply_status].c}>
                          {APPLY_BADGE[p.apply_status].t}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {di ? (
                        <span className={'pdue ' + di.level}>
                          {di.text}
                          {di.tag && di.level !== 'none' && <em> {di.tag}</em>}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num period">
                      {p.start_date || p.end_date
                        ? `${fmt(p.start_date) || '?'} – ${fmt(p.end_date) || '?'}`
                        : '—'}
                    </td>
                    <td className="discount">{p.discount || '—'}</td>
                    <td>{p.assignee || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <PromoModal
          key={modal.promo?.id || 'new'}
          modal={modal}
          assignees={assignees}
          onSave={save}
          onDelete={remove}
          onApply={
            modal.mode === 'edit'
              ? () => {
                  const pr = modal.promo
                  setModal(null)
                  setApplyModal(pr)
                }
              : null
          }
          onClose={() => setModal(null)}
        />
      )}

      {applyModal && (
        <ApplyPriceModal
          promo={promos.find((x) => x.id === applyModal.id) || applyModal}
          promos={promos}
          products={products}
          listings={listings}
          me={me}
          isAdmin={isAdmin}
          adminNames={adminNames}
          onSavedPromo={(patch) =>
            setPromos((ps) => ps.map((x) => (x.id === applyModal.id ? { ...x, ...patch } : x)))
          }
          onClose={() => setApplyModal(null)}
        />
      )}
    </div>
  )
}

function PromoModal({ modal, assignees, onSave, onDelete, onApply, onClose }) {
  const isNew = modal.mode === 'new'
  const p = modal.promo
  const [channel, setChannel] = useState(p?.channel || '무신사')
  const [title, setTitle] = useState(p?.title || '')
  const [status, setStatus] = useState(p?.status || 'review')
  const [submitDue, setSubmitDue] = useState(p?.submit_due || '')
  const [start, setStart] = useState(p?.start_date || '')
  const [end, setEnd] = useState(p?.end_date || '')
  const [discount, setDiscount] = useState(p?.discount || '')
  const [assignee, setAssignee] = useState(p?.assignee || '')
  const [memo, setMemo] = useState(p?.memo || '')
  const [link, setLink] = useState(p?.link || '')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setErr('기획전명을 입력하세요.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await onSave({
        channel,
        title: title.trim(),
        status,
        submit_due: submitDue || null,
        start_date: start || null,
        end_date: end || null,
        discount: discount.trim() || null,
        assignee: assignee.trim() || null,
        memo: memo.trim() || null,
        link: link.trim() || null,
      })
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? '기획전 추가' : '기획전'}
      width={520}
      onClose={onClose}
      footer={
        <>
          {!isNew &&
            (confirmDel ? (
              <Button variant="danger" onClick={onDelete} loading={busy}>
                정말 삭제
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDel(true)}>
                삭제
              </Button>
            ))}
          {!isNew && !confirmDel && onApply && (
            <Button variant="ghost" onClick={onApply}>
              신청가 계산
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="promoform" loading={busy}>
            {isNew ? '추가' : '저장'}
          </Button>
        </>
      }
    >
      <form id="promoform" onSubmit={submit} className="form-col">
        {!isNew && p?.apply_status && p.apply_status !== 'draft' && APPLY_BADGE[p.apply_status] && (
          <div
            className={
              'approve-bar ' +
              (p.apply_status === 'approved'
                ? 'approved'
                : p.apply_status === 'rejected'
                  ? 'reject'
                  : 'pending')
            }
          >
            <b>신청가 {APPLY_BADGE[p.apply_status].t}</b>
            <span>
              {p.apply_status === 'approved' &&
                [p.apply_approved_by, fmtDT(p.apply_approved_at)].filter(Boolean).join(' · ')}
              {p.apply_status === 'pending' &&
                ([p.apply_requested_by, fmtDT(p.apply_requested_at)].filter(Boolean).join(' · ') ||
                  `${p.assignee || '담당자'} 검토 중`)}
              {p.apply_status === 'rejected' && (p.apply_note ? `사유: ${p.apply_note}` : '사유 없음')}
            </span>
          </div>
        )}
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">채널</label>
            <select className="field-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="field-label">상태</label>
            <select className="field-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fld">
          <label className="field-label">기획전명</label>
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 무신사 FW 브랜드 위크"
            autoFocus
          />
        </div>
        <div className="fld">
          <label className="field-label">자료 제출 마감일</label>
          <input
            type="date"
            className="field-input"
            value={submitDue}
            onChange={(e) => setSubmitDue(e.target.value)}
          />
        </div>
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">진행 시작</label>
            <input type="date" className="field-input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="fld">
            <label className="field-label">진행 종료</label>
            <input type="date" className="field-input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="fld">
          <label className="field-label">할인 조건</label>
          <input
            className="field-input"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="예: 즉시 20% + 쿠폰 10%"
          />
        </div>
        <div className="fld">
          <label className="field-label">담당자</label>
          <input
            className="field-input"
            list="promo-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="이름"
          />
          <datalist id="promo-assignee">
            {assignees.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="fld">
          <label className="field-label">메모</label>
          <textarea
            className="field-input ta"
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="MD 연락처, 참여 상품, 진행 조건 등"
          />
        </div>
        <div className="fld">
          <label className="field-label">링크</label>
          <input
            className="field-input"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
          />
        </div>
        {link && (
          <a className="promo-link" href={link} target="_blank" rel="noreferrer">
            링크 열기 ↗
          </a>
        )}
        {err && <p className="field-error">{err}</p>}
      </form>
    </Modal>
  )
}

function CouponEditor({ coupons, setCoupons, otherPromos, onCopyFrom }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const upd = (i, patch) => setCoupons((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const del = (i) => setCoupons((cs) => cs.filter((_, idx) => idx !== i))
  const addC = () =>
    setCoupons((cs) => [
      ...cs,
      { name: '', kind: 'percent', value: 0, max_discount: null, min_order: null, grp: 'stack', our_share: 0 },
    ])
  function runParse() {
    const found = parseCoupons(pasteText)
    if (!found.length) {
      toast('쿠폰을 인식하지 못했어요. 형식을 확인하거나 직접 추가하세요.', 'warn')
      return
    }
    setCoupons((cs) => [...cs, ...found])
    setPasteText('')
    setPasteOpen(false)
    toast(`${found.length}개 인식했어요 — 구분(기본/중복)·값·분담%를 꼭 확인하세요`, 'ok')
  }
  return (
    <div className="cpn-box">
      <div className="cpn-topbar">
        <b>쿠폰</b>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="opt-add" onClick={() => setPasteOpen((v) => !v)}>
            📋 메일 붙여넣기
          </button>
          {otherPromos.length > 0 && (
            <select
              className="mini-input"
              value=""
              onChange={(e) => e.target.value && onCopyFrom(e.target.value)}
            >
              <option value="">다른 기획전에서 복사…</option>
              {otherPromos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {pasteOpen && (
        <div className="cpn-paste">
          <textarea
            className="field-input ta"
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="기획전 안내 메일의 쿠폰 스킴 부분을 그대로 붙여넣으세요"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button type="button" size="sm" onClick={runParse} disabled={!pasteText.trim()}>
              분석해서 추가
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
              닫기
            </Button>
          </div>
          <p className="hint-sm" style={{ marginTop: 6 }}>
            자동 인식은 <b>대략적인 초안</b>이에요. 특히 <b>구분(기본/중복)</b>·값·한도·최소금액·분담%를
            메일 원문과 하나씩 대조해서 고치세요. 복잡한 메일은 절반 이상 손봐야 할 수 있어요.
          </p>
        </div>
      )}
      {coupons.length > 0 && (
        <div className="cpn-row cpn-head">
          <span>쿠폰명</span>
          <span>구분</span>
          <span>유형</span>
          <span className="num">값</span>
          <span className="num">한도</span>
          <span className="num">최소금액</span>
          <span className="num">분담%</span>
          <span />
        </div>
      )}
      {coupons.map((c, i) => (
        <div className="cpn-row" key={i}>
          <label className="cpn-f cpn-f-name">
            <span>쿠폰명</span>
            <input
              className="mini-input"
              placeholder="예: 카테고리데이 30%"
              value={c.name}
              onChange={(e) => upd(i, { name: e.target.value })}
            />
          </label>
          <label className="cpn-f">
            <span>구분</span>
            <select className="mini-input" value={c.grp} onChange={(e) => upd(i, { grp: e.target.value })}>
              <option value="base">기본</option>
              <option value="stack">중복</option>
            </select>
          </label>
          <label className="cpn-f">
            <span>유형</span>
            <select className="mini-input" value={c.kind} onChange={(e) => upd(i, { kind: e.target.value })}>
              <option value="percent">정률%</option>
              <option value="fixed">정액원</option>
            </select>
          </label>
          <label className="cpn-f">
            <span>값</span>
            <input
              className="mini-input num"
              inputMode="numeric"
              value={c.value || ''}
              onChange={(e) => upd(i, { value: toInt(e.target.value) || 0 })}
            />
          </label>
          <label className="cpn-f">
            <span>한도</span>
            <input
              className="mini-input num"
              inputMode="numeric"
              placeholder="—"
              disabled={c.kind !== 'percent'}
              value={c.max_discount || ''}
              onChange={(e) => upd(i, { max_discount: toInt(e.target.value) })}
            />
          </label>
          <label className="cpn-f">
            <span>최소금액</span>
            <input
              className="mini-input num"
              inputMode="numeric"
              placeholder="—"
              value={c.min_order || ''}
              onChange={(e) => upd(i, { min_order: toInt(e.target.value) })}
            />
          </label>
          <label className="cpn-f">
            <span>분담%</span>
            <input
              className="mini-input num"
              inputMode="numeric"
              value={c.our_share || ''}
              onChange={(e) => upd(i, { our_share: toInt(e.target.value) || 0 })}
            />
          </label>
          <button type="button" className="link-danger" onClick={() => del(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="opt-add" onClick={addC}>
        ＋ 쿠폰 추가
      </button>
      {coupons.length > 0 && (
        <p className="hint-sm" style={{ marginTop: 4 }}>
          <b>기본</b>·<b>중복</b> 각 그룹에서 할인액이 가장 큰 쿠폰 1개씩만 적용 (최대 2개). 분담% = 그 쿠폰 할인액 중 우리가 내는 비율
        </p>
      )}
    </div>
  )
}

function ApplyPriceModal({ promo, promos, products, listings, me, isAdmin, adminNames = [], onSavedPromo, onClose }) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lbp = useMemo(() => {
    const m = new Map()
    for (const l of listings) {
      if (!m.has(l.product_id)) m.set(l.product_id, [])
      m.get(l.product_id).push(l)
    }
    return m
  }, [listings])
  const otherPromos = useMemo(
    () => (promos || []).filter((p) => p.id !== promo.id),
    [promos, promo.id],
  )

  const [reqDisc, setReqDisc] = useState(promo.discount_rate != null ? String(promo.discount_rate) : '')
  const [coupons, setCoupons] = useState([])
  const [rows, setRows] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reqD = reqDisc === '' ? null : parseInt(reqDisc, 10)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [pp, cps] = await Promise.all([fetchPromoProducts(promo.id), fetchPromoCoupons(promo.id)])
        if (!alive) return
        const m = {}
        for (const r of pp) m[r.product_id] = { included: true, apply: r.apply_price != null ? String(r.apply_price) : '' }
        setRows(m)
        setCoupons(cps.map((c) => ({ ...c })))
      } catch (e) {
        setErr(readErr(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [promo.id])

  const setRow = (id, patch) =>
    setRows((r) => ({ ...r, [id]: { included: false, apply: '', ...(r[id] || {}), ...patch } }))

  function calcApply(list, floor) {
    const t1 = solveApply(floor, list, coupons)
    const t2 = list != null && reqD != null ? Math.floor((list * (1 - reqD / 100)) / 100) * 100 : null
    if (t1 == null) return t2
    if (t2 != null && t2 < t1) return t2
    return t1
  }
  function autoFill() {
    setRows(() => {
      const next = {}
      for (const p of products) {
        const { list, floor } = resolvePrices(p, byId, lbp)
        const v = calcApply(list, floor)
        if (v != null) next[p.id] = { included: true, apply: String(v) }
      }
      return next
    })
  }
  async function copyFrom(pid) {
    try {
      const cps = await fetchPromoCoupons(pid)
      setCoupons(
        cps.map((c) => ({
          name: c.name,
          kind: c.kind,
          value: c.value,
          max_discount: c.max_discount,
          min_order: c.min_order,
          grp: c.grp,
          our_share: c.our_share,
        })),
      )
      toast('쿠폰을 복사했어요', 'ok')
    } catch (e) {
      toast(readErr(e), 'warn')
    }
  }

  const [status, setStatus] = useState(promo.apply_status || 'draft')
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  // 관리자는 본인 요청도 승인 가능. 담당자는 본인이 요청한 건 승인 불가.
  const canApprove =
    status === 'pending' &&
    (isAdmin || (me && promo.assignee && me === promo.assignee && promo.apply_requested_by !== me))

  async function save(statusPatch, quiet) {
    setBusy(true)
    setErr('')
    try {
      const promoPatch = {}
      const newReq = reqDisc === '' ? null : reqD
      if ((promo.discount_rate ?? null) !== newReq) promoPatch.discount_rate = newReq
      const now = new Date().toISOString()
      promoPatch.apply_updated_at = now
      if (!promo.apply_created_at) promoPatch.apply_created_at = now
      Object.assign(promoPatch, statusPatch || {})
      if (Object.keys(promoPatch).length) {
        await updatePromo(promo.id, promoPatch)
        onSavedPromo(promoPatch)
      }
      await savePromoCoupons(
        promo.id,
        coupons.filter((c) => c.name.trim()),
      )
      const payload = Object.entries(rows)
        .filter(([, v]) => v.included)
        .map(([product_id, v]) => ({ product_id, apply_price: toInt(v.apply) }))
      await savePromoProducts(promo.id, payload)
      if (!quiet) toast('임시저장했어요', 'ok')
      return true
    } catch (e) {
      setErr(readErr(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function requestApproval() {
    if (included === 0) {
      setErr('신청가를 먼저 입력하세요.')
      return
    }
    const patch = {
      apply_status: 'pending',
      apply_requested_by: me || null,
      apply_requested_at: new Date().toISOString(),
      apply_approved_by: null,
      apply_approved_at: null,
      apply_note: null,
    }
    const sb = bumpStatus(promo.status, 'review')
    if (sb) patch.status = sb
    if (await save(patch, true)) {
      setStatus('pending')
      // 담당자가 지정돼 있으면 담당자에게, 없으면 관리자 전원에게 알림 (본인 제외)
      const hasAssignee = promo.assignee && promo.assignee !== me
      const targets = hasAssignee
        ? [promo.assignee]
        : [...new Set(adminNames)].filter((n) => n && n !== me)
      if (targets.length) {
        targets.forEach((name) =>
          notify(name, {
            type: 'apply_request',
            title: `신청가 승인 요청 · ${promo.title}`,
            body: `${me || '누군가'}님이 승인을 요청했어요`,
            link: `/promos?apply=${promo.id}`,
          }),
        )
        toast(`승인 요청했어요 — ${hasAssignee ? '담당자' : '관리자'}에게 알림을 보냈습니다`, 'ok')
      } else {
        toast('승인 요청했어요 (알림 받을 담당자·관리자가 없어요)', 'warn')
      }
      onClose()
    }
  }
  async function decide(approved) {
    const note = rejectNote.trim()
    const patch = approved
      ? { apply_status: 'approved', apply_approved_by: me || null, apply_approved_at: new Date().toISOString() }
      : { apply_status: 'rejected', apply_note: note || null }
    if (approved) {
      const sb = bumpStatus(promo.status, 'applied') // 승인 = 신청가 확정 → '신청함'
      if (sb) patch.status = sb
    } else {
      const sb = demoteOnReject(promo.status) // 반려 = 다시 '검토'로
      if (sb) patch.status = sb
    }
    setBusy(true)
    try {
      await updatePromo(promo.id, patch)
      onSavedPromo(patch)
      setStatus(patch.apply_status)
      if (promo.apply_requested_by && promo.apply_requested_by !== me) {
        notify(promo.apply_requested_by, {
          type: approved ? 'apply_approved' : 'apply_rejected',
          title: `신청가 ${approved ? '승인됨' : '반려됨'} · ${promo.title}`,
          body: approved ? `${me}님이 승인했어요` : `사유: ${note || '없음'}`,
          link: `/promos?apply=${promo.id}`,
        })
      }
      toast(approved ? '승인했어요' : '반려했어요', approved ? 'ok' : 'warn')
      onClose()
    } catch (e) {
      setErr(readErr(e))
      setBusy(false)
    }
  }

  const included = Object.values(rows).filter((v) => v.included).length
  const allOn = products.length > 0 && products.every((p) => rows[p.id]?.included)
  function toggleAll() {
    setRows((prev) => {
      const next = { ...prev }
      for (const p of products) {
        if (allOn) next[p.id] = { ...(next[p.id] || { apply: '' }), included: false }
        else {
          const { list, floor, channelMin } = resolvePrices(p, byId, lbp)
          const cur = next[p.id]
          next[p.id] = { included: true, apply: cur?.apply || String(calcApply(list, floor) ?? channelMin ?? '') }
        }
      }
      return next
    })
  }

  return (
    <Modal
      title={`${promo.title} · 신청가`}
      width={820}
      onClose={onClose}
      footer={
        rejecting ? (
          <>
            <input
              className="field-input"
              style={{ flex: 1 }}
              placeholder="반려 사유 (선택)"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              autoFocus
            />
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              취소
            </Button>
            <Button variant="danger" size="sm" onClick={() => decide(false)} loading={busy}>
              반려 확정
            </Button>
          </>
        ) : (
        <>
          <Button variant="ghost" size="sm" className="btn-outline" onClick={autoFill}>
            최저가 맞춰 자동
          </Button>
          <span className="spacer" />
          {canApprove ? (
            <>
              <Button variant="danger" onClick={() => setRejecting(true)} loading={busy}>
                반려
              </Button>
              <Button onClick={() => decide(true)} loading={busy}>
                승인
              </Button>
            </>
          ) : status === 'pending' ? (
            <>
              <Button variant="ghost" onClick={() => save(null)} loading={busy}>
                임시저장
              </Button>
              <Button variant="ghost" disabled>
                승인 대기 중
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="btn-outline" onClick={() => save(null)} loading={busy}>
                임시저장
              </Button>
              <Button onClick={requestApproval} loading={busy}>
                {status === 'approved' || status === 'rejected' ? '다시 승인 요청' : '승인 요청'}
              </Button>
            </>
          )}
        </>
        )
      }
    >
      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : (
        <>
          {status === 'pending' && (
            <div className="approve-bar pending">
              <b>승인 대기</b>
              <span>
                {promo.apply_requested_by || '?'} 요청
                {promo.apply_requested_at
                  ? ` · ${new Date(promo.apply_requested_at).toLocaleDateString('ko-KR')}`
                  : ''}
                {canApprove ? ' · 검토 후 승인/반려하세요' : ` · ${promo.assignee || '담당자'} 승인 대기 중`}
              </span>
            </div>
          )}
          {status === 'approved' && (
            <div className="approve-bar approved">
              <b>승인됨</b>
              <span>
                {promo.apply_approved_by || ''}
                {promo.apply_approved_at
                  ? ` · ${new Date(promo.apply_approved_at).toLocaleDateString('ko-KR')}`
                  : ''}
              </span>
            </div>
          )}
          {status === 'rejected' && (
            <div className="approve-bar reject">
              <b>반려됨</b>
              <span>{promo.apply_note ? `사유: ${promo.apply_note}` : '사유 없음'} · 수정 후 다시 승인 요청하세요</span>
            </div>
          )}

          {(promo.apply_created_at || promo.apply_requested_at || promo.apply_approved_at) && (
            <dl className="apply-log">
              {promo.apply_created_at && (
                <div>
                  <dt>작성</dt>
                  <dd>{fmtDT(promo.apply_created_at)}</dd>
                </div>
              )}
              {promo.apply_updated_at && promo.apply_updated_at !== promo.apply_created_at && (
                <div>
                  <dt>최종 수정</dt>
                  <dd>{fmtDT(promo.apply_updated_at)}</dd>
                </div>
              )}
              {promo.apply_requested_at && (
                <div>
                  <dt>승인 요청</dt>
                  <dd>
                    {promo.apply_requested_by ? `${promo.apply_requested_by} · ` : ''}
                    {fmtDT(promo.apply_requested_at)}
                  </dd>
                </div>
              )}
              {promo.apply_approved_at && (
                <div>
                  <dt>승인</dt>
                  <dd>
                    {promo.apply_approved_by ? `${promo.apply_approved_by} · ` : ''}
                    {fmtDT(promo.apply_approved_at)}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="fld" style={{ maxWidth: 180, marginBottom: 12 }}>
            <label className="field-label">요구 즉시할인율 (%)</label>
            <input
              className="field-input"
              inputMode="numeric"
              value={reqDisc}
              onChange={(e) => setReqDisc(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="예: 10"
            />
          </div>

          <CouponEditor
            coupons={coupons}
            setCoupons={setCoupons}
            otherPromos={otherPromos}
            onCopyFrom={copyFrom}
          />

          <p className="hint-sm" style={{ margin: '14px 0 8px' }}>
            <b>최저가 맞춰 자동</b> = 쿠폰 다 붙었을 때 <b>고객 최종가 = 최저가</b> 가 되도록 신청가 역산.
            요구 즉시할인율을 못 채우면 <b>정상가 × (1−요구율)</b> 강제 (이땐 고객가가 최저가보다 낮아짐 🔴).
          </p>

          {products.length === 0 ? (
            <p className="chart-empty">먼저 가격 비교에서 제품을 등록하세요.</p>
          ) : (
            <div className="apply-table apply-v2">
              <div className="apply-head">
                <span>
                  <input type="checkbox" checked={allOn} onChange={toggleAll} title="전체 선택" />
                </span>
                <span>제품 / 최저가</span>
                <span className="num">정상가</span>
                <span className="num">신청가</span>
                <span className="num">즉시할인</span>
                <span className="num">고객 최종가</span>
                <span>확인</span>
              </div>
              {products.map((p) => {
                const { list, floor, channelMin } = resolvePrices(p, byId, lbp)
                const row = rows[p.id] || { included: false, apply: '' }
                const apply = toInt(row.apply)
                const discRate = list && apply ? Math.round((1 - apply / list) * 100) : null
                const res = apply != null ? computeFinal(apply, coupons) : null
                const customer = res ? res.customer : null
                const custBelow = floor != null && customer != null && customer < floor
                const discShort = reqD != null && discRate != null && discRate < reqD
                return (
                  <div className={'apply-row' + (row.included ? ' on' : '')} key={p.id}>
                    <span className="ap-chk" data-label="포함">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={(e) =>
                          setRow(p.id, {
                            included: e.target.checked,
                            apply:
                              e.target.checked && !row.apply
                                ? String(calcApply(list, floor) ?? channelMin ?? '')
                                : row.apply,
                          })
                        }
                      />
                    </span>
                    <span className="ap-name">
                      {p.name}
                      <em>{floor != null ? nf2.format(floor) : '최저가 미설정'}</em>
                    </span>
                    <span className="num" data-label="정상가">{list != null ? nf2.format(list) : '—'}</span>
                    <span className="num" data-label="신청가">
                      <input
                        className="ap-input"
                        inputMode="numeric"
                        disabled={!row.included}
                        value={row.apply ? nf2.format(toInt(row.apply)) : ''}
                        onChange={(e) => setRow(p.id, { apply: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                    </span>
                    <span className={'num' + (discShort ? ' ap-bad' : '')} data-label="즉시할인">
                      {discRate != null ? discRate + '%' : '—'}
                    </span>
                    <span
                      className={'num' + (custBelow ? ' ap-bad' : '')}
                      data-label="고객 최종가"
                      title={res && res.used.length ? '적용: ' + res.used.join(' + ') : undefined}
                    >
                      {customer != null ? nf2.format(customer) : '—'}
                    </span>
                    <span className="ap-flag" data-label="확인">
                      {row.included && apply != null && custBelow && <em className="bad">최저가 미달</em>}
                      {row.included && apply != null && !custBelow && discShort && (
                        <em className="warn">할인율 부족</em>
                      )}
                      {row.included && apply != null && !custBelow && !discShort && <em className="ok">OK</em>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="hint-sm" style={{ marginTop: 12 }}>
            선택 {included}개 · 🔴 고객 최종가 &lt; 최저가 · 🟠 즉시할인율이 요구치보다 낮음
          </p>
        </>
      )}
      {err && <p className="field-error">{err}</p>}
    </Modal>
  )
}
