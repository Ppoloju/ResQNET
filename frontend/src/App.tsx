import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useStatus } from './state/StatusContext';
import { useSession } from './state/SessionContext';
import { useSettings } from './state/SettingsContext';
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

/** Theme quick-toggle: cycles system → light → dark. Icon shows the current mode. */
function ThemeToggle() {
  const { theme, update } = useSettings();
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const label = theme === 'system' ? 'System theme' : theme === 'light' ? 'Light mode' : 'Dark mode';
  return (
    <button
      className="icon-btn"
      onClick={() => update({ theme: next })}
      aria-label={`Color theme: ${label}. Switch to ${next}`}
      title={`${label} — tap to change`}
    >
      {theme === 'system' ? 'SYS' : theme === 'light' ? 'LIGHT' : 'DARK'}
    </button>
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
  const { user } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer when the route changes (any NavLink click).
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  const navLinks = (onClick?: () => void) =>
    NAV.map((n) => (
      <NavLink
        key={n.to}
        to={n.to}
        end={n.end}
        className={({ isActive }) => (isActive ? 'active' : '')}
        onClick={onClick}
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
          <ThemeToggle />
          <button
            className={`icon-btn burger ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span className="burger-line" aria-hidden />
            <span className="burger-line" aria-hidden />
            <span className="burger-line" aria-hidden />
          </button>
        </div>
      </header>

      <ModeBanner />

      <nav id="main-nav" className={`drawer ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        {navLinks(() => setMenuOpen(false))}
        <div className="drawer-foot">
          {user ? (
            <span className="dim small">Signed in as <strong>{user.displayName}</strong></span>
          ) : (
            <span className="dim small">SOS works without an account</span>
          )}
        </div>
      </nav>
      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      {location.pathname !== '/' && <StatusBar />}
      <main id="main-content" className="page-host">
        {children}
      </main>

      {/* Desktop sidebar nav — hidden on phones by CSS; the burger drawer is the phone nav. */}
      <nav className="footer-nav" aria-label="Section navigation">
        {navLinks()}
      </nav>
    </div>
  );
}
