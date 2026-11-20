import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Appearance } from '@shared/domain/settings';
import type { Logger } from '../logging/logger';
import { createEmptyAppState } from '../persistence/app-state';
import { createAppStateHolder } from '../persistence/app-state-holder';
import type { StateStore } from '../persistence/state-store';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import { createSettingsService, type SettingsService } from './settings-service';

describe('createSettingsService', () => {
  let stateStore: FakeStateStore;
  let applyAppearance: Mock<(appearance: Appearance) => void>;
  let logWarn: Mock<Logger['warn']>;
  let logger: Logger;
  let settingsService: SettingsService;

  beforeEach(() => {
    stateStore = new FakeStateStore();
    applyAppearance = vi.fn<(appearance: Appearance) => void>();
    logWarn = vi.fn<Logger['warn']>();
    logger = { warn: logWarn, error: vi.fn<Logger['error']>() };
    settingsService = createSettingsService({
      stateHolder: createAppStateHolder(stateStore),
      applyAppearance,
      logger,
    });
  });

  it('update_WithAppearance_SavesAndAppliesIt', async () => {
    // Arrange
    const patch = { appearance: 'dark' as const };

    // Act
    await settingsService.update(patch);

    // Assert
    expect(stateStore.savedState?.settings.appearance).toBe('dark');
    expect(applyAppearance).toHaveBeenCalledWith('dark');
  });

  it('update_WhenSavingFails_DoesNotApplyAppearance', async () => {
    // Arrange: otherwise the window would show a mode that state.json does not contain
    stateStore.nextSaveError = new Error('EPERM: operation not permitted');

    // Act
    const updating = settingsService.update({ appearance: 'dark' });

    // Assert
    await expect(updating).rejects.toThrow('EPERM');
    expect(applyAppearance).not.toHaveBeenCalled();
  });

  it('applyStoredAppearance_WithStoredDark_AppliesDark', async () => {
    // Arrange
    const emptyState = createEmptyAppState();
    stateStore = new FakeStateStore({
      ...emptyState,
      settings: { ...emptyState.settings, appearance: 'dark' },
    });
    settingsService = createSettingsService({
      stateHolder: createAppStateHolder(stateStore),
      applyAppearance,
      logger,
    });

    // Act
    await settingsService.applyStoredAppearance();

    // Assert
    expect(applyAppearance).toHaveBeenCalledWith('dark');
  });

  it('applyStoredAppearance_WithUnreadableStateFile_KeepsSystemAndWarns', async () => {
    // Arrange: e.g. state.json briefly locked by a virus scanner
    const lockedError = Object.assign(new Error('EBUSY: resource busy or locked'), {
      code: 'EBUSY',
    });
    const lockedStore: StateStore = {
      load: () => Promise.reject(lockedError),
      save: () => Promise.resolve(),
    };
    settingsService = createSettingsService({
      stateHolder: createAppStateHolder(lockedStore),
      applyAppearance,
      logger,
    });

    // Act
    await settingsService.applyStoredAppearance();

    // Assert: Electron's own default is "system", so nothing needs to be applied
    expect(applyAppearance).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(expect.any(String), { error: lockedError });
  });
});
