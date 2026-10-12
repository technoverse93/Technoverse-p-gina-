// =====================================================================
// «MIRÁ ESTO» — la cámara de Phill
// =====================================================================
// Una vista en vivo de la cámara trasera, dentro de la propia app (sin
// saltar a otra pantalla): la foto sale directo al mensaje, que Phill
// analiza. Se abre con el botón de la cámara, desde el modo manos libres,
// o sola cuando le decís «Phill, mirá esto» (entonces cuenta 3, 2, 1 y
// saca la foto; tocar el obturador la saca ya).
// Si el aparato no deja usar la cámara en vivo, se cae a elegir una foto.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCcw, X } from 'lucide-react';

const LADO_MAX = 1600;

/** Un fotograma del video → archivo JPEG (de hasta 1600 px por el lado largo). */
async function fotograma(video: HTMLVideoElement): Promise<File> {
  const k = Math.min(1, LADO_MAX / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/jpeg', 0.88));
  return new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

export default function CamaraPhill({ auto = false, motivo = '', onFoto, onCerrar }: {
  /** Cuenta 3, 2, 1 y saca la foto sola (cuando Phill la abrió por vos). */
  auto?: boolean;
  motivo?: string;
  onFoto: (f: File) => void;
  onCerrar: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [lista, setLista] = useState(false);
  const [error, setError] = useState('');
  const [cuenta, setCuenta] = useState<number | null>(null);
  const [trasera, setTrasera] = useState(true);
  const entregada = useRef(false);

  const soltar = useCallback(() => {
    try { flujo.current?.getTracks().forEach(t => t.stop()); } catch { /* ya soltada */ }
    flujo.current = null;
  }, []);

  // Abrir la cámara (otra vez si se cambia de lado).
  useEffect(() => {
    let vivo = true;
    setLista(false); setError('');
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara');
        const f = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: trasera ? 'environment' : 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo) { f.getTracks().forEach(t => t.stop()); return; }
        soltar();
        flujo.current = f;
        const v = video.current;
        if (v) { v.srcObject = f; await v.play().catch(() => {}); }
        setLista(true);
      } catch (e: any) {
        if (!vivo) return;
        setError(e?.name === 'NotAllowedError' || /Permission|denied/i.test(String(e?.message))
          ? 'Phill necesita permiso para usar la cámara. Activalo en Ajustes del teléfono → Aplicaciones → Technoverse → Permisos → Cámara.'
          : 'No pude abrir la cámara en este aparato. Podés elegir una foto.');
      }
    })();
    return () => { vivo = false; };
  }, [trasera, soltar]);
  useEffect(() => soltar, [soltar]);

  const sacar = useCallback(async () => {
    const v = video.current;
    if (!v || !v.videoWidth || entregada.current) return;
    entregada.current = true;
    try { const f = await fotograma(v); soltar(); onFoto(f); }
    catch { entregada.current = false; setError('No pude sacar la foto. Probá de nuevo.'); }
  }, [onFoto, soltar]);

  // 3, 2, 1 y foto (solo cuando Phill abrió la cámara por vos).
  useEffect(() => {
    if (!auto || !lista) return;
    let n = 3; setCuenta(n);
    const id = setInterval(() => { n -= 1; if (n <= 0) { clearInterval(id); setCuenta(null); void sacar(); } else setCuenta(n); }, 1000);
    return () => clearInterval(id);
  }, [auto, lista, sacar]);

  const elegir = (l: FileList | null) => { const f = l?.[0]; if (f && !entregada.current) { entregada.current = true; soltar(); onFoto(f); } };

  return (
    <div className="jv-cam" role="dialog" aria-label="Cámara de Phill">
      <video ref={video} className="jv-cam-video" playsInline muted autoPlay />
      <div className="jv-cam-barra">
        <button type="button" className="jv-cam-btn" onClick={() => { soltar(); onCerrar(); }} aria-label="Cerrar la cámara"><X className="w-5 h-5" /></button>
        {motivo && <span className="jv-cam-motivo">{motivo}</span>}
        {lista && !error && <button type="button" className="jv-cam-btn" onClick={() => setTrasera(t => !t)} aria-label="Cambiar de cámara"><RefreshCcw className="w-5 h-5" /></button>}
      </div>
      {cuenta !== null && <div className="jv-cam-cuenta" aria-live="assertive">{cuenta}</div>}
      {error && (
        <div className="jv-cam-error" role="alert">
          <p>{error}</p>
          <button type="button" className="ai-chip" onClick={() => archivo.current?.click()}><ImagePlus className="w-4 h-4" />Elegir una foto</button>
        </div>
      )}
      <div className="jv-cam-pie">
        {auto && cuenta !== null && <small>Apuntá a lo que querés mostrar…</small>}
        <button type="button" className="jv-cam-obt" onClick={() => void sacar()} disabled={!lista || !!error} aria-label="Sacar la foto"><Camera className="w-6 h-6" /></button>
      </div>
      <input ref={archivo} type="file" accept="image/*" capture="environment" hidden onChange={e => elegir(e.target.files)} />
    </div>
  );
}
