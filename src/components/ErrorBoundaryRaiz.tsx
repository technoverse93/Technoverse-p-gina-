import React from 'react';
import { anotarErrorPantalla } from '../utils/erroresPantalla';

// =====================================================================
// BORDE DE ERRORES DE TODA LA APP
// =====================================================================
// Sin esto, un error al armar CUALQUIER pantalla hacía que React desmontara
// la app entera y quedaba la pantalla oscura, sin nada que tocar («sale
// cargando y luego en total oscuro»). Ahora:
//
//   1. Un fallo suelto (una carrera al arrancar, un archivo que no cargó a
//      tiempo) casi siempre se arregla armando la pantalla de nuevo: se hace
//      UNA vez, sin molestar a nadie.
//   2. Si vuelve a fallar, se muestra una pantalla clara con qué hacer
//      (reintentar, recargar, buscar la actualización) y el detalle técnico.
//
// Es a propósito simple y sin dependencias de la app: si esta pantalla
// dependiera de lo que se rompió, se romperían las dos.
// =====================================================================

interface Props { children: React.ReactNode }
interface Estado { error: Error | null; intento: number; silencioso: boolean }

/** Cuándo fue el último rearmado silencioso (para no repetirlo en bucle). */
let ultimoRearmado = 0;
const ESPERA_ENTRE_REARMADOS_MS = 60_000;

export default class ErrorBoundaryRaiz extends React.Component<Props, Estado> {
  // Este proyecto no trae los tipos de React: se declaran a mano los miembros de la clase base que se usan.
  declare props: Props;
  declare setState: (cambio: Partial<Estado> | ((s: Estado) => Partial<Estado>)) => void;
  state: Estado = { error: null, intento: 0, silencioso: false };

  static getDerivedStateFromError(error: unknown): Partial<Estado> {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      // ¿Toca rearmar en silencio o mostrar la pantalla de recuperación?
      silencioso: Date.now() - ultimoRearmado > ESPERA_ENTRE_REARMADOS_MS,
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    anotarErrorPantalla('render', error, info?.componentStack?.split('\n').slice(0, 4).join(' ') || undefined);
    if (this.state.silencioso) {
      ultimoRearmado = Date.now();
      this.setState(s => ({ error: null, silencioso: false, intento: s.intento + 1 }));
    }
  }

  private reintentar = () => {
    ultimoRearmado = Date.now();
    this.setState(s => ({ error: null, silencioso: false, intento: s.intento + 1 }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      // Mientras se rearma en silencio (un instante) solo se ve el fondo liso.
      if (this.state.silencioso) return <div style={{ minHeight: '100dvh', background: '#0F1217' }} />;
      return <PantallaDeRecuperacion error={this.state.error} onReintentar={this.reintentar} />;
    }
    return <React.Fragment key={this.state.intento}>{this.props.children}</React.Fragment>;
  }
}

function PantallaDeRecuperacion({ error, onReintentar }: { error: Error; onReintentar: () => void }) {
  const [mensaje, setMensaje] = React.useState('');
  const [copiado, setCopiado] = React.useState(false);
  const nativa = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  const version = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '?';
  const detalle = `${error.message || error.name}\n${(error.stack || '').split('\n').slice(0, 6).join('\n')}\nversión ${version}`;

  const buscarActualizacion = async () => {
    setMensaje('Buscando la versión más reciente…');
    try {
      const { verificarActualizacionManual } = await import('../mobile/otaUpdater');
      const r = await verificarActualizacionManual();
      if (r.estado === 'actualizando') setMensaje('Aplicando la actualización y reiniciando…');
      else if (r.estado === 'al-dia') setMensaje('Ya tiene la versión más reciente. Pruebe «Recargar la app».');
      else if (r.estado === 'error' || r.estado === 'sin-plugin') setMensaje(r.mensaje);
      else setMensaje('Esto solo aplica a la app instalada.');
    } catch {
      setMensaje('No se pudo buscar la actualización. Revise la conexión.');
    }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(detalle); setCopiado(true); } catch { /* el detalle queda a la vista igual */ }
  };

  const boton: React.CSSProperties = {
    appearance: 'none', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.06)', color: '#E9ECF1',
    borderRadius: 12, padding: '12px 14px', fontSize: 14, fontWeight: 600, width: '100%', cursor: 'pointer',
  };

  return (
    <div role="alert" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0F1217', color: '#E9ECF1', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#171B22', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: '#FB923C', marginBottom: 10 }}>Technoverse Costa Rica</div>
        <h1 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 8px', color: '#E9ECF1', fontFamily: 'inherit', lineHeight: 1.25 }}>Se detuvo la pantalla</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: '#A7AFBD', margin: '0 0 16px' }}>
          Algo falló al mostrar esta pantalla. No se perdió nada: sus datos están a salvo en el servidor. Pruebe una de estas opciones.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" style={{ ...boton, background: '#FB923C', color: '#1a1206', border: 'none' }} onClick={onReintentar}>Volver a intentar</button>
          <button type="button" style={boton} onClick={() => window.location.reload()}>Recargar la app</button>
          {nativa && <button type="button" style={boton} onClick={buscarActualizacion}>Buscar actualización</button>}
        </div>
        {mensaje && <p role="status" style={{ fontSize: 13, color: '#A7AFBD', margin: '14px 0 0' }}>{mensaje}</p>}
        <details style={{ marginTop: 16 }}>
          <summary style={{ fontSize: 12.5, color: '#A7AFBD', cursor: 'pointer' }}>Detalle técnico</summary>
          <pre style={{ fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,.35)', borderRadius: 10, padding: 10, margin: '8px 0', maxHeight: 180, overflow: 'auto', color: '#cdd3dd' }}>{detalle}</pre>
          <button type="button" style={{ ...boton, fontSize: 12.5, padding: '8px 10px' }} onClick={copiar}>{copiado ? 'Copiado' : 'Copiar detalle'}</button>
        </details>
      </div>
    </div>
  );
}
