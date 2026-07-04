import { useCallback, useEffect, useState } from 'react';
import Button from '../components/ui/Button';
import { listAllFixturesForAdmin, triggerSyncLeagues, triggerPredictFixture, untrackFixture } from '../lib/fixtures';
import { confidenceMeta } from '../lib/constants';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export default function Admin() {
  const [fixtures, setFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase가 아직 연결되지 않았어요. .env.example을 참고해 .env 파일을 설정해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await listAllFixturesForAdmin();
      setFixtures(rows);
    } catch (e) {
      setError(e.message || '경기 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setNotice('');
    setError('');
    try {
      await triggerSyncLeagues();
      setNotice('추적 리그의 예정된 경기를 동기화했습니다.');
      await load();
    } catch (e) {
      setError(e.message || '동기화에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  }

  async function handlePredict(fixtureId) {
    setBusyId(fixtureId);
    setNotice('');
    setError('');
    try {
      await triggerPredictFixture(fixtureId);
      await load();
    } catch (e) {
      setError(e.message || '예측 갱신에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUntrack(fixtureId) {
    setBusyId(fixtureId);
    setNotice('');
    setError('');
    try {
      await untrackFixture(fixtureId);
      setFixtures((prev) => prev.filter((f) => f.id !== fixtureId));
    } catch (e) {
      setError(e.message || '추적 해제에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="wrap admin-page">
      <div className="section-head">
        <div>
          <span className="section-num">관리자 —</span>
          <h2 className="section-title">추적 경기 관리</h2>
        </div>
        <div className="section-desc">
          경기 데이터는 API-Football + 통계 모델 + GPT가 자동으로 계산합니다. 새 경기 발견과 예측 갱신은 정기적으로
          자동 실행되며, 여기서 즉시 실행할 수도 있습니다.
        </div>
      </div>

      <div className="admin-actions" style={{ marginBottom: 'var(--space-8)' }}>
        <Button variant="primary" size="md" onClick={handleSync} disabled={syncing}>
          {syncing ? '동기화 중...' : '추적 리그 지금 동기화'}
        </Button>
      </div>

      {notice && <div className="state-msg" style={{ color: 'var(--color-success)' }}>{notice}</div>}
      {error && <div className="state-msg error">{error}</div>}
      {loading && <div className="state-msg">불러오는 중...</div>}

      {!loading && !error && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>리그</th>
                <th>일시</th>
                <th>홈팀</th>
                <th>원정팀</th>
                <th>예상 스코어</th>
                <th>신뢰도</th>
                <th>마지막 계산</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fixtures.map((f) => {
                const conf = f.hasPrediction ? confidenceMeta(f.confidence) : null;
                const isBusy = busyId === f.id;
                return (
                  <tr key={f.id}>
                    <td>{f.league}</td>
                    <td>{f.date}</td>
                    <td>{f.home.name}</td>
                    <td>{f.away.name}</td>
                    <td>{f.hasPrediction ? `${f.score.home}-${f.score.away}` : '미계산'}</td>
                    <td>{conf ? conf.label : '—'}</td>
                    <td>{f.generatedAt ? new Date(f.generatedAt).toLocaleString('ko-KR') : '—'}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="mini-btn" onClick={() => handlePredict(f.id)} disabled={isBusy}>
                          {isBusy ? '처리 중...' : '예측 갱신'}
                        </button>
                        <button className="mini-btn danger" onClick={() => handleUntrack(f.id)} disabled={isBusy}>
                          추적 해제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {fixtures.length === 0 && (
                <tr>
                  <td colSpan={8}>추적 중인 경기가 없습니다. "추적 리그 지금 동기화"를 눌러 시작하세요.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
