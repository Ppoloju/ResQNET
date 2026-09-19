import type { ReactNode } from 'react';

export interface DemoMapMarker {
  id: string;
  label: string;
  x: number;
  y: number;
  tone?: 'primary' | 'secondary' | 'tertiary' | 'success';
  detail?: string;
}

interface DemoMapProps {
  title: string;
  subtitle: string;
  markers: DemoMapMarker[];
  paths?: Array<[string, string]>;
  children?: ReactNode;
}

const toneClass = (tone: DemoMapMarker['tone']) => `demo-map-marker ${tone ?? 'secondary'}`;

export default function DemoMap({ title, subtitle, markers, paths = [], children }: DemoMapProps) {
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  return (
    <section className="demo-map-card" aria-label={title}>
      <div className="demo-map-heading">
        <div>
          <span className="eyebrow">TEMPORARY DEMO MAP</span>
          <h3>{title}</h3>
        </div>
        <span className="demo-map-badge">SIMULATION</span>
      </div>
      <p className="demo-map-subtitle">{subtitle}</p>
      <div className="demo-map-canvas">
        <div className="demo-map-grid" aria-hidden="true" />
        <div className="demo-map-route-lines" aria-hidden="true">
          {paths.map(([fromId, toId]) => {
            const from = byId.get(fromId);
            const to = byId.get(toId);
            if (!from || !to) return null;
            return <span key={`${fromId}-${toId}`} style={{ left: `${from.x}%`, top: `${from.y}%`, width: `${Math.hypot(to.x - from.x, to.y - from.y)}%`, transform: `rotate(${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI}deg)` }} />;
          })}
        </div>
        {markers.map((marker) => (
          <div key={marker.id} className={toneClass(marker.tone)} style={{ left: `${marker.x}%`, top: `${marker.y}%` }} title={marker.detail ?? marker.label}>
            <span className="demo-map-dot" />
            <span className="demo-map-label"><strong>{marker.label}</strong>{marker.detail && <small>{marker.detail}</small>}</span>
          </div>
        ))}
        {children}
      </div>
      <div className="demo-map-legend"><span><i className="primary" /> Emergency</span><span><i className="secondary" /> Mesh node</span><span><i className="tertiary" /> Resource</span></div>
    </section>
  );
}
