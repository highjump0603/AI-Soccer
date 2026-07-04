import { supabase } from './supabaseClient';

// The prototype's default h2h for newly-created matches — there's no real
// head-to-head history to show yet, so this placeholder mirrors what the
// Claude Design mock did.
const DEFAULT_H2H = ['W', 'D', 'L', 'W', 'D'];

function rowToMatch(row) {
  return {
    id: row.id,
    league: row.league,
    date: row.match_date,
    home: { name: row.home_name },
    away: { name: row.away_name },
    score: { home: row.score_home, away: row.score_away },
    prob: { home: row.prob_home, draw: row.prob_draw, away: row.prob_away },
    confidence: row.confidence,
    factors: row.factors || [],
    odds: {
      book: { home: row.odds_book_home, draw: row.odds_book_draw, away: row.odds_book_away },
      ai: { home: row.odds_ai_home, draw: row.odds_ai_draw, away: row.odds_ai_away },
    },
    h2h: row.h2h && row.h2h.length ? row.h2h : DEFAULT_H2H,
  };
}

function matchToRow(m) {
  return {
    league: m.league,
    match_date: m.date,
    home_name: m.home.name,
    away_name: m.away.name,
    score_home: m.score.home,
    score_away: m.score.away,
    prob_home: m.prob.home,
    prob_draw: m.prob.draw,
    prob_away: m.prob.away,
    confidence: m.confidence,
    odds_book_home: m.odds.book.home,
    odds_book_draw: m.odds.book.draw,
    odds_book_away: m.odds.book.away,
    odds_ai_home: m.odds.ai.home,
    odds_ai_draw: m.odds.ai.draw,
    odds_ai_away: m.odds.ai.away,
    factors: m.factors,
    h2h: m.h2h && m.h2h.length ? m.h2h : DEFAULT_H2H,
  };
}

export async function listMatches() {
  const { data, error } = await supabase.from('matches').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(rowToMatch);
}

export async function createMatch(match) {
  const { data, error } = await supabase.from('matches').insert(matchToRow(match)).select().single();
  if (error) throw error;
  return rowToMatch(data);
}

export async function updateMatch(id, match) {
  const { data, error } = await supabase.from('matches').update(matchToRow(match)).eq('id', id).select().single();
  if (error) throw error;
  return rowToMatch(data);
}

export async function deleteMatch(id) {
  const { error } = await supabase.from('matches').delete().eq('id', id);
  if (error) throw error;
}
