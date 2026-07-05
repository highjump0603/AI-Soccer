// Guards the admin-only Edge Functions (sync-leagues, predict-due,
// untrack-fixture, backtest, clear-backtest-results). The functions are
// deployed with --no-verify-jwt (see README), so Supabase's platform-level
// gateway auth is off and every request reaches this code regardless of
// its Authorization header — the check below is the only thing standing
// between an anonymous caller and these endpoints, so it must run first.
//
// Design: the frontend signs the admin in via Supabase Auth
// (email+password), and supabase-js automatically attaches that user's
// access token as the Authorization header on every functions.invoke()
// call once a session exists. Here we validate that token against Supabase
// Auth and check the resulting user's email against an allowlist, since
// this app only ever has one or a handful of trusted operators rather than
// a general user/role system.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

function rejection(message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Returns a Response to send back immediately if the caller isn't an
// authorized admin, or null if the request is clear to proceed.
export async function requireAdmin(req: Request): Promise<Response | null> {
  const adminEmails = (Deno.env.get('ADMIN_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) {
    return rejection('ADMIN_EMAILS secret is not set for this function.', 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return rejection('로그인이 필요합니다.', 401);

  // The pg_cron schedule (see migrations/0002_cron.sql) calls sync-leagues/
  // predict-due directly with the service_role key as its bearer token —
  // there's no end user in that path, so a plain email check would always
  // fail it. The service_role key never leaves Supabase's own Vault/Edge
  // Function runtime, so trusting it here is equivalent to trusting the
  // project itself.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return rejection('Supabase 인증 설정을 확인할 수 없습니다.', 500);

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser();
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !adminEmails.includes(email)) {
    return rejection('관리자 권한이 없습니다.', 403);
  }

  return null;
}
