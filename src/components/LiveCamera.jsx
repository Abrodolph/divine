import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { THEME } from '../lib/theme';
import { uploadPhoto } from '../lib/upload';
import { Banner, Btn, Modal } from './ui';

/**
 * The crew photo is taken here, in the app — a live viewfinder with no way to
 * pick an old picture from the gallery — and the date, time, site and GPS are
 * burned into the corner before it is uploaded.
 *
 *   stamp     lines of text drawn onto the photo
 *   onCapture called with the uploaded file reference
 */
export default function LiveCamera({ open, onClose, onCapture, stamp = [], folder = 'attendance', title = 'Crew photo' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(null);
    setReady(false);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser will not let the app open the camera. Open the site in Chrome or Safari (over https) and try again.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setError(e.name === 'NotAllowedError' || e.name === 'NotFoundError'
          ? 'The camera is blocked or missing. Allow camera access for this site in the browser settings, then try again.'
          : e.message);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  async function shoot() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const lines = stamp.filter(Boolean);
      if (lines.length) {
        const size = Math.max(14, Math.round(canvas.width / 45));
        const pad = Math.round(size * 0.6);
        const boxH = lines.length * (size + pad * 0.4) + pad;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);
        ctx.fillStyle = '#fff';
        ctx.font = `${size}px sans-serif`;
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
          ctx.fillText(line, pad, canvas.height - boxH + pad * 0.6 + i * (size + pad * 0.4));
        });
      }

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('The photo could not be saved. Try again.');
      const ref = await uploadPhoto(new File([blob], 'crew.jpg', { type: 'image/jpeg' }), folder, { private: true });
      onCapture(ref);
      onClose();
    } catch (e) {
      setError(e.message || 'The photo could not be sent. Check the signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={title} accent={THEME.orange}>
      <div className="space-y-3">
        {error && <Banner tone="red">{error}</Banner>}
        <div className="rounded-lg overflow-hidden flex items-center justify-center" style={{ background: '#000', minHeight: 220 }}>
          <video ref={videoRef} playsInline muted className="w-full" style={{ maxHeight: '60vh' }} />
        </div>
        <div className="text-xs" style={{ color: THEME.textDim }}>
          {stamp.filter(Boolean).join(' · ')}
        </div>
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="subtle" onClick={onClose}>Cancel</Btn>
          <Btn type="button" accent={THEME.orange} icon={busy ? Loader2 : Camera} disabled={!ready || busy} onClick={shoot}>
            {busy ? 'Saving…' : 'Take photo'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
