import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Battery, BatteryCharging, Menu, Settings as SettingsIcon, X } from 'lucide-react';
import { useStatus } from './state/StatusContext';
import { useMode } from './state/ModeContext';

function StatusBar() {
  const { online, battery, charging } = useStatus();
  const batteryLabel = battery === null
    ? 'Battery level unavailable'
    : `Battery ${battery}%${charging ? ', charging' : ''}`;
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className={`pill ${online ? 'on' : 'off'}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
      <span
        className={`pill battery-pill ${battery === null ? '' : battery <= 20 ? 'off' : battery <= 50 ? 'warn' : 'on'}${charging ? ' is-charging' : ''}`}
        aria-label={batteryLabel}
        title={batteryLabel}
      >
        {charging ? <BatteryCharging size={18} aria-hidden="true" /> : <Battery size={18} aria-hidden="true" />}
        <span aria-hidden="true">{battery === null ? '--' : `${battery}%`}</span>
        <span className="sr-only">{batteryLabel}</span>
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
];

const MENU = [
  { to: '/situations', label: 'Alerts' },
  { to: '/profile', label: 'Profile' },
  { to: '/demo', label: 'Demo Mode' },
  { to: '/disaster-demo', label: 'Disaster Demo' },
  { to: '/responders', label: 'Responders' },
  { to: '/history', label: 'History' },
  { to: '/missing', label: 'Missing Person' },
];

export default function App({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
          <button
            className={`icon-btn burger ${menuOpen ? 'open' : ''}`}
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
          <NavLink className="icon-btn settings-link" to="/settings" aria-label="Open settings" title="Settings">
            <SettingsIcon size={20} aria-hidden="true" />
          </NavLink>
        </div>
      </header>

      <aside id="app-menu" className={`drawer ${menuOpen ? 'open' : ''}`} aria-label="More navigation">
        <nav>
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="drawer-foot">
          <NavLink to="/more">About ResQNET</NavLink>
        </div>
      </aside>
      {menuOpen && <button className="scrim" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

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
