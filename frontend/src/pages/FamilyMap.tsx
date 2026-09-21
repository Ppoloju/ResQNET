import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cross, LocateFixed, MapPinned, RefreshCw, Users } from 'lucide-react';
import { PageHeader, StatusPill } from '../components/ui';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L, { type LatLngBoundsExpression, type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import { Card, EmptyState } from '../components/ui';

interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  linked: boolean;
  checkInStatus: 'SAFE' | 'AT_RISK' | 'NEEDS_HELP' | null;
  lastCheckInAt: string | null;
  lastLocation: { latitude: number; longitude: number } | null;
}

interface Point {
  id: string;
  label: string;
  relation?: string;
  latitude: number;
  longitude: number;
  status: string;
  isUser?: boolean;
  kind?: 'MEDICAL' | 'POLICE' | 'SHELTER' | 'SAFE_ZONE' | 'WATER' | 'SUPPLIES';
  distanceM?: number;
}

interface NearbyResource {
  id: string;
  kind: 'MEDICAL' | 'POLICE' | 'SHELTER' | 'SAFE_ZONE' | 'WATER' | 'SUPPLIES';
  name: string;
  lat: number;
  lon: number;
  capacityNote: string | null;
  verifiedAt: string;
  source: string;
  distanceM: number;
}

function age(value: string | null): string {
  if (!value) return 'location unavailable';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'updated just now' : `updated ${minutes}m ago`;
}

function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function markerIcon(kind: 'self' | 'family' | Point['kind'], status?: string): L.DivIcon {
  const className = kind === 'self' ? 'self' : kind === 'family' && status === 'NEEDS_HELP' ? 'danger' : kind ? kind.toLowerCase() : 'family';
  const symbol = kind === 'MEDICAL' ? '+' : kind === 'POLICE' ? 'P' : kind === 'SHELTER' ? 'S' : kind === 'SAFE_ZONE' ? 'Z' : kind === 'WATER' ? 'W' : kind === 'SUPPLIES' ? '□' : kind === 'self' ? '' : '•';
  return L.divIcon({
    className: 'family-leaflet-icon',
    html: `<span class="family-leaflet-pin ${className}"><span class="family-leaflet-symbol">${symbol}</span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
    popupAnchor: [0, -34],
  });
}

function FitMap({ points, userLocation }: { points: Point[]; userLocation: { latitude: number; longitude: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [map, points]);
  useEffect(() => {
    if (userLocation) map.panTo([userLocation.latitude, userLocation.longitude]);
  }, [map, userLocation]);
  return null;
}

export default function FamilyMap() {
  const { user } = useSession();
  const { online } = useStatus();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [resources, setResources] = useState<NearbyResource[]>([]);
  const [locationNote, setLocationNote] = useState('Requesting your location...');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!user) return;
    apiFetch<{ members: FamilyMember[] }>('/family')
      .then((response) => { setMembers(response.members); setError(''); })
      .catch((reason: Error) => setError(reason.message));
  }, [user]);

  const loadResources = useCallback((latitude: number, longitude: number) => {
    apiFetch<{ resources: NearbyResource[] }>(`/resources/nearby?lat=${latitude}&lon=${longitude}&limit=20`)
          .then((response) => setResources(response.resources))
      .catch(() => setResources([]));
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationNote('Location is not supported in this browser.');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setUserLocation(next);
        loadResources(next.latitude, next.longitude);
        setLocationNote('Your location is shown locally on this device.');
      },
      () => setLocationNote('Location permission was not granted. Family positions remain private and unshown.'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [loadResources]);

  useEffect(() => {
    load();
    const stopLocation = locate();
    const timer = window.setInterval(load, 15_000);
    return () => { window.clearInterval(timer); stopLocation?.(); };
  }, [load, locate]);

  const points = useMemo<Point[]>(() => [
    ...(userLocation ? [{ id: 'self', label: 'You', latitude: userLocation.latitude, longitude: userLocation.longitude, status: 'LIVE', isUser: true }] : []),
    ...members.filter((member) => member.lastLocation).map((member) => ({
      id: member.id,
      label: member.name,
      relation: member.relation,
      latitude: member.lastLocation!.latitude,
      longitude: member.lastLocation!.longitude,
      status: member.checkInStatus ?? 'WAITING',
    })),
    ...resources.map((resource) => ({
      id: resource.id,
      label: resource.name,
      relation: resource.kind.replace('_', ' '),
      latitude: resource.lat,
      longitude: resource.lon,
      status: resource.kind,
      kind: resource.kind,
      distanceM: resource.distanceM,
    })),
  ], [members, resources, userLocation]);

  const mapCenter: LatLngExpression = userLocation
    ? [userLocation.latitude, userLocation.longitude]
    : points.length > 0 ? [points[0].latitude, points[0].longitude] : [20.5937, 78.9629];
  const mapBounds: LatLngBoundsExpression | null = points.length > 0
    ? points.map((point) => [point.latitude, point.longitude] as [number, number])
    : null;

  if (!user) return <div className="page family-map-page"><Card><EmptyState icon={<Users size={20} />} title="Sign in to view your family map" /></Card></div>;

  return (
    <div className="page family-map-page">
      <PageHeader
        eyebrow="RESQNET / FAMILY MAP"
        title="Circle locations"
        subtitle="Opt-in location view refreshed every 15 seconds. Unlinked contacts never appear on the map."
        badge={online ? 'SYNC LINKED' : 'OFFLINE'}
        badgeTone={online ? 'safe' : 'waiting'}
        actions={
          <button className="family-icon-action" type="button" onClick={() => { load(); locate(); }} aria-label="Refresh family map" title="Refresh family map"><RefreshCw size={18} /></button>
        }
      />

      <section className="family-map-status" role="status"><span className={online ? 'is-live' : 'is-muted'}><span className="pulse-dot" /> {online ? 'SYNC LINKED' : 'OFFLINE'}</span><span><Users size={15} /> {points.length} visible location{points.length === 1 ? '' : 's'}</span><span><LocateFixed size={15} /> {locationNote}</span></section>
      {error && <p className="error-text">{error}</p>}

      <section className="family-live-map" aria-label="Family location map">
        <MapContainer center={mapCenter} zoom={userLocation ? 13 : 5} scrollWheelZoom className="family-leaflet-map">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {mapBounds && <FitMap points={points} userLocation={userLocation} />}
          {userLocation && <CircleMarker center={[userLocation.latitude, userLocation.longitude]} radius={22} pathOptions={{ color: '#f85149', fillColor: '#f85149', fillOpacity: 0.12, weight: 2 }} />}
          {points.map((point) => {
            const kind = point.isUser ? 'self' : point.kind ?? 'family';
            return <Marker key={point.id} position={[point.latitude, point.longitude]} icon={markerIcon(kind, point.status)}>
              <Popup><strong>{point.label}</strong><br />{point.isUser ? 'Live location on this device' : point.kind ? `${point.relation} · ${point.distanceM ?? '--'}m` : `${point.relation} · ${point.status}`}<br />{point.kind && <a href={googleMapsUrl(point.latitude, point.longitude)} target="_blank" rel="noreferrer">Open in Google Maps</a>}</Popup>
            </Marker>;
          })}
        </MapContainer>
        {points.length === 0 && <div className="family-map-empty"><MapPinned size={28} /><strong>No shared locations yet</strong><span>Linked family members appear after they share a location through a supported check-in.</span></div>}
        <div className="family-map-legend"><span><i className="self" /> You</span><span><i className="family" /> Family</span><span><i className="hospital" /> Hospital</span><span><i className="police" /> Police</span><span><i className="shelter" /> Shelter</span></div>
        <span className="family-map-scale">OPENSTREETMAP / LIVE DATA</span>
      </section>

      <section className="family-map-list"><div className="family-list-heading"><h2><MapPinned size={19} /> Location sharing</h2></div>{members.map((member) => <article key={member.id} className="family-map-row"><div><strong>{member.name}</strong><span>{member.relation} · {member.linked ? age(member.lastCheckInAt) : 'not linked'}</span></div><b className={member.lastLocation ? 'is-live' : 'is-muted'}>{member.lastLocation ? 'VISIBLE' : 'NO LOCATION'}</b></article>)}</section>
      <section className="family-map-list"><div className="family-list-heading"><h2><Cross size={19} /> Nearby resources</h2></div>{resources.length === 0 ? <p className="muted">Allow location access while online to load nearby hospitals, police stations, shelters, and aid points.</p> : resources.slice(0, 8).map((resource) => <a key={resource.id} className="family-map-row family-map-resource-link" href={googleMapsUrl(resource.lat, resource.lon)} target="_blank" rel="noreferrer"><div><strong>{resource.name}</strong><span>{resource.kind.replace('_', ' ')} · {resource.distanceM}m · verified {resource.verifiedAt}</span></div><b className="is-muted">OPEN MAP</b></a>)}</section>
    </div>
  );
}
