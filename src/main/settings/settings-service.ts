import {
  applySettingsPatch,
  type Appearance,
  type Settings,
  type SettingsPatch,
} from '@shared/domain/settings';
import type { Logger } from '../logging/logger';
import type { AppStateHolder } from '../persistence/app-state-holder';

/** Reads and changes the global settings and puts the parts the main process owns into effect. */
export interface SettingsService {
  /**
   * Returns the stored settings.
   * @returns The settings.
   */
  get(): Promise<Settings>;

  /**
   * Merges a patch into the stored settings, saves them and then applies the appearance.
   * @param patch Validated change from the renderer.
   * @returns The saved settings.
   */
  update(patch: SettingsPatch): Promise<Settings>;

  /**
   * Applies the stored appearance; called once at startup, before the main window is created.
   * Never fails: if `state.json` cannot be read, the app starts with "System".
   */
  applyStoredAppearance(): Promise<void>;
}

/** Collaborators of the settings service. */
export interface SettingsServiceDependencies {
  readonly stateHolder: AppStateHolder;
  /**
   * Puts the appearance into effect for the whole app (in production `nativeTheme.themeSource`,
   * which also drives `prefers-color-scheme` in the renderer).
   * @param appearance The stored appearance.
   */
  readonly applyAppearance: (appearance: Appearance) => void;
  readonly logger: Logger;
}

/**
 * Creates the settings service.
 * @param dependencies State holder, the port that applies the appearance and the logger for
 *   read failures at startup.
 * @returns The service.
 */
export function createSettingsService(dependencies: SettingsServiceDependencies): SettingsService {
  const { stateHolder, applyAppearance, logger } = dependencies;

  return {
    get: async () => (await stateHolder.read()).settings,
    update: async (patch) => {
      const { settings } = await stateHolder.update((state) => ({
        ...state,
        settings: applySettingsPatch(state.settings, patch),
      }));
      applyAppearance(settings.appearance);
      return settings;
    },
    applyStoredAppearance: async () => {
      let settings: Settings;
      try {
        ({ settings } = await stateHolder.read());
      } catch (error: unknown) {
        // Any read failure (locked file, missing permission) must not keep the window from
        // opening; the holder retries on the next read and the renderer shows that error.
        logger.warn('Could not read the stored appearance, starting with "System"', { error });
        return;
      }
      applyAppearance(settings.appearance);
    },
  };
}
