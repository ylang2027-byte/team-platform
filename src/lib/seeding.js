import { supabase } from './supabase.js'

function guard() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
}

export async function fetchSeedings() {
  guard()
  const { data, error } = await supabase.from('seedings').select('*')
  if (error) throw error
  return data
}

export async function createSeeding(payload) {
  guard()
  const { data, error } = await supabase.from('seedings').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateSeeding(id, patch) {
  guard()
  const { data, error } = await supabase.from('seedings').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteSeeding(id) {
  guard()
  const { error } = await supabase.from('seedings').delete().eq('id', id)
  if (error) throw error
}
