import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Key, Mail, Power, Download, Trash2, ShoppingBag, RefreshCw, Save, AlertTriangle
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { ClientProfile, Order } from '../types';
import { useToast, useConfirm } from './ui/Overlays';

// =====================================================================
// FICHA COMPLETA DEL CLIENTE
// =====================================================================
// Todo lo que se puede hacer con un cliente, en un solo lugar:
//
//   · Historial completo de compras
//   · Cambiar su contraseña o enviarle el correo de restablecimiento
//   · Cambiar su correo de acceso
//   · Activar o desactivar la cuenta
//   · Exportar sus datos      (Ley 8968 — portabilidad)
//   · Derecho al Olvido       (Ley 8968 — supresión)
//
// Las dos últimas venían de la pantalla "Cumplimiento Legal", que se
// retiró del panel. Se rescataron aquí a propósito: NO son informativas,
// son derechos que el cliente puede exigirle a Technoverse ante la
// PRODHAB. Quitar la pantalla estaba bien; perder la capacidad de
// atenderlos, no. Y este es su sitio natural: cuando un cliente escriba
// pidiendo que borren sus datos, se le busca acá y se resuelve desde su
// propia ficha, sin ir a otro lado.
// =====================================================================

interface ClienteFichaProps {
  cliente: ClientProfile;
  pedidos: Order[];
  adminEmail?: string;
  onCerrar: () => void;
  onCambios: () => void;
}

const colones = (n: number) =>
  '₡' + Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fecha = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-CR'); } catch { return String(iso); }
};

export default function ClienteFicha({ cliente, pedidos, adminEmail, onCerrar, onCambios }: ClienteFichaProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [activo, setActivo] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nuevaClave, setNuevaClave] = useState('');
  const [nuevoCorreo, setNuevoCorreo] = useState('');

  // `activo` no viaja en el objeto del CRM: se dejó fuera del mapeo de
  // storage.ts para que el formulario de siempre no lo pise sin querer.
  // Por eso se lee aquí, directo de la tabla.
  useEffect(() => {
    let vigente = true;
    supabase
      .from('client_profiles')
      .select('activo')
      .eq('id', cliente.id)
      .maybeSingle()
      .then(({ data }) => { if (vigente) setActivo(data?.activo ?? true); });
    return () => { vigente = false; };
  }, [cliente.id]);

  // Historial de compras. Se cruza por correo porque es lo que queda
  // guardado en el pedido; el id del cliente no siempre viaja en él.
  const compras = useMemo(() => {
    const correo = (cliente.email || '').toLowerCase();
    return (pedidos || [])
      .filter(o => (o.customerEmail || '').toLowerCase() === correo)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [pedidos, cliente.email]);

  const totalComprado = useMemo(
    () => compras.reduce((s, o) => s + Number(o.total || 0), 0),
    [compras]
  );

  // ---- Acciones -----------------------------------------------------

  const cambiarClave = async () => {
    if (nuevaClave.length < 8) {
      toast.warning('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setOcupado('clave');
    try {
      const { data, error } = await supabase.functions.invoke('admin-clientes', {
        body: { accion: 'cambiar-password', email: cliente.email, password: nuevaClave },
      });
      // El mensaje de error útil viaja en el cuerpo de la respuesta, no en
      // `error.message`: sin leerlo, todos los fallos se verían iguales.
      const detalle = await leerError(error);
      if (detalle || !data?.success) {
        toast.error(detalle || data?.error || 'No se pudo cambiar la contraseña.');
        return;
      }
      addAuditLog(adminEmail || 'admin', 'Clientes', 'Cambio de contraseña',
        `Contraseña cambiada manualmente para ${cliente.email}`);
      toast.success('Contraseña actualizada. Entréguesela al cliente por un medio seguro.');
      setNuevaClave('');
    } finally {
      setOcupado(null);
    }
  };

  const enviarEnlaceReset = async () => {
    setOcupado('enlace');
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-password-reset', {
        body: { email: cliente.email },
      });
      const detalle = await leerError(error);
      if (detalle || !data?.success) {
        toast.error(detalle || data?.error || 'No se pudo enviar el correo.');
        return;
      }
      toast.success(`Correo de restablecimiento enviado a ${cliente.email}.`);
    } finally {
      setOcupado(null);
    }
  };

  const cambiarCorreo = async () => {
    const limpio = nuevoCorreo.trim().toLowerCase();
    if (!limpio.includes('@')) {
      toast.warning('Escriba un correo válido.');
      return;
    }
    const ok = await confirm({
      title: 'Cambiar el correo de acceso',
      message: `El cliente pasará a entrar con ${limpio}, y ahí le llegarán sus comprobantes. El correo anterior dejará de servir. ¿Continuar?`,
      confirmText: 'Cambiar correo',
    });
    if (!ok) return;

    setOcupado('correo');
    try {
      const { data, error } = await supabase.functions.invoke('admin-clientes', {
        body: { accion: 'cambiar-correo', email: cliente.email, nuevo_email: limpio },
      });
      const detalle = await leerError(error);
      if (detalle || !data?.success) {
        toast.error(detalle || data?.error || 'No se pudo cambiar el correo.');
        return;
      }
      addAuditLog(adminEmail || 'admin', 'Clientes', 'Cambio de correo',
        `Correo de acceso cambiado de ${cliente.email} a ${limpio}`);
      toast.success(data.mensaje || 'Correo actualizado.');
      setNuevoCorreo('');
      onCambios();
      onCerrar();
    } finally {
      setOcupado(null);
    }
  };

  const alternarActivo = async () => {
    const apagar = activo !== false;
    const ok = await confirm({
      title: apagar ? 'Desactivar la cuenta' : 'Reactivar la cuenta',
      message: apagar
        ? `${cliente.name} no va a poder iniciar sesión, aunque su contraseña sea correcta. Sus pedidos y su historial NO se borran. ¿Continuar?`
        : `${cliente.name} va a poder volver a entrar con su contraseña de siempre. ¿Continuar?`,
      confirmText: apagar ? 'Desactivar' : 'Reactivar',
      variant: apagar ? 'danger' : undefined,
    });
    if (!ok) return;

    setOcupado('activo');
    try {
      const { error } = await supabase
        .from('client_profiles')
        .update({ activo: !apagar })
        .eq('id', cliente.id);
      if (error) { toast.error('No se pudo cambiar el estado: ' + error.message); return; }
      setActivo(!apagar);
      addAuditLog(adminEmail || 'admin', 'Clientes', apagar ? 'Desactivar cuenta' : 'Reactivar cuenta',
        `Cuenta de ${cliente.email} ${apagar ? 'desactivada' : 'reactivada'}`);
      toast.success(apagar ? 'Cuenta desactivada. Ya no puede iniciar sesión.' : 'Cuenta reactivada.');
    } finally {
      setOcupado(null);
    }
  };

  // ---- Ley 8968: portabilidad ---------------------------------------
  const exportarDatos = () => {
    const paquete = {
      exportado_en: new Date().toISOString(),
      fundamento: 'Ley 8968 de Protección de la Persona frente al tratamiento de sus datos personales (Costa Rica) — derecho de portabilidad.',
      cliente,
      compras,
    };
    const url = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(paquete, null, 2));
    const a = document.createElement('a');
    a.href = url;
    a.download = `PORTABILIDAD-LEY-8968-${cliente.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    addAuditLog(adminEmail || 'admin', 'Protección Datos', 'Portabilidad',
      `Exportación de datos generada para ${cliente.name}`);
    toast.success('Archivo generado. Entrégueselo al cliente.');
  };

  // ---- Ley 8968: derecho al olvido ----------------------------------
  const derechoAlOlvido = async () => {
    const ok = await confirm({
      title: 'Derecho al Olvido (Ley 8968)',
      message: 'Se borrarán de forma irreversible el nombre, correo, teléfono, dirección y tarjetas de este cliente. Los comprobantes se conservan porque Hacienda obliga a guardarlos, pero quedarán a nombre de "Cliente anónimo". Esto no se puede deshacer. ¿Continuar?',
      confirmText: 'Purgar los datos',
      variant: 'danger',
    });
    if (!ok) return;

    setOcupado('olvido');
    try {
      const db = getDB();
      const i = db.clients.findIndex(c => c.id === cliente.id);
      if (i === -1) { toast.error('No se encontró el cliente.'); return; }

      const nombreOriginal = db.clients[i].name;
      db.clients[i].name = 'CLIENTE ANÓNIMO (DERECHO AL OLVIDO)';
      db.clients[i].email = `anonimo-${cliente.id.toLowerCase()}@technoverse.com`;
      db.clients[i].phone = '+506 0000 0000';
      db.clients[i].addressDetail = 'ELIMINADO BAJO SOLICITUD DE LEY 8968';
      db.clients[i].cardsTokenized = [];
      db.clients[i].balance = 0;
      db.clients[i].notes = `Información personal purgada el ${new Date().toLocaleDateString('es-CR')} a solicitud del titular, conforme a la Ley 8968.`;

      addAuditLog(adminEmail || 'admin', 'Protección Datos', 'Derecho Olvido',
        `Purga de datos personales completada para ${nombreOriginal} (${cliente.id}) conforme a la Ley 8968.`, db);

      await saveDB(db);
      toast.success('Datos personales purgados conforme a la Ley 8968.');
      onCambios();
      onCerrar();
    } finally {
      setOcupado(null);
    }
  };

  // ---- Utilidad -----------------------------------------------------
  // supabase-js mete la respuesta HTTP real dentro de error.context. Sin
  // abrirla, un 404 ("no tiene cuenta de acceso") y un 400 ("contraseña
  // muy corta") se verían idénticos para quien usa el panel.
  async function leerError(error: any): Promise<string | null> {
    if (!error) return null;
    try {
      const cuerpo = await error?.context?.json?.();
      if (cuerpo?.error) return cuerpo.error;
    } catch { /* sin cuerpo legible */ }
    return error?.message || 'Error inesperado.';
  }

  const trabajando = (cual: string) => ocupado === cual;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onCerrar}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-color)]/60 p-5 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="font-bold text-[var(--text-primary)] truncate">{cliente.name}</h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono truncate">{cliente.email}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {activo === null ? (
                <span className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">comprobando…</span>
              ) : activo ? (
                <span className="text-[9px] uppercase font-bold bg-[var(--ok-soft)] border border-[var(--ok)] text-[var(--ok)] px-2 py-0.5 rounded">Cuenta activa</span>
              ) : (
                <span className="text-[9px] uppercase font-bold bg-rose-500/10 border border-rose-500/40 text-rose-500 px-2 py-0.5 rounded">Desactivada</span>
              )}
              <span className="text-[9px] uppercase font-bold bg-[var(--bg-base)] border border-[var(--border-color)]/60 text-[var(--text-secondary)] px-2 py-0.5 rounded">
                {compras.length} compra(s) · {colones(totalComprado)}
              </span>
            </div>
          </div>
          <button onClick={onCerrar} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* ---- Historial de compras ---- */}
          <section className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3 flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4" /> Historial de compras
            </h4>
            {compras.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] italic">Este cliente todavía no tiene compras registradas.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {/* Sin flex-wrap: en un celular angosto la lista de artículos
                    empujaba el precio a una segunda línea y quedaba
                    desalineado con el de las demás compras. Ahora el texto
                    se recorta y la columna del monto no se mueve nunca. */}
                {compras.map(o => (
                  <div key={o.id} className="bg-[var(--bg-surface)] border border-[var(--border-color)]/50 rounded-xl p-3 flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs text-[var(--text-primary)]">{o.id}</div>
                      <div className="text-[10px] text-[var(--text-secondary)]">{fecha(o.timestamp)}</div>
                      <div className="text-[10px] text-[var(--text-secondary)] truncate">
                        {(o.items || []).map(it => `${it.quantity}× ${it.productName}`).join(' · ') || 'sin detalle'}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono font-bold text-sm text-[var(--text-primary)]">{colones(o.total)}</div>
                      <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">{o.status}</div>
                      {(o as any).payment_status && (
                        <div className="text-[9px] uppercase font-bold text-[var(--brand-gold-mid)]">
                          pago: {(o as any).payment_status}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---- Acceso: contraseña ---- */}
          <section className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
              <Key className="w-4 h-4" /> Contraseña
            </h4>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={nuevaClave}
                onChange={e => setNuevaClave(e.target.value)}
                placeholder="Contraseña nueva (mínimo 8)"
                className="flex-1 min-w-[200px] bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={cambiarClave}
                disabled={!!ocupado}
                className="bg-[var(--brand-gold-mid)]/15 border border-[var(--brand-gold-mid)]/50 text-[var(--brand-gold-mid)] text-xs font-bold px-4 py-2 rounded-xl transition hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5"
              >
                {trabajando('clave') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Cambiar ahora
              </button>
              <button
                onClick={enviarEnlaceReset}
                disabled={!!ocupado}
                className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-[var(--text-primary)] text-xs font-bold px-4 py-2 rounded-xl transition hover:bg-[var(--bg-base)] disabled:opacity-50 flex items-center gap-1.5"
              >
                {trabajando('enlace') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Mandarle el enlace
              </button>
            </div>
            {/* La contraseña se escribe visible a propósito: si va a
                dictársela al cliente, necesita poder leerla. */}
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              Cambiarla aquí surte efecto de inmediato y el cliente pierde la anterior. Si prefiere que él la escoja,
              use <strong className="text-[var(--text-primary)]">Mandarle el enlace</strong>: le llega un correo y usted
              nunca conoce su contraseña, que es lo más sano.
            </p>
          </section>

          {/* ---- Acceso: correo ---- */}
          <section className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
              <Mail className="w-4 h-4" /> Correo de acceso
            </h4>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={nuevoCorreo}
                onChange={e => setNuevoCorreo(e.target.value)}
                placeholder={`Actual: ${cliente.email}`}
                className="flex-1 min-w-[200px] bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={cambiarCorreo}
                disabled={!!ocupado}
                className="bg-[var(--brand-gold-mid)]/15 border border-[var(--brand-gold-mid)]/50 text-[var(--brand-gold-mid)] text-xs font-bold px-4 py-2 rounded-xl transition hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5"
              >
                {trabajando('correo') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Cambiar correo
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              Se cambia en los tres lugares donde vive: el acceso, el perfil y la ficha del CRM. A partir de ahí sus
              comprobantes le llegan al nuevo.
            </p>
          </section>

          {/* ---- Estado de la cuenta ---- */}
          <section className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                <Power className="w-4 h-4" /> Estado de la cuenta
              </h4>
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed mt-1 max-w-md">
                Desactivarla le impide iniciar sesión aunque su contraseña sea correcta. No borra nada: sus pedidos, sus
                comprobantes y su historial se conservan intactos.
              </p>
            </div>
            <button
              onClick={alternarActivo}
              disabled={!!ocupado || activo === null}
              className={`text-xs font-bold px-4 py-2 rounded-xl transition border flex items-center gap-1.5 disabled:opacity-50 ${
                activo === false
                  ? 'bg-[var(--ok-soft)] border-[var(--ok)] text-[var(--ok)] hover:brightness-110'
                  : 'bg-rose-500/10 border-rose-500/40 text-rose-500 hover:bg-rose-500/20'
              }`}
            >
              {trabajando('activo') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              {activo === false ? 'Reactivar cuenta' : 'Desactivar cuenta'}
            </button>
          </section>

          {/* ---- Ley 8968 ---- */}
          <section className="bg-[var(--bg-base)] border border-[var(--border-color)]/60 rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Derechos del cliente (Ley 8968)
            </h4>
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              Estas dos no son opcionales: son derechos que el cliente puede exigirle ante la PRODHAB, y usted está
              obligado a atenderlos.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={exportarDatos}
                disabled={!!ocupado}
                className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-[var(--text-primary)] text-xs font-bold px-4 py-2 rounded-xl transition hover:bg-[var(--bg-base)] disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Exportar sus datos
              </button>
              <button
                onClick={derechoAlOlvido}
                disabled={!!ocupado}
                className="bg-rose-500/10 border border-rose-500/40 text-rose-500 text-xs font-bold px-4 py-2 rounded-xl transition hover:bg-rose-500/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                {trabajando('olvido') ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Derecho al Olvido
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
