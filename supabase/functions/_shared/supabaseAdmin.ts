import { createClient } from 'npm:@supabase/supabase-js@2';

// Service-role client for Edge Function use only — this key bypasses RLS,
// so it must never reach the browser. Edge Functions get it from
// `supabase secrets set`, not from the frontend .env.
export function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets are not set for this function.');
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
