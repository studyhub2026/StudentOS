import { Router } from 'express';
import {
  assignmentRouter,
  dashboardRouter,
  subjectRouter,
} from './assignment.routes.js';
import { adminRouter } from './admin.routes.js';
import { aiRouter } from './ai.routes.js';
import { authRouter } from './auth.routes.js';
import { flashcardRouter } from './flashcard.routes.js';
import { groupRouter } from './group.routes.js';
import { uploadRouter } from './upload.routes.js';
import { noteFolderRouter, noteRouter } from './note.routes.js';
import {
  analyticsRouter,
  focusRouter,
  plannerRouter,
  scheduleRouter,
} from './schedule.routes.js';

export const apiRouter: Router = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    data: { name: 'StudentOS AI API', version: 'v1' },
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/assignments', assignmentRouter);
apiRouter.use('/subjects', subjectRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/notes', noteRouter);
apiRouter.use('/note-folders', noteFolderRouter);
apiRouter.use('/decks', flashcardRouter);
apiRouter.use('/schedule', scheduleRouter);
apiRouter.use('/planner', plannerRouter);
apiRouter.use('/focus', focusRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/groups', groupRouter);
apiRouter.use('/uploads', uploadRouter);
apiRouter.use('/admin', adminRouter);
