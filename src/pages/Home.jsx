import { useState } from 'react';
import Button from '../components/ui/Button';
import MatchCard from '../components/MatchCard';
import { useMatches } from '../lib/MatchesContext';
import { LEAGUES } from '../lib/constants';

export default function Home() {
  const { matches, pastMatches, loading, error } = useMatches();
  const [activeLeague, setActiveLeague] = useState('전체');

  const filtered = activeLeague === '전체' ? matches : matches.filter((m) => m.league === activeLeague);
  const filteredPast = activeLeague === '전체' ? pastMatches : pastMatches.filter((m) => m.league === activeLeague);

  return (
    <div className="wrap">
      <section className="hero" id="top">
        <div className="hero-kicker">AI 기반 경기 예측 엔진</div>
        <h1 className="hero-title">
          다음 경기, <em>데이터</em>가 먼저 본다
        </h1>
        <p className="hero-sub">
          전 세계 주요 리그와 국가대표 경기를 AI 모델이 분석해 승부 확률과 예상 스코어를 제공합니다. 베팅이 아닌, 재미로 보는 예측입니다.
        </p>
        <div className="hero-actions">
          <Button
            variant="primary"
            size="lg"
            onClick={() => document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth' })}
          >
            예측 보러가기 →
          </Button>
        </div>
        <div className="stat-row">
          <div className="stat-cell">
            <div className="stat-num">
              <span>{matches.length}</span>
            </div>
            <div className="stat-label">이번 주 분석 경기</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num">
              61<span>%</span>
            </div>
            <div className="stat-label">평균 적중률(최근 시즌)</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num">14</div>
            <div className="stat-label">커버 리그/대회</div>
          </div>
          <div className="stat-cell">
            <div className="stat-num">
              5<span>개</span>
            </div>
            <div className="stat-label">모델 입력 변수 그룹</div>
          </div>
        </div>
      </section>

      <section className="section" id="dashboard">
        <div className="section-head">
          <div>
            <span className="section-num">01 —</span>
            <h2 className="section-title">예측 대시보드</h2>
          </div>
          <div className="section-desc">리그를 선택하고 카드를 클릭하면 경기 상세 페이지로 이동합니다.</div>
        </div>
        <div className="tabs">
          {LEAGUES.map((lg) => (
            <button
              key={lg}
              className={`tab ${lg === activeLeague ? 'active' : ''}`}
              onClick={() => setActiveLeague(lg)}
            >
              {lg}
            </button>
          ))}
        </div>

        {loading && <div className="state-msg">경기 데이터를 불러오는 중...</div>}
        {error && <div className="state-msg error">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="state-msg">
            {matches.length === 0 ? '등록된 경기가 없습니다. 관리자 페이지에서 추가해보세요.' : '해당 리그의 경기가 없습니다.'}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid">
            {filtered.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </section>

      <section className="section" id="past">
        <div className="section-head">
          <div>
            <span className="section-num">02 —</span>
            <h2 className="section-title">지난 경기 결과</h2>
          </div>
          <div className="section-desc">최근 종료된 경기의 결과입니다.</div>
        </div>

        {!loading && !error && filteredPast.length === 0 && <div className="state-msg">최근 종료된 경기가 없습니다.</div>}

        {!loading && !error && filteredPast.length > 0 && (
          <div className="grid">
            {filteredPast.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </section>

      <section className="section" id="about">
        <div className="section-head">
          <div>
            <span className="section-num">03 —</span>
            <h2 className="section-title">모델 소개</h2>
          </div>
        </div>
        <p className="hero-sub" style={{ maxWidth: 680 }}>
          최근 폼, 부상자 현황, 홈/원정 기록, 상대 전적, 대회 중요도 등 다섯 그룹의 변수를 학습한 모델이 매 경기의 승/무/패
          확률과 예상 스코어를 산출합니다. 예측은 참고용이며 실제 결과와 다를 수 있습니다.
        </p>
      </section>
    </div>
  );
}
