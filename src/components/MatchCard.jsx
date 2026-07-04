import { useNavigate } from 'react-router-dom';
import Card from './ui/Card';
import Tag from './ui/Tag';
import Badge from './ui/Badge';
import TeamLogo from './TeamLogo';
import ProbBar from './ProbBar';
import { confidenceMeta } from '../lib/constants';

export default function MatchCard({ match }) {
  const navigate = useNavigate();
  const conf = confidenceMeta(match.confidence);

  return (
    <Card
      variant="default"
      interactive
      onClick={() => navigate(`/match/${match.id}`)}
      className="mcard"
    >
      <div className="mcard-top">
        <Tag variant="filled">{match.league}</Tag>
        <span className="mdate">{match.date}</span>
      </div>
      <div className="teams">
        <div className="team">
          <TeamLogo name={match.home.name} size={52} />
          <span className="tname">{match.home.name}</span>
        </div>
        <div className="score">
          {match.score.home}
          <span className="dash">–</span>
          {match.score.away}
        </div>
        <div className="team">
          <TeamLogo name={match.away.name} size={52} />
          <span className="tname">{match.away.name}</span>
        </div>
      </div>
      <ProbBar prob={match.prob} />
      <div className="mcard-foot">
        <Badge variant={conf.variant} dot>
          신뢰도 {conf.label}
        </Badge>
        <span className="expand-hint">상세 보기 →</span>
      </div>
    </Card>
  );
}
