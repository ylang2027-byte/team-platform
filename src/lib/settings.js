import { supabase } from './supabase.js'

function guard() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
}

export async function fetchProfiles() {
  guard()
  const { data, error } = await supabase.from('profiles').select('*').order('created_at')
  if (error) throw error
  return data
}

export async function updateProfile(id, patch) {
  guard()
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function inviteUser({ email, password, name }) {
  guard()
  const { data, error } = await supabase.functions.invoke('create-user', {
    body: { email, password, name },
  })
  if (error) {
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch {
      // keep
    }
    if (/Function not found|404/i.test(msg || '')) msg = 'create-user 함수가 아직 배포되지 않았습니다.'
    throw new Error(msg || '계정 생성에 실패했습니다.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchAllChannels() {
  guard()
  const { data, error } = await supabase.from('channels').select('*').order('sort_order')
  if (error) throw error
  return data
}

export async function createChannel(name, sortOrder) {
  guard()
  const { data, error } = await supabase
    .from('channels')
    .insert({ name, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateChannel(id, patch) {
  guard()
  const { data, error } = await supabase.from('channels').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteChannel(id) {
  guard()
  const { error } = await supabase.from('channels').delete().eq('id', id)
  if (error) throw error
}
