import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listUpcomingFixtures, listRecentFinishedFixtures } from './fixtures';
import { isSupabaseConfigured } from './supabaseClient';

const MatchesContext = createContext(null);

export function MatchesProvider({ children }) {
  const [matches, setMatches] = useState([]);
  const [pastMatches, setPastMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Provider lives above the router, so this state stays populated across
  // page navigation — refresh() only needs to run once per app load.
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase가 아직 연결되지 않았어요. .env.example을 참고해 .env 파일을 설정해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [rows, past] = await Promise.all([listUpcomingFixtures(), listRecentFinishedFixtures()]);
      setMatches(rows);
      setPastMatches(past);
    } catch (e) {
      setError(e.message || '경기 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyQuickInfo = useCallback((fixtureId, { h2h, odds }) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === fixtureId
          ? {
              ...m,
              h2h: m.hasPrediction ? m.h2h : h2h,
              odds: { ...m.odds, book: m.hasPrediction ? m.odds.book : odds },
              quickInfoFetchedAt: new Date().toISOString(),
            }
          : m
      )
    );
  }, []);

  return (
    <MatchesContext.Provider value={{ matches, pastMatches, loading, error, refresh, applyQuickInfo }}>
      {children}
    </MatchesContext.Provider>
  );
}

export function useMatches() {
  const ctx = useContext(MatchesContext);
  if (!ctx) throw new Error('useMatches must be used within a MatchesProvider');
  return ctx;
}
