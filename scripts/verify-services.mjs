/**
 * Verifies the external services against REAL credentials.
 *
 * Makes genuine billable calls: one Gemini text generation, one Gemini
 * structured-output generation, and one Cloudinary upload + delete of a tiny
 * generated image. Each service is skipped (not failed) when its credentials
 * are absent, so this is safe to run in any environment.
 *
 *   npm run build --workspace=backend
 *   node scripts/verify-services.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../backend/.env') });

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function skip(label, reason) {
  skipped += 1;
  console.log(`SKIP  ${label}  (${reason})`);
}

// --- Gemini -----------------------------------------------------------------

async function verifyGemini() {
  console.log('\n--- Google Gemini ---');

  if (!process.env.GEMINI_API_KEY) {
    skip('gemini text generation', 'GEMINI_API_KEY is not set');
    skip('gemini structured output', 'GEMINI_API_KEY is not set');
    return;
  }

  const { geminiService } = await import('../backend/dist/services/gemini.service.js');

  // A deterministic factual prompt, so the assertion is about the pipeline
  // rather than about model creativity.
  const text = await geminiService.generateFromPrompt(
    'Reply with exactly one word: the chemical symbol for gold.',
    { temperature: 0, maxOutputTokens: 32 },
  );

  check('gemini returns text', text.text.trim().length > 0);
  check('gemini answers correctly', /au/i.test(text.text), `got "${text.text.trim()}"`);
  check('gemini reports the model used', text.model.includes('gemini'), text.model);
  check('gemini reports token usage', text.totalTokens > 0, `${text.totalTokens} tokens`);
  check('gemini reports latency', text.latencyMs > 0, `${text.latencyMs}ms`);
  console.log(`      model=${text.model} tokens=${text.totalTokens} latency=${text.latencyMs}ms`);

  // Structured output is the path every generator feature depends on.
  const { aiStudyService } = await import('../backend/dist/services/ai-study.service.js');
  const cards = await aiStudyService.generateFlashcards({
    source:
      'The mitochondrion is the organelle responsible for producing ATP through ' +
      'cellular respiration. It has an inner and an outer membrane, and the inner ' +
      'membrane is folded into cristae which increase surface area.',
    count: 3,
    difficulty: 'MEDIUM',
  });

  check('gemini structured output parses', Array.isArray(cards.cards));
  check('gemini returns the requested card count', cards.cards.length === 3, `got ${cards.cards.length}`);
  check('generated cards have both sides', cards.cards.every((c) => c.front && c.back));
  check('generated cards are flagged as AI-made', cards.cards.every((c) => c.generatedByAi === true));
  console.log(`      sample front: "${cards.cards[0]?.front?.slice(0, 70)}"`);

  // Streaming underpins the chat UI.
  let chunks = 0;
  let streamed = '';
  const stream = geminiService.streamText({
    messages: [{ role: 'user', content: 'Count from one to five in words, comma separated.' }],
    temperature: 0,
    maxOutputTokens: 64,
  });
  for await (const delta of stream) {
    chunks += 1;
    streamed += delta;
  }
  check('gemini streaming yields chunks', chunks > 0, `${chunks} chunks`);
  check('streamed text is non-empty', streamed.trim().length > 0);
}

// --- Cloudinary -------------------------------------------------------------

async function verifyCloudinary() {
  console.log('\n--- Cloudinary ---');

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    skip('cloudinary signed upload', 'Cloudinary credentials are not set');
    skip('cloudinary delete', 'Cloudinary credentials are not set');
    return;
  }

  const { uploadService } = await import('../backend/dist/services/upload.service.js');

  const signed = uploadService.createSignedUpload('verify-user', 'avatars');
  check('signature minted', Boolean(signed.signature));
  check('signature is a sha1 hex digest', /^[a-f0-9]{40}$/.test(signed.signature));
  check('upload URL targets the configured cloud', signed.uploadUrl.includes(cloudName));

  // A 1x1 transparent PNG — the smallest thing that is a genuine upload.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  const form = new FormData();
  form.append('file', new Blob([pixel], { type: 'image/png' }), 'pixel.png');
  form.append('api_key', signed.apiKey);
  form.append('timestamp', String(signed.timestamp));
  form.append('public_id', signed.publicId);
  form.append('signature', signed.signature);

  const response = await fetch(signed.uploadUrl, { method: 'POST', body: form });
  const result = await response.json();

  check('cloudinary accepts the signed upload', response.ok, JSON.stringify(result).slice(0, 200));

  if (!response.ok) return;

  check('upload returns a secure URL', typeof result.secure_url === 'string');
  check('upload returns the requested public id', result.public_id === signed.publicId);
  console.log(`      uploaded: ${result.secure_url}`);

  // The same validation the API applies before persisting an attachment.
  let validationError = null;
  try {
    uploadService.validateUploadResult('verify-user', 'avatars', {
      publicId: result.public_id,
      url: result.secure_url,
      bytes: result.bytes,
      format: result.format,
    });
  } catch (error) {
    validationError = error.message;
  }
  check('server-side validation accepts the real upload', validationError === null, validationError ?? '');

  const destroyed = await uploadService.destroyAsset(result.public_id);
  check('uploaded asset is deleted again', destroyed === true);
}

// --- Run --------------------------------------------------------------------

try {
  await verifyGemini();
} catch (error) {
  failed += 1;
  console.error('FAIL  gemini verification threw:', error?.message ?? error);
}

try {
  await verifyCloudinary();
} catch (error) {
  failed += 1;
  console.error('FAIL  cloudinary verification threw:', error?.message ?? error);
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

if (skipped > 0 && failed === 0) {
  console.log('Some services were skipped because their credentials are absent.');
}

process.exit(failed === 0 ? 0 : 1);
