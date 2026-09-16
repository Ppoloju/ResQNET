import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useStatus } from './state/StatusContext';
import { useSession } from './state/SessionContext';

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

export default function App({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return (
    <div className="app">
      <StatusBar />
      {children}
      <nav className="footer-nav" aria-label="Main navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">🏠</span>Home
        </NavLink>
        <NavLink to="/family" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">👪</span>Family
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">📜</span>History
        </NavLink>
        <NavLink to="/network" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">🛰</span>Network
        </NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico">⋯</span>More
        </NavLink>
      </nav>
    </div>
  );
}
