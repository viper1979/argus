import { z } from 'zod';
import { isValidBranchName, isValidBranchPrefix } from './git-ref-name';
import { isValidWindowsFolderName } from './windows-folder-name';

/** Agent types Argus can start. Only Claude Code exists in the MVP; Codex follows later. */
export const agentTypeSchema = z.enum(['claude-code']);

/** An agent CLI Argus can start, e.g. `claude-code` (glossary: Agent-Typ). */
export type AgentType = z.infer<typeof agentTypeSchema>;

/** Agent type of new projects; the only one in the MVP. */
export const DEFAULT_AGENT_TYPE: AgentType = 'claude-code';

/** A Git repository registered in Argus. Groups tasks, has no working state of its own. */
export const projectSchema = z.object({
  id: z.uuid(),
  /** Unique per Argus installation; becomes a folder under the worktree root. */
  name: z.string().trim().refine(isValidWindowsFolderName, 'Kein gültiger Ordnername'),
  /** Absolute path of the main repository on disk. */
  repoPath: z.string().min(1),
  /** Branch new tasks are based on by default, e.g. `main`. */
  mainBranch: z.string().trim().refine(isValidBranchName, 'Kein gültiger Branch-Name'),
  /** First segment of every task branch, e.g. `agent` for `agent/<task-name>`. */
  branchPrefix: z.string().trim().refine(isValidBranchPrefix, 'Kein gültiger Branch-Präfix'),
  defaultAgentType: agentTypeSchema,
  /** Local PowerShell script that prepares a new worktree; `null` if there is none. */
  setupScript: z.string().nullable(),
});

/** A Git repository registered in Argus. */
export type Project = z.infer<typeof projectSchema>;

/** The part of a project the user can change in the project settings. */
export const projectSettingsSchema = projectSchema.pick({
  name: true,
  mainBranch: true,
  branchPrefix: true,
  defaultAgentType: true,
  setupScript: true,
});

/** The part of a project the user can change in the project settings. */
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/** Why project settings could not be saved; the renderer maps it to a German message. */
export const updateProjectFailureReasonSchema = z.enum(['not-found', 'name-taken']);

/** Outcome of changing a project. */
export const updateProjectResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), project: projectSchema }),
  z.object({ ok: z.literal(false), reason: updateProjectFailureReasonSchema }),
]);

/** Outcome of changing a project. */
export type UpdateProjectResult = z.infer<typeof updateProjectResultSchema>;

/** Why a folder could not be added as project; the renderer maps it to a German message. */
export const addProjectFailureReasonSchema = z.enum([
  'not-a-git-repository',
  'already-registered',
  'git-unavailable',
]);

/** Outcome of adding a project; business failures are results, not exceptions. */
export const addProjectResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), project: projectSchema }),
  z.object({ ok: z.literal(false), reason: addProjectFailureReasonSchema }),
]);

/** Outcome of adding a project. */
export type AddProjectResult = z.infer<typeof addProjectResultSchema>;
