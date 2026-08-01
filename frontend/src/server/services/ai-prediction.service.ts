import 'server-only';
import { getOverview } from './analytics.service';
import { generateJson } from './gemini.service';

export interface SubjectPrediction {
  subjectId: string;
  name: string;
  predictedGrade: number;
  currentAverage: number | null;
  confidence: number;
  trend: 'improving' | 'stable' | 'declining';
  weakTopics: string[];
  recommendation: string;
}

export interface PredictionResult {
  overallPredictedGpa: number | null;
  summary: string;
  subjects: SubjectPrediction[];
  studyRecommendations: string[];
  riskAlert: string | null;
  model: string;
}

const PREDICTION_SCHEMA = {
  type: 'object',
  properties: {
    overallPredictedGpa: { type: 'number' },
    summary: { type: 'string' },
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: { type: 'string' },
          name: { type: 'string' },
          predictedGrade: { type: 'number' },
          confidence: { type: 'number' },
          trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
          weakTopics: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
        required: ['subjectId', 'name', 'predictedGrade', 'confidence', 'trend', 'weakTopics', 'recommendation'],
      },
    },
    studyRecommendations: { type: 'array', items: { type: 'string' } },
    riskAlert: { type: 'string' },
  },
  required: ['overallPredictedGpa', 'summary', 'subjects', 'studyRecommendations'],
} as const;

interface RawPrediction {
  overallPredictedGpa: number;
  summary: string;
  subjects: {
    subjectId: string;
    name: string;
    predictedGrade: number;
    confidence: number;
    trend: 'improving' | 'stable' | 'declining';
    weakTopics: string[];
    recommendation: string;
  }[];
  studyRecommendations: string[];
  riskAlert?: string;
}

export async function predictGrades(userId: string): Promise<PredictionResult> {
  const analytics = await getOverview(userId, 30);

  const subjectContext = analytics.subjects
    .map(
      (s) =>
        `- ${s.name} (id: ${s.subjectId}): studyMinutes=${s.studyMinutes}, assignments=${s.assignmentsCompleted}/${s.assignmentsTotal} (${Math.round(
          s.completionRate * 100,
        )}% complete), currentAverage=${s.averageGrade ?? 'none'}`,
    )
    .join('\n');

  const weakContext = analytics.weakSubjects.map((w) => `- ${w.name}: ${w.reason}`).join('\n');

  const prompt = `You are an academic performance analyst. Based on this student's last 30 days of study data, predict their likely grades and give actionable study recommendations.

Study overview:
- Total study time: ${analytics.totals.studyMinutes} minutes across ${analytics.totals.sessions} sessions
- Average per active day: ${analytics.averages.minutesPerActiveDay} minutes
- Productivity score: ${analytics.averages.productivityScore}/100
- Current streak: ${analytics.streak.current} days
- Burnout risk: ${analytics.burnout.atRisk ? `YES — ${analytics.burnout.reason}` : 'no'}
- Overall current average: ${analytics.grades.overallAverage ?? 'none'}%
- Current GPA: ${analytics.grades.gpa ?? 'none'}

Subjects:
${subjectContext || 'No subjects with data.'}

Flagged weak subjects:
${weakContext || 'None flagged.'}

For each subject, predict a grade percentage (0-100), assign a confidence (0-100), a trend, likely weak topics (inferred from the subject and low completion), and one concrete recommendation. Use the exact subjectId values provided. Also give 3-5 overall study recommendations and, if there is a real risk (burnout, falling behind), a short risk alert. Base predictions strictly on the data — do not invent grades where there is no signal, estimate conservatively.`;

  const result = await generateJson<RawPrediction>({
    messages: [{ role: 'user', content: prompt }],
    responseSchema: PREDICTION_SCHEMA as unknown as Record<string, unknown>,
    // flash matches the rest of the app and has far higher free-tier quota than
    // pro, which gets rate-limited immediately on the demo key.
    tier: 'flash',
    parse: (v) => v as RawPrediction,
  });

  const byId = new Map(analytics.subjects.map((s) => [s.subjectId, s.averageGrade]));

  return {
    overallPredictedGpa: result.data.overallPredictedGpa,
    summary: result.data.summary,
    subjects: result.data.subjects.map((s) => ({
      ...s,
      currentAverage: byId.get(s.subjectId) ?? null,
    })),
    studyRecommendations: result.data.studyRecommendations,
    riskAlert: result.data.riskAlert ?? null,
    model: result.model,
  };
}
