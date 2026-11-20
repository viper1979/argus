import { z } from 'zod';

/** Upper bound for terminal dimensions; protects the PTY from absurd values sent by the renderer. */
const MAX_TERMINAL_DIMENSION = 1000;

/** Columns or rows of a terminal as measured by xterm.js. */
const terminalDimensionSchema = z.number().int().min(1).max(MAX_TERMINAL_DIMENSION);

/** Size of a terminal in character cells. */
export const terminalSizeSchema = z.object({
  cols: terminalDimensionSchema,
  rows: terminalDimensionSchema,
});

/** Size of a terminal in character cells. */
export type TerminalSize = z.infer<typeof terminalSizeSchema>;

/** Opens a new terminal (glossary: Terminal) in the worktree of a task. */
export const openTerminalRequestSchema = terminalSizeSchema.extend({
  taskId: z.uuid(),
});

/** Opens a new terminal in the worktree of a task. */
export type OpenTerminalRequest = z.infer<typeof openTerminalRequestSchema>;

/** Why a terminal could not be opened; the renderer maps it to a German message. */
export const openTerminalFailureReasonSchema = z.enum([
  'task-not-found',
  'shell-unavailable',
  /** Argus is quitting and ends all terminals; a new one would outlive it. */
  'app-closing',
]);

/** Outcome of opening a terminal; business failures are results, not exceptions. */
export const openTerminalResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), terminalId: z.uuid() }),
  z.object({ ok: z.literal(false), reason: openTerminalFailureReasonSchema }),
]);

/** Outcome of opening a terminal. */
export type OpenTerminalResult = z.infer<typeof openTerminalResultSchema>;

/**
 * Upper bound for one input message. Typed keys are tiny; the bound only has to allow pasting
 * large texts while keeping absurd messages from the renderer away from the PTY.
 */
const MAX_TERMINAL_INPUT_LENGTH = 1_000_000;

/** Input for a terminal, e.g. keystrokes or pasted text. */
export const writeTerminalRequestSchema = z.object({
  terminalId: z.uuid(),
  data: z.string().max(MAX_TERMINAL_INPUT_LENGTH),
});

/** New size of a terminal after xterm.js was resized. */
export const resizeTerminalRequestSchema = terminalSizeSchema.extend({
  terminalId: z.uuid(),
});

/** Addresses one terminal. */
export const terminalReferenceSchema = z.object({ terminalId: z.uuid() });

/** Output of a terminal, pushed from main to renderer. */
export const terminalOutputEventSchema = z.object({
  terminalId: z.uuid(),
  data: z.string(),
});

/** Output of a terminal. */
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>;

/** The process of a terminal ended, by itself or because the tab was closed. */
export const terminalExitEventSchema = z.object({
  terminalId: z.uuid(),
  exitCode: z.number().int(),
});

/** The process of a terminal ended. */
export type TerminalExitEvent = z.infer<typeof terminalExitEventSchema>;
