import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, ShieldAlert } from 'lucide-react';
import { formatMedicalCardText, hasMedicalCard, type MedicalInfo } from '../state/medicalProfile';

export default function MedicalCard({ info }: { info: MedicalInfo }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState('');
  const ready = hasMedicalCard(info);
  const payload = formatMedicalCardText(info);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    setQrError('');
    void QRCode.toCanvas(canvas, payload, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220', light: '#ffffff' },
    }).catch((e: unknown) => {
      setQrError(e instanceof Error ? e.message : 'Could not draw QR code');
    });
  }, [payload, ready]);

  return (
    <article className="medical-card" aria-label="Medical ID card">
      <header className="medical-card-band">
        <QrCode size={18} aria-hidden="true" />
        <span>MEDICAL ID</span>
        <strong>RESQNET</strong>
      </header>

      <div className="medical-card-body">
        <div className="medical-card-fields">
          <p className="medical-card-name">{info.name.trim() || 'Add your name'}</p>
          <dl>
            <div><dt>Age</dt><dd>{info.age ?? '—'}</dd></div>
            <div><dt>Gender</dt><dd>{info.gender || '—'}</dd></div>
            <div className="span2"><dt>Allergies</dt><dd>{info.allergies?.trim() || 'None listed'}</dd></div>
            <div className="span2"><dt>Medications</dt><dd>{info.medications?.trim() || 'None listed'}</dd></div>
            <div className="span2"><dt>Conditions</dt><dd>{info.medicalConditions?.trim() || 'None listed'}</dd></div>
          </dl>
        </div>

        <div className="medical-card-qr">
          {ready ? (
            <canvas ref={canvasRef} width={220} height={220} aria-label="QR code with medical details for responders" />
          ) : (
            <div className="medical-card-qr-empty" role="status">Save a name to generate a QR code</div>
          )}
          {qrError && <p className="error-text">{qrError}</p>}
          <p className="muted small">Responders can scan this with any camera app. The code contains your medical details as text — no internet required.</p>
        </div>
      </div>

      <footer className="medical-card-foot">
        <ShieldAlert size={14} aria-hidden="true" />
        Anyone who scans this QR can read these details. Show it to medical responders; do not post it publicly.
      </footer>
    </article>
  );
}
