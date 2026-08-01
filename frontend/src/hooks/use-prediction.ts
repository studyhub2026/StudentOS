'use client';

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

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

export function usePredictGrades() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<ApiEnvelope<PredictionResult>>('/ai/predict');
      return data.data;
    },
  });
}
