import type { z } from 'zod';

/**
 * Reduces zod issues to path and message so that rejected values never end up in logs or errors.
 * @param error The zod error of a failed parse.
 * @returns One `path: message` entry per issue.
 */
export function summarizeZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
