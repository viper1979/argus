/** Characters Windows forbids in file and folder names, plus ASCII control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is forbidden
const FORBIDDEN_FOLDER_NAME_CHARACTERS = /[\u0000-\u001f<>:"/\\|?*]/;

/**
 * Device names Windows reserves regardless of case and extension (e.g. `con`, `NUL.txt`).
 * Matched against the part before the first dot.
 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;

/**
 * Checks whether a string can be used as one folder name on Windows. Project names become
 * folders under the worktree root (`<WorktreeRoot>\<Projekt>\<task-name>`, concept 5.2).
 * @param folderName Candidate name, e.g. `Webshop`.
 * @returns `true` if Windows accepts the name as a folder.
 */
export function isValidWindowsFolderName(folderName: string): boolean {
  if (folderName === '' || FORBIDDEN_FOLDER_NAME_CHARACTERS.test(folderName)) {
    return false;
  }
  // Windows silently strips a trailing dot or space, so the folder would get another name.
  if (folderName.endsWith('.') || folderName.endsWith(' ')) {
    return false;
  }
  const baseName = folderName.split('.')[0] ?? '';
  return !RESERVED_DEVICE_NAME.test(baseName);
}
