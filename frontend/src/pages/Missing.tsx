// Missing Person Mode (§27): authorized users create reports; nearby devices
// receive a minimal alert. NO automatic facial recognition — matching is done
// by humans who read the description. Photo only shared via the alert payload.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, useSession } from '../state/SessionContext';
import { useStatus } from '../state/StatusContext';

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

  if (!user) return <div className="card">Sign in to file or view missing person reports.</div>;

  return (
    <div>
      <h1>Missing Person</h1>
      <p className="muted">
        File a report when someone cannot be located. Alerts carry only the minimal
        description — never automatic facial recognition; people match people. [R: full
        mesh alert propagation needs the native client]
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {note && <p className="ok-text" role="status">{note}</p>}

      <div className="card">
        <h2>File a report</h2>
        <label htmlFor="mp-name">Person's name</label>
        <input id="mp-name" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} />

        <div className="grid2">
          <div>
            <label htmlFor="mp-seen">Last seen (date & time)</label>
            <input id="mp-seen" type="datetime-local" value={form.lastSeenAt}
              onChange={(e) => setForm({ ...form, lastSeenAt: e.target.value })} />
          </div>
          <div>
            <label htmlFor="mp-phone">Contact phone</label>
            <input id="mp-phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </div>
        </div>

        <label htmlFor="mp-desc">Description</label>
        <textarea id="mp-desc" rows={2} maxLength={2000} value={form.description}
          placeholder="Age, build, language spoken, distinguishing details…"
          onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <label htmlFor="mp-cloth">Clothing</label>
        <input id="mp-cloth" value={form.clothing} onChange={(e) => setForm({ ...form, clothing: e.target.value })} />

        <label htmlFor="mp-photo" style={{ marginTop: 8 }}>Photo (optional, ≤150 KB)</label>
        <input id="mp-photo" type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} />

        {!cameraOn ? (
          <button className="btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => void startCamera()}>
            Take photo with camera [P]
          </button>
        ) : (
          <div className="mt">
            <video ref={videoRef} style={{ width: '100%', borderRadius: 12 }} muted playsInline aria-label="Camera preview" />
            <div className="row mt">
              <button className="btn-primary" onClick={capturePhoto}>Capture</button>
              <button className="btn-ghost" onClick={stopCamera}>Cancel</button>
            </div>
          </div>
        )}
        {photo && <p className="ok-text" style={{ fontSize: '0.8rem' }}>Photo attached ✓</p>}

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={useLocation}
            onChange={(e) => { setUseLocation(e.target.checked); if (e.target.checked) grabLocation(); }} />
          Include last-known location (from this device)
        </label>
        {useLocation && coords && (
          <p className="muted mono" style={{ fontSize: '0.8rem' }}>{coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}</p>
        )}

        <button className="btn-primary" style={{ width: '100%', marginTop: 10 }}
          onClick={() => void submit()}
          disabled={busy || !form.personName || !form.lastSeenAt || !form.contactPhone}>
          {busy ? 'Filing…' : 'File missing person report'}
        </button>
        {!online && <p className="muted" style={{ fontSize: '0.8rem' }}>Offline — the report will queue and sync when connectivity returns.</p>}
      </div>

      <h2>Open reports</h2>
      {reports.length === 0 && <p className="muted">No open reports.</p>}
      {reports.map((r) => (
        <div key={r.id} className="card" style={{ borderLeft: '4px solid #e0a12b' }}>
          <div className="row spread" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <strong>{r.personName}</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>last seen {new Date(r.lastSeenAt).toLocaleString()}</span>
          </div>
          {r.description && <p className="muted" style={{ margin: '6px 0 0' }}>{r.description}</p>}
          {r.clothing && <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>Clothing: {r.clothing}</p>}
          {r.lastLat != null && r.lastLon != null && (
            <p className="muted mono" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
              last location: {r.lastLat.toFixed(5)}, {r.lastLon.toFixed(5)}
            </p>
          )}
          <p className="muted mono" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>contact: {r.contactPhone}</p>
        </div>
      ))}
    </div>
  );
}
