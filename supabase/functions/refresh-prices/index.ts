// refresh-prices — 링크가 등록된 모든 채널 칸의 가격을 서버에서 갱신.
// pg_cron 이 하루 2회 호출. x-cron-key 헤더로 인증.
// ※ 가격 추출 로직은 extract-price/index.ts 와 동일하게 유지할 것.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_KEY = Deno.env.get('CRON_SECRET') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (!CRON_KEY || req.headers.get('x-cron-key') !== CRON_KEY) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: listings, error } = await admin
    .from('listings')
    .select('id, url, price, coupon_price, options')
  if (error) return json({ ok: false, error: error.message }, 500)

  const targets = (listings ?? []).filter(
    (l) => l.url && !(Array.isArray(l.options) && l.options.length),
  )

  let updated = 0
  let failed = 0
  const now = new Date().toISOString()

  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5)
    await Promise.all(
      batch.map(async (l) => {
        const r = await fetchPrice(l.url as string)
        if (r.ok && r.price != null) {
          await admin
            .from('listings')
            .update({
              price: r.price,
              coupon_price: r.coupon_price ?? null,
              price_source: 'auto',
              last_checked_at: now,
            })
            .eq('id', l.id)
          updated++
        } else {
          await admin
            .from('listings')
            .update({ price_source: 'failed', last_checked_at: now })
            .eq('id', l.id)
          failed++
        }
      }),
    )
  }

  return json({ ok: true, total: targets.length, updated, failed, at: now })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ───────────────────────── 가격 추출 (extract-price 와 동일) ─────────────────────────

async function fetchPrice(url: string) {
  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    })
  } catch {
    return { ok: false as const, error: 'fetch failed' }
  }
  if (!res.ok) return { ok: false as const, error: `http ${res.status}` }
  const found = extractPrices(await res.text())
  if (!found) return { ok: false as const, error: 'not found' }
  return { ok: true as const, ...found }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v)
  if (typeof v === 'string') {
    const m = v.replace(/[,\s₩]/g, '').match(/\d+(\.\d+)?/)
    if (m) return Math.round(parseFloat(m[0]))
  }
  return null
}
function sane(n: number | null): number | null {
  if (n == null) return null
  return n >= 100 && n <= 100_000_000 ? n : null
}
function metaPrice(html: string, key: string): number | null {
  const k = key.replace(/[.:]/g, '\\$&')
  const a = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)["']`, 'i'),
  )
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i'),
  )
  return sane(num((a ?? b)?.[1]))
}
function findPriceContext(o: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 12 || o == null || typeof o !== 'object') return null
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = findPriceContext(v, depth + 1)
      if (r) return r
    }
    return null
  }
  const rec = o as Record<string, unknown>
  const keys = Object.keys(rec)
  const hasNormal = keys.some((k) => /^(normalprice|saleprice|originprice)$/i.test(k))
  const hasAnyPrice = keys.some((k) => /price/i.test(k))
  if (hasNormal && hasAnyPrice && num(rec.normalPrice ?? rec.salePrice ?? rec.originPrice) != null) {
    return rec
  }
  for (const v of Object.values(rec)) {
    const r = findPriceContext(v, depth + 1)
    if (r) return r
  }
  return null
}

function extractPrices(html: string) {
  let price: number | null = null
  let coupon: number | null = null

  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (nextData) {
    try {
      const ctx = findPriceContext(JSON.parse(nextData[1]))
      if (ctx) {
        const p = num(ctx.normalPrice ?? ctx.salePrice ?? ctx.price ?? ctx.originPrice)
        const c = num(ctx.couponPrice ?? ctx.finalPrice ?? ctx.lowestPrice)
        if (p) price = p
        if (c && (!price || c < price)) coupon = c
      }
    } catch {
      // ignore
    }
  }

  if (!price) {
    for (const m of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        const data = JSON.parse(m[1].trim())
        const nodes = Array.isArray(data)
          ? data
          : Array.isArray(data?.['@graph'])
            ? data['@graph']
            : [data]
        for (const node of nodes) {
          const offers = node?.offers
          const arr = Array.isArray(offers) ? offers : offers ? [offers] : []
          for (const o of arr) {
            const p = sane(num(o?.price ?? o?.lowPrice ?? o?.priceSpecification?.price))
            if (p) {
              price = p
              break
            }
          }
          if (price) break
        }
      } catch {
        // ignore
      }
      if (price) break
    }
  }

  if (!price) {
    const p = metaPrice(html, 'product:price:amount') ?? metaPrice(html, 'og:price:amount')
    if (p) price = p
  }
  const saleMeta = metaPrice(html, 'product:sale_price:amount')
  if (saleMeta && price && saleMeta < price) coupon = saleMeta

  const keyNum = (key: string): number | null => {
    const m = html.match(new RegExp(`["']${key}["']\\s*:\\s*["']?(\\d[\\d.]{2,})`, 'i'))
    return m ? sane(num(m[1])) : null
  }
  if (price == null) {
    for (const k of [
      'discount_price',
      'af_sale_price',
      'salePrice',
      'sellPrice',
      'consumerPrice',
      'normalPrice',
    ]) {
      const v = keyNum(k)
      if (v != null) {
        price = v
        break
      }
    }
  }
  if (coupon == null) {
    for (const k of ['display_price', 'couponPrice', 'benefitPrice', 'finalPrice']) {
      const v = keyNum(k)
      if (v != null && (price == null || v < price)) {
        coupon = v
        break
      }
    }
  }
  if (coupon == null) {
    const m = html.match(/totalDiscountedItemPrice["\\:\s]{1,6}(\d{3,})/i)
    const v = m ? sane(num(m[1])) : null
    if (v != null && (price == null || v < price)) coupon = v
  }
  if (price == null) {
    const v = keyNum('price')
    if (v != null) price = v
  }

  price = sane(price)
  coupon = sane(coupon)
  if (coupon != null && price != null && coupon >= price) coupon = null
  if (price == null && coupon != null) {
    price = coupon
    coupon = null
  }
  if (price == null) return null
  return { price, coupon_price: coupon }
}
