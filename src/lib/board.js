import { supabase } from './supabase.js'

function guard() {
  if (!supabase) throw new Error('Supabase가 연결되지 않았습니다.')
}

export async function fetchTasks() {
  guard()
  const { data, error } = await supabase.from('tasks').select('*').order('sort_order')
  if (error) throw error
  return data
}

export async function createTask(payload) {
  guard()
  const { data, error } = await supabase.from('tasks').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateTask(id, patch) {
  guard()
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTask(id) {
  guard()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

export function subscribeTasks(onChange) {
  if (!supabase) return () => {}
  const ch = supabase
    .channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}
