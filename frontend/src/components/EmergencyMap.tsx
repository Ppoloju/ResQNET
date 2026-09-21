// Emergency location map — real GPS on real map tiles.
//
// Leaflet + OpenStreetMap tiles (free, no API key, works over plain HTTP on a
// LAN). The marker tracks `position` exactly — high-accuracy GPS when the
// device provides it — and the circle shows the meter-level accuracy radius.
// If geolocation is denied or unavailable the component says so; it never
// fabricates a position.

import { useEffect, useRef, useState } from 'react';
import leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

interface Props {
  position: GeoFix | null;
  /** Other live emergencies to plot (from the SSE feed / public list). */
  others?: Array<{ emergencyId: string; latitude: number; longitude: number; label?: string }>;
  height?: number;
  zoom?: number;
  follow?: boolean;
}

const RED = '#b3001b';

export function EmergencyMap({ position, others = [], height = 260, zoom = 16, follow = true }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<leaflet.Map | null>(null);
  const meRef = useRef<leaflet.Marker | null>(null);
  const circleRef = useRef<leaflet.Circle | null>(null);
  const otherMarkersRef = useRef<Map<string, leaflet.Marker>>(new Map());
  const didCenterRef = useRef(false);

  // Init map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = leaflet.map(elRef.current, {
      center: [17.385, 78.4867], // neutral start (Hyderabad) until a real fix arrives
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });
    leaflet
      .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      })
      .addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      meRef.current = null;
      circleRef.current = null;
      otherMarkersRef.current.clear();
      didCenterRef.current = false;
    };
  }, []);

  // Track my exact position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    const ll: leaflet.LatLngExpression = [position.latitude, position.longitude];

    const icon = leaflet.divIcon({
      className: 'me-marker',
      html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${RED};border:3px solid #fff;box-shadow:0 0 0 2px ${RED}55"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    if (!meRef.current) {
      meRef.current = leaflet.marker(ll, { icon, title: 'Your location' }).addTo(map);
      circleRef.current = leaflet
        .circle(ll, {
          radius: position.accuracyMeters ?? 0,
          color: RED, weight: 1, fillColor: RED, fillOpacity: 0.12,
        })
        .addTo(map);
    } else {
      meRef.current.setLatLng(ll);
      circleRef.current?.setLatLng(ll);
      circleRef.current?.setRadius(position.accuracyMeters ?? 0);
    }

    if (follow && !didCenterRef.current) {
      didCenterRef.current = true;
      map.setView(ll, zoom);
    }
  }, [position, follow, zoom]);

  // Plot other live emergencies.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const o of others) {
      seen.add(o.emergencyId);
      const existing = otherMarkersRef.current.get(o.emergencyId);
      const icon = leaflet.divIcon({
        className: 'other-marker',
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:#e07000;border:2px solid #fff;box-shadow:0 0 6px #e0700088" title="${o.label ?? o.emergencyId}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      if (existing) existing.setLatLng([o.latitude, o.longitude]);
      else otherMarkersRef.current.set(o.emergencyId, leaflet.marker([o.latitude, o.longitude], { icon }).addTo(map));
    }
    for (const [id, marker] of otherMarkersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        otherMarkersRef.current.delete(id);
      }
    }
  }, [others]);

  return (
    <div className="map-wrap">
      <div ref={elRef} style={{ height, width: '100%', borderRadius: 10 }} aria-label="Emergency location map" />
      {!position && (
        <p className="muted small" style={{ margin: '6px 2px 0' }}>
          Waiting for a location fix… enable GPS/location permission for exact positioning.
        </p>
      )}
    </div>
  );
}

/**
 * High-accuracy watch: returns a live GeoFix that updates as the phone moves.
 * Uses watchPosition so SOS location stays exact while it matters; falls back
 * gracefully (LOCATION states mirror the shared packet schema).
 */
export function useHighAccuracyLocation() {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [state, setState] = useState<'idle' | 'watching' | 'denied' | 'unavailable'>('idle');

  useEffect(() => {
    if (!('geolocation' in navigator)) { setState('unavailable'); return; }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState('watching');
        setFix({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
        });
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { fix, state };
}
