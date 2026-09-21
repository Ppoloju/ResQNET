// "More" page: secondary destinations + honest labeling. Relay consent and
// thresholds live in Settings (§29/§37).

import { Link } from 'react-router-dom';
import {
  Bell, History, Map, Play, Siren, UserRound, UserSearch, Network as NetworkIcon,
} from 'lucide-react';
import { HelpCircle } from 'lucide-react';
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

      <div className="card" id="faq">
        <span className="eyebrow"><HelpCircle size={14} /> RESQNET / FAQs</span>
        <h2>Frequently asked questions</h2>
        <details>
          <summary>Does ResQNET work without internet?</summary>
          <p className="muted">SOS packets can be created and queued offline. The simulated mesh demonstrates store-and-forward routing; real background device relays require the native mobile app.</p>
        </details>
        <details>
          <summary>Is my medical information stored?</summary>
          <p className="muted">Your profile is saved to the protected backend database when you save it. Sensitive medical fields are encrypted at rest.</p>
        </details>
        <details>
          <summary>Does this replace emergency services?</summary>
          <p className="muted">No. ResQNET supports emergency coordination and never replaces official emergency numbers such as 100, 112, or 911.</p>
        </details>
        <details>
          <summary>What is still a prototype?</summary>
          <p className="muted">The browser mesh and demo radio links are foreground/prototype paths. Background Bluetooth, Wi-Fi Direct, and native lifecycle support require the mobile client.</p>
        </details>
      </div>

      <div className="card">
        <span className="eyebrow">RESQNET / ABOUT</span>
        <h2>Built for the moments between signal and help</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          ResQNET is an offline-first emergency coordination prototype. It helps people create a
          signed SOS, share an honest location, stay connected with trusted contacts, and surface
          nearby response information when ordinary connectivity is unreliable.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
          The demo uses a simulated mesh to prove routing, retries, acknowledgements, and gateway
          sync <span className="mono">[P]</span>. Background Bluetooth and Wi-Fi Direct require a
          native mobile client <span className="mono">[R]</span>. ResQNET supports official emergency
          services; it never replaces local emergency numbers such as 100, 112, or 911.
        </p>
      </div>
    </div>
  );
}
