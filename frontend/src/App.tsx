import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useStatus } from './state/StatusContext';
import { useSession } from './state/SessionContext';
import { useSettings } from './state/SettingsContext';

function StatusBar() {
  const { online, battery, charging } = useStatus();
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className={`pill ${online ? 'on' : 'off'}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
      <span className={`pill ${battery === null ? '' : battery <= 20 ? 'off' : battery <= 50 ? 'warn' : 'on'}`}>
        {battery === null ? 'BATT --' : `BATT ${battery}%${charging ? ' ⚡' : ''}`}
      </span>
      <span className="pill on">IQOO</span>
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
      {theme === 'system' ? '🖥' : theme === 'light' ? '☀️' : '🌙'}
    </button>
  );
}

const NAV = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/family', label: 'Family', icon: '👪' },
  { to: '/history', label: 'History', icon: '📜' },
  { to: '/network', label: 'Network', icon: '🛰' },
  { to: '/situations', label: 'Alerts', icon: '🚨' },
  { to: '/more', label: 'More', icon: '⋯' },
];

export default function App({ children }: { children: ReactNode }) {
  const { user } = useSession();
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
        <span className="ico" aria-hidden>{n.icon}</span> {n.label}
      </NavLink>
    ));

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <header className="topbar">
        <span className="brand" aria-hidden>
          <span className="brand-dot" /> IQOO
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

      <StatusBar />
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
