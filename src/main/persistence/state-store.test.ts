import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logging/logger';
import { createEmptyAppState, type AppState } from './app-state';
import { InvalidAppStateError } from './invalid-app-state-error';
import { createStateStore, type StateStore } from './state-store';

/** A state with one project, as it would look after registering a repository. */
const STATE_WITH_PROJECT: AppState = {
  version: 1,
  projects: [
    {
      id: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f',
      name: 'Webshop',
      repoPath: 'D:\\Repos\\webshop',
      mainBranch: 'main',
      branchPrefix: 'agent',
      defaultAgentType: 'claude-code',
      setupScript: null,
    },
  ],
  settings: { worktreeRoot: 'D:\\Worktrees' },
  tasks: [],
  consumedTaskNames: [],
};

/** Backup name for the fixed test clock; colons are not allowed in Windows file names. */
const EXPECTED_BACKUP_FILE_NAME = 'state.json.corrupt-2026-11-20T10-15-30-000Z';

describe('createStateStore', () => {
  let directory: string;
  let filePath: string;
  let logWarn: Mock<Logger['warn']>;
  let store: StateStore;

  beforeEach(async () => {
    // A fresh real directory per test keeps the tests independent of each other.
    directory = await mkdtemp(join(tmpdir(), 'argus-state-store-'));
    // Nested so that `save` has to create the missing parent folder, as on a fresh install.
    filePath = join(directory, 'Argus', 'state.json');
    logWarn = vi.fn<Logger['warn']>();
    store = createStateStore({
      filePath,
      logger: { warn: logWarn, error: vi.fn<Logger['error']>() },
      now: () => new Date('2026-11-20T10:15:30.000Z'),
    });
  });

  /**
   * Places a `state.json` with the given content, as a previous run would have left it.
   * @param content Raw file content.
   */
  async function writeStateFile(content: string): Promise<void> {
    await mkdir(join(directory, 'Argus'), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('load_WhenFileIsMissing_ReturnsEmptyState', async () => {
    // Arrange
    // Nothing to arrange: the directory is empty.

    // Act
    const state = await store.load();

    // Assert
    expect(state).toEqual(createEmptyAppState());
  });

  it('save_ThenLoad_ReturnsSavedState', async () => {
    // Arrange
    // Nothing to arrange: the parent folder of the file does not exist yet.

    // Act
    await store.save(STATE_WITH_PROJECT);
    const state = await store.load();

    // Assert
    expect(state).toEqual(STATE_WITH_PROJECT);
  });

  it('load_WithInvalidJson_BacksUpFileLogsAndReturnsEmptyState', async () => {
    // Arrange
    const brokenContent = '{ "version": 1, "projects": [';
    await writeStateFile(brokenContent);

    // Act
    const state = await store.load();

    // Assert
    expect(state).toEqual(createEmptyAppState());
    const backupPath = join(directory, 'Argus', EXPECTED_BACKUP_FILE_NAME);
    expect(await readFile(backupPath, 'utf8')).toBe(brokenContent);
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('state.json'),
      expect.objectContaining({ filePath, backupPath }),
    );
  });

  it('load_WithSchemaViolation_BacksUpFileAndReturnsEmptyState', async () => {
    // Arrange
    // Valid JSON, but a project without repoPath, e.g. edited by hand.
    const invalidContent = JSON.stringify({
      ...STATE_WITH_PROJECT,
      projects: [{ ...STATE_WITH_PROJECT.projects[0], repoPath: undefined }],
    });
    await writeStateFile(invalidContent);

    // Act
    const state = await store.load();

    // Assert
    expect(state).toEqual(createEmptyAppState());
    const backupPath = join(directory, 'Argus', EXPECTED_BACKUP_FILE_NAME);
    expect(await readFile(backupPath, 'utf8')).toBe(invalidContent);
  });

  it('load_WithFileWrittenBeforeTasksExisted_KeepsProjectsAndHasNoTasks', async () => {
    // Arrange
    // Exactly the shape Argus wrote up to #3: no `tasks`, no `consumedTaskNames`.
    const fileBeforeTasks = {
      version: 1,
      projects: STATE_WITH_PROJECT.projects,
      settings: STATE_WITH_PROJECT.settings,
    };
    await writeStateFile(JSON.stringify(fileBeforeTasks));

    // Act
    const state = await store.load();

    // Assert
    expect(state).toEqual({ ...fileBeforeTasks, tasks: [], consumedTaskNames: [] });
    expect(await readdir(join(directory, 'Argus'))).toEqual(['state.json']);
  });

  it('save_WhenFileExists_ReplacesItAndLeavesNoTemporaryFile', async () => {
    // Arrange
    await store.save(STATE_WITH_PROJECT);
    const changedState: AppState = { ...STATE_WITH_PROJECT, projects: [] };

    // Act
    await store.save(changedState);

    // Assert
    expect(await store.load()).toEqual(changedState);
    expect(await readdir(join(directory, 'Argus'))).toEqual(['state.json']);
  });

  it('save_WithStateViolatingSchema_RejectsAndKeepsPreviousFile', async () => {
    // Arrange
    // An empty project name would make the next load discard the whole file.
    await store.save(STATE_WITH_PROJECT);
    const invalidState = {
      ...STATE_WITH_PROJECT,
      projects: [{ ...STATE_WITH_PROJECT.projects[0], name: '' }],
    } as AppState;

    // Act
    const saving = store.save(invalidState);

    // Assert
    await expect(saving).rejects.toBeInstanceOf(InvalidAppStateError);
    expect(await store.load()).toEqual(STATE_WITH_PROJECT);
    expect(await readdir(join(directory, 'Argus'))).toEqual(['state.json']);
  });
});
