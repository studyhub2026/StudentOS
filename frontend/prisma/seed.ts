/**
 * Database seed.
 *
 * Creates a coherent, realistic dataset for one demo student: subjects,
 * assignments across every status, notes with version history, a flashcard
 * deck with cards at different SM-2 maturities, a week of schedule blocks,
 * study sessions with matching daily stats, a study group with chat history,
 * and achievements.
 *
 * Idempotent: re-running replaces the demo user's data rather than
 * accumulating duplicates. It never touches other accounts.
 *
 *   npm run prisma:seed --workspace=backend
 */
import {
  AssignmentStatus,
  CardDifficulty,
  CardState,
  ChannelType,
  GroupRole,
  NotificationType,
  Priority,
  PrismaClient,
  Role,
  ScheduleBlockType,
  StudySessionType,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@studentos.ai';
const DEMO_PASSWORD = 'DemoPassword123';
const PEER_EMAIL = 'peer@studentos.ai';
const ADMIN_EMAIL = 'admin@studentos.ai';
const ADMIN_PASSWORD = 'AdminPassword123';

/** Midnight today, so seeded dates land predictably relative to "now". */
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function daysFromToday(days: number, hour = 9): Date {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function main(): Promise<void> {
  console.log('Seeding StudentOS AI…\n');

  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  // --- Users --------------------------------------------------------------
  // Delete-then-recreate keeps the seed idempotent; cascades clear everything
  // owned by these accounts without touching anyone else's rows.
  await prisma.user.deleteMany({
    where: { email: { in: [DEMO_EMAIL, PEER_EMAIL, ADMIN_EMAIL] } },
  });

  const demo = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      username: 'demo',
      name: 'Demo Student',
      passwordHash,
      role: Role.STUDENT,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      currentStreak: 5,
      longestStreak: 12,
      totalXp: 2480,
      lastActiveDate: new Date(),
      settings: {
        create: {
          dailyStudyGoalMinutes: 150,
          pomodoroWorkMinutes: 25,
          aiTone: 'encouraging',
        },
      },
    },
  });
  console.log(`  user       ${demo.email}`);

  const peer = await prisma.user.create({
    data: {
      email: PEER_EMAIL,
      username: 'peer',
      name: 'Study Partner',
      passwordHash,
      role: Role.STUDENT,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      settings: { create: {} },
    },
  });
  console.log(`  user       ${peer.email}`);

  // A dedicated administrator so the admin dashboard is reachable out of the
  // box. Hashed separately since it uses its own password.
  const adminPasswordHash = await hash(ADMIN_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      username: 'admin',
      name: 'Platform Admin',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      settings: { create: {} },
    },
  });
  console.log(`  user       ${admin.email} (admin)`);

  // --- Subjects -----------------------------------------------------------
  const subjectSpecs = [
    { name: 'Organic Chemistry', code: 'CHEM241', color: '#8b5cf6', credits: 4, targetGrade: 85 },
    { name: 'Linear Algebra', code: 'MATH210', color: '#38bdf8', credits: 3, targetGrade: 90 },
    { name: 'Cell Biology', code: 'BIO150', color: '#2dd4bf', credits: 4, targetGrade: 80 },
    { name: 'Modern History', code: 'HIST101', color: '#fbbf24', credits: 3, targetGrade: 75 },
  ];

  const subjects = await Promise.all(
    subjectSpecs.map((spec) =>
      prisma.subject.create({
        data: { ...spec, userId: demo.id, teacherName: 'Dr. Reyes', room: 'B-204' },
      }),
    ),
  );
  console.log(`  subjects   ${subjects.length}`);

  const [chem, maths, bio, history] = subjects as [
    (typeof subjects)[0],
    (typeof subjects)[0],
    (typeof subjects)[0],
    (typeof subjects)[0],
  ];

  // --- Assignments --------------------------------------------------------
  // Deliberately spans every status, plus overdue and graded work, so the
  // dashboard, filters and analytics all have something real to render.
  const assignmentSpecs = [
    {
      title: 'Alkene reaction mechanisms worksheet',
      subjectId: chem.id,
      status: AssignmentStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      dueAt: daysFromToday(1, 17),
      estimatedMinutes: 120,
      actualMinutes: 45,
      progress: 40,
      labels: ['worksheet', 'mechanisms'],
    },
    {
      title: 'Eigenvalue problem set 4',
      subjectId: maths.id,
      status: AssignmentStatus.TODO,
      priority: Priority.URGENT,
      dueAt: daysFromToday(0, 23),
      estimatedMinutes: 90,
      labels: ['problem-set'],
    },
    {
      title: 'Mitosis lab report',
      subjectId: bio.id,
      status: AssignmentStatus.BLOCKED,
      priority: Priority.MEDIUM,
      dueAt: daysFromToday(4, 12),
      estimatedMinutes: 180,
      progress: 15,
      labels: ['lab', 'report'],
    },
    {
      title: 'Cold War essay — 2000 words',
      subjectId: history.id,
      status: AssignmentStatus.TODO,
      priority: Priority.HIGH,
      dueAt: daysFromToday(9, 17),
      estimatedMinutes: 300,
      labels: ['essay'],
    },
    {
      title: 'Stereochemistry quiz revision',
      subjectId: chem.id,
      status: AssignmentStatus.COMPLETED,
      priority: Priority.MEDIUM,
      dueAt: daysFromToday(-3, 15),
      completedAt: daysFromToday(-4, 20),
      estimatedMinutes: 60,
      actualMinutes: 75,
      progress: 100,
      grade: 88,
      maxGrade: 100,
      weight: 10,
    },
    {
      title: 'Matrix determinants homework',
      subjectId: maths.id,
      status: AssignmentStatus.SUBMITTED,
      priority: Priority.LOW,
      dueAt: daysFromToday(-1, 12),
      completedAt: daysFromToday(-1, 10),
      estimatedMinutes: 45,
      actualMinutes: 50,
      progress: 100,
      grade: 92,
      maxGrade: 100,
      weight: 5,
    },
    {
      // Past due and unfinished — drives the "overdue" counters.
      title: 'Photosynthesis reading response',
      subjectId: bio.id,
      status: AssignmentStatus.TODO,
      priority: Priority.MEDIUM,
      dueAt: daysFromToday(-2, 17),
      estimatedMinutes: 40,
      labels: ['reading'],
    },
  ];

  await prisma.assignment.createMany({
    data: assignmentSpecs.map((spec) => ({ ...spec, userId: demo.id })),
  });
  console.log(`  assignments ${assignmentSpecs.length}`);

  // --- Notes, folders and versions ----------------------------------------
  const folder = await prisma.noteFolder.create({
    data: { userId: demo.id, name: 'Semester 1', color: '#8b5cf6' },
  });

  const noteContent = `# Alkene Reactions

Alkenes undergo **electrophilic addition** because the pi bond is a region of
high electron density.

## Markovnikov's rule

The hydrogen adds to the carbon already bearing more hydrogens, because the
more substituted carbocation intermediate is more stable.

- Tertiary carbocation — most stable
- Secondary carbocation — moderately stable
- Primary carbocation — least stable

> Carbocation stability is the single idea most of this chapter rests on.
`;

  const note = await prisma.note.create({
    data: {
      userId: demo.id,
      subjectId: chem.id,
      folderId: folder.id,
      title: 'Alkene Reactions',
      content: noteContent,
      excerpt: 'Alkene Reactions Alkenes undergo electrophilic addition because the pi bond…',
      wordCount: 78,
      tags: ['chemistry', 'mechanisms'],
      favorite: true,
    },
  });

  // An earlier revision, so version history has something to show.
  await prisma.noteVersion.create({
    data: {
      noteId: note.id,
      version: 1,
      title: 'Alkene Reactions',
      content: '# Alkene Reactions\n\nInitial notes from the lecture.',
      wordCount: 7,
      automatic: true,
      createdAt: daysFromToday(-2, 14),
    },
  });

  await prisma.note.createMany({
    data: [
      {
        userId: demo.id,
        subjectId: maths.id,
        folderId: folder.id,
        title: 'Eigenvalues and eigenvectors',
        content:
          '# Eigenvalues\n\nAv = λv. The eigenvector keeps its direction under the transformation; only its scale changes.',
        excerpt: 'Eigenvalues Av = λv. The eigenvector keeps its direction…',
        wordCount: 20,
        tags: ['maths', 'linear-algebra'],
      },
      {
        userId: demo.id,
        subjectId: history.id,
        title: 'Cold War essay plan',
        content: '# Essay plan\n\n1. Origins\n2. Escalation\n3. Détente\n4. Collapse',
        excerpt: 'Essay plan 1. Origins 2. Escalation 3. Détente 4. Collapse',
        wordCount: 10,
        tags: ['history', 'essay'],
        archivedAt: daysFromToday(-5),
      },
    ],
  });
  console.log('  notes      3 (1 with version history, 1 archived)');

  // --- Flashcards ---------------------------------------------------------
  const deck = await prisma.flashcardDeck.create({
    data: {
      userId: demo.id,
      subjectId: chem.id,
      sourceNoteId: note.id,
      name: 'Organic Chemistry — Reactions',
      description: 'Mechanisms, reagents and selectivity rules.',
      color: '#8b5cf6',
    },
  });

  // Cards spread across SM-2 states so the review queue, maturity counts and
  // statistics all have realistic inputs.
  const cardSpecs = [
    {
      front: 'What does Markovnikov’s rule predict?',
      back: 'The hydrogen adds to the carbon with more hydrogens, giving the more stable carbocation.',
      difficulty: CardDifficulty.MEDIUM,
      state: CardState.REVIEW,
      easeFactor: 2.6,
      intervalDays: 30,
      repetitions: 5,
      dueAt: daysFromToday(6),
      lastReviewedAt: daysFromToday(-24),
    },
    {
      front: 'Rank carbocation stability.',
      back: 'Tertiary > secondary > primary > methyl, due to hyperconjugation and induction.',
      difficulty: CardDifficulty.EASY,
      state: CardState.REVIEW,
      easeFactor: 2.5,
      intervalDays: 21,
      repetitions: 4,
      dueAt: daysFromToday(-1),
      lastReviewedAt: daysFromToday(-22),
    },
    {
      front: 'What reagent converts an alkene to a vicinal diol?',
      back: 'Cold dilute KMnO₄, or OsO₄ followed by NaHSO₃ — both give syn addition.',
      difficulty: CardDifficulty.HARD,
      state: CardState.LEARNING,
      easeFactor: 2.1,
      intervalDays: 3,
      repetitions: 2,
      lapses: 1,
      dueAt: daysFromToday(0),
      lastReviewedAt: daysFromToday(-3),
    },
    {
      front: 'Define an electrophile.',
      back: 'An electron-pair acceptor; it is attracted to regions of high electron density.',
      difficulty: CardDifficulty.EASY,
      state: CardState.NEW,
      dueAt: new Date(),
    },
    {
      front: 'Why is benzene resistant to addition reactions?',
      back: 'Addition would break its aromatic delocalisation, which costs more energy than substitution.',
      difficulty: CardDifficulty.HARD,
      state: CardState.NEW,
      dueAt: new Date(),
    },
  ];

  await prisma.flashcard.createMany({
    data: cardSpecs.map((spec) => ({ ...spec, deckId: deck.id })),
  });

  // A review history so the heatmap and retention rate are non-empty.
  const cards = await prisma.flashcard.findMany({
    where: { deckId: deck.id },
    select: { id: true },
  });

  const reviews = [];
  for (let dayOffset = 30; dayOffset >= 1; dayOffset -= 1) {
    // Roughly every other day, a handful of reviews.
    if (dayOffset % 2 === 0) continue;
    const reviewedAt = daysFromToday(-dayOffset, 19);

    for (const card of cards.slice(0, 3)) {
      reviews.push({
        cardId: card.id,
        userId: demo.id,
        quality: dayOffset % 7 === 0 ? 2 : 4,
        responseMs: 4200,
        easeBefore: 2.5,
        easeAfter: 2.5,
        intervalBefore: 6,
        intervalAfter: 15,
        reviewedAt,
      });
    }
  }
  await prisma.flashcardReview.createMany({ data: reviews });
  console.log(`  flashcards ${cardSpecs.length} cards, ${reviews.length} reviews`);

  // --- Schedule -----------------------------------------------------------
  const blocks = [];
  for (let dayOffset = -2; dayOffset <= 4; dayOffset += 1) {
    const weekday = daysFromToday(dayOffset).getDay();
    if (weekday === 0 || weekday === 6) continue; // skip weekends

    blocks.push(
      {
        userId: demo.id,
        subjectId: chem.id,
        title: 'Organic Chemistry lecture',
        type: ScheduleBlockType.CLASS,
        startAt: daysFromToday(dayOffset, 9),
        endAt: daysFromToday(dayOffset, 10),
        location: 'B-204',
      },
      {
        userId: demo.id,
        subjectId: maths.id,
        title: 'Linear Algebra tutorial',
        type: ScheduleBlockType.CLASS,
        startAt: daysFromToday(dayOffset, 11),
        endAt: daysFromToday(dayOffset, 12),
        location: 'C-118',
      },
      {
        userId: demo.id,
        title: 'Focus block',
        type: ScheduleBlockType.FOCUS,
        startAt: daysFromToday(dayOffset, 14),
        endAt: daysFromToday(dayOffset, 16),
      },
    );
  }
  await prisma.scheduleBlock.createMany({ data: blocks });
  console.log(`  schedule   ${blocks.length} blocks`);

  // --- Study sessions and daily stats -------------------------------------
  const sessions = [];
  const stats = [];

  for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
    // A believable pattern: lighter at weekends, an occasional rest day.
    const date = daysFromToday(-dayOffset);
    const weekday = date.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const restDay = dayOffset % 11 === 0;

    if (restDay) {
      stats.push({
        userId: demo.id,
        date,
        studySeconds: 0,
        focusSeconds: 0,
        sessionsCompleted: 0,
        assignmentsCompleted: 0,
        cardsReviewed: 0,
        notesCreated: 0,
        productivityScore: 0,
        xpEarned: 0,
      });
      continue;
    }

    const sessionCount = isWeekend ? 1 : 2 + (dayOffset % 2);
    let daySeconds = 0;

    for (let index = 0; index < sessionCount; index += 1) {
      const durationSeconds = (isWeekend ? 25 : 50) * 60;
      daySeconds += durationSeconds;

      const startedAt = daysFromToday(-dayOffset, 14 + index * 2);
      sessions.push({
        userId: demo.id,
        subjectId: subjects[index % subjects.length]?.id ?? null,
        type: index === 0 ? StudySessionType.POMODORO : StudySessionType.DEEP_WORK,
        startedAt,
        endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
        durationSeconds,
        completed: true,
        interruptions: index,
        focusScore: 100 - index * 12,
      });
    }

    stats.push({
      userId: demo.id,
      date,
      studySeconds: daySeconds,
      focusSeconds: daySeconds,
      sessionsCompleted: sessionCount,
      assignmentsCompleted: dayOffset % 6 === 0 ? 1 : 0,
      cardsReviewed: dayOffset % 2 === 1 ? 3 : 0,
      notesCreated: dayOffset % 9 === 0 ? 1 : 0,
      productivityScore: Math.min(100, Math.round((daySeconds / (120 * 60)) * 60) + 20),
      xpEarned: Math.round(daySeconds / 60),
    });
  }

  await prisma.studySession.createMany({ data: sessions });
  await prisma.dailyStat.createMany({ data: stats });
  console.log(`  sessions   ${sessions.length} sessions, ${stats.length} daily stats`);

  // --- Goals --------------------------------------------------------------
  await prisma.goal.createMany({
    data: [
      {
        userId: demo.id,
        subjectId: chem.id,
        title: 'Study 10 hours of chemistry this month',
        targetValue: 600,
        currentValue: 380,
        unit: 'minutes',
        dueAt: daysFromToday(14),
      },
      {
        userId: demo.id,
        title: 'Maintain a 14-day study streak',
        targetValue: 14,
        currentValue: 5,
        unit: 'days',
      },
    ],
  });

  // --- Study group with chat history --------------------------------------
  const group = await prisma.studyGroup.create({
    data: {
      ownerId: demo.id,
      name: 'Chem 241 Study Crew',
      slug: 'chem-241-study-crew',
      description: 'Weekly problem sessions and exam prep.',
      isPublic: true,
      inviteCode: 'CHEM2416',
      members: {
        create: [
          { userId: demo.id, role: GroupRole.OWNER },
          { userId: peer.id, role: GroupRole.MEMBER },
        ],
      },
      channels: {
        create: [
          { name: 'general', type: ChannelType.TEXT, topic: 'Anything goes' },
          { name: 'problem-sets', type: ChannelType.TEXT, topic: 'Worked solutions' },
        ],
      },
    },
    include: { channels: true },
  });

  const generalChannel = group.channels.find((channel) => channel.name === 'general');
  if (generalChannel) {
    await prisma.message.createMany({
      data: [
        {
          channelId: generalChannel.id,
          authorId: demo.id,
          content: 'Anyone free to go through problem set 4 tomorrow afternoon?',
          createdAt: daysFromToday(-1, 18),
        },
        {
          channelId: generalChannel.id,
          authorId: peer.id,
          content: 'I can do 3pm. Struggling with the eigenvector question honestly.',
          createdAt: daysFromToday(-1, 18),
        },
        {
          channelId: generalChannel.id,
          authorId: demo.id,
          content: 'Same. Let’s work through it together.',
          createdAt: daysFromToday(-1, 19),
        },
      ],
    });
  }
  console.log(`  group      ${group.name} (2 members, 2 channels, 3 messages)`);

  // --- Achievements -------------------------------------------------------
  const achievementSpecs = [
    { key: 'first-steps', name: 'First Steps', description: 'Complete your first assignment', icon: '🎯', xpReward: 50, tier: 'BRONZE', criteria: { metric: 'assignmentsCompleted', gte: 1 } },
    { key: 'week-streak', name: 'Consistent', description: 'Study seven days in a row', icon: '🔥', xpReward: 150, tier: 'SILVER', criteria: { metric: 'streak', gte: 7 } },
    { key: 'century', name: 'Century', description: 'Review 100 flashcards', icon: '🧠', xpReward: 200, tier: 'SILVER', criteria: { metric: 'cardsReviewed', gte: 100 } },
    { key: 'deep-work', name: 'Deep Worker', description: 'Complete a 90-minute focus session', icon: '⚡', xpReward: 100, tier: 'BRONZE', criteria: { metric: 'sessionMinutes', gte: 90 } },
    { key: 'scholar', name: 'Scholar', description: 'Reach a 30-day streak', icon: '🏆', xpReward: 500, tier: 'GOLD', criteria: { metric: 'streak', gte: 30 } },
  ];

  for (const spec of achievementSpecs) {
    await prisma.achievement.upsert({
      where: { key: spec.key },
      create: spec,
      update: spec,
    });
  }

  const unlocked = await prisma.achievement.findMany({
    where: { key: { in: ['first-steps', 'deep-work'] } },
    select: { id: true },
  });

  await prisma.userAchievement.createMany({
    data: unlocked.map((achievement) => ({
      userId: demo.id,
      achievementId: achievement.id,
      progress: 100,
      unlockedAt: daysFromToday(-6),
    })),
  });
  console.log(`  achievements ${achievementSpecs.length} defined, ${unlocked.length} unlocked`);

  // --- Notifications ------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        userId: demo.id,
        type: NotificationType.ASSIGNMENT_DUE,
        title: 'Eigenvalue problem set 4 is due today',
        body: 'Due at 23:00.',
        link: '/assignments',
      },
      {
        userId: demo.id,
        type: NotificationType.FLASHCARD_REVIEW,
        title: '2 flashcards are ready for review',
        link: '/flashcards',
        readAt: daysFromToday(-1, 20),
      },
    ],
  });

  console.log('\nSeed complete.');
  console.log(`  Student  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  console.log(`  Admin    ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
