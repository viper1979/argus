import { win32 } from 'node:path';
import {
  DEFAULT_AGENT_TYPE,
  type AddProjectResult,
  type Project,
  type ProjectSettings,
  type UpdateProjectResult,
} from '@shared/domain/project';
import { isValidWindowsFolderName } from '@shared/domain/windows-folder-name';
import type { GitClient } from '../git/git-client';
import { GitUnavailableError } from '../git/git-unavailable-error';
import type { AppStateHolder } from '../persistence/app-state-holder';

/** Registers, changes and removes projects. */
export interface ProjectService {
  /**
   * Registers the repository a folder belongs to.
   * @param folderPath Folder picked by the user; may be a subfolder of the repository.
   * @returns The new project, or why the folder cannot be added.
   */
  add(folderPath: string): Promise<AddProjectResult>;

  /**
   * Replaces the user-editable settings of a project.
   * @param projectId Id of the project.
   * @param settings The new settings.
   * @returns The changed project, or `not-found` if the project does not exist (any more).
   */
  update(projectId: string, settings: ProjectSettings): Promise<UpdateProjectResult>;

  /**
   * Removes a project from Argus only; nothing on disk is touched.
   * Removing an unknown project is a no-op, so a repeated click does no harm.
   * @param projectId Id of the project.
   */
  remove(projectId: string): Promise<void>;

  /**
   * Returns all registered projects.
   * @returns Projects in the order they were added.
   */
  list(): Promise<Project[]>;
}

/** The git queries the project service needs. */
export type ProjectGitClient = Pick<GitClient, 'resolveRepositoryRoot' | 'detectMainBranch'>;

/** Collaborators of the project service; `generateId` makes ids deterministic in tests. */
export interface ProjectServiceOptions {
  readonly gitClient: ProjectGitClient;
  readonly stateHolder: AppStateHolder;
  readonly generateId: () => string;
}

/** First branch segment of new projects; task branches become `agent/<task-name>`. */
const DEFAULT_BRANCH_PREFIX = 'agent';

/** Name of a new project whose path yields no usable name; the user can rename it. */
const FALLBACK_PROJECT_NAME = 'Projekt';

/** First number appended to a project name that is already taken, as in "Webshop (2)". */
const FIRST_NAME_SUFFIX_NUMBER = 2;

/**
 * Creates the project service.
 * @param options Git access, state and id generator.
 * @returns The service.
 */
export function createProjectService(options: ProjectServiceOptions): ProjectService {
  const { gitClient, stateHolder, generateId } = options;

  return {
    add: async (folderPath) => {
      let repoPath: string | null;
      let mainBranch: string;
      try {
        repoPath = await gitClient.resolveRepositoryRoot(folderPath);
        if (repoPath === null) {
          return { ok: false, reason: 'not-a-git-repository' };
        }
        mainBranch = await gitClient.detectMainBranch(repoPath);
      } catch (error: unknown) {
        // A missing git is a setup problem the user can fix, so it is a result, not a crash.
        if (error instanceof GitUnavailableError) {
          return { ok: false, reason: 'git-unavailable' };
        }
        throw error;
      }

      // Path and name are checked inside the update, so two concurrent adds cannot both pass.
      const outcome: { result: AddProjectResult } = {
        result: { ok: false, reason: 'already-registered' },
      };
      await stateHolder.update((state) => {
        if (state.projects.some((existing) => isSameWindowsPath(existing.repoPath, repoPath))) {
          return state;
        }
        const project: Project = {
          id: generateId(),
          name: findFreeProjectName(suggestProjectName(repoPath), state.projects),
          repoPath,
          mainBranch,
          branchPrefix: DEFAULT_BRANCH_PREFIX,
          defaultAgentType: DEFAULT_AGENT_TYPE,
          setupScript: null,
        };
        outcome.result = { ok: true, project };
        return { ...state, projects: [...state.projects, project] };
      });
      return outcome.result;
    },

    update: async (projectId, settings) => {
      const outcome: { result: UpdateProjectResult } = {
        result: { ok: false, reason: 'not-found' },
      };
      await stateHolder.update((state) => {
        const existing = state.projects.find((project) => project.id === projectId);
        if (existing === undefined) {
          return state;
        }
        const otherProjects = state.projects.filter((project) => project.id !== projectId);
        if (isNameTaken(settings.name, otherProjects)) {
          outcome.result = { ok: false, reason: 'name-taken' };
          return state;
        }
        const changed: Project = { ...existing, ...settings };
        outcome.result = { ok: true, project: changed };
        return {
          ...state,
          projects: state.projects.map((project) => (project.id === projectId ? changed : project)),
        };
      });
      return outcome.result;
    },

    remove: async (projectId) => {
      await stateHolder.update((state) =>
        state.projects.some((project) => project.id === projectId)
          ? { ...state, projects: state.projects.filter((project) => project.id !== projectId) }
          : state,
      );
    },

    list: async () => (await stateHolder.read()).projects,
  };
}

/**
 * Suggests a project name from the repository path: its folder name, or the drive letter for a
 * repository at a drive root (`D:\` has no folder name).
 * @param repoPath Root of the repository.
 * @returns A valid Windows folder name.
 */
function suggestProjectName(repoPath: string): string {
  const folderName = win32.basename(repoPath);
  if (isValidWindowsFolderName(folderName)) {
    return folderName;
  }
  const driveLetter = win32.parse(repoPath).root.replace(/[:\\]/g, '');
  return isValidWindowsFolderName(driveLetter) ? driveLetter : FALLBACK_PROJECT_NAME;
}

/**
 * Finds a project name that no other project uses yet, numbering it if necessary.
 * @param preferredName Usually the folder name of the repository.
 * @param projects The registered projects.
 * @returns `preferredName`, or `preferredName (2)`, `(3)`, ... if it is taken.
 */
function findFreeProjectName(preferredName: string, projects: readonly Project[]): string {
  let candidate = preferredName;
  for (let number = FIRST_NAME_SUFFIX_NUMBER; isNameTaken(candidate, projects); number++) {
    candidate = `${preferredName} (${number})`;
  }
  return candidate;
}

/**
 * Checks whether a project name is in use. Names become Windows folders, which ignore case.
 * @param name Candidate name.
 * @param projects Projects to compare with.
 * @returns `true` if one of the projects already has this name.
 */
function isNameTaken(name: string, projects: readonly Project[]): boolean {
  return projects.some((project) => project.name.toLowerCase() === name.toLowerCase());
}

/**
 * Compares two Windows paths; Windows treats paths case-insensitively (ADR 0002).
 * @param first A normalized Windows path.
 * @param second Another normalized Windows path.
 * @returns `true` if both point to the same folder.
 */
function isSameWindowsPath(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
