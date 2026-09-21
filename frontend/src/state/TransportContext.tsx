// CommunicationManager provider (§35): registers transports, exposes live
// availability per transport. Bluetooth is the [P] prototype; internet is the
// implemented REST+SSE path. The app's routing logic never touches radios
// directly — it goes through this manager.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CommunicationManager, type TransportAvailability } from '@iqoo/shared';
import { API_BASE } from './SessionContext';
import { WebBluetoothTransport } from './bluetoothTransport';
import { LocalNetworkTransport } from './lanTransport';

interface TransportRow {
  name: 'bluetooth' | 'local-network';
  availability: TransportAvailability | 'READY';
  detail: string;
}

interface TransportState {
  manager: CommunicationManager;
  bluetooth: WebBluetoothTransport;
  lan: LocalNetworkTransport;
  rows: TransportRow[];
  requestingBluetooth: boolean;
  requestBluetooth: () => Promise<boolean>;
  refresh: () => void;
}

const TransportContext = createContext<TransportState>(null as unknown as TransportState);

export function TransportProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new CommunicationManager());
  const [bluetooth] = useState(() => new WebBluetoothTransport());
  const [lan] = useState(() => new LocalNetworkTransport(
    API_BASE.replace(/\/api$/, ''),
  ));
  const [rows, setRows] = useState<TransportRow[]>([
    { name: 'local-network', availability: 'UNAVAILABLE', detail: 'checking…' },
    { name: 'bluetooth', availability: 'UNSUPPORTED', detail: 'checking…' },
  ]);
  const [requestingBluetooth, setRequestingBluetooth] = useState(false);

  const refresh = useCallback(() => {
    void manager.availability().then((av) => {
      setRows(av.map((a: { name: string; availability: TransportAvailability; detail: string }) => ({
        name: a.name as TransportRow['name'],
        availability: a.availability,
        detail: a.detail,
      })));
    }).catch(() => { /* keep last known */ });
  }, [manager]);

  useEffect(() => {
    manager.register(bluetooth);
    manager.register(lan);
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => { clearInterval(t); void manager.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestBluetooth = useCallback(async () => {
    setRequestingBluetooth(true);
    try {
      const ok = await bluetooth.requestPermission(); // must be inside the user gesture
      refresh();
      return ok;
    } finally {
      setRequestingBluetooth(false);
    }
  }, [bluetooth, refresh]);

  return (
    <TransportContext.Provider value={{ manager, bluetooth, lan, rows, requestingBluetooth, requestBluetooth, refresh }}>
      {children}
    </TransportContext.Provider>
  );
}

export function useTransports(): TransportState {
  return useContext(TransportContext);
}
