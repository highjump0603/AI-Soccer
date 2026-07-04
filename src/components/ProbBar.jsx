import { maxProbKey } from '../lib/constants';

export default function ProbBar({ prob, labelsStyle }) {
  const maxKey = maxProbKey(prob);
  const segColor = (key) => (maxKey === key ? 'var(--color-accent)' : 'var(--border-strong)');

  return (
    <>
      <div className="probbar">
        <div className="probseg" style={{ width: `${prob.home}%`, background: segColor('home') }} />
        <div className="probseg" style={{ width: `${prob.draw}%`, background: segColor('draw') }} />
        <div className="probseg" style={{ width: `${prob.away}%`, background: segColor('away') }} />
      </div>
      <div className="problabels" style={labelsStyle}>
        <span className={maxKey === 'home' ? 'max' : ''}>홈 {prob.home}%</span>
        <span className={`mid ${maxKey === 'draw' ? 'max' : ''}`}>무 {prob.draw}%</span>
        <span className={`end ${maxKey === 'away' ? 'max' : ''}`}>원정 {prob.away}%</span>
      </div>
    </>
  );
}
