import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, Polyline } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface DemoMapMarker {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  tone?: 'primary' | 'secondary' | 'tertiary' | 'success';
  detail?: string;
}

interface DemoMapProps {
  title: string;
  subtitle: string;
  markers: DemoMapMarker[];
  paths?: Array<[string, string]>;
  userLocation?: { latitude: number; longitude: number } | null;
}

function markerIcon(tone: DemoMapMarker['tone']): L.DivIcon {
  const color = tone === 'primary' ? '#b3001b' : tone === 'success' ? '#2fae66' : tone === 'tertiary' ? '#2e7dd1' : '#e0a12b';
  return L.divIcon({ className: 'demo-leaflet-icon', html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 2px ${color}55"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

export default function DemoMap({ title, subtitle, markers, paths = [], userLocation }: DemoMapProps) {
  const center: LatLngExpression = markers.length > 0 ? [markers[0].latitude, markers[0].longitude] : [20.5937, 78.9629];
  const bounds = markers.length > 1 ? L.latLngBounds(markers.map((marker) => [marker.latitude, marker.longitude] as [number, number])) : null;
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
      <div className="demo-map-canvas demo-leaflet-map">
        <MapContainer center={center} zoom={markers.length > 0 ? 13 : 5} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {bounds && <MapBounds bounds={bounds} />}
          {markers.map((marker) => <Marker key={marker.id} position={[marker.latitude, marker.longitude]} icon={markerIcon(marker.tone)}><Popup><strong>{marker.label}</strong>{marker.detail && <><br />{marker.detail}</>}</Popup></Marker>)}
          {paths.map(([fromId, toId]) => {
            const from = markers.find((marker) => marker.id === fromId);
            const to = markers.find((marker) => marker.id === toId);
            return from && to ? <Polyline key={`${fromId}-${toId}`} positions={[[from.latitude, from.longitude], [to.latitude, to.longitude]]} /> : null;
          })}
          {userLocation && <Marker position={[userLocation.latitude, userLocation.longitude]} icon={markerIcon('primary')}><Popup><strong>Your live location</strong></Popup></Marker>}
        </MapContainer>
      </div>
      <div className="demo-map-legend"><span><i className="primary" /> Emergency</span><span><i className="secondary" /> Mesh node</span><span><i className="tertiary" /> Resource</span></div>
    </section>
  );
}

function MapBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 }); }, [bounds, map]);
  return null;
}
