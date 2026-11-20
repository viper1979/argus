/**
 * Characters git never allows in a ref name: ASCII control characters, space, `~ ^ : ? * [ \`.
 * Subset of the rules of `git check-ref-format`.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is forbidden
const FORBIDDEN_REF_CHARACTERS = /[\u0000- \u007f~^:?*[\\]/;

/** Suffix git reserves for its lock files; no segment of a ref name may end with it. */
const LOCK_FILE_SUFFIX = '.lock';

/** Names `git check-ref-format --branch` rejects as a whole: `@` and the symbolic `HEAD`. */
const RESERVED_BRANCH_NAMES = new Set(['@', 'HEAD']);

/**
 * Checks whether a string is a valid git branch name, following `git check-ref-format --branch`.
 * Only the format is checked, not whether the branch exists.
 * @param branchName Candidate name, e.g. `main` or `release/2026.11`.
 * @returns `true` if git would accept the name.
 */
export function isValidBranchName(branchName: string): boolean {
  if (RESERVED_BRANCH_NAMES.has(branchName)) {
    return false;
  }
  // A leading dash would be read as an option when the name is passed to git.
  if (branchName === '' || branchName.startsWith('-')) {
    return false;
  }
  if (FORBIDDEN_REF_CHARACTERS.test(branchName)) {
    return false;
  }
  if (branchName.includes('..') || branchName.includes('@{') || branchName.endsWith('.')) {
    return false;
  }
  // Splitting on "/" also catches a leading, trailing or double slash as an empty segment.
  return branchName
    .split('/')
    .every(
      (segment) =>
        segment !== '' && !segment.startsWith('.') && !segment.endsWith(LOCK_FILE_SUFFIX),
    );
}

/**
 * Checks whether a string can be used as branch prefix. Argus builds task branches as
 * `<prefix>/<task-name>` (concept, section 5.2), so the prefix is exactly one ref segment.
 * @param branchPrefix Candidate prefix, e.g. `agent`.
 * @returns `true` if the prefix is a single valid segment.
 */
export function isValidBranchPrefix(branchPrefix: string): boolean {
  return !branchPrefix.includes('/') && isValidBranchName(branchPrefix);
}
