/** Environment of a terminal process: only variables that actually have a value. */
export type TerminalEnvironment = Record<string, string>;

/** Git config entry every terminal of a task gets, so the first push works without `-u` (ADR 0006). */
const AUTO_SETUP_REMOTE_KEY = 'push.autoSetupRemote';
const AUTO_SETUP_REMOTE_VALUE = 'true';

/** Variable that tells git how many `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs follow. */
const GIT_CONFIG_COUNT = 'GIT_CONFIG_COUNT';

/**
 * A count as git's strtoul accepts it: optional leading C whitespace, optional plus sign, at
 * least one digit, nothing after (verified with git 2.55). An empty value counts as 0.
 * Matches e.g. "2", " 2", "+2"; rejects " ", "+", "2 ", "-1".
 */
const GIT_ACCEPTED_COUNT_PATTERN = /^[ \t\n\v\f\r]*\+?(\d+)$/;

/** git rejects counts above INT_MAX ("too many entries"); Argus must stay below after +1. */
const MAX_GIT_CONFIG_COUNT = 2_147_483_647;

/**
 * Builds the environment a terminal of a task is started with: the inherited environment plus
 * `push.autoSetupRemote=true` via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`.
 * @param processEnv The environment Argus itself runs with; it is not modified.
 * @returns A new environment object for the terminal.
 */
export function buildTerminalEnvironment(processEnv: NodeJS.ProcessEnv): TerminalEnvironment {
  const environment = copyDefinedVariables(processEnv);
  appendAutoSetupRemote(environment);
  return environment;
}

/**
 * Copies all variables that have a value.
 * @param processEnv The inherited environment.
 * @returns A new object without `undefined` values.
 */
function copyDefinedVariables(processEnv: NodeJS.ProcessEnv): TerminalEnvironment {
  const environment: TerminalEnvironment = {};
  for (const [name, value] of Object.entries(processEnv)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

/**
 * Appends `push.autoSetupRemote=true` as next git config entry. A count set by the user is
 * continued, so their own entries stay in effect (ADR 0006); a count git would reject is left
 * unchanged, so the user still sees git's own error instead of a silently altered setup.
 * @param environment The terminal environment; modified in place.
 */
function appendAutoSetupRemote(environment: TerminalEnvironment): void {
  const entryIndex = parseContinuableCount(readVariable(environment, GIT_CONFIG_COUNT) ?? '');
  if (entryIndex === null) {
    return;
  }

  writeVariable(environment, GIT_CONFIG_COUNT, String(entryIndex + 1));
  writeVariable(environment, `GIT_CONFIG_KEY_${entryIndex}`, AUTO_SETUP_REMOTE_KEY);
  writeVariable(environment, `GIT_CONFIG_VALUE_${entryIndex}`, AUTO_SETUP_REMOTE_VALUE);
}

/**
 * Reads a user's `GIT_CONFIG_COUNT` the way git does and checks that one more entry still fits.
 * @param userCount The raw value; empty if the variable is not set.
 * @returns The count, i.e. the index of the next entry, or `null` if git would reject the value
 *   or the incremented one.
 */
function parseContinuableCount(userCount: string): number | null {
  if (userCount === '') {
    return 0;
  }
  const digits = GIT_ACCEPTED_COUNT_PATTERN.exec(userCount)?.[1];
  if (digits === undefined) {
    return null;
  }
  const count = Number(digits);
  return count < MAX_GIT_CONFIG_COUNT ? count : null;
}

/**
 * Finds the spelling under which a variable is stored. Windows variable names are
 * case-insensitive (ADR 0002: Windows only), and git reads every spelling.
 * @param environment The terminal environment.
 * @param name Variable name in any case.
 * @returns The stored names that match, usually none or one.
 */
function findStoredNames(environment: TerminalEnvironment, name: string): string[] {
  const upperCaseName = name.toUpperCase();
  return Object.keys(environment).filter(
    (storedName) => storedName.toUpperCase() === upperCaseName,
  );
}

/**
 * Reads a variable regardless of the case of its name.
 * @param environment The terminal environment.
 * @param name Variable name in any case.
 * @returns The value, or `undefined` if the variable is not set.
 */
function readVariable(environment: TerminalEnvironment, name: string): string | undefined {
  const [storedName] = findStoredNames(environment, name);
  return storedName === undefined ? undefined : environment[storedName];
}

/**
 * Sets a variable under exactly the given name and removes every other spelling of it, so the
 * environment block passed to Windows never contains the same variable twice.
 * @param environment The terminal environment; modified in place.
 * @param name Variable name as it should be stored.
 * @param value The new value.
 */
function writeVariable(environment: TerminalEnvironment, name: string, value: string): void {
  for (const storedName of findStoredNames(environment, name)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- variable names are data here
    delete environment[storedName];
  }
  environment[name] = value;
}
