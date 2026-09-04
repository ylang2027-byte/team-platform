import { supabase } from './supabase.js'

function guard() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
}

export async function fetchPromos() {
  guard()
  const { data, error } = await supabase.from('promos').select('*')
  if (error) throw error
  return data
}

export async function createPromo(payload) {
  guard()
  const { data, error } = await supabase.from('promos').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updatePromo(id, patch) {
  guard()
  const { data, error } = await supabase.from('promos').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePromo(id) {
  guard()
  const { error } = await supabase.from('promos').delete().eq('id', id)
  if (error) throw error
}

export async function fetchPromoCoupons(promoId) {
  guard()
  const { data, error } = await supabase
    .from('promo_coupons')
    .select('*')
    .eq('promo_id', promoId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data
}

export async function savePromoCoupons(promoId, coupons) {
  guard()
  await supabase.from('promo_coupons').delete().eq('promo_id', promoId)
  if (coupons.length) {
    const { error } = await supabase.from('promo_coupons').insert(
      coupons.map((c, i) => ({
        promo_id: promoId,
        name: c.name,
        kind: c.kind,
        value: c.value,
        max_discount: c.max_discount,
        min_order: c.min_order,
        grp: c.grp,
        our_share: c.our_share,
        sort_order: i,
      })),
    )
    if (error) throw error
  }
}

export async function fetchPromoProducts(promoId) {
  guard()
  const { data, error } = await supabase
    .from('promo_products')
    .select('*')
    .eq('promo_id', promoId)
  if (error) throw error
  return data
}

export async function savePromoProducts(promoId, rows) {
  guard()
  // rows: [{ product_id, apply_price }]
  const keep = new Set(rows.map((r) => r.product_id))
  const { data: existing } = await supabase
    .from('promo_products')
    .select('product_id')
    .eq('promo_id', promoId)
  const toDelete = (existing || []).map((e) => e.product_id).filter((id) => !keep.has(id))
  if (toDelete.length) {
    await supabase.from('promo_products').delete().eq('promo_id', promoId).in('product_id', toDelete)
  }
  if (rows.length) {
    const { error } = await supabase.from('promo_products').upsert(
      rows.map((r) => ({ promo_id: promoId, product_id: r.product_id, apply_price: r.apply_price })),
      { onConflict: 'promo_id,product_id' },
    )
    if (error) throw error
  }
}
