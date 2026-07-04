import { useState } from 'react';
import Button from '../components/ui/Button';
import { useMatches } from '../lib/MatchesContext';
import { LEAGUE_OPTIONS, confidenceMeta } from '../lib/constants';

function emptyForm() {
  return {
    home: '',
    away: '',
    league: LEAGUE_OPTIONS[0],
    date: '',
    scoreHome: '1',
    scoreAway: '1',
    probHome: '40',
    probDraw: '30',
    probAway: '30',
    confidence: 'medium',
    oddsBookHome: '2.5',
    oddsBookDraw: '3.2',
    oddsBookAway: '3.0',
    oddsAiHome: '2.5',
    oddsAiDraw: '3.2',
    oddsAiAway: '3.0',
    factors: '',
  };
}

function formFromMatch(m) {
  return {
    home: m.home.name,
    away: m.away.name,
    league: m.league,
    date: m.date,
    scoreHome: String(m.score.home),
    scoreAway: String(m.score.away),
    probHome: String(m.prob.home),
    probDraw: String(m.prob.draw),
    probAway: String(m.prob.away),
    confidence: m.confidence,
    oddsBookHome: String(m.odds.book.home),
    oddsBookDraw: String(m.odds.book.draw),
    oddsBookAway: String(m.odds.book.away),
    oddsAiHome: String(m.odds.ai.home),
    oddsAiDraw: String(m.odds.ai.draw),
    oddsAiAway: String(m.odds.ai.away),
    factors: m.factors.join('\n'),
  };
}

export default function Admin() {
  const { matches, loading, error, addMatch, editMatch, removeMatch } = useMatches();
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFormError('');
  }

  function startEdit(m) {
    setEditingId(m.id);
    setForm(formFromMatch(m));
    setFormError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError('');
  }

  async function handleDelete(id) {
    try {
      await removeMatch(id);
      if (editingId === id) cancelEdit();
    } catch (e) {
      setFormError(e.message || '삭제에 실패했습니다.');
    }
  }

  async function handleSubmit() {
    if (!form.home.trim() || !form.away.trim()) {
      setFormError('홈팀명과 원정팀명을 입력해주세요.');
      return;
    }
    let factors = form.factors.split('\n').map((s) => s.trim()).filter(Boolean);
    if (factors.length === 0) factors = ['등록된 변수 없음'];

    const match = {
      league: form.league,
      date: form.date || '일정 미정',
      home: { name: form.home.trim() },
      away: { name: form.away.trim() },
      prob: { home: Number(form.probHome) || 0, draw: Number(form.probDraw) || 0, away: Number(form.probAway) || 0 },
      score: { home: Number(form.scoreHome) || 0, away: Number(form.scoreAway) || 0 },
      confidence: form.confidence,
      factors,
      odds: {
        book: { home: Number(form.oddsBookHome) || 0, draw: Number(form.oddsBookDraw) || 0, away: Number(form.oddsBookAway) || 0 },
        ai: { home: Number(form.oddsAiHome) || 0, draw: Number(form.oddsAiDraw) || 0, away: Number(form.oddsAiAway) || 0 },
      },
      h2h: editingId != null ? matches.find((m) => m.id === editingId)?.h2h : undefined,
    };

    setSubmitting(true);
    setFormError('');
    try {
      if (editingId != null) {
        await editMatch(editingId, match);
      } else {
        await addMatch(match);
      }
      setEditingId(null);
      setForm(emptyForm());
    } catch (e) {
      setFormError(e.message || '저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wrap admin-page">
      <div className="section-head">
        <div>
          <span className="section-num">관리자 —</span>
          <h2 className="section-title">경기 데이터 관리</h2>
        </div>
      </div>

      <div className="admin-grid">
        <label className="admin-field">
          <span>리그</span>
          <select value={form.league} onChange={(e) => setField('league', e.target.value)}>
            {LEAGUE_OPTIONS.map((lo) => (
              <option key={lo} value={lo}>
                {lo}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>경기 일시</span>
          <input
            type="text"
            placeholder="7/10 (금) 20:00"
            value={form.date}
            onInput={(e) => setField('date', e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>신뢰도</span>
          <select value={form.confidence} onChange={(e) => setField('confidence', e.target.value)}>
            <option value="high">높음</option>
            <option value="medium">보통</option>
            <option value="low">낮음</option>
          </select>
        </label>
        <label className="admin-field">
          <span>홈팀명</span>
          <input type="text" placeholder="예: 맨체스터 시티" value={form.home} onInput={(e) => setField('home', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>원정팀명</span>
          <input type="text" placeholder="예: 리버풀" value={form.away} onInput={(e) => setField('away', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>예상 스코어 (홈-원정)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" value={form.scoreHome} onInput={(e) => setField('scoreHome', e.target.value)} />
            <input type="number" value={form.scoreAway} onInput={(e) => setField('scoreAway', e.target.value)} />
          </div>
        </label>
        <label className="admin-field">
          <span>승률 홈 %</span>
          <input type="number" value={form.probHome} onInput={(e) => setField('probHome', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>승률 무 %</span>
          <input type="number" value={form.probDraw} onInput={(e) => setField('probDraw', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>승률 원정 %</span>
          <input type="number" value={form.probAway} onInput={(e) => setField('probAway', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>배당률 — 북메이커 (홈/무/원정)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" step="0.01" value={form.oddsBookHome} onInput={(e) => setField('oddsBookHome', e.target.value)} />
            <input type="number" step="0.01" value={form.oddsBookDraw} onInput={(e) => setField('oddsBookDraw', e.target.value)} />
            <input type="number" step="0.01" value={form.oddsBookAway} onInput={(e) => setField('oddsBookAway', e.target.value)} />
          </div>
        </label>
        <label className="admin-field">
          <span>배당률 — AI 환산 (홈/무/원정)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" step="0.01" value={form.oddsAiHome} onInput={(e) => setField('oddsAiHome', e.target.value)} />
            <input type="number" step="0.01" value={form.oddsAiDraw} onInput={(e) => setField('oddsAiDraw', e.target.value)} />
            <input type="number" step="0.01" value={form.oddsAiAway} onInput={(e) => setField('oddsAiAway', e.target.value)} />
          </div>
        </label>
        <label className="admin-field wide">
          <span>주요 변수 (한 줄에 하나씩)</span>
          <textarea value={form.factors} onInput={(e) => setField('factors', e.target.value)} />
        </label>
      </div>

      {formError && <div className="form-error" style={{ marginBottom: 'var(--space-4)' }}>{formError}</div>}

      <div className="admin-actions">
        <Button variant="primary" size="md" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '저장 중...' : editingId != null ? '경기 수정 저장' : '경기 추가'}
        </Button>
        {editingId != null && (
          <Button variant="ghost" size="md" onClick={cancelEdit}>
            취소
          </Button>
        )}
      </div>

      {loading && <div className="state-msg">경기 데이터를 불러오는 중...</div>}
      {error && <div className="state-msg error">{error}</div>}

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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const conf = confidenceMeta(m.confidence);
                return (
                  <tr key={m.id}>
                    <td>{m.league}</td>
                    <td>{m.date}</td>
                    <td>{m.home.name}</td>
                    <td>{m.away.name}</td>
                    <td>{m.score.home}-{m.score.away}</td>
                    <td>{conf.label}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="mini-btn" onClick={() => startEdit(m)}>수정</button>
                        <button className="mini-btn danger" onClick={() => handleDelete(m.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
