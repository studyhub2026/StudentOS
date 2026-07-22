import { Router } from 'express';
import * as controller from '../controllers/note.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { aiRateLimit } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  archiveSchema,
  autosaveNoteSchema,
  createFolderSchema,
  createNoteSchema,
  favoriteSchema,
  linkTokenSchema,
  listNotesSchema,
  noteIdSchema,
  noteVersionParamsSchema,
  shareIdSchema,
  shareNoteSchema,
  updateFolderSchema,
  updateNoteSchema,
} from '../validators/note.validator.js';

export const noteRouter: Router = Router();

// Public share links resolve without authentication, so this is mounted
// before the auth guard below.
noteRouter.get(
  '/shared/:token',
  validate({ params: linkTokenSchema }),
  asyncHandler(controller.getByLink),
);

noteRouter.use(requireAuth);

// Static segments must precede '/:id'.
noteRouter.get('/tags', asyncHandler(controller.tags));
noteRouter.get('/shared-with-me', asyncHandler(controller.sharedWithMe));

noteRouter.get('/', validate({ query: listNotesSchema }), asyncHandler(controller.list));
noteRouter.post('/', validate({ body: createNoteSchema }), asyncHandler(controller.create));

noteRouter.get('/:id', validate({ params: noteIdSchema }), asyncHandler(controller.getById));

noteRouter.patch(
  '/:id',
  validate({ params: noteIdSchema, body: updateNoteSchema }),
  asyncHandler(controller.update),
);

noteRouter.put(
  '/:id/autosave',
  validate({ params: noteIdSchema, body: autosaveNoteSchema }),
  asyncHandler(controller.autosave),
);

noteRouter.delete('/:id', validate({ params: noteIdSchema }), asyncHandler(controller.remove));
noteRouter.post('/:id/restore', validate({ params: noteIdSchema }), asyncHandler(controller.restore));
noteRouter.delete('/:id/purge', validate({ params: noteIdSchema }), asyncHandler(controller.purge));

noteRouter.patch(
  '/:id/favorite',
  validate({ params: noteIdSchema, body: favoriteSchema }),
  asyncHandler(controller.setFavorite),
);

noteRouter.patch(
  '/:id/archive',
  validate({ params: noteIdSchema, body: archiveSchema }),
  asyncHandler(controller.setArchived),
);

// --- Versions ---------------------------------------------------------------

noteRouter.get(
  '/:id/versions',
  validate({ params: noteIdSchema }),
  asyncHandler(controller.listVersions),
);

noteRouter.get(
  '/:id/versions/:versionId',
  validate({ params: noteVersionParamsSchema }),
  asyncHandler(controller.getVersion),
);

noteRouter.post(
  '/:id/versions/:versionId/restore',
  validate({ params: noteVersionParamsSchema }),
  asyncHandler(controller.restoreVersion),
);

// --- Sharing ----------------------------------------------------------------

noteRouter.get('/:id/shares', validate({ params: noteIdSchema }), asyncHandler(controller.listShares));

noteRouter.post(
  '/:id/shares',
  validate({ params: noteIdSchema, body: shareNoteSchema }),
  asyncHandler(controller.share),
);

noteRouter.delete(
  '/:id/shares/:shareId',
  validate({ params: shareIdSchema }),
  asyncHandler(controller.revokeShare),
);

// --- AI ---------------------------------------------------------------------

noteRouter.post(
  '/:id/summarise',
  aiRateLimit,
  validate({ params: noteIdSchema }),
  asyncHandler(controller.summarise),
);

// --- Folders ----------------------------------------------------------------

export const noteFolderRouter: Router = Router();

noteFolderRouter.use(requireAuth);

noteFolderRouter.get('/', asyncHandler(controller.listFolders));
noteFolderRouter.post(
  '/',
  validate({ body: createFolderSchema }),
  asyncHandler(controller.createFolder),
);
noteFolderRouter.patch(
  '/:id',
  validate({ params: noteIdSchema, body: updateFolderSchema }),
  asyncHandler(controller.updateFolder),
);
noteFolderRouter.delete(
  '/:id',
  validate({ params: noteIdSchema }),
  asyncHandler(controller.removeFolder),
);
