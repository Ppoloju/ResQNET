// "More" page: secondary destinations + honest labeling. Relay consent and
// thresholds live in Settings (§29/§37).

import { Link } from 'react-router-dom';
import {
  Bell, History, Map, Play, Siren, UserRound, UserSearch, Network as NetworkIcon,
} from 'lucide-react';
import { useSession } from '../state/SessionContext';
import { Card, CardHeader, PageHeader } from '../components/ui';

const LINKS = [
  { to: '/situations', icon: Bell, title: 'Alerts', subtitle: 'Community bulletins and resources' },
  { to: '/profile', icon: UserRound, title: 'Profile', subtitle: 'Emergency card & medical info' },
  { to: '/demo', icon: Play, title: 'Demo Mode', subtitle: 'Scripted mesh scenario [P]' },
  { to: '/disaster-demo', icon: Map, title: 'Disaster Demo', subtitle: 'Community response walkthrough [P]' },
  { to: '/responders', icon: Siren, title: 'Responders', subtitle: 'Responder dashboard (role-gated)' },
  { to: '/network', icon: NetworkIcon, title: 'Message Map', subtitle: 'Live relay visualization' },
  { to: '/history', icon: History, title: 'History', subtitle: 'Black-box and past emergencies' },
  { to: '/missing', icon: UserSearch, title: 'Missing Person', subtitle: 'File & view reports' },
];

export default function More() {
  const { user } = useSession();

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / MORE"
        title="More"
        subtitle={user ? `Signed in as ${user.displayName}` : 'All ResQNET destinations'}
      />

      <div className="rq-hub-grid">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="card rq-hub-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <CardHeader icon={<l.icon size={17} />} title={l.title} subtitle={l.subtitle} />
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader icon={<Siren size={17} />} title="About this prototype" />
        <p className="muted">
          ResQNET is a hackathon prototype. Mesh links between phones are simulated in the demo
          (<span className="mono">[P]</span>) — real BLE transport requires native mobile support
          (<span className="mono">[R]</span>). ResQNET augments emergency response; it never replaces
          official emergency numbers (100/112/911).
        </p>
      </Card>
    </div>
  );
}
