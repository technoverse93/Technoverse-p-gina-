// =====================================================================
// GESTOR DE BANNERS — crear, editar y colocar los carteles de la tienda
// =====================================================================
// Vive dentro de la pestaña Marketing. Cubre los 3 formatos + el pop-up:
//   · Sube una imagen propia (se guarda en Storage al grabar).
//   · Elige el formato (hero / divisor / grid / pop-up).
//   · Configura una etiqueta de oferta (2x1, -30%…) y un enlace
//     (WhatsApp, redes, o una categoría interna).
//   · "Generar banner automático" arma uno desde un producto: su foto,
//     su nombre y su precio, sin diseñar nada.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Trash2, Image as ImageIcon, Wand2, ExternalLink, X } from 'lucide-react';
import { Card, Btn, Field, Chip, Empty } from './AdminKit';
import { CustomSelect } from '../CustomSelect';
import { useToast, useConfirm } from '../ui/Overlays';
import { getDB, saveDB, addAuditLog } from '../../utils/storage';
import { generarBannerDeProducto } from '../../utils/bannerAuto';
import type { Banner, Product, User } from '../../types';

const FORMATOS: { value: NonNullable<Banner['formato']>; label: string; ayuda: string }[] = [
  { value: 'hero', label: 'Hero — carrusel principal', ayuda: 'Arriba del catálogo. Ideal 1920×600 (escritorio) / 1080×810 (celular).' },
  { value: 'divisor', label: 'Divisor — franja ancha', ayuda: 'Separa secciones. Franja horizontal, ideal 1920×480.' },
  { value: 'grid', label: 'Tarjeta en la cuadrícula', ayuda: 'Se mezcla entre los productos, ocupa dos espacios.' },
  { value: 'popup', label: 'Pop-up emergente', ayuda: 'Aparece una vez por sesión. Ideal 1080×810.' },
];

function idNuevo(): string {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* nada */ }
  return `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bannerVacio(): Banner {
  return { id: idNuevo(), title: '', description: '', imageUrl: '', link: '', type: 'General', formato: 'hero', oferta: '', active: true };
}

function leerArchivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const fr = new FileReader();
    fr.onload = () => resolver(String(fr.result || ''));
    fr.onerror = () => rechazar(fr.error);
    fr.readAsDataURL(file);
  });
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
  const fileRef = useRef<HTMLInputElement | null>(null);

  // La base puede cambiar por Realtime (otro admin) o por el propio guardado.
  useEffect(() => {
    const alActualizar = () => {
      setBanners(getDB().banners || []);
      setProductos(getDB().products || []);
    };
    window.addEventListener('technoverse_db_updated', alActualizar);
    return () => window.removeEventListener('technoverse_db_updated', alActualizar);
  }, []);

  const abrirNuevo = () => { setForm(bannerVacio()); setEsNuevo(true); };
  const abrirEdicion = (b: Banner) => { setForm({ ...b, oferta: b.oferta || '', link: b.link || '' }); setEsNuevo(false); };
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

  const guardar = async () => {
    if (!form) return;
    if (!form.imageUrl) { toast.error('Falta la imagen del banner.'); return; }
    setGuardando(true);
    try {
      const db = getDB();
      const limpio: Banner = {
        ...form,
        title: (form.title || '').trim(),
        description: (form.description || '').trim(),
        oferta: (form.oferta || '').trim() || undefined,
        link: (form.link || '').trim() || undefined,
      };
      const idx = (db.banners || []).findIndex(b => b.id === limpio.id);
      if (idx === -1) db.banners.push(limpio);
      else db.banners[idx] = limpio;
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
      .filter(p => p && p.name && p.imageUrl)
      .slice(0, 300)
      .map(p => ({ value: p.id, label: `${p.name} — ₡${(p.price || 0).toLocaleString('es-CR')}` })),
    [productos]
  );

  const etiquetaFormato = (f?: Banner['formato']) => FORMATOS.find(x => x.value === (f || 'hero'))?.label.split(' — ')[0] || 'Hero';

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
            <h4 className="text-[13px] font-bold text-[var(--text-primary)]">{esNuevo ? 'Nuevo banner' : 'Editar banner'}</h4>
            <button type="button" onClick={cerrar} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Imagen */}
            <div className="md:col-span-2">
              <span className="tv-label">Imagen</span>
              <div className="mt-1 flex items-center gap-3">
                <div className="w-28 h-20 rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-sunken)] flex items-center justify-center shrink-0">
                  {form.imageUrl
                    ? <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
                    : <ImageIcon className="w-6 h-6 text-[var(--text-muted)]" />}
                </div>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => elegirImagen(e.target.files?.[0])} />
                  <Btn variant="default" icon={ImageIcon} onClick={() => fileRef.current?.click()}>
                    {form.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  </Btn>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-xs">
                    {FORMATOS.find(f => f.value === (form.formato || 'hero'))?.ayuda}
                  </p>
                </div>
              </div>
            </div>

            <Field label="Formato (dónde se muestra)">
              <CustomSelect
                value={form.formato || 'hero'}
                onChange={val => setForm({ ...form, formato: val as Banner['formato'] })}
                options={FORMATOS.map(f => ({ value: f.value, label: f.label }))}
              />
            </Field>
            <Field label="Etiqueta de oferta" hint="Opcional. Ej: 2x1, -30%, Envío gratis.">
              <input type="text" className="tv-input" value={form.oferta || ''} placeholder="2x1"
                onChange={e => setForm({ ...form, oferta: e.target.value })} />
            </Field>
            <Field label="Título" className="md:col-span-2">
              <input type="text" className="tv-input" value={form.title} placeholder="Ej: Semana del audio"
                onChange={e => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Descripción" className="md:col-span-2">
              <input type="text" className="tv-input" value={form.description} placeholder="Texto corto de apoyo"
                onChange={e => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Enlace (WhatsApp, red o categoría)" hint="Ej: https://wa.me/506… o /tienda" className="md:col-span-2">
              <input type="text" className="tv-input" value={form.link || ''} placeholder="https://wa.me/50688888888"
                onChange={e => setForm({ ...form, link: e.target.value })} />
            </Field>
            <Field label="Desde (opcional)">
              <input type="date" className="tv-input" value={form.startDate || ''}
                onChange={e => setForm({ ...form, startDate: e.target.value || undefined })} />
            </Field>
            <Field label="Hasta (opcional)">
              <input type="date" className="tv-input" value={form.endDate || ''}
                onChange={e => setForm({ ...form, endDate: e.target.value || undefined })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 mt-3 text-[13px] text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Activo (visible en la tienda)
          </label>

          <div className="flex justify-end gap-2 mt-4">
            <Btn variant="ghost" onClick={cerrar}>Cancelar</Btn>
            <Btn variant="primary" icon={Save} onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar banner'}
            </Btn>
          </div>
        </div>
      )}

      {/* Lista */}
      {banners.length === 0 ? (
        <Empty icon={ImageIcon} title="Sin banners" text="Creá el primero con “Nuevo banner”, o generalo automático desde un producto." />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {banners.map(b => (
            <li key={b.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden flex">
              <div className="w-28 shrink-0 bg-[var(--bg-sunken)]">
                {b.imageUrl
                  ? <img src={b.imageUrl} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-[var(--text-muted)]" /></div>}
              </div>
              <div className="flex-1 min-w-0 p-3 flex flex-col">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Chip tone="accent">{etiquetaFormato(b.formato)}</Chip>
                  {b.oferta && <Chip tone="ok">{b.oferta}</Chip>}
                  {!b.active && <Chip>Inactivo</Chip>}
                </div>
                <div className="text-[13px] font-bold text-[var(--text-primary)] truncate">{b.title || '(sin título)'}</div>
                <div className="text-[11.5px] text-[var(--text-secondary)] truncate">{b.description || '—'}</div>
                {b.link && (
                  <div className="text-[11px] text-[var(--text-muted)] truncate flex items-center gap-1 mt-0.5">
                    <ExternalLink className="w-3 h-3" /> {b.link}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-auto pt-2">
                  <Btn variant="ghost" onClick={() => abrirEdicion(b)}>Editar</Btn>
                  <Btn variant="ghost" onClick={() => alternarActivo(b)}>{b.active ? 'Desactivar' : 'Activar'}</Btn>
                  <Btn variant="danger" icon={Trash2} onClick={() => borrar(b)}>Quitar</Btn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
