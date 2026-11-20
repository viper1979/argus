import { useEffect, useState } from 'react';
import type { ArgusApi } from '@shared/ipc/contract';

/** Name and version of the running app, as returned by `app:getInfo`. */
type AppInfo = Awaited<ReturnType<ArgusApi['app']['getInfo']>>;

/**
 * Loads name and version of the app from the main process once.
 * @returns The app info, or `null` while loading or if the call failed.
 */
export function useAppInfo(): AppInfo | null {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let isCancelled = false;

    window.argus.app
      .getInfo({})
      .then((info) => {
        if (!isCancelled) {
          setAppInfo(info);
        }
      })
      .catch((error: unknown) => {
        // Handler and validation failures are logged in the main process; the version is only cosmetic.
        console.error('Could not load app info', error);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return appInfo;
}
