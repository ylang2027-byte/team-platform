import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchChannels,
  fetchProducts,
  fetchListings,
  createProduct,
  updateProduct,
  deleteProduct,
  upsertListing,
  extractPrice,
  refreshListing,
  fetchProductHistory,
  fetchAllPriceHistory,
} from '../lib/db.js'
import { toast } from '../lib/toast.js'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'
import TextField from '../components/TextField.jsx'
import LineChart from '../components/LineChart.jsx'

const CH_COLORS = ['#33684a', '#a8548c', '#3f6fb2', '#c1552f', '#7d6cc0', '#2f8f7e', '#c0842c', '#4e5968']

const nf = new Intl.NumberFormat('ko-KR')
const won = (n) => (n == null || n === '' ? '—' : '₩' + nf.format(n))
const signed = (n) => (n == null ? '' : (n >= 0 ? '+' : '') + nf.format(n))

// 쿠폰적용가가 있으면 그것, 없으면 판매가
const effective = (l) => (l?.coupon_price != null ? l.coupon_price : l?.price ?? null)
const effectivePrices = (l) => {
  if (!l) return []
  if (Array.isArray(l.options) && l.options.length) {
    return l.options.map((o) => (o.coupon_price != null ? o.coupon_price : o.price)).filter((p) => p != null)
  }
  const e = effective(l)
  return e != null ? [e] : []
}
const hasOptions = (l) => Array.isArray(l?.options) && l.options.length > 0

const toInt = (s) => {
  const digits = String(s ?? '').replace(/[^0-9]/g, '')
  return digits === '' ? null : parseInt(digits, 10)
}
const toSignedInt = (s) => {
  let t = String(s ?? '').replace(/[^0-9-]/g, '')
  t = (t.startsWith('-') ? '-' : '') + t.replace(/-/g, '')
  if (t === '' || t === '-') return null
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

function fmtWhen(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const mins = Math.round((now - d) / 60000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const day =
    d.toDateString() === now.toDateString()
      ? '오늘'
      : d.toDateString() === y.toDateString()
        ? '어제'
        : `${d.getMonth() + 1}/${d.getDate()}`
  let rel
  if (mins < 1) rel = '방금'
  else if (mins < 60) rel = `${mins}분 전`
  else if (mins < 1440) rel = `${Math.round(mins / 60)}시간 전`
  else rel = `${Math.round(mins / 1440)}일 전`
  return `${day} ${hh}:${mm} · ${rel}`
}

function readErr(e) {
  const m = e?.message || String(e)
  if (/base_product_id|price_offset|list_price/i.test(m)) {
    return '가격 연동 칸이 없습니다. supabase/migrations/0004_product_variant.sql 을 SQL Editor에서 실행한 뒤 새로고침하세요.'
  }
  if (/coupon_price/i.test(m)) {
    return "'coupon_price' 칸이 없습니다. 0002_coupon_price.sql 을 실행한 뒤 새로고침하세요."
  }
  if (/does not exist/i.test(m) || /Could not find the (table|.*column)/i.test(m) || /schema cache/i.test(m)) {
    return 'DB 스키마가 최신이 아닙니다. supabase/migrations 의 SQL 을 순서대로 실행하세요.'
  }
  if (/JWT|not authenticated|Auth session/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return m
}

function priceText(l, eps) {
  if (!eps.length) return '—'
  if (hasOptions(l) && eps.length > 1) {
    const lo = Math.min(...eps)
    const hi = Math.max(...eps)
    return lo !== hi ? `${nf.format(lo)}–${nf.format(hi)}` : nf.format(lo)
  }
  return nf.format(eps[0])
}
function cellTip(l) {
  if (!l) return undefined
  if (l.coupon_price != null && l.price != null) {
    return `판매가 ${nf.format(l.price)} → 쿠폰적용가 ${nf.format(l.coupon_price)}`
  }
  return undefined
}

// price_history + 현재가로 채널별 시계열 만들기
function buildChannelSeries({ productListings, history, channels, offset = 0 }) {
  const listingCh = new Map(productListings.map((l) => [l.id, l.channel_id]))
  const byCh = new Map()
  for (const h of history) {
    const chId = listingCh.get(h.listing_id)
    if (!chId) continue
    const eff = h.coupon_price != null ? h.coupon_price : h.price
    if (eff == null) continue
    if (!byCh.has(chId)) byCh.set(chId, [])
    byCh.get(chId).push({ x: new Date(h.recorded_at).getTime(), y: eff + offset })
  }
  for (const l of productListings) {
    const eff = l.coupon_price != null ? l.coupon_price : l.price
    if (eff == null) continue
    if (!byCh.has(l.channel_id)) byCh.set(l.channel_id, [])
    const arr = byCh.get(l.channel_id)
    if (!arr.length || arr[arr.length - 1].y !== eff + offset) arr.push({ x: Date.now(), y: eff + offset })
  }
  return channels
    .filter((c) => byCh.has(c.id))
    .map((c) => ({
      name: c.name,
      color: CH_COLORS[channels.indexOf(c) % CH_COLORS.length],
      points: byCh.get(c.id).slice().sort((a, b) => a.x - b.x),
    }))
}

export default function Prices() {
  const [channels, setChannels] = useState([])
  const [products, setProducts] = useState([])
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productModal, setProductModal] = useState(null)
  const [cellModal, setCellModal] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [refreshing, setRefreshing] = useState(null)
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [view, setView] = useState('table')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ch, pr, ls] = await Promise.all([fetchChannels(), fetchProducts(), fetchListings()])
      setChannels(ch)
      setProducts(pr)
      setListings(ls)
    } catch (e) {
      setError(readErr(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const listingMap = useMemo(() => {
    const m = new Map()
    for (const l of listings) m.set(l.product_id + ':' + l.channel_id, l)
    return m
  }, [listings])

  const productById = useMemo(() => {
    const m = new Map()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const baseOf = (p) => (p?.base_product_id ? productById.get(p.base_product_id) : null)
  const offsetOf = (p) => (p?.base_product_id ? p.price_offset || 0 : 0)

  const listPriceOf = (p) => {
    const b = baseOf(p)
    if (b) return b.list_price != null ? b.list_price + offsetOf(p) : null
    return p.list_price ?? null
  }
  const floorOf = (p) => {
    const b = baseOf(p)
    if (b) return b.base_price != null ? b.base_price + offsetOf(p) : null
    return p.base_price ?? null
  }

  // (제품, 채널) 의 표시용 listing. 연동 제품이면 원본 listing + 추가금.
  const cellData = (p, channelId) => {
    const b = baseOf(p)
    if (b) {
      const bl = listingMap.get(b.id + ':' + channelId)
      if (!bl) return null
      const off = offsetOf(p)
      const shift = (v) => (v != null ? v + off : null)
      return {
        derived: true,
        baseListing: bl,
        baseProduct: b,
        price: shift(bl.price),
        coupon_price: shift(bl.coupon_price),
        options: hasOptions(bl)
          ? bl.options.map((o) => ({ ...o, price: shift(o.price), coupon_price: shift(o.coupon_price) }))
          : null,
        price_source: bl.price_source,
        url: bl.url,
      }
    }
    return listingMap.get(p.id + ':' + channelId) || null
  }

  function analyze(product) {
    const floor = floorOf(product)
    let below = 0
    let filled = 0
    for (const c of channels) {
      const ep = effectivePrices(cellData(product, c.id))
      if (ep.length) filled++
      if (floor != null && ep.some((v) => v < floor)) below++
    }
    return { floor, below, filled }
  }

  const totalBelow = useMemo(
    () => products.reduce((acc, p) => acc + analyze(p).below, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, listings, channels],
  )

  const lastUpdated = useMemo(() => {
    let max = null
    for (const l of listings) {
      if (l.last_checked_at && (!max || l.last_checked_at > max)) max = l.last_checked_at
    }
    return max
  }, [listings])

  async function saveProduct(values) {
    if (productModal.mode === 'new') {
      const row = await createProduct({ ...values, sort_order: products.length })
      setProducts((p) => [...p, row])
    } else {
      const row = await updateProduct(productModal.product.id, values)
      setProducts((p) => p.map((x) => (x.id === row.id ? row : x)))
    }
    setProductModal(null)
  }

  async function removeProduct() {
    const id = productModal.product.id
    await deleteProduct(id)
    setProducts((p) => p.filter((x) => x.id !== id))
    setListings((l) => l.filter((x) => x.product_id !== id))
    setProductModal(null)
  }

  function applyRow(row) {
    setListings((l) => {
      const rest = l.filter((x) => !(x.product_id === row.product_id && x.channel_id === row.channel_id))
      return [...rest, row]
    })
  }

  async function saveCell(values) {
    const { product, channel } = cellModal
    const row = await upsertListing({
      product_id: product.id,
      channel_id: channel.id,
      url: values.url || null,
      price: values.price,
      coupon_price: values.coupon_price ?? null,
      memo: values.memo || null,
      price_source: values.price_source || 'manual',
      last_checked_at: new Date().toISOString(),
    })
    applyRow(row)
    setCellModal(null)
  }

  async function runRefresh(target, label) {
    if (refreshing) return
    const withUrl = target.filter((l) => l.url && !hasOptions(l))
    if (withUrl.length === 0) {
      toast('링크가 등록된 항목이 없어요')
      return
    }
    setRefreshing({ done: 0, total: withUrl.length })
    let ok = 0
    let fail = 0
    for (let i = 0; i < withUrl.length; i++) {
      const res = await refreshListing(withUrl[i])
      if (res.row) applyRow(res.row)
      if (res.ok) ok++
      else fail++
      setRefreshing({ done: i + 1, total: withUrl.length })
      if (i < withUrl.length - 1) await new Promise((r) => setTimeout(r, 350))
    }
    setRefreshing(null)
    toast(`${label} · ${ok}건 갱신${fail ? ` · ${fail}건 실패` : ''}`, fail ? 'warn' : 'ok')
  }

  const refreshAll = () => runRefresh(listings, '전체 새로고침')
  const refreshProduct = (p) => runRefresh(listings.filter((l) => l.product_id === p.id), p.name)

  const rows = products
    .map((p) => ({ p, a: analyze(p) }))
    .filter(({ a }) => !onlyBelow || a.below > 0)

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">가격 비교</h1>
          <p className="page-desc">
            {products.length}개 제품 · 채널 {channels.length}개
            {totalBelow > 0 && <span className="desc-flag"> · 최저가 미달 {totalBelow}건</span>}
          </p>
          {lastUpdated && <p className="page-sub">마지막 업데이트 {fmtWhen(lastUpdated)}</p>}
        </div>
        <div className="head-actions">
          <div className="seg-toggle">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
              표
            </button>
            <button className={view === 'trends' ? 'on' : ''} onClick={() => setView('trends')}>
              추이
            </button>
          </div>
          <Button size="sm" onClick={() => setProductModal({ mode: 'new' })} disabled={!!refreshing}>
            ＋ 제품 추가
          </Button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {!loading && view === 'table' && (totalBelow > 0 || listings.some((l) => l.url)) && (
        <div className="table-toolbar">
          {listings.some((l) => l.url) && (
            <Button
              size="sm"
              variant="ghost"
              className="btn-outline"
              onClick={refreshAll}
              disabled={!!refreshing}
            >
              {refreshing ? `갱신 중… ${refreshing.done}/${refreshing.total}` : '↻ 전체 새로고침'}
            </Button>
          )}
          <span className="spacer" />
          {totalBelow > 0 && (
            <button
              className={'chip-toggle' + (onlyBelow ? ' on' : '')}
              onClick={() => setOnlyBelow((v) => !v)}
            >
              미달만 보기
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : products.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder-title">아직 등록된 제품이 없어요</p>
          <p>‘＋ 제품 추가’로 제품을 넣고, 각 채널 칸을 눌러 판매가와 링크를 입력하세요.</p>
        </div>
      ) : view === 'trends' ? (
        <PriceTrends
          products={products}
          channels={channels}
          productById={productById}
          onOpen={(p) => setHistoryProduct(p)}
        />
      ) : (
        <div className="table-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th className="col-name">제품</th>
                {channels.map((c) => (
                  <th key={c.id} className="num">
                    {c.name}
                  </th>
                ))}
                <th className="col-status">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, a }) => {
                const b = baseOf(p)
                const lp = listPriceOf(p)
                const fl = floorOf(p)
                return (
                  <tr key={p.id}>
                    <td className="col-name">
                      <div className="name-row">
                        <button
                          className="linklike"
                          onClick={() => setProductModal({ mode: 'edit', product: p })}
                        >
                          {p.name}
                        </button>
                        {listings.some((l) => l.product_id === p.id && l.url && !hasOptions(l)) && (
                          <button
                            className="row-refresh"
                            title="이 제품 가격 새로고침"
                            disabled={!!refreshing}
                            onClick={() => refreshProduct(p)}
                          >
                            ↻
                          </button>
                        )}
                      </div>
                      <div className="name-meta">
                        {p.sku && <span>{p.sku}</span>}
                        {(lp != null || fl != null) && (
                          <span>
                            {lp != null && `정상 ${nf.format(lp)}`}
                            {lp != null && fl != null && ' · '}
                            {fl != null && `최저 ${nf.format(fl)}`}
                          </span>
                        )}
                        {b && (
                          <span className="v-tag">
                            ↳ {b.name} {signed(offsetOf(p))}
                          </span>
                        )}
                      </div>
                    </td>
                    {channels.map((c) => {
                      const l = cellData(p, c.id)
                      const eps = effectivePrices(l)
                      const bad = a.floor != null && eps.some((v) => v < a.floor)
                      const derived = !!l?.derived
                      return (
                        <td key={c.id} className={'cell num' + (bad ? ' bad' : '')}>
                          <button
                            className="cell-btn"
                            title={
                              derived
                                ? `${l.baseProduct.name} 가격 ${signed(offsetOf(p))}원`
                                : cellTip(l)
                            }
                            onClick={() =>
                              derived
                                ? setCellModal({
                                    product: l.baseProduct,
                                    channel: c,
                                    listing: l.baseListing,
                                  })
                                : setCellModal({ product: p, channel: c, listing: l })
                            }
                          >
                            <span className="cell-price">{priceText(l, eps)}</span>
                            {l?.price_source === 'failed' && !derived && (
                              <span className="cell-fail" title="자동 갱신 실패 — 확인 필요">
                                !
                              </span>
                            )}
                          </button>
                        </td>
                      )
                    })}
                    <td className="col-status">
                      {a.below > 0 ? (
                        <span className="status-dot bad" title={`${a.below}개 채널이 최저가 미만`} />
                      ) : a.floor == null || a.filled === 0 ? (
                        <span className="status-dot muted" title="비교 기준 없음" />
                      ) : (
                        <span className="status-dot ok" title="모든 채널 최저가 이상" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {productModal && (
        <ProductModal
          key={productModal.product?.id || 'new'}
          mode={productModal.mode}
          product={productModal.product}
          products={products}
          onSave={saveProduct}
          onDelete={removeProduct}
          onHistory={() => {
            const p = productModal.product
            setProductModal(null)
            setHistoryProduct(p)
          }}
          onClose={() => setProductModal(null)}
        />
      )}

      {historyProduct && (
        <HistoryModal
          product={historyProduct}
          channels={channels}
          productById={productById}
          onClose={() => setHistoryProduct(null)}
        />
      )}

      {cellModal && (
        <CellModal
          product={cellModal.product}
          channel={cellModal.channel}
          listing={cellModal.listing}
          onSave={saveCell}
          onClose={() => setCellModal(null)}
        />
      )}
    </div>
  )
}

function ProductModal({ mode, product, products, onSave, onDelete, onHistory, onClose }) {
  const [name, setName] = useState(product?.name || '')
  const [sku, setSku] = useState(product?.sku || '')
  const [listPrice, setListPrice] = useState(product?.list_price != null ? String(product.list_price) : '')
  const [floor, setFloor] = useState(product?.base_price != null ? String(product.base_price) : '')
  const [image, setImage] = useState(product?.image_url || '')
  const [linked, setLinked] = useState(!!product?.base_product_id)
  const [baseId, setBaseId] = useState(product?.base_product_id || '')
  const [offset, setOffset] = useState(product?.price_offset ? String(product.price_offset) : '')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')

  // 연동 대상: 자기 자신 제외, 다른 연동 제품 제외
  const baseCandidates = (products || []).filter((x) => x.id !== product?.id && !x.base_product_id)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setErr('제품명을 입력하세요.')
      return
    }
    let payload
    if (linked) {
      if (!baseId) {
        setErr('연동할 제품을 선택하세요.')
        return
      }
      payload = {
        name: name.trim(),
        sku: sku.trim() || null,
        image_url: image.trim() || null,
        base_product_id: baseId,
        price_offset: toSignedInt(offset) ?? 0,
        list_price: null,
        base_price: null,
      }
    } else {
      payload = {
        name: name.trim(),
        sku: sku.trim() || null,
        image_url: image.trim() || null,
        base_product_id: null,
        price_offset: 0,
        list_price: toInt(listPrice),
        base_price: toInt(floor),
      }
    }
    setBusy(true)
    setErr('')
    try {
      await onSave(payload)
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  async function doDelete() {
    setBusy(true)
    setErr('')
    try {
      await onDelete()
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'new' ? '제품 추가' : '제품 편집'}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' &&
            (confirmDel ? (
              <Button variant="danger" onClick={doDelete} loading={busy}>
                정말 삭제
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDel(true)}>
                삭제
              </Button>
            ))}
          {mode === 'edit' && !confirmDel && (
            <Button variant="ghost" onClick={onHistory}>
              가격 추이
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="pform" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="pform" onSubmit={submit} className="form-col">
        <TextField label="제품명" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <TextField label="품번 (선택)" value={sku} onChange={(e) => setSku(e.target.value)} />

        <label className="check-row">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          <span>다른 제품 가격에 연동 (예: 롱 = 숏 + 2,000원)</span>
        </label>

        {linked ? (
          <>
            <div className="fld">
              <label className="field-label">연동할 제품</label>
              <select
                className="field-input"
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
              >
                <option value="">선택하세요</option>
                {baseCandidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="fld-group">
              <TextField
                label="추가금 (원)"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                inputMode="numeric"
                placeholder="예: 2000  (빼려면 -1000)"
              />
              <p className="hint-sm">연동 제품의 정상가·최저가·채널 가격에 이 금액을 더해 표시합니다.</p>
            </div>
          </>
        ) : (
          <>
            <div className="fld-group">
              <TextField
                label="정상가 (원, 선택)"
                value={listPrice ? nf.format(toInt(listPrice)) : ''}
                onChange={(e) => setListPrice(e.target.value)}
                inputMode="numeric"
                placeholder="우리 공식 판매가"
              />
            </div>
            <div className="fld-group">
              <TextField
                label="최저가 (원, 선택)"
                value={floor ? nf.format(toInt(floor)) : ''}
                onChange={(e) => setFloor(e.target.value)}
                inputMode="numeric"
                placeholder="예: 39000"
              />
              <p className="hint-sm">채널 가격이 이 금액 아래로 떨어지면 빨갛게 표시됩니다.</p>
            </div>
          </>
        )}

        <TextField
          label="대표 이미지 URL (선택)"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="https://"
        />
        {err && <p className="field-error">{err}</p>}
      </form>
    </Modal>
  )
}

function CellModal({ product, channel, listing, onSave, onClose }) {
  const [price, setPrice] = useState(listing?.price != null ? String(listing.price) : '')
  const [coupon, setCoupon] = useState(listing?.coupon_price != null ? String(listing.coupon_price) : '')
  const [url, setUrl] = useState(listing?.url || '')
  const [memo, setMemo] = useState(listing?.memo || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchNote, setFetchNote] = useState('')
  const [snap, setSnap] = useState(null)

  const urlOk = /^https?:\/\/\S+/i.test(url.trim())
  const isAuto =
    snap != null && toInt(price) === snap.price && (toInt(coupon) ?? null) === (snap.coupon ?? null)

  function clearAuto() {
    setSnap(null)
    setFetchNote('')
  }

  async function runExtract() {
    setFetching(true)
    setErr('')
    setFetchNote('')
    try {
      const r = await extractPrice(url.trim())
      setPrice(String(r.price))
      setCoupon(r.coupon_price != null ? String(r.coupon_price) : '')
      setSnap({ price: r.price, coupon: r.coupon_price ?? null })
      const parts = [`판매가 ${nf.format(r.price)}`]
      if (r.coupon_price != null) parts.push(`쿠폰적용가 ${nf.format(r.coupon_price)}`)
      const conf = r.confidence === 'low' ? ' · 정확도 낮음, 꼭 확인' : ''
      setFetchNote(`${parts.join(' · ')}원 확인 (${r.matched_by}${conf})`)
    } catch (e2) {
      setErr(readErr(e2))
    } finally {
      setFetching(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await onSave({
        price: toInt(price),
        coupon_price: toInt(coupon),
        url: url.trim(),
        memo: memo.trim(),
        price_source: isAuto ? 'auto' : 'manual',
      })
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${product.name} · ${channel.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="cform" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="cform" onSubmit={submit} className="form-col">
        <TextField
          label="상품 링크"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            clearAuto()
          }}
          placeholder="https://"
        />
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={runExtract}
            loading={fetching}
            disabled={!urlOk}
            className="btn-outline"
          >
            링크에서 가격 가져오기
          </Button>
          {fetchNote && <p className="fetch-note">✓ {fetchNote}</p>}
        </div>
        <div className="fld-row">
          <TextField
            label="판매가 (원)"
            value={price ? nf.format(toInt(price)) : ''}
            onChange={(e) => {
              setPrice(e.target.value)
              clearAuto()
            }}
            inputMode="numeric"
            placeholder="예: 39000"
          />
          <TextField
            label="쿠폰적용가 (원, 선택)"
            value={coupon ? nf.format(toInt(coupon)) : ''}
            onChange={(e) => {
              setCoupon(e.target.value)
              clearAuto()
            }}
            inputMode="numeric"
            placeholder="쿠폰·할인가"
          />
        </div>
        <TextField label="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        {listing?.last_checked_at && (
          <p className="hint-sm">
            마지막 확인: {new Date(listing.last_checked_at).toLocaleString('ko-KR')}
            {listing.price_source === 'auto' && ' · 자동'}
            {listing.price_source === 'failed' && ' · 자동 실패'}
          </p>
        )}
        {err && <p className="field-error">{err}</p>}
      </form>
    </Modal>
  )
}

function HistoryModal({ product, channels, productById, onClose }) {
  const [state, setState] = useState({ loading: true, series: [], changes: [] })
  const target = product.base_product_id ? productById.get(product.base_product_id) : product
  const off = product.base_product_id ? product.price_offset || 0 : 0

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { listings, history } = await fetchProductHistory((target || product).id)
        if (!alive) return
        const series = buildChannelSeries({ productListings: listings, history, channels, offset: off })
        const changes = []
        for (const s of series) {
          for (let i = 1; i < s.points.length; i++) {
            if (s.points[i].y !== s.points[i - 1].y) {
              changes.push({ t: s.points[i].x, name: s.name, from: s.points[i - 1].y, to: s.points[i].y })
            }
          }
        }
        changes.sort((a, b) => b.t - a.t)
        setState({ loading: false, series, changes: changes.slice(0, 12) })
      } catch (e) {
        if (alive) setState({ loading: false, series: [], changes: [], error: readErr(e) })
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal title={`${product.name} · 가격 추이`} width={540} onClose={onClose} footer={null}>
      {product.base_product_id && (
        <p className="hint-sm" style={{ marginBottom: 12 }}>
          {target?.name} 가격 + {signed(off)}원 기준
        </p>
      )}
      {state.loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : state.error ? (
        <p className="field-error">{state.error}</p>
      ) : (
        <>
          <LineChart
            series={state.series}
            yFormat={(v) => nf.format(v)}
            xFormat={(ms) => {
              const d = new Date(ms)
              return `${d.getMonth() + 1}/${d.getDate()}`
            }}
          />
          {state.changes.length > 0 && (
            <div className="change-log">
              <p className="change-log-title">가격 변동</p>
              {state.changes.map((c, i) => (
                <div className="change-row" key={i}>
                  <span className="change-date">
                    {new Date(c.t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                  </span>
                  <span className="change-ch">{c.name}</span>
                  <span className="change-val">
                    {nf.format(c.from)} → <b>{nf.format(c.to)}</b>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function PriceTrends({ products, channels, productById, onOpen }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await fetchAllPriceHistory()
        if (alive) setData(d)
      } catch (e) {
        if (alive) setErr(readErr(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (err) return <div className="banner-error">{err}</div>
  if (!data) {
    return (
      <div className="loading-row">
        <div className="spinner" />
      </div>
    )
  }

  const byProduct = new Map()
  for (const l of data.listings) {
    if (!byProduct.has(l.product_id)) byProduct.set(l.product_id, [])
    byProduct.get(l.product_id).push(l)
  }

  const cards = products.map((p) => {
    const base = p.base_product_id ? productById.get(p.base_product_id) : null
    const off = base ? p.price_offset || 0 : 0
    const srcId = base ? base.id : p.id
    const pl = byProduct.get(srcId) || []
    const plIds = new Set(pl.map((l) => l.id))
    const hist = data.history.filter((h) => plIds.has(h.listing_id))
    return { p, series: buildChannelSeries({ productListings: pl, history: hist, channels, offset: off }) }
  })

  return (
    <div>
      <div className="chart-legend trend-legend">
        {channels.map((c) => (
          <span key={c.id}>
            <i style={{ background: CH_COLORS[channels.indexOf(c) % CH_COLORS.length] }} />
            {c.name}
          </span>
        ))}
      </div>
      <div className="trend-grid">
        {cards.map(({ p, series }) => (
          <button className="trend-card" key={p.id} onClick={() => onOpen(p)}>
            <div className="trend-name">{p.name}</div>
            <LineChart
              series={series}
              height={128}
              compact
              yFormat={(v) => (v >= 10000 ? Math.round(v / 1000) + 'k' : nf.format(v))}
              xFormat={(ms) => {
                const d = new Date(ms)
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
