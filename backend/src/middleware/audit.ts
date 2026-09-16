import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { logger } from '../logger.js';

/** Append-only audit trail (§32). Never store secrets here. */
export function audit(
  actor: string,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Record<string, unknown>,
): void {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity, entity_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      actor,
      action,
      entity ?? null,
      entityId ?? null,
      detail ? JSON.stringify(detail) : null,
      new Date().toISOString(),
    );
  } catch (err) {
    logger.error({ err }, 'audit write failed');
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err }, 'unhandled error');
  const message = err instanceof Error ? err.message : 'internal error';
  res.status(500).json({ error: message });
}
