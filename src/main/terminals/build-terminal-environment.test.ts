import { describe, expect, it } from 'vitest';
import { buildTerminalEnvironment } from './build-terminal-environment';

describe('buildTerminalEnvironment', () => {
  it('buildTerminalEnvironment_WithoutGitConfigCount_AddsAutoSetupRemoteAtIndexZero', () => {
    // Arrange
    const processEnv = { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev' };

    // Act
    const environment = buildTerminalEnvironment(processEnv);

    // Assert
    expect(environment).toEqual({
      PATH: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\dev',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'push.autoSetupRemote',
      GIT_CONFIG_VALUE_0: 'true',
    });
  });

  it('buildTerminalEnvironment_WithUserGitConfigCount_AppendsEntryWithoutOverwriting', () => {
    // Arrange
    const processEnv = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'user.name',
      GIT_CONFIG_VALUE_1: 'Dev',
    };

    // Act
    const environment = buildTerminalEnvironment(processEnv);

    // Assert
    expect(environment).toEqual({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'user.name',
      GIT_CONFIG_VALUE_1: 'Dev',
      GIT_CONFIG_KEY_2: 'push.autoSetupRemote',
      GIT_CONFIG_VALUE_2: 'true',
    });
  });

  it.each([' 1', '+1', '\t1', ' +1'])(
    'buildTerminalEnvironment_WithGitConfigCount%jGitAccepts_ContinuesAtIndexOne',
    (userCount) => {
      // Arrange: git parses the count with strtoul, which skips leading whitespace and accepts
      // a plus sign (verified with git 2.55)
      const processEnv = {
        GIT_CONFIG_COUNT: userCount,
        GIT_CONFIG_KEY_0: 'core.autocrlf',
        GIT_CONFIG_VALUE_0: 'false',
      };

      // Act
      const environment = buildTerminalEnvironment(processEnv);

      // Assert
      expect(environment).toEqual({
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'core.autocrlf',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_CONFIG_KEY_1: 'push.autoSetupRemote',
        GIT_CONFIG_VALUE_1: 'true',
      });
    },
  );

  it.each(['abc', '-1', '1 ', ' ', '+', '2147483648'])(
    'buildTerminalEnvironment_WithBogusGitConfigCount%j_LeavesGitVariablesUnchanged',
    (bogusCount) => {
      // Arrange: git itself rejects these counts (verified with git 2.55), so Argus must not
      // overwrite them and hide the user's broken setup.
      const processEnv = { GIT_CONFIG_COUNT: bogusCount, PATH: 'C:\\Windows' };

      // Act
      const environment = buildTerminalEnvironment(processEnv);

      // Assert
      expect(environment).toEqual({ GIT_CONFIG_COUNT: bogusCount, PATH: 'C:\\Windows' });
    },
  );

  it('buildTerminalEnvironment_WithLowerCaseGitConfigCount_ContinuesItUnderOneName', () => {
    // Arrange: Windows variable names are case-insensitive and git reads this count too
    // (verified with git 2.55); two spellings in one environment block would be ambiguous.
    const processEnv = {
      git_config_count: '1',
      git_config_key_0: 'core.autocrlf',
      git_config_value_0: 'false',
    };

    // Act
    const environment = buildTerminalEnvironment(processEnv);

    // Assert
    expect(environment).toEqual({
      GIT_CONFIG_COUNT: '2',
      git_config_key_0: 'core.autocrlf',
      git_config_value_0: 'false',
      GIT_CONFIG_KEY_1: 'push.autoSetupRemote',
      GIT_CONFIG_VALUE_1: 'true',
    });
  });

  it('buildTerminalEnvironment_WithEmptyGitConfigCount_TreatsItAsZero', () => {
    // Arrange: git reads an empty count as 0 (verified with git 2.55)
    const processEnv = { GIT_CONFIG_COUNT: '' };

    // Act
    const environment = buildTerminalEnvironment(processEnv);

    // Assert
    expect(environment).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'push.autoSetupRemote',
      GIT_CONFIG_VALUE_0: 'true',
    });
  });
});
