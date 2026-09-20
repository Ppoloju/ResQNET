import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { useStatus } from './state/StatusContext';
import { useMode } from './state/ModeContext';

function StatusBar() {
  const { online, battery, charging } = useStatus();
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className={`pill ${online ? 'on' : 'off'}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
      <span className={`pill ${battery === null ? '' : battery <= 20 ? 'off' : battery <= 50 ? 'warn' : 'on'}`}>
        {battery === null ? 'BATT --' : `BATT ${battery}%${charging ? ' CHARGING' : ''}`}
      </span>
      <span className="pill on">ResQNET</span>
    </div>
  );
}

function ModeBanner() {
  const { mode, reason } = useMode();
  if (mode === 'NORMAL') return null;
  return (
    <div className={`mode-banner mode-${mode.toLowerCase()}`} role="status">
      <div>
        <strong>{mode === 'DISASTER' ? 'DISASTER MODE ACTIVE' : 'EMERGENCY MODE ACTIVE'}</strong>
        <span>{reason}</span>
      </div>
      <NavLink to="/situations">Open alerts</NavLink>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/family', label: 'Family' },
  { to: '/ai-assistance', label: 'AI Assistance' },
  { to: '/network', label: 'Network' },
  { to: '/more', label: 'More' },
];

export default function App({ children }: { children: ReactNode }) {
  const location = useLocation();

  const navLinks = () =>
    NAV.map((n) => (
      <NavLink
        key={n.to}
        to={n.to}
        end={n.end}
        className={({ isActive }) => (isActive ? 'active' : '')}
      >
        <span className="nav-label">{n.label}</span>
      </NavLink>
    ));

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <header className="topbar">
        <span className="brand">
          <img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" />
          <span>ResQNET</span>
        </span>
        <div className="topbar-actions">
          <NavLink className="icon-btn settings-link" to="/settings" aria-label="Open settings" title="Settings">
            <SettingsIcon size={20} aria-hidden="true" />
          </NavLink>
        </div>
      </header>

      <ModeBanner />

      {location.pathname !== '/' && <StatusBar />}
      <main id="main-content" className="page-host">
        {children}
      </main>

      {/* Desktop section navigation — hidden on phones by CSS. */}
      <nav className="footer-nav" aria-label="Section navigation">
        {navLinks()}
      </nav>
    </div>
  );
}
