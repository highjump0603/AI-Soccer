import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listMatches, createMatch, updateMatch, deleteMatch } from './matches';
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
      const rows = await listMatches();
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

  const addMatch = useCallback(async (match) => {
    const created = await createMatch(match);
    setMatches((prev) => [...prev, created]);
    return created;
  }, []);

  const editMatch = useCallback(async (id, match) => {
    const updated = await updateMatch(id, match);
    setMatches((prev) => prev.map((m) => (m.id === id ? updated : m)));
    return updated;
  }, []);

  const removeMatch = useCallback(async (id) => {
    await deleteMatch(id);
    setMatches((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return (
    <MatchesContext.Provider value={{ matches, loading, error, refresh, addMatch, editMatch, removeMatch }}>
      {children}
    </MatchesContext.Provider>
  );
}

export function useMatches() {
  const ctx = useContext(MatchesContext);
  if (!ctx) throw new Error('useMatches must be used within a MatchesProvider');
  return ctx;
}
