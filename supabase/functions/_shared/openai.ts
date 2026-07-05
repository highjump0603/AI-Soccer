// GPT is now the sole predictor (no separate statistical model blended in
// afterward) — it's given every signal we can gather (formation, expected
// lineup, rest/fatigue, discipline, H2H, each team's own recent form and
// league position, plus a reference expected-goals estimate) and asked to
// reason through all of it to a final score and probabilities directly, in
// Korean since that's what the site displays.

const RESPONSE_SCHEMA = {
  name: 'match_prediction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prob_home: { type: 'number', description: '홈팀 승리 확률 (0-100)' },
      prob_draw: { type: 'number', description: '무승부 확률 (0-100)' },
      prob_away: { type: 'number', description: '원정팀 승리 확률 (0-100)' },
      score_home: { type: 'integer', description: '예상 홈팀 득점' },
      score_away: { type: 'integer', description: '예상 원정팀 득점' },
      factors: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 5,
        description: '예측에 영향을 준 핵심 변수 3~5개, 각각 한 문장, 한국어',
      },
      summary: { type: 'string', description: '한두 문장짜리 종합 코멘트, 한국어' },
    },
    required: ['prob_home', 'prob_draw', 'prob_away', 'score_home', 'score_away', 'factors', 'summary'],
  },
};

export type GptPredictionInput = {
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  homeFormSummary: string;
  awayFormSummary: string;
  h2hSummary: string;
  homeLineupSummary: string;
  awayLineupSummary: string;
  homeFormationNote: string;
  awayFormationNote: string;
  homeFatigueNote: string;
  awayFatigueNote: string;
  homeDisciplineNote: string;
  awayDisciplineNote: string;
  homeStandingNote: string;
  awayStandingNote: string;
  referenceXg: string;
};

export type GptPrediction = {
  probHome: number;
  probDraw: number;
  probAway: number;
  scoreHome: number;
  scoreAway: number;
  factors: string[];
  summary: string;
};

export async function getGptPrediction(input: GptPredictionInput): Promise<GptPrediction> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY secret is not set for this function.');

  const prompt = `다음은 실제 축구 경기 데이터입니다. 아래 모든 정보를 종합적으로 고려해 승/무/패 확률과 예상 스코어를 직접 예측해주세요. 별도의 통계 모델은 없으니, 당신의 예측이 곧 최종 예측입니다.

리그: ${input.league}
경기: ${input.homeTeam} (홈) vs ${input.awayTeam} (원정)
킥오프: ${input.kickoffAt}

[리그 순위]
홈팀 - ${input.homeStandingNote}
원정팀 - ${input.awayStandingNote}

[홈팀 최근 폼]
${input.homeFormSummary}

[원정팀 최근 폼]
${input.awayFormSummary}

[최근 상대 전적]
${input.h2hSummary}

[포메이션]
홈팀 - ${input.homeFormationNote}
원정팀 - ${input.awayFormationNote}

[예상/확정 선발 라인업]
${input.homeLineupSummary}
${input.awayLineupSummary}

[휴식/피로도]
홈팀 - ${input.homeFatigueNote}
원정팀 - ${input.awayFatigueNote}

[카드/징계 (최근 경기 평균)]
홈팀 - ${input.homeDisciplineNote}
원정팀 - ${input.awayDisciplineNote}

[참고용 기대득점 (최근 득점력/실점력 기반 참고치, 그대로 따를 필요는 없음)]
${input.referenceXg}

위 모든 요소(포메이션, 라인업, 피로도, 카드/징계, 맞대결, 각 팀의 최근 폼과 순위, 기대득점)를 근거로 삼아 최종 스코어와 확률을 예측하세요. 확률 3개의 합은 반드시 100이 되어야 합니다. factors에는 실제로 이 예측에 영향을 준 구체적인 근거(예: 포메이션 상성, 피로 누적, 카드 누적으로 인한 결장 위험, 순위 격차 등)를 담아주세요.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '당신은 신중하고 데이터 기반적인 축구 분석가입니다. 반드시 요청된 JSON 스키마로만 응답하세요.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response had no content.');

  const parsed = JSON.parse(content);
  return {
    probHome: parsed.prob_home,
    probDraw: parsed.prob_draw,
    probAway: parsed.prob_away,
    scoreHome: parsed.score_home,
    scoreAway: parsed.score_away,
    factors: parsed.factors,
    summary: parsed.summary,
  };
}
