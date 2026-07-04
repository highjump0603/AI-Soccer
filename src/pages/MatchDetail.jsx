import { useNavigate, useParams } from 'react-router-dom';
import Tag from '../components/ui/Tag';
import Badge from '../components/ui/Badge';
import TeamLogo from '../components/TeamLogo';
import ProbBar from '../components/ProbBar';
import { useMatches } from '../lib/MatchesContext';
import { confidenceMeta } from '../lib/constants';

const fmtOdds = (v) => (v == null ? '—' : v.toFixed(2));

export default function MatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { matches, loading, error } = useMatches();

  const match = matches.find((m) => String(m.id) === id);
  const conf = match?.hasPrediction ? confidenceMeta(match.confidence) : null;

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
          </div>
          <div className="teams detail-teams">
            <div className="team">
              <TeamLogo name={match.home.name} remoteUrl={match.home.logoUrl} size={88} />
              <span className="tname" style={{ fontSize: 15 }}>
                {match.home.name}
              </span>
            </div>
            <div className="score" style={{ fontSize: 48 }}>
              {match.hasPrediction ? (
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

          {!match.hasPrediction && (
            <div className="state-msg">
              아직 이 경기의 예측이 계산되지 않았습니다. 잠시 후 다시 확인해주세요 (자동으로 주기적으로 갱신됩니다).
            </div>
          )}

          {match.hasPrediction && (
            <>
              <ProbBar prob={match.prob} labelsStyle={{ marginBottom: 'var(--space-6)' }} />

              <Badge variant={conf.variant} dot>
                예측 신뢰도 {conf.label}
              </Badge>

              {match.gptSummary && (
                <p className="hero-sub" style={{ marginTop: 'var(--space-4)', marginBottom: 0, maxWidth: 680 }}>
                  {match.gptSummary}
                </p>
              )}

              <div className="detail-grid" style={{ marginTop: 'var(--space-8)' }}>
                <div>
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
                  <div className="detail-card">
                    <div className="detail-block-title">최근 상대 전적 (홈팀 기준, 최신순)</div>
                    {match.h2h.length > 0 ? (
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
                </div>
                <div>
                  <div className="detail-card">
                    <div className="detail-block-title">배당률 비교 (1 / X / 2)</div>
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
                          <td>북메이커 평균</td>
                          <td>{fmtOdds(match.odds.book.home)}</td>
                          <td>{fmtOdds(match.odds.book.draw)}</td>
                          <td>{fmtOdds(match.odds.book.away)}</td>
                        </tr>
                        <tr className="ai-row">
                          <td>AI 예측(환산)</td>
                          <td>{fmtOdds(match.odds.ai.home)}</td>
                          <td>{fmtOdds(match.odds.ai.draw)}</td>
                          <td>{fmtOdds(match.odds.ai.away)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
