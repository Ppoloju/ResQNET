import { Router } from 'express';
import { z } from 'zod';
import { classifyFromText, AI_DISCLAIMER } from '@iqoo/shared';
import { audit } from '../middleware/audit.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const aiRouter = Router();

const classifySchema = z.object({
  text: z.string().max(500).default(''),
  battery: z.number().int().min(0).max(100).nullable().optional(),
  saysImmobile: z.boolean().optional(),
});

/**
 * Deterministic server-side fallback for native clients and responder tools.
 * The browser PWA classifies locally first; this endpoint never calls a cloud
 * model and does not persist the submitted description.
 */
aiRouter.post('/classify', requireAuth, (req: AuthedRequest, res) => {
  const parsed = classifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation failed', issues: parsed.error.issues });
    return;
  }

  const result = classifyFromText(parsed.data);
  audit(req.user!.userId, 'ai.classify', 'ai_assistance', undefined, {
    category: result.category,
    severity: result.severity,
    engine: result.engine,
  });
  res.json({ result, disclaimer: AI_DISCLAIMER, local: true });
});
