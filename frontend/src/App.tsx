import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bell, Brain, History, Home as HomeIcon, Map, MapPinned, Menu, Network as NetworkIcon,
  Play, QrCode, Settings as SettingsIcon, ShieldCheck, UserRound, UserSearch, Users, X,
  type LucideIcon,
} from 'lucide-react';
import { Battery, BatteryCharging } from 'lucide-react';
import { useStatus } from './state/StatusContext';
import { useMode } from './state/ModeContext';
import { useMesh } from './state/MeshContext';
import { apiFetch, useSession } from './state/SessionContext';
import MedicalCard from './components/MedicalCard';
import { loadMedicalInfo, medicalFromProfile, type EmergencyProfilePayload, type MedicalInfo } from './state/medicalProfile';

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
  { to: '/', label: 'Home', end: true, icon: HomeIcon },
  { to: '/family', label: 'Family', icon: Users },
  { to: '/ai-assistance', label: 'AI Assistance', icon: Brain },
  { to: '/network', label: 'Network', icon: NetworkIcon },
];

const MENU = [
  { to: '/situations', label: 'Alerts', icon: Bell },
  { to: '/family-map', label: 'Family Map', icon: MapPinned },
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/demo', label: 'Demo Mode', icon: Play },
  { to: '/disaster-demo', label: 'Disaster Demo', icon: Map },
  { to: '/responders', label: 'Responders', icon: ShieldCheck },
  { to: '/history', label: 'History', icon: History },
  { to: '/missing', label: 'Missing Person', icon: UserSearch },
];

function MedicalIdButton() {
  const [open, setOpen] = useState(false);
  const [medical, setMedical] = useState<MedicalInfo>(loadMedicalInfo);
  const modalRef = useRef<HTMLElement>(null);
  const { user } = useSession();

  useEffect(() => {
    if (!open) return;
    setMedical(loadMedicalInfo());
    if (user) {
      apiFetch<{ profile: EmergencyProfilePayload }>('/emergency-profiles/me')
        .then(({ profile }) => setMedical(medicalFromProfile(profile)))
        .catch(() => { /* local profile remains available offline */ });
    }
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !modalRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [open]);

  return <>
    <button className="icon-btn medical-id-link" type="button" aria-label="Open Medical ID" title="Medical ID" aria-expanded={open} onClick={() => setOpen(true)}>
      <QrCode size={20} aria-hidden="true" />
    </button>
    {open && <>
      <button className="medical-id-scrim" type="button" aria-label="Close Medical ID" onClick={() => setOpen(false)} />
      <aside ref={modalRef} className="medical-id-modal" role="dialog" aria-modal="true" aria-label="Medical ID quick access">
        <header><strong>MEDICAL ID</strong><button className="medical-id-close" type="button" aria-label="Close Medical ID" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <div className="medical-id-content"><MedicalCard info={medical} /></div>
      </aside>
    </>}
  </>;
}

export default function App({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { phase, active, safePulse } = useMesh();
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
        title={n.label}
      >
        <n.icon size={18} aria-hidden="true" />
        <span className="nav-label">{n.label}</span>
      </NavLink>
    ));

  return (
    <div className={`app ${phase === 'ACTIVE' ? 'sos-global-active' : ''} ${safePulse ? 'safe-global-active' : ''}`}>
      {phase === 'ACTIVE' && (
        <div className="sos-global-frame" role="alert" aria-live="assertive">
          <span className="sr-only">SOS active{active ? `, emergency ${active.emergencyId}` : ''}</span>
        </div>
      )}
      {safePulse && <div className="safe-global-frame" role="status" aria-live="polite"><span className="sr-only">Safe status confirmed</span></div>}
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
          <MedicalIdButton />
          <NavLink className="icon-btn settings-link" to="/settings" aria-label="Open settings" title="Settings">
            <SettingsIcon size={20} aria-hidden="true" />
          </NavLink>
        </div>
      </header>

      <aside id="app-menu" className={`drawer ${menuOpen ? 'open' : ''}`} aria-label="More navigation">
        <nav>
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <item.icon className="ico" size={19} aria-hidden="true" />
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
