import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

/**
 * Whether the device can reach the internet. Offline, the app disables actions and says so; it does not
 * queue them (a confirmation or a delivery status that "will send later" is a lie to the buyer waiting).
 * Defaults to online until told otherwise, so a slow probe never blocks the UI.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    void Network.getNetworkStateAsync()
      .then((s) => live && setOnline(s.isInternetReachable !== false && s.isConnected !== false))
      .catch(() => undefined);
    const sub = Network.addNetworkStateListener((s) =>
      setOnline(s.isInternetReachable !== false && s.isConnected !== false),
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return online;
}
