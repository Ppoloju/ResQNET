// "More" page: secondary destinations + honest labeling. Relay consent and
// thresholds live in Settings (§29/§37).

import { Link } from 'react-router-dom';
import { useSession } from '../state/SessionContext';

export default function More() {
  const { user } = useSession();

  return (
    <div className="page">
      <h2>More</h2>

      <div className="grid2">
        <Link to="/profile" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>🪪 Profile</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Emergency card &amp; medical info</p>
        </Link>
        <Link to="/demo" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>🎬 Demo Mode</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Scripted mesh scenario <span className="mono">[P]</span></p>
        </Link>
        <Link to="/responders" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>🚑 Responders</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Responder dashboard (role-gated)</p>
        </Link>
        <Link to="/network" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>🛰 Message Map</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Live relay visualization</p>
        </Link>
        <Link to="/missing" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>🔍 Missing Person</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>File &amp; view reports</p>
        </Link>
        <Link to="/settings" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h2 style={{ margin: 0 }}>⚙️ Settings</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Relay, battery tiers, transports</p>
        </Link>
      </div>

      <div className="card">
        <h2>About this prototype</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          IQOO is a hackathon prototype. Mesh links between phones are simulated in the demo
          (<span className="mono">[P]</span>) — real BLE transport requires native mobile support
          (<span className="mono">[R]</span>). IQOO augments emergency response; it never replaces
          official emergency numbers (100/112/911).
        </p>
      </div>
    </div>
  );
}
