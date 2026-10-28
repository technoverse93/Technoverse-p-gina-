// =====================================================================
// ESTUDIO DE PAUTA — Javier crea la publicidad
// =====================================================================
// Elegís un producto, un objetivo y un formato; Javier escribe los textos
// con los datos reales, la IA gratis hace un fondo (opcional) y la app
// dibuja la pieza con el logo y el precio exactos. Después:
//   · se descarga o se comparte (WhatsApp, Instagram…);
//   · se guarda en la galería;
//   · se usa de banner de la tienda;
//   · se programa en Instagram (el cron de la base la publica sola).
// También cierra el hueco de «Publicaciones de Instagram» de Inventario:
// las solicitudes «Falta imagen» se resuelven aquí con un toque.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Sparkles, Download, Share2, Save, Image as ImageIcon, Megaphone, CalendarClock, Copy, Trash2, RefreshCw, Instagram, Layers } from 'lucide-react';
import { Card, Btn, Field, Chip, Empty } from './AdminKit';
import { CustomSelect } from '../CustomSelect';
import { useToast, useConfirm } from '../ui/Overlays';
import { getDB, saveDB, addAuditLog } from '../../utils/storage';
import { webhookInstagramConfigurado } from '../../utils/webhookInstagram';
import { aBlob, comprimirReferencia, miniaturaDe, renderizar } from '../../utils/pauta/compositor';
import { ESTILOS, FORMATOS, OBJETIVOS, ORDEN_ESTILOS, ORDEN_FORMATOS, colones, formatoDeBanner, piezaNueva, textoPublicacion, type FondoModo, type FormatoId, type ObjetivoId, type Pieza } from '../../utils/pauta/modelo';
import { aPautaGuardada, borrarPauta, guardarPauta, listarPautas, nuevaId, pedirCopy, pedirImagen, subirFondo, subirPieza, type PautaGuardada } from '../../utils/pauta/api';
import { CLAVE_PEDIDO_PAUTA, EVENTO_PEDIDO_PAUTA, type PedidoPauta } from '../../utils/pauta/pedido';
import { compartirImagen, guardarImagen } from '../../utils/guardarImagen';
import type { Banner, MarketingRequest, Product, User } from '../../types';
import '../../styles/estudio.css';
import { esRepuesto, esInsumo } from '../../utils/categorias';


const FONDOS: { id: FondoModo; nombre: string }[] = [
  { id: 'gradiente', nombre: 'Degradado de marca' },
  { id: 'producto', nombre: 'Foto difuminada' },
  { id: 'ia', nombre: 'Con IA ✨' },
];

const aLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mananaALas = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return aLocalInput(d); };

export default function EstudioPauta({ currentUser }: { currentUser: User | null }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [productos, setProductos] = useState<Product[]>(() => (getDB().products || []).filter(p => p.active !== false && p.name));
  const [solicitudes, setSolicitudes] = useState<MarketingRequest[]>(() => getDB().marketing_requests || []);
  const [productoId, setProductoId] = useState('');
  const [objetivo, setObjetivo] = useState<ObjetivoId>('venta');
  const [instrucciones, setInstrucciones] = useState('');
  const [pieza, setPieza] = useState<Pieza>(() => piezaNueva({ telefono: String(getDB().settings?.companyPhone || '') }));
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [fondoPrompt, setFondoPrompt] = useState('');
  const [escena, setEscena] = useState(false);
  const [armando, setArmando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [trabajando, setTrabajando] = useState<null | 'guardar' | 'descargar' | 'compartir' | 'banner' | 'instagram'>(null);
  const [aviso, setAviso] = useState('');
  const [galeria, setGaleria] = useState<PautaGuardada[] | null>(null);
  const [enNube, setEnNube] = useState(true);
  const [programar, setProgramar] = useState<{ abierto: boolean; cuando: string; requestId: string | null }>({ abierto: false, cuando: mananaALas(18), requestId: null });
  const [pautaId, setPautaId] = useState<string>(() => nuevaId());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cola = useRef<Promise<void>>(Promise.resolve());

  const producto = useMemo(() => productos.find(p => p.id === productoId) || null, [productos, productoId]);
  const hayPieza = !!pieza.titular.trim() || !!pieza.productoImg;
  const fmt = FORMATOS[pieza.formato];

  // ---- datos que cambian por fuera (otro admin, Inventario) ----
  useEffect(() => {
    const alActualizar = () => {
      setProductos((getDB().products || []).filter(p => p.active !== false && p.name));
      setSolicitudes(getDB().marketing_requests || []);
    };
    window.addEventListener('technoverse_db_updated', alActualizar);
    return () => window.removeEventListener('technoverse_db_updated', alActualizar);
  }, []);

  const cargarGaleria = useCallback(async () => {
    try { const r = await listarPautas(); setGaleria(r.items); setEnNube(r.nube); }
    catch (e: any) { setGaleria([]); toast.error(`No se pudo leer la galería: ${e?.message || e}`); }
  }, [toast]);
  useEffect(() => { void cargarGaleria(); }, [cargarGaleria]);

  // ---- la vista previa se vuelve a dibujar al editar (una a la vez) ----
  useEffect(() => {
    const t = setTimeout(() => {
      cola.current = cola.current.then(async () => {
        const c = canvasRef.current;
        if (!c) return;
        const ancho = FORMATOS[pieza.formato].ancho;
        try { await renderizar(c, pieza, { escala: Math.min(1, 720 / ancho) }); } catch { /* se reintenta con el próximo cambio */ }
      });
    }, 90);
    return () => clearTimeout(t);
  }, [pieza]);

  const cambiar = (parcial: Partial<Pieza>) => setPieza(p => ({ ...p, ...parcial }));

  // ---- elegir producto ----
  const aplicarProducto = useCallback((p: Product | null, base?: Partial<Pieza>) => {
    setProductoId(p?.id || '');
    if (!p) { setPieza(x => ({ ...x, productoImg: null, precio: null, ...base })); return; }
    const desc = Number(p.discountPercent) > 0 ? `-${Math.round(Number(p.discountPercent))}%` : '';
    setPieza(x => ({
      ...x, productoImg: p.imageUrl || null, precio: Number(p.price) || null, mostrarPrecio: true,
      titular: x.titular.trim() ? x.titular : p.name.slice(0, 34), etiqueta: x.etiqueta || desc, fondoImg: null, fondoUrl: null, ocultarProducto: false,
      fondo: x.fondo === 'ia' ? 'gradiente' : x.fondo, ...base,
    }));
  }, []);

  // ---- armar con Javier ----
  const armar = useCallback(async (p: Product | null, opciones?: { objetivo?: ObjetivoId; formato?: FormatoId; extra?: string }) => {
    if (!p) { toast.error('Elegí un producto primero.'); return; }
    setArmando(true); setAviso('');
    const r = await pedirCopy({
      nombre: p.name, categoria: p.category, precio: Number(p.price) || 0, descuento: Number(p.discountPercent) || 0, descripcion: p.description,
      garantia: p.warranty, marca: (p as any).brand, stock: p.stock, objetivo: opciones?.objetivo || objetivo,
      instrucciones: [opciones?.extra, instrucciones].filter(Boolean).join('. '), telefono: String(getDB().settings?.companyPhone || ''), formato: opciones?.formato || pieza.formato,
    });
    setArmando(false);
    if (!r.ok || !r.copy) { const m = r.error || 'No se pudieron armar los textos.'; toast.error(m); setAviso(m); return; }
    const c = r.copy;
    setPieza(x => ({ ...x, titular: c.titular, subtitulo: c.subtitulo, etiqueta: c.etiqueta, cta: c.cta, pie: c.pie, estilo: c.estilo, formato: opciones?.formato || x.formato }));
    setCaption(c.caption); setHashtags(c.hashtags.join(' ')); setFondoPrompt(c.fondo);
    toast.success('Listo: Javier armó los textos. Revisalos y afiná lo que quieras.');
  }, [objetivo, instrucciones, pieza.formato, toast]);

  // ---- fondo con IA ----
  const generarFondo = useCallback(async () => {
    setGenerando(true); setAviso('');
    const escenaConProducto = escena && !!pieza.productoImg;
    const referencia = escenaConProducto ? (await comprimirReferencia(pieza.productoImg!)) || undefined : undefined;
    const r = await pedirImagen({
      fondo: fondoPrompt || (producto ? `a professional advertising scene for ${producto.name}` : 'abstract modern technology backdrop'),
      formato: pieza.formato, estilo: pieza.estilo, referencia,
    });
    setGenerando(false);
    if (!r.ok || !r.imagen) {
      const motivo = r.intentos?.length ? ` (${r.intentos.slice(0, 3).join(' · ')})` : '';
      setAviso(`${r.error || 'No se pudo crear el fondo.'}${motivo}`); toast.error(r.error || 'No se pudo crear el fondo.');
      return;
    }
    setPieza(x => ({ ...x, fondo: 'ia', fondoImg: r.imagen!, fondoUrl: null, ocultarProducto: !!referencia }));
    toast.success(`Fondo listo (${r.proveedor === 'pollinations' ? 'Pollinations' : r.proveedor === 'cloudflare' ? 'Cloudflare' : r.proveedor === 'huggingface' ? 'Hugging Face' : 'Gemini'}${typeof r.quedan === 'number' ? ` · te quedan ${r.quedan} hoy` : ''}).`);
  }, [escena, fondoPrompt, pieza.formato, pieza.estilo, pieza.productoImg, producto, toast]);

  // ---- lo que me dejaron el chat de Javier o Inventario ----
  const aplicarPedido = useCallback((ped: PedidoPauta) => {
    const p = productos.find(x => x.id === ped.productoId) || null;
    if (p) aplicarProducto(p, { ...(ped.formato ? { formato: ped.formato } : {}), ...(ped.estilo ? { estilo: ped.estilo } : {}) });
    else if (ped.formato || ped.estilo) cambiar({ ...(ped.formato ? { formato: ped.formato } : {}), ...(ped.estilo ? { estilo: ped.estilo } : {}) });
    if (ped.objetivo) setObjetivo(ped.objetivo);
    if (ped.copy) {
      const c = ped.copy;
      setPieza(x => ({ ...x, titular: c.titular, subtitulo: c.subtitulo, etiqueta: c.etiqueta, cta: c.cta, pie: c.pie, estilo: ped.estilo || c.estilo }));
      setCaption(c.caption); setHashtags((c.hashtags || []).join(' ')); setFondoPrompt(c.fondo || '');
    }
    if (ped.requestId) {
      const req = (getDB().marketing_requests || []).find(r => r.id === ped.requestId);
      setProgramar({ abierto: true, cuando: aLocalInput(new Date(req?.scheduledAt || Date.now() + 86_400_000)), requestId: ped.requestId });
      if (!ped.copy && p) void armar(p, { formato: ped.formato || 'retrato', extra: 'Es para una publicación programada en Instagram' });
    }
    setAviso('');
    setTimeout(() => document.getElementById('estudio-pauta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [productos, aplicarProducto, armar]);

  useEffect(() => {
    const leer = () => {
      try {
        const crudo = sessionStorage.getItem(CLAVE_PEDIDO_PAUTA);
        if (!crudo) return;
        sessionStorage.removeItem(CLAVE_PEDIDO_PAUTA);
        aplicarPedido(JSON.parse(crudo) as PedidoPauta);
      } catch { /* pedido ilegible: se ignora */ }
    };
    leer();
    window.addEventListener(EVENTO_PEDIDO_PAUTA, leer);
    return () => window.removeEventListener(EVENTO_PEDIDO_PAUTA, leer);
  }, [aplicarPedido]);

  // ---- exportar ----
  const exportar = useCallback(async () => {
    const c = document.createElement('canvas');
    await renderizar(c, pieza, { escala: 1 });
    const blob = await aBlob(c, 'image/jpeg', 0.92);
    return { canvas: c, blob };
  }, [pieza]);

  const nombreArchivo = () => `pauta-${(pieza.titular || 'technoverse').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pieza'}.jpg`;
  const textoRedes = textoPublicacion(caption, hashtags.split(/\s+/).filter(Boolean));

  const descargar = async () => {
    setTrabajando('descargar');
    try { const { blob } = await exportar(); const r = await guardarImagen(blob, nombreArchivo()); (r.ok ? toast.success : toast.error)(r.mensaje || 'Listo.'); }
    catch (e: any) { toast.error(`No se pudo armar la imagen: ${e?.message || e}`); }
    finally { setTrabajando(null); }
  };
  const compartir = async () => {
    setTrabajando('compartir');
    try {
      const { blob } = await exportar();
      const r = await compartirImagen(blob, nombreArchivo(), textoRedes);
      if (!r.ok) { const g = await guardarImagen(blob, nombreArchivo()); toast.info(g.mensaje || r.mensaje); }
    } catch (e: any) { toast.error(`No se pudo armar la imagen: ${e?.message || e}`); }
    finally { setTrabajando(null); }
  };
  const copiarTexto = async () => {
    try { await navigator.clipboard.writeText(textoRedes); toast.success('Texto copiado.'); }
    catch { toast.error('No se pudo copiar. Seleccionalo y copialo a mano.'); }
  };

  /** Sube la imagen y la guarda en la galería. Devuelve lo necesario para banner/Instagram. */
  const guardarEnGaleria = useCallback(async (estado: PautaGuardada['estado'], extra: { requestId?: string | null; bannerId?: string | null } = {}) => {
    const { canvas, blob } = await exportar();
    const imagenUrl = await subirPieza(blob, pautaId);
    let fondoUrl = pieza.fondoUrl || null;
    if (pieza.fondo === 'ia' && pieza.fondoImg?.startsWith('data:')) fondoUrl = await subirFondo(pieza.fondoImg, pautaId);
    const guardable: Pieza = { ...pieza, fondoUrl };
    const registro = aPautaGuardada({
      id: pautaId, titulo: pieza.titular || 'Pieza sin título', pieza: guardable, productoId: productoId || null, productoNombre: producto?.name || null,
      imagenUrl, miniatura: miniaturaDe(canvas), copy: { titular: pieza.titular, subtitulo: pieza.subtitulo, etiqueta: pieza.etiqueta, cta: pieza.cta, pie: pieza.pie, caption, hashtags: hashtags.split(/\s+/).filter(Boolean), fondo: fondoPrompt },
      creadaPor: currentUser?.email || '', estado, requestId: extra.requestId ?? null, bannerId: extra.bannerId ?? null,
    });
    const donde = await guardarPauta(registro);
    setEnNube(donde === 'nube');
    void cargarGaleria();
    return { imagenUrl, donde };
  }, [exportar, pautaId, pieza, productoId, producto, caption, hashtags, fondoPrompt, currentUser?.email, cargarGaleria]);

  const guardar = async () => {
    setTrabajando('guardar');
    try {
      const { donde } = await guardarEnGaleria('borrador');
      toast.success(donde === 'nube' ? 'Guardada en la galería.' : 'Guardada en este aparato (falta correr el SQL de pautas para guardarla en la nube).');
    } catch (e: any) { toast.error(e?.message || 'No se pudo guardar.'); }
    finally { setTrabajando(null); }
  };

  const usarDeBanner = async () => {
    const formato = formatoDeBanner(pieza.formato);
    const ok = await confirmar({
      title: 'Usar como banner de la tienda',
      message: `Esta pieza se publica en la tienda como banner «${formato === 'hero' ? 'principal' : formato === 'divisor' ? 'franja' : 'tarjeta'}» y la ven todos los clientes. Podés desactivarla después en «Banners y promociones».`,
      confirmText: 'Publicar en la tienda',
    });
    if (!ok) return;
    setTrabajando('banner');
    try {
      const bannerId = `banner-${Date.now()}`;
      const { imagenUrl } = await guardarEnGaleria('banner', { bannerId });
      const db = getDB();
      const b: Banner = { id: bannerId, title: pieza.titular, description: pieza.subtitulo, imageUrl: imagenUrl, link: undefined, type: 'General', formato, oferta: pieza.etiqueta || undefined, active: true };
      if (!db.banners) db.banners = [];
      db.banners.push(b);
      addAuditLog(currentUser?.email || '', 'Marketing', 'Crear banner', `Desde el Estudio de pauta: ${formato} · ${b.title}`, db);
      await saveDB(db);
      toast.success('Banner publicado en la tienda.');
    } catch (e: any) { toast.error(e?.message || 'No se pudo crear el banner.'); }
    finally { setTrabajando(null); }
  };

  const programarInstagram = async () => {
    const fecha = new Date(programar.cuando);
    if (Number.isNaN(fecha.getTime()) || fecha.getTime() < Date.now() + 60_000) { toast.error('Elegí una fecha y hora futuras.'); return; }
    if (!caption.trim()) { toast.error('Falta el texto de la publicación.'); return; }
    setTrabajando('instagram');
    try {
      const reqId = programar.requestId || `MKT-${Date.now()}`;
      const { imagenUrl } = await guardarEnGaleria('programada', { requestId: reqId });
      const db = getDB();
      if (!db.marketing_requests) db.marketing_requests = [];
      const idx = db.marketing_requests.findIndex(r => r.id === reqId);
      const base: MarketingRequest = {
        id: reqId, productId: productoId || '', productName: producto?.name || pieza.titular || 'Pieza de pauta', productSku: producto?.sku,
        price: Number(pieza.precio) || 0, caption: textoRedes, imageUrl: imagenUrl, status: 'programado', scheduledAt: fecha.toISOString(),
        createdBy: currentUser?.email || '', createdAt: new Date().toISOString(),
      };
      if (idx === -1) db.marketing_requests.unshift(base);
      else db.marketing_requests[idx] = { ...db.marketing_requests[idx], ...base, createdBy: db.marketing_requests[idx].createdBy || base.createdBy, createdAt: db.marketing_requests[idx].createdAt || base.createdAt };
      addAuditLog(currentUser?.email || '', 'Marketing', 'Programar Instagram', `${base.productName} · ${fecha.toLocaleString('es-CR')}`, db);
      await saveDB(db);
      setSolicitudes(getDB().marketing_requests || []);
      setProgramar(p => ({ ...p, abierto: false, requestId: null }));
      // El webhook ya no está en los ajustes públicos: se consulta si hay uno configurado (sin verlo).
      const hayWebhook = (await webhookInstagramConfigurado()) ?? !!db.settings?.instagramWebhookUrl;
      toast.success(hayWebhook
        ? 'Programada: se publica sola en la fecha elegida.'
        : 'Programada, pero falta el webhook de Instagram (Zapier) en Configuración: sin él no sale.');
    } catch (e: any) { toast.error(e?.message || 'No se pudo programar.'); }
    finally { setTrabajando(null); }
  };

  // ---- galería ----
  const abrirDeGaleria = (g: PautaGuardada) => {
    const p = productos.find(x => x.id === g.productoId) || null;
    setPautaId(g.id);
    setProductoId(p?.id || '');
    setPieza({ ...piezaNueva(), ...(g.pieza as Partial<Pieza>), productoImg: p?.imageUrl || null, fondoImg: (g.pieza as any)?.fondoUrl || null });
    setCaption(String(g.copy?.caption || '')); setHashtags((g.copy?.hashtags || []).join(' ')); setFondoPrompt(String(g.copy?.fondo || ''));
    setAviso(p ? '' : 'El producto de esta pieza ya no está en el inventario: se muestra sin su foto.');
    setTimeout(() => document.getElementById('estudio-pauta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const quitarDeGaleria = async (g: PautaGuardada) => {
    const ok = await confirmar({ title: 'Quitar de la galería', message: `¿Quitar «${g.titulo || 'esta pieza'}»? La imagen se borra; si ya salió en Instagram o en la tienda, eso no cambia.`, confirmText: 'Quitar', variant: 'danger' });
    if (!ok) return;
    try { await borrarPauta(g.id); void cargarGaleria(); } catch (e: any) { toast.error(e?.message || 'No se pudo quitar.'); }
  };
  const nueva = () => {
    setPautaId(nuevaId()); setProductoId(''); setCaption(''); setHashtags(''); setFondoPrompt(''); setAviso('');
    setPieza(piezaNueva({ telefono: String(getDB().settings?.companyPhone || '') }));
  };

  const pendientes = solicitudes.filter(s => s.status === 'pendiente_imagen');
  // Solo lo que se vende: los repuestos e insumos del taller (₡0, foto de relleno) no se publicitan.
  const opcionesProducto = useMemo(() => productos.filter(p => !esRepuesto(p.category) && !esInsumo(p.category) && p.category !== 'Repuestos').slice(0, 700).map(p => ({
    value: p.id, label: `${p.name} — ${colones(Number(p.price) || 0)}`, searchText: `${p.sku || ''} ${p.category || ''}`,
  })), [productos]);

  return (
    <Card
      title="Estudio de pauta con Javier"
      actions={hayPieza ? <Btn variant="ghost" icon={RefreshCw} onClick={nueva}>Pieza nueva</Btn> : undefined}
      className="ep-card"
    >
      <div id="estudio-pauta" className="ep">
        <p className="ep-intro">
          Javier escribe los textos con los datos reales del producto, la IA gratis hace el fondo y la app dibuja la pieza con tu logo y el precio exacto.
          Después la descargás, la compartís, la usás de banner o la programás en Instagram.
        </p>

        {pendientes.length > 0 && (
          <div className="ep-pend" role="region" aria-label="Publicaciones de Instagram sin imagen">
            <div className="ep-pend-t"><Instagram className="w-4 h-4" /> {pendientes.length === 1 ? '1 publicación de Instagram espera su imagen' : `${pendientes.length} publicaciones de Instagram esperan su imagen`}</div>
            {pendientes.slice(0, 4).map(s => (
              <div key={s.id} className="ep-pend-f">
                <span className="ep-pend-n">{s.productName}<small>{new Date(s.scheduledAt).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
                <Btn variant="primary" icon={Wand2} onClick={() => aplicarPedido({ productoId: s.productId, requestId: s.id, formato: 'retrato' })}>Crear con Javier</Btn>
              </div>
            ))}
          </div>
        )}

        {/* 1 · Qué anunciar */}
        <div className="ep-paso">
          <span className="ep-num">1</span>
          <div className="ep-paso-c">
            <Field label="Producto">
              <CustomSelect value={productoId} onChange={id => aplicarProducto(productos.find(p => p.id === id) || null)} options={opcionesProducto} placeholder="Elegí un producto del inventario…" searchable searchPlaceholder="Buscar por nombre, SKU o categoría…" />
            </Field>
            <div className="ep-fila">
              <div className="ep-grupo" role="group" aria-label="Objetivo">
                <span className="tv-label">Objetivo</span>
                <div className="ep-seg">{OBJETIVOS.map(o => <button key={o.id} type="button" data-on={objetivo === o.id || undefined} aria-pressed={objetivo === o.id} onClick={() => setObjetivo(o.id)}>{o.nombre}</button>)}</div>
              </div>
            </div>
            <div className="ep-grupo" role="group" aria-label="Formato">
              <span className="tv-label">Formato</span>
              <div className="ep-seg ep-seg-env">{ORDEN_FORMATOS.map(f => <button key={f} type="button" data-on={pieza.formato === f || undefined} aria-pressed={pieza.formato === f} onClick={() => cambiar({ formato: f })}>{FORMATOS[f].corto}</button>)}</div>
              <span className="tv-hint">{fmt.nombre} · {fmt.ancho}×{fmt.alto} · {fmt.uso}</span>
            </div>
            <Field label="Algo que Javier deba tener en cuenta (opcional)">
              <input type="text" className="tv-input" value={instrucciones} maxLength={200} placeholder="Ej: para el fin de semana, tono divertido, mencioná el taller" onChange={e => setInstrucciones(e.target.value)} />
            </Field>
            <Btn variant="primary" icon={Sparkles} disabled={armando || !producto} onClick={() => void armar(producto)}>{armando ? 'Javier está escribiendo…' : hayPieza && pieza.titular ? 'Volver a armar con Javier' : 'Armar con Javier'}</Btn>
            {aviso && <p className="ep-aviso" role="alert">{aviso}</p>}
          </div>
        </div>

        {/* 2 · La pieza */}
        <div className="ep-paso">
          <span className="ep-num">2</span>
          <div className="ep-paso-c">
            <div className="ep-pieza">
              <div className="ep-vista">
                <div className="ep-lienzo" style={{ aspectRatio: `${fmt.ancho} / ${fmt.alto}`, maxWidth: `min(100%, calc(68vh * ${fmt.ancho / fmt.alto}))` }}>
                  <canvas ref={canvasRef} aria-label="Vista previa de la pieza" />
                  {!hayPieza && <div className="ep-vacio"><Megaphone className="w-7 h-7" /><span>Elegí un producto y tocá «Armar con Javier»</span></div>}
                  {(armando || generando) && <div className="ep-ocupado" role="status"><span className="ep-giro" />{generando ? 'Creando el fondo con IA…' : 'Escribiendo los textos…'}</div>}
                </div>
              </div>

              <div className="ep-campos">
                <div className="ep-grupo" role="group" aria-label="Estilo">
                  <span className="tv-label">Estilo</span>
                  <div className="ep-estilos">{ORDEN_ESTILOS.map(e => (
                    <button key={e} type="button" data-on={pieza.estilo === e || undefined} aria-pressed={pieza.estilo === e} onClick={() => cambiar({ estilo: e })} title={ESTILOS[e].descripcion}>
                      <i style={{ background: `linear-gradient(135deg, ${ESTILOS[e].fondoA}, ${ESTILOS[e].fondoC || ESTILOS[e].fondoB})` }} aria-hidden="true" /><span>{ESTILOS[e].nombre}</span>
                    </button>))}</div>
                </div>

                <div className="ep-grupo" role="group" aria-label="Fondo">
                  <span className="tv-label">Fondo</span>
                  <div className="ep-seg">{FONDOS.map(f => <button key={f.id} type="button" data-on={pieza.fondo === f.id || undefined} aria-pressed={pieza.fondo === f.id} disabled={f.id === 'producto' && !pieza.productoImg} onClick={() => cambiar({ fondo: f.id })}>{f.nombre}</button>)}</div>
                  {pieza.fondo === 'ia' && (
                    <div className="ep-ia">
                      <textarea className="tv-input" rows={2} maxLength={240} value={fondoPrompt} placeholder="Escena del fondo, en inglés o español (sin textos). Javier la propone al armar." onChange={e => setFondoPrompt(e.target.value)} />
                      <label className="ep-chk"><input type="checkbox" checked={escena} onChange={e => setEscena(e.target.checked)} disabled={!pieza.productoImg} /> Poner el producto dentro de la escena (experimental: revisá que el producto se vea igual)</label>
                      <Btn variant="default" icon={ImageIcon} disabled={generando} onClick={() => void generarFondo()}>{generando ? 'Creando…' : pieza.fondoImg ? 'Crear otro fondo' : 'Crear fondo con IA'}</Btn>
                    </div>
                  )}
                </div>

                <Field label="Titular" hint={`${pieza.titular.length}/34`}><input type="text" className="tv-input" maxLength={60} value={pieza.titular} onChange={e => cambiar({ titular: e.target.value })} /></Field>
                <Field label="Subtítulo"><input type="text" className="tv-input" maxLength={90} value={pieza.subtitulo} onChange={e => cambiar({ subtitulo: e.target.value })} /></Field>
                <div className="ep-dos">
                  <Field label="Sello (oferta)"><input type="text" className="tv-input" maxLength={12} value={pieza.etiqueta} placeholder="-20%, NUEVO…" onChange={e => cambiar({ etiqueta: e.target.value })} /></Field>
                  <Field label="Botón"><input type="text" className="tv-input" maxLength={28} value={pieza.cta} onChange={e => cambiar({ cta: e.target.value })} /></Field>
                </div>
                <Field label="Pie"><input type="text" className="tv-input" maxLength={70} value={pieza.pie} onChange={e => cambiar({ pie: e.target.value })} /></Field>
                <Field label="WhatsApp en el pie (opcional)"><input type="text" className="tv-input" inputMode="tel" maxLength={24} value={pieza.telefono} placeholder="8888-8888" onChange={e => cambiar({ telefono: e.target.value })} /></Field>
                <div className="ep-chks">
                  <label className="ep-chk"><input type="checkbox" checked={pieza.mostrarPrecio} onChange={e => cambiar({ mostrarPrecio: e.target.checked })} disabled={!pieza.precio} /> Mostrar el precio{pieza.precio ? ` (${colones(pieza.precio)})` : ''}</label>
                  <label className="ep-chk"><input type="checkbox" checked={pieza.logo} onChange={e => cambiar({ logo: e.target.checked })} /> Logo de Technoverse</label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3 · Texto para la red */}
        <div className="ep-paso">
          <span className="ep-num">3</span>
          <div className="ep-paso-c">
            <Field label="Texto de la publicación" hint={`${caption.length} caracteres`}><textarea className="tv-input" rows={5} value={caption} placeholder="Javier lo escribe al armar la pieza." onChange={e => setCaption(e.target.value)} /></Field>
            <Field label="Hashtags"><input type="text" className="tv-input" value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="#CostaRica #Technoverse" /></Field>
            <Btn variant="default" icon={Copy} disabled={!caption.trim()} onClick={() => void copiarTexto()}>Copiar texto</Btn>
          </div>
        </div>

        {/* 4 · Qué hacer con la pieza */}
        <div className="ep-paso">
          <span className="ep-num">4</span>
          <div className="ep-paso-c">
            <div className="ep-acciones">
              <Btn variant="primary" icon={Download} disabled={!hayPieza || !!trabajando} onClick={() => void descargar()}>{trabajando === 'descargar' ? 'Armando…' : 'Descargar'}</Btn>
              <Btn variant="default" icon={Share2} disabled={!hayPieza || !!trabajando} onClick={() => void compartir()}>Compartir</Btn>
              <Btn variant="default" icon={Save} disabled={!hayPieza || !!trabajando} onClick={() => void guardar()}>{trabajando === 'guardar' ? 'Guardando…' : 'Guardar en galería'}</Btn>
              <Btn variant="default" icon={Layers} disabled={!hayPieza || !!trabajando} onClick={() => void usarDeBanner()}>Usar de banner</Btn>
              <Btn variant="default" icon={CalendarClock} disabled={!hayPieza || !!trabajando} onClick={() => setProgramar(p => ({ ...p, abierto: !p.abierto }))}>Programar en Instagram</Btn>
            </div>
            {programar.abierto && (
              <div className="ep-prog">
                <Field label="Publicar el" hint={programar.requestId ? 'Es la fecha que ya tenía esa publicación; podés cambiarla.' : 'Sale sola a esa hora (el cron de la base revisa cada 5 minutos).'}>
                  <input type="datetime-local" className="tv-input" value={programar.cuando} onChange={e => setProgramar(p => ({ ...p, cuando: e.target.value }))} />
                </Field>
                <Btn variant="primary" icon={Instagram} disabled={!!trabajando || !caption.trim()} onClick={() => void programarInstagram()}>{trabajando === 'instagram' ? 'Programando…' : 'Programar'}</Btn>
              </div>
            )}
          </div>
        </div>

        {/* Galería */}
        <div className="ep-gal">
          <div className="ep-gal-t">
            <b>Galería</b>
            {galeria && <Chip>{galeria.length}</Chip>}
            {!enNube && <Chip tone="alert">Solo en este aparato</Chip>}
          </div>
          {!enNube && <p className="ep-aviso">Para guardar la galería en la nube hay que correr una vez el SQL <code>migracion_pautas.sql</code> en Supabase. Mientras tanto queda en este aparato.</p>}
          {galeria === null ? <div className="ep-esq"><i /><i /><i /></div>
            : galeria.length === 0 ? <Empty icon={ImageIcon} title="Todavía no hay piezas guardadas" text="Las que guardes aparecen aquí para volver a abrirlas y editarlas." />
              : (
                <ul className="ep-lista">
                  {galeria.map(g => (
                    <li key={g.id}>
                      <button type="button" className="ep-mini" onClick={() => abrirDeGaleria(g)} aria-label={`Abrir ${g.titulo || 'pieza'}`}>
                        {g.miniatura ? <img src={g.miniatura} alt="" loading="lazy" /> : <ImageIcon className="w-6 h-6" />}
                      </button>
                      <div className="ep-mini-i">
                        <b title={g.titulo}>{g.titulo || '(sin título)'}</b>
                        <small>{FORMATOS[g.formato]?.corto || g.formato} · {new Date(g.creadaEn).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}</small>
                        <span className="ep-mini-e">{g.estado === 'programada' ? <Chip tone="accent">Programada</Chip> : g.estado === 'banner' ? <Chip tone="ok">Banner</Chip> : <Chip>Borrador</Chip>}</span>
                      </div>
                      <button type="button" className="ep-quitar" onClick={() => void quitarDeGaleria(g)} aria-label={`Quitar ${g.titulo || 'pieza'}`}><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </div>
    </Card>
  );
}
