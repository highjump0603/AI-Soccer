// GPT side of the ensemble — same underlying stats as the Poisson model,
// but asked to weigh qualitative context (missing players, run of form,
// fixture context) the way a knowledgeable fan would, in Korean since
// that's what the site displays.

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
        maxItems: 4,
        description: '예측에 영향을 준 핵심 변수 3~4개, 각각 한 문장, 한국어',
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

  const prompt = `다음은 실제 축구 경기 데이터입니다. 이 정보를 바탕으로 승/무/패 확률과 예상 스코어를 예측해주세요.

리그: ${input.league}
경기: ${input.homeTeam} (홈) vs ${input.awayTeam} (원정)
킥오프: ${input.kickoffAt}

[홈팀 최근 폼]
${input.homeFormSummary}

[원정팀 최근 폼]
${input.awayFormSummary}

[최근 상대 전적]
${input.h2hSummary}

[홈팀 라인업 소식]
${input.homeLineupSummary}

[원정팀 라인업 소식]
${input.awayLineupSummary}

통계적으로 계산된 별도 모델이 이미 있으니, 당신은 위 맥락(부상/로테이션/최근 흐름 등 정성적 요소)을 반영해 독립적인 예측을 내주세요. 확률 3개의 합은 반드시 100이 되어야 합니다.`;

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
