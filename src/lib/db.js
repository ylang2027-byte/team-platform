import { supabase } from './supabase.js'

function guard() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
}

export async function fetchChannels() {
  guard()
  const { data, error } = await supabase.from('channels').select('*').order('sort_order')
  if (error) throw error
  return data
}

export async function fetchProducts() {
  guard()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data
}

export async function fetchListings() {
  guard()
  const { data, error } = await supabase.from('listings').select('*')
  if (error) throw error
  return data
}

export async function createProduct(payload) {
  guard()
  const { data, error } = await supabase.from('products').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateProduct(id, patch) {
  guard()
  const { data, error } = await supabase.from('products').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteProduct(id) {
  guard()
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

export async function upsertListing({ product_id, channel_id, ...patch }) {
  guard()
  const { data, error } = await supabase
    .from('listings')
    .upsert({ product_id, channel_id, ...patch }, { onConflict: 'product_id,channel_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function extractPrice(url) {
  guard()
  const { data, error } = await supabase.functions.invoke('extract-price', { body: { url } })
  if (error) {
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch {
      // keep default
    }
    if (/Failed to send|Function not found|404/i.test(msg || '')) {
      msg = 'extract-price 함수가 아직 배포되지 않았습니다.'
    }
    throw new Error(msg || '가격을 가져오지 못했습니다.')
  }
  if (!data?.ok) throw new Error(data?.error || '가격을 찾지 못했습니다.')
  return data // { ok, price, matched_by, confidence, title? }
}

// 링크가 있는 리스팅 하나를 자동 갱신. 실패해도 기존 가격은 유지하고 상태만 'failed'.
export async function refreshListing(listing) {
  if (!listing?.url) return { skipped: true }
  const base = {
    product_id: listing.product_id,
    channel_id: listing.channel_id,
    url: listing.url,
    memo: listing.memo ?? null,
    last_checked_at: new Date().toISOString(),
  }
  try {
    const r = await extractPrice(listing.url)
    const row = await upsertListing({
      ...base,
      price: r.price,
      coupon_price: r.coupon_price ?? null,
      price_source: 'auto',
    })
    const changed =
      r.price !== listing.price || (r.coupon_price ?? null) !== (listing.coupon_price ?? null)
    return { ok: true, row, changed }
  } catch (e) {
    try {
      const row = await upsertListing({
        ...base,
        price: listing.price ?? null,
        coupon_price: listing.coupon_price ?? null,
        price_source: 'failed',
      })
      return { ok: false, row, error: e?.message || String(e) }
    } catch (e2) {
      return { ok: false, error: e2?.message || String(e2) }
    }
  }
}

export async function fetchAllPriceHistory() {
  guard()
  const [{ data: listings, error: e1 }, { data: history, error: e2 }] = await Promise.all([
    supabase.from('listings').select('id, product_id, channel_id, price, coupon_price'),
    supabase
      .from('price_history')
      .select('listing_id, price, coupon_price, recorded_at')
      .order('recorded_at'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { listings: listings || [], history: history || [] }
}

export async function fetchProductHistory(productId) {
  guard()
  const { data: ls, error: e1 } = await supabase
    .from('listings')
    .select('id, channel_id, price, coupon_price, last_checked_at')
    .eq('product_id', productId)
  if (e1) throw e1
  const ids = (ls || []).map((l) => l.id)
  if (!ids.length) return { listings: [], history: [] }
  const { data, error } = await supabase
    .from('price_history')
    .select('listing_id, price, coupon_price, recorded_at')
    .in('listing_id', ids)
    .order('recorded_at')
  if (error) throw error
  return { listings: ls, history: data || [] }
}

export async function fetchPriceHistory(listingId) {
  guard()
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('listing_id', listingId)
    .order('recorded_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data
}
