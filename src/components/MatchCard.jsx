import { useNavigate } from 'react-router-dom';
import Card from './ui/Card';
import Tag from './ui/Tag';
import Badge from './ui/Badge';
import TeamLogo from './TeamLogo';
import ProbBar from './ProbBar';
import { confidenceMeta } from '../lib/constants';

export default function MatchCard({ match }) {
  const navigate = useNavigate();
  const conf = match.hasPrediction ? confidenceMeta(match.confidence) : null;

  return (
    <Card variant="default" interactive onClick={() => navigate(`/match/${match.id}`)} className="mcard">
      <div className="mcard-top">
        <Tag variant="filled">{match.league}</Tag>
        <span className="mdate">
          {match.date}
          {match.venue && ` · ${match.venue}`}
        </span>
      </div>
      <div className="teams">
        <div className="team">
          <TeamLogo name={match.home.name} remoteUrl={match.home.logoUrl} size={52} />
          <span className="tname">{match.home.name}</span>
        </div>
        <div>
          <div className="score">
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
          {match.actualScore && match.hasPrediction && (
            <div className="score-predicted-sub">
              AI {match.score.home}–{match.score.away}
            </div>
          )}
        </div>
        <div className="team">
          <TeamLogo name={match.away.name} remoteUrl={match.away.logoUrl} size={52} />
          <span className="tname">{match.away.name}</span>
        </div>
      </div>
      {match.hasPrediction ? (
        <>
          <ProbBar prob={match.prob} />
          <div className="mcard-foot">
            <Badge variant={conf.variant} dot>
              신뢰도 {conf.label}
            </Badge>
            <span className="expand-hint">상세 보기 →</span>
          </div>
        </>
      ) : (
        <div className="mcard-foot">
          <Badge variant="default">{match.actualScore ? '경기 종료' : '예측 계산 중'}</Badge>
          <span className="expand-hint">상세 보기 →</span>
        </div>
      )}
    </Card>
  );
}
