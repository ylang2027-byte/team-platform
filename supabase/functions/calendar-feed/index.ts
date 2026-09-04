// calendar-feed — app_config 에 저장된 구글 캘린더 iCal(.ics) 을 읽어 일정 목록을 반환.
// 프론트: supabase.functions.invoke('calendar-feed')

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: cfg } = await admin
      .from('app_config')
      .select('gcal_ical_url')
      .eq('id', 'main')
      .maybeSingle()

    const url = cfg?.gcal_ical_url
    if (!url) return json({ ok: false, error: '연동된 구글 캘린더가 없습니다.', events: [] })

    const res = await fetch(url, { headers: { 'User-Agent': 'team-platform/1.0' } })
    if (!res.ok) {
      return json({ ok: false, error: `캘린더를 불러오지 못했습니다 (${res.status})`, events: [] })
    }
    const events = parseIcs(await res.text())
    return json({ ok: true, count: events.length, events })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e), events: [] }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

type Ev = {
  uid: string
  title: string
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD (표시용, 마지막 날 포함)
  allDay: boolean
  time?: string // HH:MM (allDay 아닐 때, KST)
}

function parseIcs(text: string): Ev[] {
  // 접힌 줄 펼치기 (CRLF/LF + 공백|탭)
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)
  const out: Ev[] = []
  let cur: Record<string, string> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        const ev = toEvent(cur)
        if (ev) out.push(ev)
      }
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const rawKey = line.slice(0, idx)
    const val = line.slice(idx + 1)
    const key = rawKey.split(';')[0]
    cur[key] = val
    if (rawKey.includes('VALUE=DATE')) cur['_' + key + '_dateonly'] = '1'
    const tz = rawKey.match(/TZID=([^;:]+)/)
    if (tz) cur['_' + key + '_tzid'] = tz[1]
  }
  return out
}

function toEvent(e: Record<string, string>): Ev | null {
  const title = decodeText(e.SUMMARY || '(제목 없음)')
  const dtStart = e.DTSTART
  if (!dtStart) return null

  const startDateOnly = e['_DTSTART_dateonly'] === '1' || /^\d{8}$/.test(dtStart)
  if (startDateOnly) {
    const s = ymd(dtStart.slice(0, 8))
    let end = s
    if (e.DTEND) {
      // 종일 일정의 DTEND 는 마지막 날 다음 날(exclusive) → 하루 뺀다
      end = ymd(addDays(e.DTEND.slice(0, 8), -1))
      if (end < s) end = s
    }
    return { uid: e.UID || s + title, title, start: s, end, allDay: true }
  }

  // 시간 있는 일정
  const d = parseDateTime(dtStart)
  const startYmd = ymd(d.slice(0, 8))
  const endYmd = e.DTEND ? ymd(parseDateTime(e.DTEND).slice(0, 8)) : startYmd
  return {
    uid: e.UID || startYmd + title,
    title,
    start: startYmd,
    end: endYmd < startYmd ? startYmd : endYmd,
    allDay: false,
    time: d.slice(9, 11) + ':' + d.slice(11, 13),
  }
}

// "20260825T050000Z" 또는 "20260825T140000" → KST 기준 "YYYYMMDDTHHMMSS"
function parseDateTime(v: string): string {
  const m = v.match(/(\d{8})T(\d{6})(Z)?/)
  if (!m) return v.slice(0, 8) + 'T000000'
  if (m[3] === 'Z') {
    // UTC → KST (+9h)
    const dt = new Date(
      Date.UTC(
        +m[1].slice(0, 4),
        +m[1].slice(4, 6) - 1,
        +m[1].slice(6, 8),
        +m[2].slice(0, 2),
        +m[2].slice(2, 4),
        +m[2].slice(4, 6),
      ) +
        9 * 3600 * 1000,
    )
    const p = (n: number) => String(n).padStart(2, '0')
    return (
      `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}` +
      `T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}00`
    )
  }
  return m[1] + 'T' + m[2]
}

function ymd(d8: string) {
  return `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`
}
function addDays(d8: string, n: number) {
  const dt = new Date(+d8.slice(0, 4), +d8.slice(4, 6) - 1, +d8.slice(6, 8))
  dt.setDate(dt.getDate() + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}`
}
function decodeText(s: string) {
  return s
    .replace(/\\n/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}
