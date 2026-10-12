// =====================================================================
// LA PIEZA DE PAUTA EN EL CHAT — lo que Phill armó con «crear_pauta»
// =====================================================================
// Una tarjeta con la pieza ya dibujada (con la foto y el precio reales del
// inventario), sus textos y dos botones: abrirla en el Estudio para afinarla
// (fondo con IA, Instagram, banner…) o descargarla tal cual.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { Download, Megaphone, ArrowUpRight } from 'lucide-react';
import { getDB } from '../../utils/storage';
import { aBlob, renderizar } from '../../utils/pauta/compositor';
import { FORMATOS, piezaNueva, type CopyPauta, type EstiloId, type FormatoId, type ObjetivoId, type Pieza } from '../../utils/pauta/modelo';
import { abrirEstudio } from '../../utils/pauta/pedido';
import { guardarImagen } from '../../utils/guardarImagen';

export type PiezaChat = {
  productoId: string; nombre: string; precio: number; descuento: number;
  formato: FormatoId; estilo: EstiloId; objetivo: ObjetivoId; copy: CopyPauta;
};

function aPieza(p: PiezaChat): Pieza {
  const prod = (getDB().products || []).find(x => x.id === p.productoId);
  return piezaNueva({
    formato: p.formato, estilo: p.estilo, titular: p.copy.titular, subtitulo: p.copy.subtitulo, etiqueta: p.copy.etiqueta, cta: p.copy.cta, pie: p.copy.pie,
    precio: p.precio > 0 ? p.precio : null, productoImg: prod?.imageUrl || null, telefono: String(getDB().settings?.companyPhone || ''),
  });
}

export default function PiezaPauta({ pieza, onAbrir }: { pieza: PiezaChat; onAbrir?: (modulo: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [bajando, setBajando] = useState(false);
  const fmt = FORMATOS[pieza.formato] || FORMATOS.retrato;

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try { if (canvas.current && vivo) await renderizar(canvas.current, aPieza(pieza), { escala: Math.min(1, 520 / fmt.ancho) }); }
      catch { if (vivo) setError('No se pudo dibujar la vista previa.'); }
    })();
    return () => { vivo = false; };
  }, [pieza, fmt.ancho]);

  const descargar = async () => {
    setBajando(true);
    try {
      const c = document.createElement('canvas');
      await renderizar(c, aPieza(pieza), { escala: 1 });
      const nombre = `pauta-${pieza.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pieza'}.jpg`;
      await guardarImagen(await aBlob(c, 'image/jpeg', 0.92), nombre);
    } catch { setError('No se pudo descargar la imagen.'); }
    finally { setBajando(false); }
  };

  return (
    <article className="jv-pieza" aria-label={`Pauta de ${pieza.nombre}`}>
      <header><Megaphone className="w-4 h-4" aria-hidden="true" /><b>Pauta</b><span>{fmt.corto} · {fmt.ancho}×{fmt.alto}</span></header>
      <div className="jv-pieza-lienzo" style={{ aspectRatio: `${fmt.ancho} / ${fmt.alto}`, maxWidth: `min(100%, calc(46vh * ${fmt.ancho / fmt.alto}))` }}>
        <canvas ref={canvas} aria-label={`Vista previa de la pieza: ${pieza.copy.titular}`} />
      </div>
      {error && <p className="jv-pieza-error" role="alert">{error}</p>}
      <p className="jv-pieza-caption">{pieza.copy.caption}</p>
      <div className="jv-pieza-botones">
        <button type="button" className="ai-chip" onClick={() => abrirEstudio({ productoId: pieza.productoId, formato: pieza.formato, estilo: pieza.estilo, objetivo: pieza.objetivo, copy: pieza.copy }, onAbrir)}><ArrowUpRight className="w-4 h-4" />Abrir en el Estudio</button>
        <button type="button" className="ai-chip" disabled={bajando} onClick={() => void descargar()}><Download className="w-4 h-4" />{bajando ? 'Armando…' : 'Descargar'}</button>
      </div>
    </article>
  );
}
