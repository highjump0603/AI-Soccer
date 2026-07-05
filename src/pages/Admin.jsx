import { useCallback, useEffect, useState } from 'react';
import Button from '../components/ui/Button';
import {
  listAllFixturesForAdmin,
  triggerSyncLeagues,
  triggerPredictFixture,
  triggerPredictAllDue,
  untrackFixture,
  runBacktestForLeagueSeason,
  fetchBacktestResults,
  clearBacktestResults,
  listBacktestLeagues,
} from '../lib/fixtures';
import { confidenceMeta } from '../lib/constants';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export default function Admin() {
  const [fixtures, setFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');

  const [backtestLeagues, setBacktestLeagues] = useState([]);
  const [backtestLeague, setBacktestLeague] = useState('');
  const [backtestSeason, setBacktestSeason] = useState(String(new Date().getUTCFullYear()));
  const [backtestCount, setBacktestCount] = useState(5);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestResults, setBacktestResults] = useState([]);
  const [backtestNotice, setBacktestNotice] = useState('');
  const [backtestError, setBacktestError] = useState('');
  const [backtestPage, setBacktestPage] = useState(1);

  const backtestPageSize = 15;
  const backtestPageCount = Math.max(1, Math.ceil(backtestResults.length / backtestPageSize));
  const visibleBacktestResults = backtestResults.slice(
    (backtestPage - 1) * backtestPageSize,
    backtestPage * backtestPageSize
  );

  const loadBacktestResults = useCallback(async () => {
    try {
      setBacktestPage(1);
      setBacktestResults(await fetchBacktestResults());
    } catch (e) {
      setBacktestError(e.message || '백테스트 결과를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    loadBacktestResults();
    listBacktestLeagues()
      .then(setBacktestLeagues)
      .catch(() => {});
  }, [loadBacktestResults]);

  async function handleRunBacktest() {
    if (!backtestLeague) return;
    setBacktestRunning(true);
    setBacktestNotice('');
    setBacktestError('');
    try {
      const result = await runBacktestForLeagueSeason(backtestLeague, Number(backtestSeason) || new Date().getUTCFullYear(), Number(backtestCount) || 5);
      const entries = Object.entries(result?.results ?? {});
      const breakdown = entries
        .map(([label, outcome]) => `${label}: ${outcome}`)
        .join(' / ');
      const details = [result?.message, result?.error].filter(Boolean);
      setBacktestNotice(breakdown || details.join(' / ') || '백테스트 응답이 비어있습니다.');
      await loadBacktestResults();
    } catch (e) {
      setBacktestError(e.message || '백테스트 실행에 실패했습니다.');
    } finally {
      setBacktestRunning(false);
    }
  }

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
      const result = await triggerSyncLeagues();
      const breakdown = Object.entries(result?.synced ?? {})
        .map(([league, value]) => `${league}: ${value}`)
        .join(' / ');
      const dateErrors = Object.entries(result?.dateErrors ?? {});
      const errorNote = dateErrors.length ? ` (일부 날짜 조회 실패: ${dateErrors.map(([d, msg]) => `${d} - ${msg}`).join('; ')})` : '';
      setNotice(breakdown ? `동기화 결과 — ${breakdown}${errorNote} — 예측 계산 중...` : '동기화 응답이 비어있습니다.');
      // New fixtures have no AI prediction yet (that's a separate cron, up
      // to 30 minutes away) — run it now so the admin table isn't stuck on
      // "미계산" right after a sync.
      await triggerPredictAllDue().catch(() => {});
      await load();
      setNotice(breakdown ? `동기화 결과 — ${breakdown}${errorNote}` : '동기화 응답이 비어있습니다.');
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

  async function handleClearBacktestResults() {
    try {
      await clearBacktestResults();
      await loadBacktestResults();
      setBacktestNotice('백테스팅 결과를 모두 비웠습니다.');
    } catch (e) {
      setBacktestError(e.message || '백테스팅 결과 초기화에 실패했습니다.');
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
          경기 데이터는 FotMob + GPT가 자동으로 계산합니다. 새 경기 발견과 예측 갱신은 정기적으로 자동 실행되며,
          여기서 즉시 실행할 수도 있습니다.
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
                    <td>{conf ? (f.confidencePct != null ? `${f.confidencePct}%` : conf.label) : '—'}</td>
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

      <div className="section-head" style={{ marginTop: 'var(--space-12)' }}>
        <div>
          <span className="section-num">백테스팅 —</span>
          <h2 className="section-title">과거 경기로 예측 검증</h2>
        </div>
        <div className="section-desc">
          이미 종료된 경기를 골라, 그 경기 시작 이전 데이터만으로 다시 예측을 돌린 뒤 실제 결과와 비교합니다. 예측
          시점 이후의 정보(그 경기 자체의 결과 포함)는 전혀 사용하지 않습니다 — 순위표만 현재 기준이라는 한계가
          있습니다.
        </div>
      </div>

      <div className="admin-actions admin-actions--backtest" style={{ marginBottom: 'var(--space-5)' }}>
        <select className="admin-select" value={backtestLeague} onChange={(e) => setBacktestLeague(e.target.value)}>
          <option value="">리그 선택</option>
          {backtestLeagues.map((league) => (
            <option key={league.value} value={league.value}>
              {league.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1900}
          max={2100}
          className="admin-count-input"
          value={backtestSeason}
          onChange={(e) => setBacktestSeason(e.target.value)}
        />
        <input
          type="number"
          min={1}
          max={20}
          className="admin-count-input"
          value={backtestCount}
          onChange={(e) => setBacktestCount(e.target.value)}
        />
        <span className="backtest-helper">시즌 / 경기 수</span>
        <Button variant="primary" size="md" onClick={handleRunBacktest} disabled={backtestRunning || !backtestLeague}>
          {backtestRunning ? '백테스트 실행 중...' : '백테스트 실행'}
        </Button>
        <Button variant="secondary" size="md" onClick={handleClearBacktestResults} disabled={backtestRunning || backtestResults.length === 0}>
          결과 초기화
        </Button>
      </div>

      {backtestNotice && <div className="state-msg" style={{ color: 'var(--color-success)' }}>{backtestNotice}</div>}
      {backtestError && <div className="state-msg error">{backtestError}</div>}

      {backtestResults.length > 0 && (
        <>
          <BacktestSummary results={backtestResults} />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>리그</th>
                  <th>경기</th>
                  <th>일시</th>
                  <th>예측</th>
                  <th>실제</th>
                  <th>승부 적중</th>
                  <th>스코어 적중</th>
                  <th>분석</th>
                </tr>
              </thead>
              <tbody>
                {visibleBacktestResults.map((r) => (
                  <tr key={r.id}>
                    <td>{r.league || '—'}</td>
                    <td>
                      {r.home_team_name} vs {r.away_team_name}
                    </td>
                    <td>{new Date(r.kickoff_at).toLocaleDateString('ko-KR')}</td>
                    <td>
                      <div className="backtest-score-cell">
                        <strong>
                          {r.predicted_score_home}-{r.predicted_score_away}
                        </strong>
                        <span>
                          홈 {r.predicted_prob_home}% / 무 {r.predicted_prob_draw}% / 원정 {r.predicted_prob_away}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="backtest-score-cell backtest-score-cell--actual">
                        <strong>
                          {r.actual_score_home}-{r.actual_score_away}
                        </strong>
                      </div>
                    </td>
                    <td style={{ color: r.outcome_correct ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {r.outcome_correct ? '적중' : '실패'}
                    </td>
                    <td style={{ color: r.score_correct ? 'var(--color-success)' : 'var(--fg-3)' }}>
                      {r.score_correct ? '적중' : '—'}
                    </td>
                    <td className="backtest-analysis-cell">{(r.analysis || '').replace(/\s+/g, ' ').trim() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {backtestResults.length > backtestPageSize && (
            <div className="backtest-pagination" role="navigation" aria-label="백테스팅 결과 페이지">
              <button className="mini-btn" onClick={() => setBacktestPage((page) => Math.max(1, page - 1))} disabled={backtestPage === 1}>
                이전
              </button>
              <span className="backtest-pagination__status">
                {backtestPage}/{backtestPageCount}
              </span>
              <button className="mini-btn" onClick={() => setBacktestPage((page) => Math.min(backtestPageCount, page + 1))} disabled={backtestPage === backtestPageCount}>
                다음
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BacktestSummary({ results }) {
  const total = results.length;
  const outcomeHits = results.filter((r) => r.outcome_correct).length;
  const scoreHits = results.filter((r) => r.score_correct).length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const getTopConfidence = (r) => {
    const probs = [Number(r.predicted_prob_home) || 0, Number(r.predicted_prob_draw) || 0, Number(r.predicted_prob_away) || 0];
    return Math.max(...probs);
  };

  const bands = [
    { label: '높음 (70%+)', min: 70, max: 100 },
    { label: '중간 (50~69%)', min: 50, max: 69.999 },
    { label: '낮음 (50% 미만)', min: 0, max: 49.999 },
  ];

  const bandStats = bands.map((band) => {
    const matches = results.filter((r) => {
      const top = getTopConfidence(r);
      return top >= band.min && top <= band.max;
    });
    const hits = matches.filter((r) => r.outcome_correct).length;
    return {
      ...band,
      total: matches.length,
      hitRate: matches.length > 0 ? pct(hits) : 0,
      hits,
    };
  });

  return (
    <>
      <div className="stat-row" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="stat-cell">
          <div className="stat-num">{total}</div>
          <div className="stat-label">백테스트 경기 수</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{pct(outcomeHits)}%</div>
          <div className="stat-label">
            승부 적중률 ({outcomeHits}/{total})
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{pct(scoreHits)}%</div>
          <div className="stat-label">
            정확한 스코어 적중률 ({scoreHits}/{total})
          </div>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 'var(--space-8)' }}>
        {bandStats.map((band) => (
          <div className="stat-cell" key={band.label}>
            <div className="stat-num">{band.total > 0 ? `${band.hitRate}%` : '—'}</div>
            <div className="stat-label">
              {band.label} ({band.hits}/{band.total})
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
