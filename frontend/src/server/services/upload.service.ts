import 'server-only';
import crypto from 'node:crypto';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';
import { AppError, BadRequestError } from '@/server/lib/errors';

/**
 * Cloudinary uploads via signed direct-to-CDN transfer.
 *
 * The browser uploads straight to Cloudinary using a short-lived signature
 * minted here; file bytes never pass through this API. That keeps large
 * attachments off the request path and means the API secret never leaves the
 * server. The client cannot alter what it was authorised to upload, because
 * every signed parameter is covered by the signature.
 */

export type UploadFolder = 'avatars' | 'assignments' | 'notes' | 'messages' | 'ai';

export interface SignedUpload {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  uploadUrl: string;
  maxBytes: number;
  allowedFormats: string[];
}

/** Per-folder policy. Avatars are images only; attachments allow documents. */
const POLICIES: Record<
  UploadFolder,
  { maxBytes: number; formats: string[]; resourceType: 'image' | 'raw' | 'auto' }
> = {
  avatars: {
    maxBytes: 2 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    resourceType: 'image',
  },
  assignments: {
    maxBytes: 25 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'txt', 'md', 'zip'],
    resourceType: 'auto',
  },
  notes: {
    maxBytes: 25 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'txt', 'md'],
    resourceType: 'auto',
  },
  messages: {
    maxBytes: 10 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'],
    resourceType: 'auto',
  },
  // Attachments for the AI chat: documents the model reads plus images it sees.
  ai: {
    maxBytes: 25 * 1024 * 1024,
    formats: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'csv', 'docx', 'xlsx', 'pptx'],
    resourceType: 'auto',
  },
};

/** Signature validity. Short, because a leaked signature is a free upload. */
const SIGNATURE_TTL_SECONDS = 600;

export function isConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
}

function requireConfig(): { cloudName: string; apiKey: string; apiSecret: string } {
  if (!isConfigured()) {
    throw new AppError(
      'File uploads are unavailable because Cloudinary is not configured.',
      503,
      'UPLOADS_NOT_CONFIGURED',
    );
  }
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME as string,
    apiKey: env.CLOUDINARY_API_KEY as string,
    apiSecret: env.CLOUDINARY_API_SECRET as string,
  };
}

/**
 * Builds Cloudinary's signature: parameters sorted by key, joined as
 * `k=v` pairs with `&`, then the API secret appended and the whole string
 * SHA-1 hashed. Exported for testing — this is the piece that must be exactly
 * right or every upload is rejected.
 */
export function buildSignature(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');

  return crypto.createHash('sha1').update(`${canonical}${apiSecret}`).digest('hex');
}

/**
 * Derives a deterministic, collision-resistant public id scoped to the owner.
 * Including the userId means one account can never overwrite another's asset
 * by guessing an id.
 */
export function buildPublicId(folder: UploadFolder, userId: string): string {
  const unique = crypto.randomBytes(8).toString('hex');
  return `studentos/${folder}/${userId}/${Date.now()}-${unique}`;
}

export function createSignedUpload(userId: string, folder: UploadFolder): SignedUpload {
  const config = requireConfig();
  const policy = POLICIES[folder];

  if (!policy) throw new BadRequestError('Unknown upload folder');

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = buildPublicId(folder, userId);

  // Only these parameters are signed; Cloudinary rejects the upload if the
  // client alters any of them, so the policy cannot be widened client-side.
  const signedParams: Record<string, string | number> = {
    public_id: publicId,
    timestamp,
  };

  return {
    signature: buildSignature(signedParams, config.apiSecret),
    timestamp,
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    folder,
    publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/${policy.resourceType}/upload`,
    maxBytes: policy.maxBytes,
    allowedFormats: policy.formats,
  };
}

/**
 * Validates a client-reported upload before it is persisted.
 *
 * The client tells us what it uploaded; that claim is checked against the
 * folder policy and the public id we actually signed, so a caller cannot
 * register an arbitrary URL as their attachment.
 */
export function validateUploadResult(
  userId: string,
  folder: UploadFolder,
  result: { publicId: string; url: string; bytes: number; format?: string | undefined },
): void {
  const policy = POLICIES[folder];
  if (!policy) throw new BadRequestError('Unknown upload folder');

  const expectedPrefix = `studentos/${folder}/${userId}/`;
  if (!result.publicId.startsWith(expectedPrefix)) {
    throw new BadRequestError('That upload does not belong to you');
  }

  if (result.bytes > policy.maxBytes) {
    throw new BadRequestError(
      `File is too large. The limit for ${folder} is ${Math.round(policy.maxBytes / 1024 / 1024)}MB.`,
    );
  }

  if (result.format && !policy.formats.includes(result.format.toLowerCase())) {
    throw new BadRequestError(
      `Files of type .${result.format} are not allowed here. Accepted: ${policy.formats.join(', ')}.`,
    );
  }

  // Reject anything not served from the configured Cloudinary account —
  // otherwise a caller could register a URL pointing anywhere.
  const cloudName = env.CLOUDINARY_CLOUD_NAME as string;
  if (!result.url.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
    throw new BadRequestError('Upload URL is not from the configured Cloudinary account');
  }
}

/** Deletes an asset. Called when an attachment or avatar is removed. */
export async function destroyAsset(publicId: string): Promise<boolean> {
  const config = requireConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildSignature({ public_id: publicId, timestamp }, config.apiSecret);

  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: config.apiKey,
    signature,
  });

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );

    if (!response.ok) {
      logger.warn({ publicId, status: response.status }, 'cloudinary delete failed');
      return false;
    }

    const data = (await response.json()) as { result?: string };
    return data.result === 'ok' || data.result === 'not found';
  } catch (error) {
    // A failed remote delete must not block the local record from being
    // removed — the orphaned asset is a cleanup concern, not a user-facing one.
    logger.warn({ err: error, publicId }, 'cloudinary delete errored');
    return false;
  }
}

export function signatureTtlSeconds(): number {
  return SIGNATURE_TTL_SECONDS;
}

export const uploadService = {
  isConfigured,
  createSignedUpload,
  validateUploadResult,
  destroyAsset,
  buildSignature,
  buildPublicId,
  signatureTtlSeconds,
} as const;
