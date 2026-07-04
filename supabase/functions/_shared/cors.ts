// Every function here is called cross-origin from the browser (the admin
// page runs on localhost/Vercel, the function runs on *.supabase.co), so
// the browser sends a CORS preflight (OPTIONS) before the real POST. Without
// these headers the preflight fails and the browser blocks the actual
// request before it ever reaches this code — surfacing in supabase-js as
// "Failed to send a request to the Edge Function" with no HTTP status at
// all, which is easy to mistake for a deployment problem.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
