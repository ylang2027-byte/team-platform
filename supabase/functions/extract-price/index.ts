// extract-price — 상품 링크에서 판매가 + 쿠폰적용가를 최선을 다해 추출.
// 프론트: supabase.functions.invoke('extract-price', { body: { url } })
// "찾지 못함 / 차단됨"도 HTTP 200 + { ok:false } (에러 아님).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { url } = await req.json().catch(() => ({}))
    if (!url || !/^https?:\/\//i.test(url)) {
      return json({ ok: false, error: '유효한 URL이 아닙니다.' }, 400)
    }

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
    } catch (e) {
      return json({ ok: false, error: '페이지에 접속하지 못했습니다.', detail: String(e) })
    }

    if (!res.ok) {
      return json({
        ok: false,
        error:
          res.status === 403 || res.status === 429
            ? '이 쇼핑몰이 자동 조회를 차단했습니다. 직접 입력해 주세요.'
            : `페이지 응답 오류 (${res.status})`,
        http_status: res.status,
      })
    }

    const html = await res.text()
    const found = extractPrices(html)
    if (!found) {
      return json({ ok: false, error: '페이지에서 가격을 찾지 못했습니다. 직접 입력해 주세요.' })
    }
    return json({ ok: true, ...found, http_status: res.status })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v)
  if (typeof v === 'string') {
    const m = v.replace(/[,\s₩]/g, '').match(/\d+(\.\d+)?/)
    if (m) return Math.round(parseFloat(m[0]))
  }
  return null
}

// 원(KRW) 상식 범위
function sane(n: number | null): number | null {
  if (n == null) return null
  return n >= 100 && n <= 100_000_000 ? n : null
}

type Result = {
  price: number
  coupon_price: number | null
  matched_by: string
  confidence: 'high' | 'low'
  title?: string
}

function extractPrices(html: string): Result | null {
  let price: number | null = null
  let coupon: number | null = null
  let title: string | undefined
  const matched: string[] = []
  let confidence: 'high' | 'low' = 'high'

  // A) __NEXT_DATA__ 안의 가격 컨텍스트 (무신사·29CM·W컨셉 등 Next.js)
  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (nextData) {
    try {
      const ctx = findPriceContext(JSON.parse(nextData[1]))
      if (ctx) {
        const p = num(ctx.normalPrice ?? ctx.salePrice ?? ctx.price ?? ctx.originPrice)
        const c = num(ctx.couponPrice ?? ctx.finalPrice ?? ctx.lowestPrice)
        if (p) {
          price = p
          matched.push('무신사식 데이터')
        }
        if (c && (!price || c < price)) coupon = c
      }
    } catch {
      // ignore
    }
  }

  // B) JSON-LD offers (카페24 등)
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
              title = node?.name
              matched.push('JSON-LD')
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

  // C) meta 태그
  if (!price) {
    const p = metaPrice(html, 'product:price:amount') ?? metaPrice(html, 'og:price:amount')
    if (p) {
      price = p
      matched.push('메타태그')
    }
  }
  // C2) 카페24식 할인가 메타
  const saleMeta = metaPrice(html, 'product:sale_price:amount')
  if (saleMeta && price && saleMeta < price) {
    coupon = saleMeta
    matched.push('할인가 메타')
  }

  // D) 마케팅용 인라인 JSON의 이름있는 가격 키 (W컨셉 등)
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
        matched.push(k)
        break
      }
    }
  }
  if (coupon == null) {
    for (const k of ['display_price', 'couponPrice', 'benefitPrice', 'finalPrice']) {
      const v = keyNum(k)
      if (v != null && (price == null || v < price)) {
        coupon = v
        matched.push(k)
        break
      }
    }
  }
  // 29CM: RSC 스트림 안에 이스케이프된 형태로 들어있는 쿠폰 적용가
  if (coupon == null) {
    const m = html.match(/totalDiscountedItemPrice["\\:\s]{1,6}(\d{3,})/i)
    const v = m ? sane(num(m[1])) : null
    if (v != null && (price == null || v < price)) {
      coupon = v
      matched.push('29CM 할인가')
    }
  }

  // E) 최후: 그냥 "price"
  if (price == null) {
    const v = keyNum('price')
    if (v != null) {
      price = v
      matched.push('price')
      confidence = 'low'
    }
  }

  price = sane(price)
  coupon = sane(coupon)
  if (coupon != null && price != null && coupon >= price) coupon = null
  if (price == null && coupon != null) {
    price = coupon
    coupon = null
  }
  if (price == null) return null
  if (matched.includes('정규식')) confidence = 'low'

  return {
    price,
    coupon_price: coupon,
    matched_by: matched.join(' + ') || 'unknown',
    confidence,
    title,
  }
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

// normalPrice / salePrice 같은 키를 가진 객체를 찾는다
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
