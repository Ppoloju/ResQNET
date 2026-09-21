// Missing Person Mode (§27): authorized users create reports; nearby devices
// receive a minimal alert. NO automatic facial recognition — matching is done
// by humans who read the description. Photo only shared via the alert payload.

import { useCallback, useEffect, useRef, useState } from 'react';
import { UserSearch, Camera, Send, MapPin } from 'lucide-react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';
import {
  Card, CardHeader, PageHeader, TextField, TextAreaField, ActionButton, EmptyState, StatusPill,
} from '../components/ui';

interface Report {
  id: string;
  personName: string;
  description: string | null;
  clothing: string | null;
  lastSeenAt: string;
  lastLat: number | null;
  lastLon: number | null;
  contactPhone: string;
  status: string;
  createdAt: string;
}

const EMPTY = {
  personName: '', description: '', clothing: '',
  lastSeenAt: '', contactPhone: '',
};

export default function Missing() {
  const { user } = useSession();
  const { online } = useStatus();
  const [reports, setReports] = useState<Report[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState<string | null>(null);
  const [useLocation, setUseLocation] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Camera capture [P] — explicit consent (§16): never starts without a press,
  // live preview shown, hard cleanup on stop/unmount. File upload remains the
  // always-works fallback.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      // Wait for the element to mount before attaching the stream.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError('Camera unavailable or permission denied — use the photo upload instead.');
    }
  };

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setError('Camera not ready yet — try again.'); return; }
    const canvas = document.createElement('canvas');
    // Cap resolution so the photo fits the mesh-friendly ≤150 KB budget.
    const scale = Math.min(1, 640 / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    if (dataUrl.length > 150_000) {
      setError('Captured photo too large — try again in better light or use upload.');
      return;
    }
    setPhoto(dataUrl);
    stopCamera();
    setNote('Photo captured ✓');
  };

  const load = useCallback(() => {
    if (!user) return;
    apiFetch<{ reports: Report[] }>('/missing-persons')
      .then((r) => setReports(r.reports))
      .catch((e: Error) => setError(e.message));
  }, [user]);

  useEffect(load, [load]);

  const grabLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setNote('Location captured for the report.'); },
      () => setError('Location unavailable — the report will be created without coordinates.'),
      { timeout: 6000 },
    );
  };

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 150_000) { setError('Photo too large (max ~150 KB) — keep reports lightweight for the mesh.'); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      await apiFetch('/missing-persons', {
        method: 'POST',
        body: JSON.stringify({
          personName: form.personName,
          description: form.description || undefined,
          clothing: form.clothing || undefined,
          photo: photo ?? undefined,
          lastSeenAt: form.lastSeenAt,
          lastLat: useLocation && coords ? coords.lat : undefined,
          lastLon: useLocation && coords ? coords.lon : undefined,
          contactPhone: form.contactPhone,
        }),
      });
      setForm(EMPTY); setPhoto(null); setUseLocation(false); setCoords(null);
      setNote('Report filed. Nearby ResQNET devices will receive a minimal alert through the mesh; matching is human-reviewed.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to file report');
    } finally {
      setBusy(false);
    }
  };

  const close = async (id: string, status: 'FOUND' | 'CANCELLED') => {
    try {
      await apiFetch(`/missing-persons/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  if (!user) return <div className="page"><Card><EmptyState icon={<UserSearch size={20} />} title="Sign in to file or view missing person reports" /></Card></div>;

  return (
    <div className="page">
      <PageHeader
        eyebrow="RESQNET / MISSING PERSON"
        title="Missing person"
        subtitle="File a report when someone cannot be located. Alerts carry only the minimal description — never automatic facial recognition; people match people. [R: full mesh alert propagation needs the native client]"
      />
      {error && <p className="error-text" role="alert">{error}</p>}
      {note && <p className="ok-text" role="status">{note}</p>}

      <Card>
        <CardHeader icon={<UserSearch size={17} />} title="File a report" />
        <div className="rq-modal-body">
          <TextField label="Person's name" value={form.personName} onChange={(personName) => setForm({ ...form, personName })} />
          <div className="grid2">
            <TextField label="Last seen (date & time)" type="datetime-local" value={form.lastSeenAt} onChange={(lastSeenAt) => setForm({ ...form, lastSeenAt })} />
            <TextField label="Contact phone" inputMode="tel" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
          </div>
          <TextAreaField label="Description" rows={2} maxLength={2000} value={form.description} placeholder="Age, build, language spoken, distinguishing details…" onChange={(description) => setForm({ ...form, description })} />
          <TextField label="Clothing" value={form.clothing} onChange={(clothing) => setForm({ ...form, clothing })} />
          <TextField label="Photo (optional, ≤150 KB)" type="file" value="" onChange={() => undefined} />
          <input
            id="mp-photo"
            type="file"
            accept="image/*"
            aria-label="Upload photo"
            onChange={(e) => onPhoto(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <ActionButton variant="secondary" full onClick={() => document.getElementById('mp-photo')?.click()}>
            <Camera size={16} /> Upload photo
          </ActionButton>
          {!cameraOn ? (
            <ActionButton variant="secondary" full onClick={() => void startCamera()}>
              <Camera size={16} /> Take photo with camera [P]
            </ActionButton>
          ) : (
            <div className="rq-modal-body">
              <video ref={videoRef} style={{ width: '100%', borderRadius: 12 }} muted playsInline aria-label="Camera preview" />
              <div className="row">
                <ActionButton variant="primary" onClick={capturePhoto}>Capture</ActionButton>
                <ActionButton variant="ghost" onClick={stopCamera}>Cancel</ActionButton>
              </div>
            </div>
          )}
          {photo && <p className="ok-text small" style={{ margin: 0 }}>Photo attached ✓</p>}

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 20, height: 20 }} checked={useLocation}
              onChange={(e) => { setUseLocation(e.target.checked); if (e.target.checked) grabLocation(); }} />
            Include last-known location (from this device)
          </label>
          {useLocation && coords && (
            <p className="muted mono small" style={{ margin: 0 }}>{coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}</p>
          )}

          <ActionButton variant="primary" full onClick={() => void submit()}
            disabled={busy || !form.personName || !form.lastSeenAt || !form.contactPhone}>
            <Send size={16} /> {busy ? 'Filing…' : 'File missing person report'}
          </ActionButton>
          {!online && <p className="muted small" style={{ margin: 0 }}>Offline — the report will queue and sync when connectivity returns.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader icon={<MapPin size={17} />} title="Open reports" subtitle={reports.length === 0 ? 'No open reports.' : `${reports.length} active report${reports.length === 1 ? '' : 's'}`} />
        {reports.map((r) => (
          <div key={r.id} className="rq-mini-list" style={{ marginBottom: 8 }}>
            <div className="rq-mini-row">
              <span className="rq-mini-main">
                <strong>{r.personName}</strong>
                <small>last seen {new Date(r.lastSeenAt).toLocaleString()}</small>
                {r.description && <small>{r.description}</small>}
                {r.clothing && <small>Clothing: {r.clothing}</small>}
                {r.lastLat != null && r.lastLon != null && (
                  <small className="mono">last location: {r.lastLat.toFixed(5)}, {r.lastLon.toFixed(5)}</small>
                )}
                <small className="mono">contact: {r.contactPhone}</small>
              </span>
              <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <StatusPill tone="waiting">{r.status}</StatusPill>
                <ActionButton variant="ghost" onClick={() => void close(r.id, 'FOUND')}>Found</ActionButton>
                <ActionButton variant="ghost" onClick={() => void close(r.id, 'CANCELLED')}>Cancel</ActionButton>
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
