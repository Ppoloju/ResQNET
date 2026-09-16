// Settings (§29/§37/§45): large touch targets, plain language, honest labels.
// Every control maps to real behavior: relay tiers feed the engine-consistent
// readiness meter, low-power mode forces CRITICAL-only, scan interval is a
// documented prototype knob.

import { useSettings } from '../state/SettingsContext';
import { useTransports } from '../state/TransportContext';
import { useStatus } from '../state/StatusContext';

const AV_LABEL: Record<string, string> = {
  UNSUPPORTED: 'not available in this browser',
  PERMISSION_NEEDED: 'needs your permission',
  READY: 'ready',
  UNAVAILABLE: 'unavailable right now',
};

function tierFor(battery: number | null, s: ReturnType<typeof useSettings>): 'CRITICAL-ONLY' | 'REDUCED' | 'NORMAL' | 'OFF' {
  if (!s.relayConsent) return 'OFF';
  if (s.lowPowerMode) return 'CRITICAL-ONLY';
  if (battery === null) return 'NORMAL';
  if (battery < s.criticalThresholdPct) return 'CRITICAL-ONLY';
  if (battery <= s.normalThresholdPct) return 'REDUCED';
  return 'NORMAL';
}

export default function Settings() {
  const s = useSettings();
  const { rows, requestingBluetooth, requestBluetooth } = useTransports();
  const { battery } = useStatus();

  const currentTier = tierFor(battery, s);

  return (
    <div>
      <h1>Settings</h1>

      <div className="card">
        <h2>Relaying</h2>
        <label className="row spread" style={{ alignItems: 'center', gap: 8, minHeight: 48 }}>
          <span>Relay emergency packets for nearby people</span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={s.relayConsent}
            onChange={(e) => s.update({ relayConsent: e.target.checked })} aria-label="Relay consent" />
        </label>
        <label className="row spread" style={{ alignItems: 'center', gap: 8, minHeight: 48 }}>
          <span>Low-power mode (relay only CRITICAL alerts)</span>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={s.lowPowerMode}
            onChange={(e) => s.update({ lowPowerMode: e.target.checked })} aria-label="Low power mode" />
        </label>

        <label htmlFor="scan-interval">Discovery scan interval: {s.scanIntervalSec}s <span className="muted">(prototype knob [P])</span></label>
        <input id="scan-interval" type="range" min={10} max={120} step={5} value={s.scanIntervalSec}
          onChange={(e) => s.update({ scanIntervalSec: Number(e.target.value) })}
          style={{ width: '100%' }} aria-valuemin={10} aria-valuemax={120} aria-valuenow={s.scanIntervalSec} />

        <label htmlFor="crit-thresh">CRITICAL-only below: {s.criticalThresholdPct}% battery</label>
        <input id="crit-thresh" type="range" min={5} max={40} step={5} value={s.criticalThresholdPct}
          onChange={(e) => s.update({ criticalThresholdPct: Math.min(Number(e.target.value), s.normalThresholdPct - 10) })}
          style={{ width: '100%' }} />

        <label htmlFor="norm-thresh">Normal relay above: {s.normalThresholdPct}% battery</label>
        <input id="norm-thresh" type="range" min={50} max={90} step={5} value={s.normalThresholdPct}
          onChange={(e) => s.update({ normalThresholdPct: Math.max(Number(e.target.value), s.criticalThresholdPct + 10) })}
          style={{ width: '100%' }} />

        <p className="muted mt" data-testid="current-tier">
          At your current battery ({battery === null ? 'unknown' : `${battery}%`}) this device would relay:
          {' '}<strong>{currentTier}</strong>
        </p>
        <button className="btn-ghost" onClick={s.reset}>Reset to defaults</button>
      </div>

      <div className="card">
        <h2>Transports</h2>
        {rows.map((r) => (
          <div key={r.name} className="row spread" style={{ minHeight: 44, alignItems: 'center' }}>
            <span>{r.name === 'bluetooth' ? '🔵 Bluetooth [P]' : '🌐 LAN/Internet'}</span>
            <span className={`pill small ${r.availability === 'READY' ? 'on' : r.availability === 'PERMISSION_NEEDED' ? 'warn' : 'off'}`}>
              {AV_LABEL[r.availability]}
            </span>
          </div>
        ))}
        <p className="muted" style={{ fontSize: '0.8rem' }}>{rows.find((r) => r.name === 'bluetooth')?.detail}</p>
        <button
          className="btn-secondary"
          style={{ width: '100%' }}
          disabled={requestingBluetooth}
          onClick={() => void requestBluetooth()}
        >
          {requestingBluetooth ? 'Waiting for picker…' : 'Pair a nearby IQOO device [P]'}
        </button>
      </div>

      <div className="card">
        <h2>About</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          IQOO is a hackathon prototype. Mesh links are simulated unless a real radio is
          active (<span className="mono">[P]</span> labels mark prototypes). IQOO augments
          emergency response — it never replaces 100/112/911.
        </p>
      </div>
    </div>
  );
}
