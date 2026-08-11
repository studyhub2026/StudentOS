'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface CourseWorkspace {
  subject: {
    id: string;
    name: string;
    code: string | null;
    color: string;
    icon: string | null;
    teacherName: string | null;
    room: string | null;
    credits: number | null;
    targetGrade: number | null;
  };
  lmsCourse: {
    id: string;
    name: string;
    code: string | null;
    instructorName: string | null;
  } | null;
  stats: {
    totalAssignments: number;
    completedAssignments: number;
    overdueAssignments: number;
    averageGrade: number | null;
    notesCount: number;
    decksCount: number;
    upcomingExams: number;
    totalGrades: number;
  };
  assignments: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    grade: number | null;
    completedAt: string | null;
    createdAt: string;
  }[];
  notes: {
    id: string;
    title: string;
    excerpt: string | null;
    updatedAt: string;
    favorite: boolean;
    pinned: boolean;
  }[];
  decks: {
    id: string;
    title: string;
    updatedAt: string;
    cardCount: number;
  }[];
  schedule: {
    id: string;
    title: string;
    type: string;
    startAt: string;
    endAt: string;
    location: string | null;
  }[];
  grades: {
    id: string;
    label: string;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    letterGrade: string | null;
    postedAt: string | null;
  }[];
  tutor: {
    id: string;
    subjectKey: string;
    subject: string;
  } | null;
}

export function useCourseWorkspace(courseId: string | undefined) {
  return useQuery<CourseWorkspace>({
    queryKey: ['course-workspace', courseId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/courses/${courseId}`);
      return data.data;
    },
    enabled: Boolean(courseId),
    staleTime: 2 * 60_000,
  });
}
