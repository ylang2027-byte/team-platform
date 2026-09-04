import { supabase } from './supabase.js'

export async function fetchCalendarFeed() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
  const { data, error } = await supabase.functions.invoke('calendar-feed')
  if (error) {
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch {
      // keep
    }
    if (/Function not found|404/i.test(msg || '')) msg = 'calendar-feed 함수가 아직 배포되지 않았습니다.'
    throw new Error(msg || '캘린더를 불러오지 못했습니다.')
  }
  if (!data?.ok && data?.error) throw new Error(data.error)
  return data?.events || []
}

export async function fetchCalConfig() {
  if (!supabase) return null
  const { data } = await supabase.from('app_config').select('gcal_ical_url').eq('id', 'main').maybeSingle()
  return data?.gcal_ical_url || null
}

export async function saveCalConfig(url) {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
  const { error } = await supabase
    .from('app_config')
    .upsert({ id: 'main', gcal_ical_url: url || null })
  if (error) throw error
}
