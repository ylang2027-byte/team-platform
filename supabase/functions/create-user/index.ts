// create-user — 관리자가 팀원 계정을 생성. 프론트: supabase.functions.invoke('create-user', { body: { email, password, name } })
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const {
      data: { user },
    } = await admin.auth.getUser(jwt)
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)

    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (prof?.role !== 'admin') return json({ error: '관리자만 팀원을 추가할 수 있습니다.' }, 403)

    const { email, password, name } = await req.json()
    if (!email || !password || String(password).length < 8) {
      return json({ error: '이메일과 8자 이상 비밀번호가 필요합니다.' }, 400)
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: String(email).trim(),
      password: String(password),
      email_confirm: true,
      user_metadata: { name: name ? String(name).trim() : undefined },
    })
    if (error) return json({ error: mapErr(error.message) }, 400)

    return json({ ok: true, id: data.user?.id })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
function mapErr(m: string) {
  if (/already been registered|already exists/i.test(m)) return '이미 등록된 이메일입니다.'
  return m
}
