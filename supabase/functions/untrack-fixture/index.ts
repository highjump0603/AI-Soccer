// Deletes a tracked fixture (and, via ON DELETE CASCADE, its lineups/
// prediction rows). This is the only write path the admin page has now —
// there's no direct table access from the anon key anymore.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  let fixtureId: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.fixture_id === 'number') fixtureId = body.fixture_id;
  } catch {
    // fall through to the validation error below
  }

  if (fixtureId == null) {
    return new Response(JSON.stringify({ ok: false, error: 'fixture_id (number) is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('fixtures').delete().eq('id', fixtureId);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
