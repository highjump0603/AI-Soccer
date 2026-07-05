import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('backtest_results').delete().gt('id', 0);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, cleared: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
