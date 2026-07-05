import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Tag from '../components/ui/Tag';
import Badge from '../components/ui/Badge';
import TeamLogo from '../components/TeamLogo';
import ProbBar from '../components/ProbBar';
import { useMatches } from '../lib/MatchesContext';
import { confidenceMeta } from '../lib/constants';
import {
  fetchQuickMatchInfo,
  fetchLineups,
  fetchRecentForm,
  triggerEstimateLineup,
  fetchStandings,
  triggerFetchStandings,
  fetchMatchStats,
} from '../lib/fixtures';
import FormationPitch from '../components/FormationPitch';

const fmtOdds = (v) => (v == null ? '—' : v.toFixed(2));
const lineupLabel = (source) => (source === 'confirmed' ? ' (확정)' : source === 'estimated' ? ' (추정)' : ' (예상)');

export default function MatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { matches, pastMatches, loading, error, applyQuickInfo } = useMatches();

  const match = matches.find((m) => String(m.id) === id) ?? pastMatches.find((m) => String(m.id) === id);
  const conf = match?.hasPrediction ? confidenceMeta(match.confidence) : null;
  const [lineups, setLineups] = useState(null);
  const hasGridLineups = lineups != null && [...lineups.home, ...lineups.away].some((l) => l.grid_row != null);

  useEffect(() => {
    // Already have quick info (fetched previously and cached on the fixture
    // row, or a full prediction already exists), or the match is over and
    // will never get one — don't hit the Edge Function needlessly.
    if (!match || match.hasPrediction || match.quickInfoFetchedAt || match.actualScore) return;
    fetchQuickMatchInfo(match.id)
      .then((info) => applyQuickInfo(match.id, { h2h: info.h2h, h2hDetail: info.h2hDetail, odds: info.odds }))
      .catch(() => {});
    // Only re-run when the match identity or prediction state changes, not on every match object update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, match?.hasPrediction, match?.quickInfoFetchedAt, match?.actualScore]);

  useEffect(() => {
    setLineups(null);
    if (!match) return;
    let cancelled = false;

    const loadLineups = () =>
      fetchLineups(match.id).then((rows) => {
        if (cancelled) return rows;
        setLineups({
          home: rows.filter((r) => r.team_id === match.home.id),
          away: rows.filter((r) => r.team_id === match.away.id),
        });
        return rows;
      });

    loadLineups()
      .then((rows) => {
        // No official (predicted/confirmed) lineup yet and we haven't tried
        // estimating one recently — ask the server to build a best-guess XI
        // from recent form, then reload once it's done.
        if (cancelled || match.actualScore || match.estimatedLineupFetchedAt) return;
        const hasOfficial = rows.some((r) => r.source === 'confirmed' || r.source === 'predicted');
        if (hasOfficial) return;
        return triggerEstimateLineup(match.id).then(() => (cancelled ? null : loadLineups()));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [match?.id, match?.home?.id, match?.away?.id, match?.actualScore, match?.estimatedLineupFetchedAt]);

  const [recentForm, setRecentForm] = useState(null);
  useEffect(() => {
    setRecentForm(null);
    if (!match) return;
    let cancelled = false;
    Promise.all([fetchRecentForm(match.home.id), fetchRecentForm(match.away.id)])
      .then(([home, away]) => {
        if (cancelled) return;
        setRecentForm({ home, away });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match?.id, match?.home?.id, match?.away?.id]);

  const [standings, setStandings] = useState(null);
  useEffect(() => {
    setStandings(null);
    if (!match || !match.fotmobLeagueId) return;
    let cancelled = false;
    const leagueId = match.fotmobLeagueId;
    fetchStandings(leagueId)
      .then((rows) => {
        if (cancelled) return rows;
        if (rows.length > 0) setStandings(rows);
        return rows;
      })
      .then((rows) => {
        if (cancelled || (rows && rows.length > 0)) return;
        return triggerFetchStandings(leagueId).then(() => (cancelled ? null : fetchStandings(leagueId)));
      })
      .then((rows) => {
        if (cancelled || !rows) return;
        setStandings(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match?.fotmobLeagueId]);

  const homeRank = standings?.find((s) => s.fotmob_team_id === match?.home?.fotmobId)?.rank;
  const awayRank = standings?.find((s) => s.fotmob_team_id === match?.away?.fotmobId)?.rank;

  const [matchStats, setMatchStats] = useState(null);
  useEffect(() => {
    setMatchStats(null);
    if (!match) return;
    let cancelled = false;
    fetchMatchStats(match.id)
      .then((rows) => {
        if (!cancelled && rows.length > 0) setMatchStats(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match?.id]);

  return (
    <div className="wrap detail-page">
      <button className="back-btn" onClick={() => navigate('/')}>
        ← 대시보드로 돌아가기
      </button>

      {loading && <div className="state-msg">경기 데이터를 불러오는 중...</div>}
      {!loading && error && <div className="state-msg error">{error}</div>}
      {!loading && !error && !match && <div className="state-msg">해당 경기를 찾을 수 없습니다.</div>}

      {!loading && !error && match && (
        <>
          <div className="detail-meta">
            <Tag variant="filled">{match.league}</Tag>
            <span className="mdate">{match.date}</span>
            {match.venue && <span className="mdate">· {match.venue}</span>}
          </div>
          <div className="teams detail-teams">
            <div className="team">
              <TeamLogo name={match.home.name} remoteUrl={match.home.logoUrl} size={88} />
              <span className="tname" style={{ fontSize: 15 }}>
                {match.home.name}
              </span>
            </div>
            <div className="score" style={{ fontSize: 48 }}>
              {match.actualScore ? (
                <>
                  {match.actualScore.home}
                  <span className="dash">–</span>
                  {match.actualScore.away}
                </>
              ) : match.hasPrediction ? (
                <>
                  {match.score.home}
                  <span className="dash">–</span>
                  {match.score.away}
                </>
              ) : (
                <span className="dash">VS</span>
              )}
            </div>
            <div className="team">
              <TeamLogo name={match.away.name} remoteUrl={match.away.logoUrl} size={88} />
              <span className="tname" style={{ fontSize: 15 }}>
                {match.away.name}
              </span>
            </div>
          </div>

          {!match.hasPrediction && match.actualScore && <Badge variant="default">경기 종료</Badge>}

          {match.actualScore && match.hasPrediction && (
            <div className="score-compare-grid">
              <div className="detail-card score-compare-card">
                <div className="detail-block-title">실제 결과</div>
                <div className="score-compare-value">
                  {match.actualScore.home}
                  <span className="dash">–</span>
                  {match.actualScore.away}
                </div>
              </div>
              <div className="detail-card score-compare-card">
                <div className="detail-block-title">AI 예측 스코어</div>
                <div className="score-compare-value">
                  {match.score.home}
                  <span className="dash">–</span>
                  {match.score.away}
                </div>
              </div>
            </div>
          )}

          {!match.hasPrediction && !match.actualScore && (
            <div className="state-msg">
              아직 이 경기의 예측이 계산되지 않았습니다. 잠시 후 다시 확인해주세요 (자동으로 주기적으로 갱신됩니다).
            </div>
          )}

          {match.hasPrediction && (
            <>
              <ProbBar prob={match.prob} labelsStyle={{ marginBottom: 'var(--space-6)' }} />

              <Badge variant={conf.variant} dot>
                예측 신뢰도 {match.confidencePct != null ? `${match.confidencePct}%` : conf.label}
              </Badge>

              {match.gptSummary && (
                <p className="hero-sub" style={{ marginTop: 'var(--space-4)', marginBottom: 0, maxWidth: 680 }}>
                  {match.gptSummary}
                </p>
              )}
            </>
          )}

          <div className="detail-grid" style={{ marginTop: 'var(--space-8)' }}>
            <div>
              {match.hasPrediction && (
                <div className="detail-card">
                  <div className="detail-block-title">주요 변수</div>
                  <div className="factor-list">
                    {match.factors.map((text, i) => (
                      <div className="factor" key={i}>
                        <span className="factor-dot" style={{ background: 'var(--fg-3)' }} />
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {recentForm && (recentForm.home.length > 0 || recentForm.away.length > 0) && (
                <div className="detail-card">
                  <div className="detail-block-title">팀별 최근 전적 (최신순)</div>
                  <div className="detail-grid">
                    <div>
                      <div className="factor" style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                        {match.home.name}
                        {homeRank && <span className="rank-badge">{homeRank}위</span>}
                      </div>
                      <div className="factor-list">
                        {recentForm.home.map((r, i) => (
                          <div className="factor" key={i}>
                            <span className={`h2hpill ${r.result}`} style={{ width: 20, height: 20, fontSize: 10 }}>
                              {r.result}
                            </span>
                            {r.venue === 'home' ? '홈' : '원정'} {r.goals_for}–{r.goals_against} vs {r.opponent_name}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="factor" style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                        {match.away.name}
                        {awayRank && <span className="rank-badge">{awayRank}위</span>}
                      </div>
                      <div className="factor-list">
                        {recentForm.away.map((r, i) => (
                          <div className="factor" key={i}>
                            <span className={`h2hpill ${r.result}`} style={{ width: 20, height: 20, fontSize: 10 }}>
                              {r.result}
                            </span>
                            {r.venue === 'home' ? '홈' : '원정'} {r.goals_for}–{r.goals_against} vs {r.opponent_name}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="detail-card">
                <div className="detail-block-title">맞대결 경기</div>
                {match.h2hDetail.length > 0 ? (
                  <div className="factor-list">
                    {match.h2hDetail.map((m, i) => (
                      <div className="h2h-row" key={i}>
                        <span className="h2h-date">{m.date.slice(2, 10)}</span>
                        <span className="h2h-league">{m.league}</span>
                        <span className="h2h-teams">
                          {m.homeTeam} {m.homeGoals} – {m.awayGoals} {m.awayTeam}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : match.h2h.length > 0 ? (
                  <div className="h2h">
                    {match.h2h.map((r, i) => (
                      <div className={`h2hpill ${r}`} key={i}>
                        {r}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="factor">최근 맞대결 기록 없음</div>
                )}
              </div>
              {match.playerNotes.length > 0 && (
                <div className="detail-card">
                  <div className="detail-block-title">출전 선수 맞대결 이력</div>
                  <div className="factor-list">
                    {match.playerNotes.map((n, i) => (
                      <div className="factor" key={i}>
                        <span className="factor-dot" style={{ background: 'var(--fg-3)' }} />
                        {n.player} ({n.team}) — 지난 맞대결({n.meetings[0]?.date?.slice(0, 10)})에도 출전, 결과 {n.meetings[0]?.result}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {lineups && !hasGridLineups && (lineups.home.length > 0 || lineups.away.length > 0) && (
                <div className="detail-card">
                  <div className="detail-block-title">
                    선발 라인업
                    {lineupLabel(lineups.home[0]?.source ?? lineups.away[0]?.source)}
                  </div>
                  <div className="detail-grid">
                    <div>
                      <div className="factor-list">
                        {lineups.home.map((l, i) => (
                          <div className="factor" key={i}>
                            <span className="factor-dot" style={{ background: 'var(--fg-3)' }} />
                            {l.player.name}
                            {l.player.position && ` (${l.player.position})`}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="factor-list">
                        {lineups.away.map((l, i) => (
                          <div className="factor" key={i}>
                            <span className="factor-dot" style={{ background: 'var(--fg-3)' }} />
                            {l.player.name}
                            {l.player.position && ` (${l.player.position})`}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="detail-card">
                <div className="detail-block-title">배당률 (1 / X / 2)</div>
                <table className="odds-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>홈</th>
                      <th>무</th>
                      <th>원정</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>1xBet</td>
                      <td>{fmtOdds(match.odds.book.home)}</td>
                      <td>{fmtOdds(match.odds.book.draw)}</td>
                      <td>{fmtOdds(match.odds.book.away)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {matchStats && matchStats.length > 0 && (
                <div className="detail-card">
                  <div className="detail-block-title">경기 통계</div>
                  <table className="match-stats-table">
                    <tbody>
                      {matchStats.map((s) => (
                        <tr key={s.stat_key}>
                          <td className="match-stats-value">{s.home_value}</td>
                          <td className="match-stats-label">{s.stat_title}</td>
                          <td className="match-stats-value">{s.away_value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {standings && standings.length > 0 && (
                <div className="detail-card">
                  <div className="detail-block-title">리그 순위</div>
                  <table className="standings-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>팀</th>
                        <th>경기</th>
                        <th>승</th>
                        <th>무</th>
                        <th>패</th>
                        <th>득실</th>
                        <th>승점</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s) => (
                        <tr
                          key={s.fotmob_team_id}
                          className={
                            s.fotmob_team_id === match.home.fotmobId || s.fotmob_team_id === match.away.fotmobId
                              ? 'standings-highlight'
                              : ''
                          }
                        >
                          <td>{s.rank}</td>
                          <td className="standings-team">{s.team_name}</td>
                          <td>{s.played}</td>
                          <td>{s.win}</td>
                          <td>{s.draw}</td>
                          <td>{s.lose}</td>
                          <td>
                            {s.goals_for}:{s.goals_against}
                          </td>
                          <td>{s.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {hasGridLineups && (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <div className="detail-block-title">
                선발 라인업{lineupLabel(lineups.home[0]?.source ?? lineups.away[0]?.source)}
              </div>
              <div className="lineup-pitches">
                <FormationPitch
                  teamName={match.home.name}
                  teamLogoUrl={match.home.logoUrl}
                  formation={match.homeFormation}
                  players={lineups.home}
                />
                <FormationPitch
                  teamName={match.away.name}
                  teamLogoUrl={match.away.logoUrl}
                  formation={match.awayFormation}
                  players={lineups.away}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
