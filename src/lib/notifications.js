import { supabase } from './supabase.js'

export async function fetchMyNotifications(name) {
  if (!supabase || !name) return []
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_name', name)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data || []
}

export async function markRead(ids) {
  if (!supabase || !ids.length) return
  await supabase.from('notifications').update({ read: true }).in('id', ids)
}

export async function markAllRead(name) {
  if (!supabase || !name) return
  await supabase.from('notifications').update({ read: true }).eq('user_name', name).eq('read', false)
}

// 알림 보내기 (조용히 실패)
export async function notify(name, { type, title, body, link }) {
  if (!supabase || !name || !title) return
  try {
    await supabase.from('notifications').insert({ user_name: name, type, title, body: body || null, link: link || null })
  } catch {
    // ignore
  }
}

export function subscribeNotifications(name, cb) {
  if (!supabase || !name) return () => {}
  const ch = supabase
    .channel('notif-' + name)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_name=eq.${name}` },
      cb,
    )
    .subscribe()
  return () => supabase.removeChannel(ch)
}
