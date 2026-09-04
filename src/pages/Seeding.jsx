import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { fetchSeedings, createSeeding, updateSeeding, deleteSeeding } from '../lib/seeding.js'
import { fetchProducts } from '../lib/db.js'
import { toast } from '../lib/toast.js'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'

const PLATFORMS = ['인스타그램', '유튜브', '틱톡', '샤오홍슈', '블로그', '스레드', '기타']
const STATUS = [
  { id: 'candidate', label: '후보' },
  { id: 'contacted', label: '컨택함' },
  { id: 'accepted', label: '수락' },
  { id: 'shipped', label: '발송' },
  { id: 'posted', label: '업로드' },
  { id: 'done', label: '완료' },
  { id: 'declined', label: '거절·보류' },
]
const statusLabel = Object.fromEntries(STATUS.map((s) => [s.id, s.label]))
const statusRank = Object.fromEntries(STATUS.map((s, i) => [s.id, i]))
const ACTIVE = new Set(['candidate', 'contacted', 'accepted', 'shipped', 'posted'])

const nf = new Intl.NumberFormat('ko-KR')
function fmtFollowers(n) {
  if (n == null) return '—'
  if (n >= 10000) {
    const v = n / 10000
    return `${v % 1 === 0 ? v : v.toFixed(1)}만`
  }
  return nf.format(n)
}
function fmtDate(iso) {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${+m}/${+d}`
}
function toInt(s) {
  const digits = String(s ?? '').replace(/[^0-9]/g, '')
  return digits === '' ? null : parseInt(digits, 10)
}
// 발송 제품 목록: 새 products 배열 우선, 없으면 옛 product 텍스트
function prodListOf(r) {
  if (Array.isArray(r?.products) && r.products.length) return r.products
  return r?.product ? [r.product] : []
}
function readErr(e) {
  const m = e?.message || String(e)
  if (/\bproducts\b/i.test(m) && /(column|schema cache|does not exist|Could not find)/i.test(m)) {
    return "'products' 칸이 없습니다. supabase/migrations/0015_seeding_products.sql 을 실행한 뒤 새로고침하세요."
  }
  if (/does not exist/i.test(m) || /Could not find the table/i.test(m) || /schema cache/i.test(m)) {
    return 'DB 테이블이 없습니다. supabase/migrations/0009_seeding.sql 을 SQL Editor에서 실행하세요.'
  }
  if (/JWT|not authenticated/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return m
}

export default function Seeding() {
  const { user } = useAuth()
  const me = user?.user_metadata?.name || user?.email?.split('@')[0] || ''

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState([])
  const [platformFilter, setPlatformFilter] = useState([])
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' })
  const [view, setView] = useState('list')
  const [groupBy, setGroupBy] = useState('none') // none | status | platform
  const [filterOpen, setFilterOpen] = useState(false)
  const [products, setProducts] = useState([])

  const load = useCallback(async () => {
    try {
      const [seeds, prods] = await Promise.all([fetchSeedings(), fetchProducts().catch(() => [])])
      setRows(seeds)
      setProducts(prods)
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

  const assignees = useMemo(
    () => [...new Set(rows.map((r) => r.assignee).filter(Boolean))].sort(),
    [rows],
  )

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const cmp = (a, b, key) => {
      switch (key) {
        case 'status':
          return statusRank[a.status] - statusRank[b.status]
        case 'followers':
          return (a.followers || 0) - (b.followers || 0)
        case 'ship_date':
        case 'post_date':
          return (a[key] || '').localeCompare(b[key] || '')
        default:
          return (a[key] || '').localeCompare(b[key] || '', 'ko')
      }
    }
    return rows
      .filter((r) => {
        const closed = r.status === 'done' || r.status === 'declined'
        // 완료·거절은 그 상태를 직접 골랐을 때만 표시
        if (closed && !statusFilter.includes(r.status)) return false
        if (statusFilter.length && !statusFilter.includes(r.status)) return false
        if (platformFilter.length && !platformFilter.includes(r.platform || '미지정')) return false
        if (ql && !`${r.name} ${r.handle || ''}`.toLowerCase().includes(ql)) return false
        return true
      })
      .sort((a, b) => {
        const r = cmp(a, b, sort.key) || cmp(a, b, 'name')
        return sort.dir === 'asc' ? r : -r
      })
  }, [rows, q, statusFilter, platformFilter, sort])

  const groups = useMemo(() => {
    if (groupBy === 'none') return null
    const map = new Map()
    for (const r of list) {
      const key = groupBy === 'status' ? r.status : r.platform || '미지정'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    const order =
      groupBy === 'status'
        ? STATUS.map((s) => s.id)
        : [...PLATFORMS, '미지정']
    const known = order.filter((k) => map.has(k))
    const extra = [...map.keys()].filter((k) => !order.includes(k))
    return [...known, ...extra].map((key) => ({
      key,
      label: groupBy === 'status' ? statusLabel[key] || key : key,
      rows: map.get(key),
    }))
  }, [list, groupBy])

  const fcount = statusFilter.length + platformFilter.length
  const toggleIn = (setter) => (id) =>
    setter((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]))
  const toggleStatus = toggleIn(setStatusFilter)
  const togglePlatform = toggleIn(setPlatformFilter)

  function toggleSort(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'followers' ? 'desc' : 'asc' },
    )
  }

  const counts = useMemo(() => {
    const c = { total: rows.length, active: 0, shipWait: 0, postWait: 0 }
    for (const r of rows) {
      if (ACTIVE.has(r.status)) c.active++
      if (r.status === 'accepted') c.shipWait++
      if (r.status === 'shipped') c.postWait++
    }
    return c
  }, [rows])


  function Th({ k, children, num, className = '' }) {
    const active = sort.key === k
    return (
      <th
        className={[num ? 'num' : '', 'sortable', active ? 'active' : '', className].filter(Boolean).join(' ')}
        onClick={() => toggleSort(k)}
      >
        {children}
        <span className="sort-caret">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    )
  }

  const renderRow = (r) => (
    <tr key={r.id} className="promo-row" onClick={() => setModal({ mode: 'edit', row: r })}>
      <td>
        <span className={'pstat sstat-' + r.status}>{statusLabel[r.status]}</span>
      </td>
      <td className="col-name">
        {r.name}
        {r.handle && <span className="sku">{r.handle}</span>}
      </td>
      <td>{r.platform || '—'}</td>
      <td className="num">{fmtFollowers(r.followers)}</td>
      <td className="discount">
        {prodListOf(r).length ? (
          <span className="prod-chips">
            {prodListOf(r).map((name) => (
              <span className="prod-chip" key={name}>
                {name}
              </span>
            ))}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="num">{fmtDate(r.ship_date)}</td>
      <td className="num">
        {r.post_date ? fmtDate(r.post_date) : '—'}
        {r.post_url && (
          <a
            className="seed-link"
            href={r.post_url}
            target="_blank"
            rel="noreferrer"
            title="업로드 게시물 열기"
            onClick={(e) => e.stopPropagation()}
          >
            {' '}
            🔗
          </a>
        )}
      </td>
      <td>{r.assignee || '—'}</td>
    </tr>
  )

  async function save(values) {
    if (modal.mode === 'edit') {
      const row = await updateSeeding(modal.row.id, values)
      setRows((rs) => rs.map((x) => (x.id === row.id ? row : x)))
      toast('저장했어요', 'ok')
    } else {
      const row = await createSeeding({ ...values, created_by: me })
      setRows((rs) => [...rs, row])
      toast('추가했어요', 'ok')
    }
    setModal(null)
  }
  async function remove() {
    const id = modal.row.id
    await deleteSeeding(id)
    setRows((rs) => rs.filter((x) => x.id !== id))
    setModal(null)
    toast('삭제했어요', 'ok')
  }

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">인플루언서 시딩</h1>
          <p className="page-desc">
            진행 중 {counts.active}명
            {counts.shipWait > 0 && <span className="desc-flag"> · 발송 대기 {counts.shipWait}</span>}
            {counts.postWait > 0 && <span> · 업로드 대기 {counts.postWait}</span>}
          </p>
        </div>
        <div className="head-actions">
          <div className="seg-toggle">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              리스트
            </button>
            <button className={view === 'stats' ? 'on' : ''} onClick={() => setView('stats')}>
              성과
            </button>
          </div>
          <Button size="sm" onClick={() => setModal({ mode: 'new' })}>
            ＋ 인플루언서 추가
          </Button>
        </div>
      </div>

      {view === 'stats' &&
        (loading ? (
          <div className="loading-row">
            <div className="spinner" />
          </div>
        ) : (
          <SeedingStats rows={rows} />
        ))}

      {view === 'list' && (
      <>
      <div className="seed-filters">
        <input
          className="seed-search"
          placeholder="이름·핸들 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className={'filter-btn' + (filterOpen ? ' open' : '') + (fcount ? ' has' : '')}
          onClick={() => setFilterOpen((v) => !v)}
        >
          필터{fcount ? ` ${fcount}` : ''}
          <span className="filter-caret">{filterOpen ? '▴' : '▾'}</span>
        </button>
        {statusFilter.map((s) => (
          <button key={s} className="active-chip" onClick={() => toggleStatus(s)}>
            {statusLabel[s]} ✕
          </button>
        ))}
        {platformFilter.map((p) => (
          <button key={p} className="active-chip" onClick={() => togglePlatform(p)}>
            {p} ✕
          </button>
        ))}
        {fcount > 1 && (
          <button
            className="active-chip clear"
            onClick={() => {
              setStatusFilter([])
              setPlatformFilter([])
            }}
          >
            전체 해제
          </button>
        )}
        <div className="seg-toggle seg-sm group-seg">
          <button className={groupBy === 'none' ? 'on' : ''} onClick={() => setGroupBy('none')}>
            전체
          </button>
          <button className={groupBy === 'status' ? 'on' : ''} onClick={() => setGroupBy('status')}>
            상태별
          </button>
          <button className={groupBy === 'platform' ? 'on' : ''} onClick={() => setGroupBy('platform')}>
            플랫폼별
          </button>
        </div>
      </div>

      {filterOpen && (
        <div className="filter-panel">
          <div className="fp-row">
            <span className="fp-lab">상태</span>
            <div className="fgroup">
              {STATUS.map((s) => (
                <button
                  key={s.id}
                  className={'fpill' + (statusFilter.includes(s.id) ? ' on' : '')}
                  onClick={() => toggleStatus(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-row">
            <span className="fp-lab">플랫폼</span>
            <div className="fgroup">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  className={'fpill' + (platformFilter.includes(p) ? ' on' : '')}
                  onClick={() => togglePlatform(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : list.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder-title">표시할 인플루언서가 없어요</p>
          <p>‘＋ 인플루언서 추가’로 시딩 대상을 등록하세요.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ptable promos">
            <thead>
              <tr>
                <Th k="status">상태</Th>
                <Th k="name" className="col-name">이름</Th>
                <Th k="platform">플랫폼</Th>
                <Th k="followers" num>팔로워</Th>
                <Th k="product">발송 제품</Th>
                <Th k="ship_date" num>발송일</Th>
                <Th k="post_date" num>업로드</Th>
                <Th k="assignee">담당자</Th>
              </tr>
            </thead>
            {groups ? (
              groups.map((g) => (
                <tbody key={g.key}>
                  <tr className="tgroup-head">
                    <td colSpan={8}>
                      {g.label}
                      <span className="tgroup-count">{g.rows.length}</span>
                    </td>
                  </tr>
                  {g.rows.map(renderRow)}
                </tbody>
              ))
            ) : (
              <tbody>{list.map(renderRow)}</tbody>
            )}
          </table>
        </div>
      )}
      </>
      )}

      {modal && (
        <SeedModal
          key={modal.row?.id || 'new'}
          modal={modal}
          assignees={assignees}
          products={products}
          onSave={save}
          onDelete={remove}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function ProductPicker({ all, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const remove = (name) => onChange(value.filter((n) => n !== name))
  const add = (name) => onChange([...value, name])
  const available = all.filter((p) => !value.includes(p.name))

  return (
    <div className="prodpick" ref={ref}>
      <div
        className={'prodpick-box' + (open ? ' open' : '')}
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
      >
        {value.length === 0 && <span className="prodpick-ph">등록된 제품에서 선택</span>}
        {value.map((name) => (
          <span className="prodpick-chip" key={name}>
            {name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                remove(name)
              }}
              aria-label="제거"
            >
              ✕
            </button>
          </span>
        ))}
        <span className="prodpick-caret">▾</span>
      </div>
      {open && (
        <div className="prodpick-menu">
          {all.length === 0 ? (
            <p className="prodpick-empty">가격 비교에 등록된 제품이 없어요</p>
          ) : available.length === 0 ? (
            <p className="prodpick-empty">모든 제품을 선택했어요</p>
          ) : (
            available.map((p) => (
              <button
                type="button"
                key={p.id}
                className="prodpick-opt"
                onClick={() => add(p.name)}
              >
                <span>{p.name}</span>
                {p.sku && <span className="prodpick-sku">{p.sku}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function SeedModal({ modal, assignees, products, onSave, onDelete, onClose }) {
  const isNew = modal.mode === 'new'
  const r = modal.row
  const [name, setName] = useState(r?.name || '')
  const [handle, setHandle] = useState(r?.handle || '')
  const [platform, setPlatform] = useState(r?.platform || '인스타그램')
  const [followers, setFollowers] = useState(r?.followers != null ? String(r.followers) : '')
  const [status, setStatus] = useState(r?.status || 'candidate')
  const [productList, setProductList] = useState(prodListOf(r))
  const [shipDate, setShipDate] = useState(r?.ship_date || '')
  const [postDate, setPostDate] = useState(r?.post_date || '')
  const [postUrl, setPostUrl] = useState(r?.post_url || '')
  const [assignee, setAssignee] = useState(r?.assignee || '')
  const [memo, setMemo] = useState(r?.memo || '')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setErr('이름을 입력하세요.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await onSave({
        name: name.trim(),
        handle: handle.trim() || null,
        platform,
        followers: toInt(followers),
        status,
        products: productList,
        product: productList[0] || null,
        ship_date: shipDate || null,
        post_date: postDate || null,
        post_url: postUrl.trim() || null,
        assignee: assignee.trim() || null,
        memo: memo.trim() || null,
      })
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? '인플루언서 추가' : name || '인플루언서'}
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
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="seedform" loading={busy}>
            {isNew ? '추가' : '저장'}
          </Button>
        </>
      }
    >
      <form id="seedform" onSubmit={submit} className="form-col">
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">이름 / 계정명</label>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="fld">
            <label className="field-label">핸들</label>
            <input
              className="field-input"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@id"
            />
          </div>
        </div>
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">플랫폼</label>
            <select className="field-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="field-label">팔로워</label>
            <input
              className="field-input"
              inputMode="numeric"
              value={followers ? nf.format(toInt(followers)) : ''}
              onChange={(e) => setFollowers(e.target.value)}
              placeholder="예: 25000"
            />
          </div>
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
        <div className="fld">
          <label className="field-label">발송 제품</label>
          <ProductPicker all={products || []} value={productList} onChange={setProductList} />
        </div>
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">발송일</label>
            <input type="date" className="field-input" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </div>
          <div className="fld">
            <label className="field-label">업로드일</label>
            <input type="date" className="field-input" value={postDate} onChange={(e) => setPostDate(e.target.value)} />
          </div>
        </div>
        <div className="fld">
          <label className="field-label">업로드 링크</label>
          <input
            className="field-input"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://"
          />
        </div>
        <div className="fld">
          <label className="field-label">담당자</label>
          <input
            className="field-input"
            list="seed-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="이름"
          />
          <datalist id="seed-assignee">
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
            placeholder="컨택 채널, 조건, 특이사항 등"
          />
        </div>
        {postUrl && (
          <a className="promo-link" href={postUrl} target="_blank" rel="noreferrer">
            업로드 게시물 열기 ↗
          </a>
        )}
        {err && <p className="field-error">{err}</p>}
      </form>
    </Modal>
  )
}

function SeedingStats({ rows }) {
  const has = (arr) => (s) => arr.includes(s.status)
  const gotProduct = rows.filter(has(['shipped', 'posted', 'done']))
  const posted = rows.filter(has(['posted', 'done']))
  const contacted = rows.filter((s) => s.status !== 'candidate')
  const responded = rows.filter(has(['accepted', 'shipped', 'posted', 'done']))

  const respRate = contacted.length ? Math.round((responded.length / contacted.length) * 100) : 0
  const postRate = gotProduct.length ? Math.round((posted.length / gotProduct.length) * 100) : 0
  const totalFollowers = rows.reduce((a, r) => a + (r.followers || 0), 0)

  const byStatus = STATUS.map((s) => ({ ...s, n: rows.filter((r) => r.status === s.id).length }))
  const maxN = Math.max(1, ...byStatus.map((s) => s.n))

  const byPlatform = {}
  rows.forEach((r) => {
    if (r.platform) byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1
  })
  const byProduct = {}
  posted.forEach((r) => {
    const ps = prodListOf(r)
    if (ps.length === 0) ps.push('미지정')
    ps.forEach((p) => {
      byProduct[p] = (byProduct[p] || 0) + 1
    })
  })
  const recent = rows
    .filter((r) => r.post_date)
    .sort((a, b) => b.post_date.localeCompare(a.post_date))
    .slice(0, 6)

  return (
    <div className="seed-stats">
      <div className="stat-row">
        <div className="stat-box">
          <div className="k">응답률</div>
          <div className="v">
            {respRate}%<small>{responded.length}/{contacted.length}</small>
          </div>
        </div>
        <div className="stat-box">
          <div className="k">업로드율</div>
          <div className="v">
            {postRate}%<small>{posted.length}/{gotProduct.length}</small>
          </div>
        </div>
        <div className="stat-box">
          <div className="k">업로드 완료</div>
          <div className="v">{posted.length}<small>명</small></div>
        </div>
        <div className="stat-box">
          <div className="k">합산 팔로워</div>
          <div className="v">{fmtFollowers(totalFollowers)}</div>
        </div>
      </div>

      <div className="funnel">
        <p className="funnel-title">파이프라인</p>
        {byStatus.map((s) => (
          <div className="funnel-row" key={s.id}>
            <span className="lab">{s.label}</span>
            <span className="bar" style={{ width: `${(s.n / maxN) * 62}%` }} />
            <span className="cnt">{s.n}</span>
          </div>
        ))}
      </div>

      <div className="mini-grid">
        <div className="mini">
          <p className="mini-title">플랫폼별</p>
          {Object.entries(byPlatform)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div className="mini-row" key={k}>
                <span>{k}</span>
                <span>{v}명</span>
              </div>
            ))}
        </div>
        <div className="mini">
          <p className="mini-title">제품별 업로드</p>
          {Object.keys(byProduct).length === 0 ? (
            <p className="dash-empty">아직 없음</p>
          ) : (
            Object.entries(byProduct)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div className="mini-row" key={k}>
                  <span>{k}</span>
                  <span>{v}건</span>
                </div>
              ))
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mini" style={{ marginTop: 14 }}>
          <p className="mini-title">최근 업로드</p>
          {recent.map((r) => (
            <div className="mini-row" key={r.id}>
              <span>
                {fmtDate(r.post_date)} · {r.name}
              </span>
              <span>{prodListOf(r).join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
