import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, Cross, LocateFixed, MapPinned, RefreshCw, Shield, Users } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';

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
  kind?: 'MEDICAL' | 'POLICE';
  distanceM?: number;
}

interface NearbyResource {
  id: string;
  kind: 'MEDICAL' | 'POLICE' | string;
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

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationNote('Location is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setUserLocation(next);
        apiFetch<{ resources: NearbyResource[] }>(`/resources/nearby?lat=${next.latitude}&lon=${next.longitude}&limit=20`)
          .then((response) => setResources(response.resources.filter((resource) => resource.kind === 'MEDICAL' || resource.kind === 'POLICE')))
          .catch(() => setResources([]));
        setLocationNote('Your location is shown locally on this device.');
      },
      () => setLocationNote('Location permission was not granted. Family positions remain private and unshown.'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    );
  }, []);

  useEffect(() => {
    load();
    locate();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
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
      relation: resource.kind === 'POLICE' ? 'POLICE' : 'HOSPITAL',
      latitude: resource.lat,
      longitude: resource.lon,
      status: resource.kind,
      kind: resource.kind as 'MEDICAL' | 'POLICE',
      distanceM: resource.distanceM,
    })),
  ], [members, resources, userLocation]);

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const latSpan = Math.max(maxLat - minLat, 0.002);
    const lonSpan = Math.max(maxLon - minLon, 0.002);
    return { minLat: minLat - latSpan * 0.18, maxLat: maxLat + latSpan * 0.18, minLon: minLon - lonSpan * 0.18, maxLon: maxLon + lonSpan * 0.18 };
  }, [points]);

  if (!user) return <div className="page family-map-page"><div className="card">Sign in to view your family map.</div></div>;

  return (
    <div className="page family-map-page">
      <section className="family-map-heading">
        <div><span className="eyebrow">RESQNET / FAMILY MAP</span><h1>Circle locations</h1><p className="muted">Opt-in location view refreshed every 15 seconds. Unlinked contacts never appear on the map.</p></div>
        <button className="family-icon-action" type="button" onClick={() => { load(); locate(); }} aria-label="Refresh family map" title="Refresh family map"><RefreshCw size={18} /></button>
      </section>

      <section className="family-map-status" role="status"><span className={online ? 'is-live' : 'is-muted'}><span className="pulse-dot" /> {online ? 'SYNC LINKED' : 'OFFLINE'}</span><span><Users size={15} /> {points.length} visible location{points.length === 1 ? '' : 's'}</span><span><LocateFixed size={15} /> {locationNote}</span></section>
      {error && <p className="error-text">{error}</p>}

      <section className="family-live-map" aria-label="Family location map">
        <div className="family-map-grid" aria-hidden="true" />
        {bounds && points.map((point) => {
          const left = ((point.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
          const top = (1 - (point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
          const ResourceIcon = point.kind === 'POLICE' ? Shield : Cross;
          const marker = <><span className="family-map-arrow">{point.kind ? <ResourceIcon size={17} /> : <ArrowUp size={17} />}</span><strong>{point.label}</strong><small>{point.isUser ? 'LIVE / THIS DEVICE' : point.kind ? `${point.relation} / ${point.distanceM ?? '--'}m` : `${point.relation} / ${point.status}`}</small></>;
          return point.kind
            ? <a key={point.id} className={`family-map-marker resource ${point.kind.toLowerCase()}`} href={googleMapsUrl(point.latitude, point.longitude)} target="_blank" rel="noreferrer" style={{ left: `${left}%`, top: `${top}%` }} title={`Open ${point.label} in Google Maps`}>{marker}</a>
            : <div key={point.id} className={`family-map-marker ${point.isUser ? 'self' : point.status === 'NEEDS_HELP' ? 'danger' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} title={`${point.label}: ${point.status}`}>{marker}</div>;
        })}
        {!bounds && <div className="family-map-empty"><MapPinned size={28} /><strong>No shared locations yet</strong><span>Linked family members appear after they share a location through a supported check-in.</span></div>}
        <div className="family-map-legend"><span><i className="self" /> You</span><span><i className="family" /> Family</span><span><i className="hospital" /> Hospital</span><span><i className="police" /> Police</span></div>
        <span className="family-map-scale">LIVE VIEW / VERIFIED RESOURCE DATA</span>
      </section>

      <section className="family-map-list"><div className="family-list-heading"><h2><MapPinned size={19} /> Location sharing</h2></div>{members.map((member) => <article key={member.id} className="family-map-row"><div><strong>{member.name}</strong><span>{member.relation} · {member.linked ? age(member.lastCheckInAt) : 'not linked'}</span></div><b className={member.lastLocation ? 'is-live' : 'is-muted'}>{member.lastLocation ? 'VISIBLE' : 'NO LOCATION'}</b></article>)}</section>
      <section className="family-map-list"><div className="family-list-heading"><h2><Cross size={19} /> Nearby care</h2></div>{resources.length === 0 ? <p className="muted">Allow location access while online to load nearby hospitals and police stations.</p> : resources.slice(0, 8).map((resource) => <a key={resource.id} className="family-map-row family-map-resource-link" href={googleMapsUrl(resource.lat, resource.lon)} target="_blank" rel="noreferrer"><div><strong>{resource.name}</strong><span>{resource.kind === 'POLICE' ? 'Police station' : 'Hospital'} · {resource.distanceM}m · verified {resource.verifiedAt}</span></div><b className="is-muted">OPEN MAP</b></a>)}</section>
    </div>
  );
}
