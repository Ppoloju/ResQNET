// 3-Mode Architecture (§13, Phase 13) — client side.
//
// The mode is DERIVED, never stored: recompute it from observable facts
// (active SOS on this device, live disaster broadcasts, recent distinct mesh
// emergencies). Deriving makes the mode restart-survivable (facts are persisted
// or re-fetched) and impossible to get stuck, and the UI can always explain WHY.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { deriveMode, type AppMode } from '@iqoo/shared';
import { useMeshEvents } from './RealtimeContext';
import { useMesh } from './MeshContext';

interface ModeState {
  mode: AppMode;
  reason: string;
}

const ModeContext = createContext<ModeState>({ mode: 'NORMAL', reason: 'No active emergency' });

export function ModeProvider({ children }: { children: ReactNode }) {
  const { active } = useMesh();
  const { broadcast, events } = useMeshEvents();

  const value = useMemo<ModeState>(() => {
    // Crowd-sourced detection (§13): only distinct emergency ids observed in
    // the documented sliding window count toward Disaster Mode.
    const cutoff = Date.now() - 30 * 60_000;
    const nearbyEmergencyIds = [...new Set(
      events
        .filter((event) => event.ts >= cutoff && Boolean(event.emergencyId))
        .map((event) => event.emergencyId),
    )];
    const decision = deriveMode({
      activeEmergency: active !== null,
      disasterBroadcast: broadcast !== null,
      nearbyEmergencyIds,
    });
    return { mode: decision.mode, reason: decision.reason };
  }, [active, broadcast, events]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeState {
  return useContext(ModeContext);
}
