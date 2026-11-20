import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The user's global Claude settings. Argus itself never touches this file (ADR 0003). */
const USER_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Temporarily adds a test HTTP hook to `~/.claude/settings.json`, runs `action`,
 * and restores the original file byte-for-byte afterwards, even if `action` throws.
 * A backup copy is written to `backupDir` before anything is changed.
 *
 * Only used by the `user-hook` scenario to answer: do `--settings` hooks run
 * *in addition to* the user's own hooks?
 *
 * @template T
 * @param {{ hookUrl: string, backupDir: string }} options
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
export async function withTemporaryUserHook({ hookUrl, backupDir }, action) {
  const originalContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf8');
  const backupPath = path.join(backupDir, 'user-settings.backup.json');
  fs.writeFileSync(backupPath, originalContent);

  const restore = () => fs.writeFileSync(USER_SETTINGS_PATH, originalContent);
  // Restore even if the process is interrupted while the patched file is active.
  const restoreAndExit = () => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', restoreAndExit);

  try {
    const settings = JSON.parse(originalContent);
    settings.hooks = settings.hooks ?? {};
    for (const eventName of ['UserPromptSubmit', 'Stop', 'SessionEnd']) {
      settings.hooks[eventName] = [
        ...(settings.hooks[eventName] ?? []),
        { hooks: [{ type: 'http', url: hookUrl }] },
      ];
    }
    fs.writeFileSync(USER_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return await action();
  } finally {
    restore();
    process.removeListener('SIGINT', restoreAndExit);
    const isRestored = fs.readFileSync(USER_SETTINGS_PATH, 'utf8') === originalContent;
    console.log(`  ~/.claude/settings.json restored: ${isRestored} (backup: ${backupPath})`);
  }
}
