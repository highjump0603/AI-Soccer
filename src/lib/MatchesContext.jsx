import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listUpcomingFixtures } from './fixtures';
import { isSupabaseConfigured } from './supabaseClient';

const MatchesContext = createContext(null);

export function MatchesProvider({ children }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase가 아직 연결되지 않았어요. .env.example을 참고해 .env 파일을 설정해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await listUpcomingFixtures();
      setMatches(rows);
    } catch (e) {
      setError(e.message || '경기 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <MatchesContext.Provider value={{ matches, loading, error, refresh }}>{children}</MatchesContext.Provider>;
}

export function useMatches() {
  const ctx = useContext(MatchesContext);
  if (!ctx) throw new Error('useMatches must be used within a MatchesProvider');
  return ctx;
}
