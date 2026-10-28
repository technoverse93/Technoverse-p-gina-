// =====================================================================
// GESTOR DE BANNERS — crear, editar, programar y medir lo que se muestra en la tienda
// =====================================================================
// Vive dentro de la pestaña Marketing. Maneja los seis formatos de la tienda:
//   · Hero (carrusel principal), Divisor, Cuadrícula y Pop-up: piezas con IMAGEN.
//   · Cintillo (franja de oferta, una línea) y Campaña (tarjeta con botón): piezas de TEXTO que se arman solas
//     con los colores de la paleta de marca (variante acento / vivo / suave / oscuro); sin diseñar nada.
//
// Cada banner tiene: título y descripción, etiqueta de oferta, enlace con su botón (CTA), prioridad (el orden
// dentro de su formato), fechas de inicio y fin, y un interruptor. Su ESTADO se ve siempre —activo, programado,
// vencido o pausado— y se puede filtrar por él. Los cambios llegan en vivo a la tienda abierta (Realtime).
//
// La VISTA PREVIA usa los mismos componentes que la tienda y deja ver el diseño en cada paleta (Esmeralda,
// Océano, Atardecer, Orquídea) y en claro y oscuro antes de guardar. Las métricas (vistas y clics) salen de
// `banner_metricas` (utils/bannerMetricas.ts).
//
// Si la base todavía no tiene las columnas nuevas (supabase/migracion_banners_motor.sql sin aplicar), el gestor
// sigue funcionando con los cuatro formatos de siempre y avisa qué falta; nada se rompe.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Save, Trash2, Image as ImageIcon, Wand2, ExternalLink, X, Megaphone, Eye, MousePointerClick, Copy,
  ChevronUp, ChevronDown, Pause, Play,
} from 'lucide-react';
import { Card, Btn, Field, Chip, Empty } from './AdminKit';
import { CustomSelect } from '../CustomSelect';
import VistaPreviaBanner from './VistaPreviaBanner';
import { useToast, useConfirm } from '../ui/Overlays';
import { getDB, saveDB, addAuditLog, tablaEnModoLegacy } from '../../utils/storage';
import { generarBannerDeProducto } from '../../utils/bannerAuto';
import { esRepuesto, esInsumo } from '../../utils/categorias';
import { colones } from '../../utils/dinero';
import { estadoDeBanner, estiloDe, formatoRequiereImagen, ordenarBanners, VARIANTES, type EstadoBanner } from '../../utils/bannerEstado';
import { leerMetricasBanners, type MetricasBanner } from '../../utils/bannerMetricas';
import type { Banner, FormatoBanner, Product, User, VarianteBanner } from '../../types';

const FORMATOS: { value: FormatoBanner; label: string; ayuda: string; soloMotor?: boolean }[] = [
  { value: 'hero', label: 'Hero — carrusel principal', ayuda: 'Arriba del catálogo. Ideal 1920×600 (escritorio) / 1080×810 (celular).' },
  { value: 'cintillo', label: 'Cintillo — franja de oferta', soloMotor: true, ayuda: 'Una línea arriba de todo: oferta + mensaje corto + enlace. No lleva imagen. Con varios, rotan cada 6 s.' },
  { value: 'campana', label: 'Campaña — tarjeta con botón', soloMotor: true, ayuda: 'Tarjeta con título, texto y botón; la imagen es opcional. Se muestran hasta 3 a la vez.' },
  { value: 'divisor', label: 'Divisor — franja ancha', ayuda: 'Separa secciones. Franja horizontal, ideal 1920×480.' },
  { value: 'grid', label: 'Tarjeta en la cuadrícula', ayuda: 'Se mezcla entre los productos, ocupa dos espacios.' },
  { value: 'popup', label: 'Pop-up emergente', ayuda: 'Aparece una vez por sesión. Ideal 1080×810.' },
];

const ESTADOS: { value: EstadoBanner | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'programado', label: 'Programados' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'pausado', label: 'Pausados' },
];

const ETIQUETA_ESTADO: Record<EstadoBanner, string> = { activo: 'Activo', programado: 'Programado', vencido: 'Vencido', pausado: 'Pausado' };

function idNuevo(): string {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* nada */ }
  return `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bannerVacio(): Banner {
  return { id: idNuevo(), title: '', description: '', imageUrl: '', link: '', type: 'General', formato: 'hero', oferta: '', cta: '', variante: undefined, prioridad: 0, active: true };
}

function leerArchivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const fr = new FileReader();
    fr.onload = () => resolver(String(fr.result || ''));
    fr.onerror = () => rechazar(fr.error);
    fr.readAsDataURL(file);
  });
}

/** El enlace tiene que ser https://, una ruta interna (/…), tel: o mailto:. Devuelve el enlace limpio o null si no vale. */
function enlaceValido(texto: string): string | null | undefined {
  const t = texto.trim();
  if (!t) return undefined;
  const conEsquema = /^(wa\.me|www\.)/i.test(t) ? `https://${t}` : t;
  return /^(https?:\/\/[^\s]+|\/[^\s]*|tel:[^\s]+|mailto:[^\s]+)$/i.test(conEsquema) ? conEsquema : null;
}

function formatoDe(b: Banner): FormatoBanner { return b.formato || 'hero'; }

function abreviar(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export default function GestorBanners({ currentUser }: { currentUser: User | null }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [banners, setBanners] = useState<Banner[]>(() => getDB().banners || []);
  const [productos, setProductos] = useState<Product[]>(() => getDB().products || []);
  const [form, setForm] = useState<Banner | null>(null);
  const [esNuevo, setEsNuevo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [productoAuto, setProductoAuto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<EstadoBanner | 'todos'>('todos');
  const [filtroFormato, setFiltroFormato] = useState<FormatoBanner | 'todos'>('todos');
  const [metricas, setMetricas] = useState<Record<string, MetricasBanner> | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Sin las columnas nuevas en la base (migración sin aplicar) solo valen los cuatro formatos de siempre.
  const sinMotor = tablaEnModoLegacy('banners');

  // La base puede cambiar por Realtime (otro admin) o por el propio guardado.
  useEffect(() => {
    const alActualizar = () => {
      setBanners(getDB().banners || []);
      setProductos(getDB().products || []);
    };
    window.addEventListener('technoverse_db_updated', alActualizar);
    return () => window.removeEventListener('technoverse_db_updated', alActualizar);
  }, []);

  // Vistas y clics de cada banner (solo el personal puede leerlos). `null` = la migración no está aplicada.
  const cargarMetricas = useCallback(() => { void leerMetricasBanners().then(setMetricas); }, []);
  useEffect(() => { cargarMetricas(); }, [cargarMetricas, banners.length]);

  const abrirNuevo = () => { setForm(bannerVacio()); setEsNuevo(true); };
  const abrirEdicion = (b: Banner) => { setForm({ ...b, oferta: b.oferta || '', link: b.link || '', cta: b.cta || '' }); setEsNuevo(false); };
  const cerrar = () => { setForm(null); };

  const elegirImagen = async (file?: File | null) => {
    if (!file || !form) return;
    if (!file.type.startsWith('image/')) { toast.error('Ese archivo no es una imagen.'); return; }
    try {
      const dataUrl = await leerArchivoComoDataUrl(file);
      setForm({ ...form, imageUrl: dataUrl });
    } catch {
      toast.error('No se pudo leer la imagen.');
    }
  };

  const cambiarFormato = (formato: FormatoBanner) => {
    if (!form) return;
    const esTexto = formato === 'cintillo' || formato === 'campana';
    setForm({ ...form, formato, variante: esTexto ? (form.variante || 'acento2') : form.variante });
  };

  const siguientePrioridad = (formato: FormatoBanner) =>
    Math.max(-1, ...(getDB().banners || []).filter(x => formatoDe(x) === formato).map(x => x.prioridad || 0)) + 1;

  const guardar = async () => {
    if (!form) return;
    const formato = formatoDe(form);
    const titulo = (form.title || '').trim();
    if (formatoRequiereImagen(formato) && !form.imageUrl) { toast.error('Falta la imagen del banner.'); return; }
    if (formato === 'cintillo' && !titulo) { toast.error('El cintillo necesita su mensaje (el título).'); return; }
    if (formato === 'campana' && !titulo && !(form.description || '').trim() && !form.imageUrl) { toast.error('La campaña necesita un título, un texto o una imagen.'); return; }
    if ((form.oferta || '').trim().length > 14) { toast.error('La etiqueta de oferta es muy larga (máximo 14 letras): «2x1», «-30%».'); return; }
    if ((form.cta || '').trim().length > 24) { toast.error('El texto del botón es muy largo (máximo 24 letras).'); return; }
    const enlace = enlaceValido(form.link || '');
    if (enlace === null) { toast.error('El enlace tiene que empezar con https://, wa.me/, tel:, mailto: o con / (una ruta de la tienda).'); return; }
    // «/» (o «/tienda») es la misma portada donde ya está el banner: el botón no llevaba a ningún lado.
    if (enlace && /^\/(tienda)?\/?$/.test(enlace)) { toast.error('Ese enlace lleva a la misma portada donde ya está el banner. Usá un WhatsApp, una red o dejalo vacío.'); return; }
    if (form.startDate && form.endDate && form.endDate < form.startDate) { toast.error('La fecha «Hasta» es anterior a «Desde».'); return; }

    setGuardando(true);
    try {
      const db = getDB();
      const idxPrevio = (db.banners || []).findIndex(b => b.id === form.id);
      const limpio: Banner = {
        ...form,
        title: titulo,
        description: (form.description || '').trim(),
        oferta: (form.oferta || '').trim() || undefined,
        link: enlace || undefined,
        cta: (form.cta || '').trim() || undefined,
        variante: formato === 'cintillo' || formato === 'campana' ? (form.variante || 'acento2') : form.variante,
        // Un banner nuevo sale al final de su formato; uno que cambia de formato, también.
        prioridad: idxPrevio === -1 || formatoDe(db.banners[idxPrevio]) !== formato ? siguientePrioridad(formato) : (form.prioridad || 0),
      };
      if (idxPrevio === -1) db.banners.push(limpio);
      else db.banners[idxPrevio] = limpio;
      addAuditLog(currentUser?.email || '', 'Marketing', esNuevo ? 'Crear banner' : 'Editar banner', `${limpio.formato} · ${limpio.title || '(sin título)'}`, db);
      await saveDB(db);
      setBanners(getDB().banners || []);
      toast.success(esNuevo ? 'Banner creado.' : 'Banner actualizado.');
      setForm(null);
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${String(e?.message || e)}`);
    } finally {
      setGuardando(false);
    }
  };

  const alternarActivo = async (b: Banner) => {
    const db = getDB();
    const idx = db.banners.findIndex(x => x.id === b.id);
    if (idx === -1) return;
    db.banners[idx].active = !b.active;
    addAuditLog(currentUser?.email || '', 'Marketing', b.active ? 'Pausar banner' : 'Activar banner', b.title || b.id, db);
    await saveDB(db);
    setBanners(getDB().banners || []);
  };

  const duplicar = async (b: Banner) => {
    if (formatoDe(b) === 'cintillo' || formatoDe(b) === 'campana') { if (sinMotor) { toast.error('Falta aplicar la migración de banners para usar este formato.'); return; } }
    const db = getDB();
    const copia: Banner = { ...b, id: idNuevo(), title: `${b.title || 'Banner'} (copia)`, active: false, prioridad: siguientePrioridad(formatoDe(b)) };
    db.banners.push(copia);
    addAuditLog(currentUser?.email || '', 'Marketing', 'Duplicar banner', b.title || b.id, db);
    await saveDB(db);
    setBanners(getDB().banners || []);
    toast.success('Copia creada, pausada. Editala y activala cuando esté lista.');
  };

  /** Sube o baja un banner dentro de su formato: se renumera la lista y se intercambian las dos posiciones. */
  const mover = async (b: Banner, delta: -1 | 1) => {
    const db = getDB();
    const mismos = ordenarBanners(db.banners.filter(x => formatoDe(x) === formatoDe(b)));
    const i = mismos.findIndex(x => x.id === b.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= mismos.length) return;
    mismos.forEach((x, k) => { x.prioridad = k; });
    const t = mismos[i].prioridad; mismos[i].prioridad = mismos[j].prioridad; mismos[j].prioridad = t;
    await saveDB(db);
    setBanners(getDB().banners || []);
  };

  const borrar = async (b: Banner) => {
    const ok = await confirmar({
      title: 'Quitar banner',
      message: `¿Quitar "${b.title || 'este banner'}" de la tienda? No se puede deshacer.`,
      confirmText: 'Quitar',
      variant: 'danger',
    });
    if (!ok) return;
    const db = getDB();
    db.banners = db.banners.filter(x => x.id !== b.id);
    addAuditLog(currentUser?.email || '', 'Marketing', 'Quitar banner', b.title || b.id, db);
    await saveDB(db);
    setBanners(getDB().banners || []);
    toast.success('Banner quitado de la tienda.');
  };

  const generarAutomatico = async () => {
    const p = productos.find(x => x.id === productoAuto);
    if (!p) { toast.error('Elegí un producto primero.'); return; }
    const b = generarBannerDeProducto(p, 'grid');
    setForm(b);
    setEsNuevo(true);
    setProductoAuto('');
    toast.success('Banner generado desde el producto. Revisalo y guardá.');
  };

  const opcionesProducto = useMemo(
    () => productos
      // Solo lo que se vende en la tienda: los repuestos e insumos del taller (₡0, sin foto real) no van en un banner.
      .filter(p => p && p.name && p.imageUrl && p.active !== false && !esRepuesto(p.category) && !esInsumo(p.category) && p.category !== 'Repuestos')
      .slice(0, 300)
      .map(p => ({ value: p.id, label: `${p.name} — ${colones(p.price || 0)}` })),
    [productos]
  );

  const etiquetaFormato = (f?: Banner['formato']) => FORMATOS.find(x => x.value === (f || 'hero'))?.label.split(' — ')[0] || 'Hero';

  // Conteos por estado y lista filtrada (en su orden: formato y luego prioridad).
  const conEstado = useMemo(() => banners.map(b => ({ b, estado: estadoDeBanner(b) })), [banners]);
  const conteo = useMemo(() => {
    const c: Record<string, number> = { todos: conEstado.length, activo: 0, programado: 0, vencido: 0, pausado: 0 };
    for (const x of conEstado) c[x.estado]++;
    return c;
  }, [conEstado]);
  const visibles = useMemo(() => {
    const orden = FORMATOS.map(f => f.value);
    return conEstado
      .filter(x => filtroEstado === 'todos' || x.estado === filtroEstado)
      .filter(x => filtroFormato === 'todos' || formatoDe(x.b) === filtroFormato)
      .sort((p, q) => (orden.indexOf(formatoDe(p.b)) - orden.indexOf(formatoDe(q.b))) || ((p.b.prioridad || 0) - (q.b.prioridad || 0)));
  }, [conEstado, filtroEstado, filtroFormato]);

  const formatoForm = form ? formatoDe(form) : 'hero';
  const esTextoForm = formatoForm === 'cintillo' || formatoForm === 'campana';
  const estadoForm = form ? estadoDeBanner(form) : 'activo';

  return (
    <Card
      title="Banners y promociones"
      actions={
        <Btn variant="primary" icon={Plus} onClick={abrirNuevo}>Nuevo banner</Btn>
      }
    >

      {/* Generación automática desde un producto */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-sunken)] p-3 mb-4 flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5 text-[var(--accent)]" /> Generar banner automático
          </div>
          <CustomSelect
            value={productoAuto}
            onChange={setProductoAuto}
            options={opcionesProducto}
            placeholder="Elegí un producto…"
          />
        </div>
        <Btn variant="default" icon={Wand2} onClick={generarAutomatico} disabled={!productoAuto}>Generar</Btn>
      </div>

      {/* Formulario de creación / edición */}
      {form && (
        <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-surface)] p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[13px] font-bold text-[var(--text-primary)] tv-1l">{esNuevo ? 'Nuevo banner' : 'Editar banner'}</h4>
            <button type="button" onClick={cerrar} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-none" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Formato (dónde se muestra)" className="md:col-span-2">
              <CustomSelect
                value={formatoForm}
                onChange={val => cambiarFormato(val as FormatoBanner)}
                options={FORMATOS.map(f => ({ value: f.value, label: f.label, disabled: !!f.soloMotor && sinMotor }))}
              />
              <p data-no-1l className="text-[11.5px] text-[var(--text-secondary)] mt-1">{FORMATOS.find(f => f.value === formatoForm)?.ayuda}</p>
            </Field>

            {/* Imagen: obligatoria en los formatos de imagen, opcional en la campaña, ausente en el cintillo */}
            {formatoForm !== 'cintillo' && (
              <div className="md:col-span-2">
                <span className="tv-label tv-1l">Imagen{formatoForm === 'campana' ? ' (opcional)' : ''}</span>
                <div className="mt-1 flex items-center gap-3">
                  <div className="w-28 h-20 rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-sunken)] flex items-center justify-center shrink-0">
                    {form.imageUrl
                      ? <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <ImageIcon className="w-6 h-6 text-[var(--text-muted)]" />}
                  </div>
                  <div className="min-w-0">
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => elegirImagen(e.target.files?.[0])} />
                    <div className="flex items-center gap-2">
                      <Btn variant="default" icon={ImageIcon} onClick={() => fileRef.current?.click()}>
                        {form.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                      </Btn>
                      {formatoForm === 'campana' && form.imageUrl && (
                        <Btn variant="ghost" onClick={() => setForm({ ...form, imageUrl: '' })}>Quitar</Btn>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Field label={formatoForm === 'cintillo' ? 'Mensaje (una línea)' : 'Título'} className="md:col-span-2">
              <input type="text" className="tv-input" value={form.title} maxLength={formatoForm === 'cintillo' ? 110 : 80}
                placeholder={formatoForm === 'cintillo' ? 'Ej: Envíos gratis en compras de más de ₡30.000' : 'Ej: Semana del audio'}
                onChange={e => setForm({ ...form, title: e.target.value })} />
            </Field>
            {formatoForm !== 'cintillo' && (
              <Field label="Descripción" className="md:col-span-2">
                <input type="text" className="tv-input" value={form.description} placeholder="Texto corto de apoyo" maxLength={160}
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </Field>
            )}
            <Field label="Etiqueta de oferta" hint="Opcional. Ej: 2x1, -30%, Gratis.">
              <input type="text" className="tv-input" value={form.oferta || ''} placeholder="2x1" maxLength={14}
                onChange={e => setForm({ ...form, oferta: e.target.value })} />
            </Field>
            <Field label="Texto del botón" hint="Opcional. Ej: Ver ofertas, Escribinos.">
              <input type="text" className="tv-input" value={form.cta || ''} placeholder="Ver ofertas" maxLength={24}
                disabled={sinMotor} onChange={e => setForm({ ...form, cta: e.target.value })} />
            </Field>
            <Field label="Enlace (WhatsApp, red o categoría)" hint="Ej: https://wa.me/506… o el enlace de una red" className="md:col-span-2">
              <input type="text" className="tv-input" value={form.link || ''} placeholder="https://wa.me/50688888888"
                onChange={e => setForm({ ...form, link: e.target.value })} />
            </Field>

            {esTextoForm && (
              <div className="md:col-span-2">
                <span className="tv-label tv-1l">Color (sigue a la paleta)</span>
                <div className="mt-1 grid grid-cols-4 gap-2" role="group" aria-label="Color del banner">
                  {(Object.keys(VARIANTES) as VarianteBanner[]).map(v => {
                    const est = estiloDe({ variante: v });
                    const elegido = (form.variante || 'acento2') === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={elegido}
                        onClick={() => setForm({ ...form, variante: v })}
                        className="h-9 min-w-0 rounded-lg px-1 text-[12px] font-bold border-2"
                        style={{ background: est.fondo, color: est.tinta, borderColor: elegido ? 'var(--text-primary)' : est.borde }}
                      >
                        <span className="tv-1l block">{est.etiqueta}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Field label="Desde (opcional)" hint="Vacío: se ve desde ya. Tocá para elegir el día.">
              <input type="date" className="tv-input" value={form.startDate || ''}
                onChange={e => setForm({ ...form, startDate: e.target.value || undefined })} />
            </Field>
            <Field label="Hasta (opcional)" hint="Vacío: se ve hasta que lo pausés.">
              <input type="date" className="tv-input" value={form.endDate || ''}
                onChange={e => setForm({ ...form, endDate: e.target.value || undefined })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 mt-3 text-[13px] text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" className="flex-none" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            <span className="tv-1l min-w-0">Activo (visible en la tienda)</span>
          </label>
          <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
            Estado hoy: <b>{ETIQUETA_ESTADO[estadoForm]}</b>
            {estadoForm === 'programado' && form.startDate ? ` · sale el ${form.startDate}` : ''}
            {estadoForm === 'vencido' && form.endDate ? ` · terminó el ${form.endDate}` : ''}
            {estadoForm === 'pausado' ? ' · no se muestra hasta activarlo' : ''}
          </p>

          <div className="mt-3">
            <span className="tv-label tv-1l">Vista previa en la tienda</span>
            <div className="mt-1"><VistaPreviaBanner banner={form} /></div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Btn variant="ghost" onClick={cerrar}>Cancelar</Btn>
            <Btn variant="primary" icon={Save} onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar banner'}
            </Btn>
          </div>
        </div>
      )}

      {/* Filtros por estado y por formato */}
      {banners.length > 0 && (
        <>
          <div className="gb-filtros" role="group" aria-label="Filtrar por estado">
            {ESTADOS.map(e => (
              <button key={e.value} type="button" className="gb-filtro" aria-pressed={filtroEstado === e.value} onClick={() => setFiltroEstado(e.value)}>
                {e.label} <span className="gb-filtro-n">{conteo[e.value]}</span>
              </button>
            ))}
          </div>
          <div className="gb-filtros" role="group" aria-label="Filtrar por formato">
            <button type="button" className="gb-filtro" aria-pressed={filtroFormato === 'todos'} onClick={() => setFiltroFormato('todos')}>Todos los formatos</button>
            {FORMATOS.filter(f => !(f.soloMotor && sinMotor)).map(f => (
              <button key={f.value} type="button" className="gb-filtro" aria-pressed={filtroFormato === f.value} onClick={() => setFiltroFormato(f.value)}>
                {f.label.split(' — ')[0]}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Lista */}
      {banners.length === 0 ? (
        <Empty icon={ImageIcon} title="Sin banners" text="Creá el primero con “Nuevo banner”, o generalo automático desde un producto." />
      ) : visibles.length === 0 ? (
        <Empty icon={Megaphone} title="Nada con ese filtro" text="Probá con otro estado o formato." />
      ) : (
        <ul className="gb-lista">
          {visibles.map(({ b, estado }) => {
            const m = metricas?.[b.id];
            const est = estiloDe(b);
            const mismos = banners.filter(x => formatoDe(x) === formatoDe(b));
            const posicion = ordenarBanners(mismos).findIndex(x => x.id === b.id);
            return (
              <li key={b.id} className="gb-item" data-estado={estado}>
                <div className="gb-mini">
                  {b.imageUrl
                    ? <img src={b.imageUrl} alt="" />
                    : formatoRequiereImagen(formatoDe(b))
                      ? <ImageIcon className="w-6 h-6 text-[var(--text-muted)]" />
                      : <span className="gb-mini-txt" style={{ background: est.fondo, color: est.tinta }}>{b.oferta || 'Aa'}</span>}
                </div>
                <div className="gb-cuerpo">
                  <div className="gb-chips">
                    <Chip tone="accent">{etiquetaFormato(b.formato)}</Chip>
                    <Chip tone={estado === 'activo' ? 'ok' : estado === 'vencido' ? 'alert' : undefined}>{ETIQUETA_ESTADO[estado]}</Chip>
                    {b.oferta && <Chip tone="ok">{b.oferta}</Chip>}
                    {mismos.length > 1 && <Chip>#{posicion + 1}</Chip>}
                  </div>
                  <div className="gb-tit tv-1l">{b.title || '(sin título)'}</div>
                  <div className="gb-sub tv-1l">{b.description || (b.startDate || b.endDate ? `${b.startDate || '…'} → ${b.endDate || '…'}` : '—')}</div>
                  {b.link && (
                    <div className="gb-sub tv-1l flex items-center gap-1"><ExternalLink className="w-3 h-3 flex-none" aria-hidden="true" /> <span className="tv-1l">{b.cta ? `${b.cta} · ` : ''}{b.link}</span></div>
                  )}
                  {m && (
                    <div className="gb-met" aria-label="Métricas">
                      <span title="Veces que se vio"><Eye aria-hidden="true" /> {abreviar(m.vistas)}</span>
                      <span title="Veces que se tocó"><MousePointerClick aria-hidden="true" /> {abreviar(m.clics)}</span>
                      {m.vistas > 0 && <span title="Clics sobre vistas">{((m.clics / m.vistas) * 100).toFixed(1).replace('.', ',')} %</span>}
                    </div>
                  )}
                  <div className="gb-acc">
                    <Btn variant="ghost" onClick={() => abrirEdicion(b)}>Editar</Btn>
                    <button type="button" className="gb-ico" onClick={() => alternarActivo(b)} aria-label={b.active ? 'Pausar' : 'Activar'} title={b.active ? 'Pausar' : 'Activar'}>
                      {b.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    </button>
                    <button type="button" className="gb-ico" onClick={() => duplicar(b)} aria-label="Duplicar" title="Duplicar (queda pausado)"><Copy aria-hidden="true" /></button>
                    <button type="button" className="gb-ico" onClick={() => mover(b, -1)} disabled={sinMotor || posicion <= 0} aria-label="Subir" title={sinMotor ? 'Falta aplicar la migración de banners' : 'Subir (sale antes)'}><ChevronUp aria-hidden="true" /></button>
                    <button type="button" className="gb-ico" onClick={() => mover(b, 1)} disabled={sinMotor || posicion < 0 || posicion >= mismos.length - 1} aria-label="Bajar" title={sinMotor ? 'Falta aplicar la migración de banners' : 'Bajar (sale después)'}><ChevronDown aria-hidden="true" /></button>
                    <button type="button" className="gb-ico" onClick={() => borrar(b)} aria-label="Quitar" title="Quitar" style={{ color: 'var(--danger-text)' }}><Trash2 aria-hidden="true" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {metricas === null && banners.length > 0 && !sinMotor && (
        <p className="tv-hint">Las métricas (vistas y clics) aparecen cuando se aplica la migración de banners.</p>
      )}
    </Card>
  );
}
