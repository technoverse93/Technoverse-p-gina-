// =====================================================================
// SALUD DE JARVIS — ¿está respondiendo bien?
// =====================================================================
// Lo que anota el servidor de cada respuesta (quién respondió, cuánto
// tardó, qué falló antes, si el revisor corrigió) y la prueba diaria de
// cada IA y herramienta (6:45 a. m.). «Probar ahora» la corre al instante.
// Ver supabase/functions/asistente-ia/salud.ts.
// =====================================================================

import { useEffect, useState } from 'react';
import { HeartPulse, RefreshCw, BellRing } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { ESTADO_PENDIENTE, estadoPush, iniciarPush, TEXTO_ESTADO, type EstadoPush } from '../../mobile/pushNativo';
import { activarAvisosWeb, estadoAvisosWeb, soportaAvisosWeb, TEXTO_ESTADO_WEB, type EstadoWeb } from '../../utils/avisosWeb';

type PruebaInfo = { ok: boolean; ms: number; detalle: string; modelo?: string | null; cuando: string };
type Ia = { id: string; nombre: string; respondio: number; fallos: number; ms: number | null; ultimoError: string; ultimoErrorEn: string | null; prueba: PruebaInfo | null };
type Informe = {
  ok: boolean; falta?: boolean; error?: string; estado?: 'bien' | 'atencion' | 'mal';
  hoy?: { total: number; bien: number; sinServicio: number; errores: number; empieza: number | null; termina: number | null; revisadas: number; corregidas: number; conTropiezos: number };
  ias?: Ia[]; herramientas?: { id: string; nombre: string; prueba: PruebaInfo }[];
  dias?: { dia: string; bien: number; mal: number }[];
  problemas?: { cuando: string; tipo: string; texto: string }[];
  ultimaPrueba?: string | null;
  recien?: { componente: string; nombre: string; ok: boolean; ms: number; detalle: string }[];
};

const seg = (ms: number | null | undefined) => (ms ? `${(ms / 1000).toLocaleString('es-CR', { maximumFractionDigits: ms < 10_000 ? 1 : 0 })} s` : '—');
const hace = (f: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(f).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'ayer' : `hace ${d} días`;
};
const LETRA = ['D', 'L', 'K', 'M', 'J', 'V', 'S'];
const TITULO = { bien: 'Todo en orden', atencion: 'Funciona, con detalles', mal: 'Javier tiene problemas' } as const;

export default function SaludJarvis() {
  const [inf, setInf] = useState<Informe | null>(null);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState('');
  const pedir = async (probar: boolean) => {
    setError('');
    if (probar) setProbando(true);
    const { data, error: e } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'salud', probar } });
    if (probar) setProbando(false);
    if (e || !data?.ok) { setError(probar ? 'No se pudo correr la prueba. Probá de nuevo en un momento.' : 'No se pudo leer la salud de Javier.'); if (!inf) setInf({ ok: false }); return; }
    setInf(data as Informe);
  };
  useEffect(() => { void pedir(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisos al teléfono (push): si este teléfono está registrado y una prueba de punta a punta.
  const [push, setPush] = useState<EstadoPush | null>(() => estadoPush() || null);
  const [pushNota, setPushNota] = useState('');
  const [pushOcupado, setPushOcupado] = useState(false);
  const probarPush = async () => {
    setPushOcupado(true); setPushNota('');
    const e = await iniciarPush('superadmin', true); setPush(e);
    if (e === 'activo') {
      const { data, error: er } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'push_prueba' } });
      setPushNota(er || !data?.ok ? 'No se pudo pedir la prueba al servidor.'
        : data.sinConfig ? 'El servidor no tiene el secreto FCM_SERVICE_ACCOUNT (Supabase → Edge Functions → Secrets).'
        : data.sinTelefonos ? 'El servidor todavía no tiene registrado este teléfono. Probá de nuevo en unos segundos.'
        : data.enviados > 0 ? 'Enviado. En unos segundos te tiene que llegar un aviso con el botón «Responder».'
        : 'Google rechazó el envío: revisá el secreto FCM_SERVICE_ACCOUNT y el registro (log) de la función.');
    }
    setPushOcupado(false);
  };

  // Avisos en este navegador (Chrome, Edge, Firefox, Safari): sin Firebase, llegan con el navegador cerrado.
  const [web, setWeb] = useState<EstadoWeb | null>(null);
  const [webNota, setWebNota] = useState('');
  const [webOcupado, setWebOcupado] = useState(false);
  useEffect(() => { if (soportaAvisosWeb()) void estadoAvisosWeb().then(setWeb); }, []);
  const probarWeb = async () => {
    setWebOcupado(true); setWebNota('');
    const e = web === 'activo' ? 'activo' : await activarAvisosWeb(); setWeb(e);
    if (e === 'activo') {
      const { data, error: er } = await supabase.functions.invoke('asistente-ia', { body: { accion: 'push_prueba' } });
      const w = data?.web as { enviados: number; suscripciones: number; sinConfig?: boolean } | undefined;
      setWebNota(er || !data?.ok ? 'No se pudo pedir la prueba al servidor.'
        : !w ? 'El servidor todavía no manda avisos web (falta desplegar la función asistente-ia).'
        : w.sinConfig ? 'Al servidor le falta el secreto VAPID_PRIVADA (Supabase → Edge Functions → Secrets).'
        : !w.suscripciones ? 'El servidor todavía no tiene este navegador. Probá de nuevo en unos segundos.'
        : w.enviados > 0 ? 'Enviado. En unos segundos te tiene que llegar el aviso de prueba.'
        : 'El servicio de avisos rechazó el envío: revisá el registro (log) de la función.');
    }
    setWebOcupado(false);
  };

  const hoy = inf?.hoy;
  const max = Math.max(1, ...(inf?.dias || []).map(d => d.bien + d.mal));
  const estado = inf?.estado || 'bien';
  return (
    <div className="ai-aj jv-salud">
      <h4><i className="jv-pt" data-area="neg" aria-hidden="true" />Salud de Javier <small>últimas 24 h</small></h4>
      {!inf ? <div className="ai-esqueleto" aria-label="Cargando"><i /><i /></div>
        : inf.falta ? (
          <p className="jv-salud-nota">Falta un paso: correr en Supabase el SQL de salud (<code>migracion_jarvis_salud.sql</code>). Desde ahí Javier anota cada respuesta y se prueba solo cada mañana. La prueba de abajo ya funciona.</p>
        ) : hoy && (
          <>
            <div className="jv-salud-estado" data-estado={estado}>
              <span className="jv-salud-ic"><HeartPulse className="w-5 h-5" /></span>
              <span className="jv-salud-tx">
                <b>{TITULO[estado]}</b>
                <span>{hoy.total
                  ? `${hoy.bien} de ${hoy.total} mensajes respondidos${hoy.sinServicio ? ` · ${hoy.sinServicio} sin servicio` : ''}${hoy.errores ? ` · ${hoy.errores} con error` : ''}`
                  : 'Sin mensajes en las últimas 24 h.'}</span>
              </span>
            </div>
            <dl className="jv-salud-cifras">
              <div><dt>Empieza a escribir</dt><dd>{seg(hoy.empieza)}</dd></div>
              <div><dt>Respuesta completa</dt><dd>{seg(hoy.termina)}</dd></div>
              <div><dt>Corregidas</dt><dd>{hoy.corregidas}<small> de {hoy.revisadas}</small></dd></div>
              <div><dt>Con respaldo</dt><dd>{hoy.conTropiezos}<small> de {hoy.bien}</small></dd></div>
            </dl>
            {!!inf.dias?.length && (
              <div className="jv-salud-dias" role="img" aria-label={`Últimos 7 días: ${inf.dias.map(d => `${d.bien} bien, ${d.mal} sin respuesta`).join('; ')}`}>
                {inf.dias.map(d => (
                  <div key={d.dia} className="jv-sd-dia" title={`${d.dia}: ${d.bien} bien · ${d.mal} sin respuesta`}>
                    <span className="jv-sd-barra">
                      {d.mal > 0 && <i data-k="mal" style={{ height: `${(d.mal / max) * 100}%` }} />}
                      {d.bien > 0 && <i data-k="bien" style={{ height: `${(d.bien / max) * 100}%` }} />}
                    </span>
                    <small>{LETRA[new Date(`${d.dia}T12:00:00`).getDay()]}</small>
                  </div>
                ))}
              </div>
            )}

            <h5 className="jv-salud-sub">Cada IA <small>7 días · prueba de hoy</small></h5>
            <ul className="jv-salud-lista">
              {(inf.ias || []).map(x => (
                <li key={x.id}>
                  <i className="jv-sd-luz" data-ok={x.prueba ? (x.prueba.ok ? 'si' : 'no') : undefined} aria-label={x.prueba ? (x.prueba.ok ? 'Prueba bien' : 'Prueba falló') : 'Sin prueba'} />
                  <span className="jv-sd-tx">
                    <b>{x.nombre}</b>
                    <span>{x.respondio ? `respondió ${x.respondio}` : 'no respondió'}{x.fallos ? ` · falló ${x.fallos}` : ''}{x.ms ? ` · ${seg(x.ms)}` : ''}</span>
                    {x.prueba && !x.prueba.ok ? <span className="jv-sd-error">{x.prueba.detalle}</span>
                      : x.ultimoError && x.ultimoErrorEn ? <span className="jv-sd-pie">Último tropiezo {hace(x.ultimoErrorEn)}: {x.ultimoError}</span> : null}
                  </span>
                  <span className="jv-sd-ms">{x.prueba ? (x.prueba.ok ? seg(x.prueba.ms) : 'falla') : '—'}</span>
                </li>
              ))}
              {!inf.ias?.length && <li className="jv-sd-vacio">Todavía no hay datos: llegan con los mensajes y con la prueba diaria.</li>}
            </ul>

            {!!inf.herramientas?.length && (
              <>
                <h5 className="jv-salud-sub">Herramientas <small>prueba de hoy</small></h5>
                <ul className="jv-salud-lista">
                  {inf.herramientas.map(h => (
                    <li key={h.id}>
                      <i className="jv-sd-luz" data-ok={h.prueba.ok ? 'si' : 'no'} aria-label={h.prueba.ok ? 'Bien' : 'Falla'} />
                      <span className="jv-sd-tx"><b>{h.nombre}</b><span className={h.prueba.ok ? undefined : 'jv-sd-error'}>{h.prueba.detalle}</span></span>
                      <span className="jv-sd-ms">{h.prueba.ok ? seg(h.prueba.ms) : 'falla'}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h5 className="jv-salud-sub">Lo último que falló <small>7 días</small></h5>
            <ul className="jv-salud-lista">
              {(inf.problemas || []).map((p, i) => (
                <li key={i}>
                  <i className="jv-sd-luz" data-ok="no" aria-hidden="true" />
                  <span className="jv-sd-tx"><span>{p.texto}</span><span className="jv-sd-pie">{hace(p.cuando)}</span></span>
                </li>
              ))}
              {!inf.problemas?.length && <li className="jv-sd-vacio">Nada: todos los mensajes tuvieron respuesta.</li>}
            </ul>
          </>
        )}

      {inf?.falta && !!inf.recien?.length && (
        <ul className="jv-salud-lista">
          {inf.recien.map(p => (
            <li key={p.componente}>
              <i className="jv-sd-luz" data-ok={p.ok ? 'si' : 'no'} aria-hidden="true" />
              <span className="jv-sd-tx"><b>{p.nombre}</b><span className={p.ok ? undefined : 'jv-sd-error'}>{p.detalle}</span></span>
              <span className="jv-sd-ms">{p.ok ? seg(p.ms) : 'falla'}</span>
            </li>
          ))}
        </ul>
      )}

      <h5 className="jv-salud-sub">Avisos al teléfono <small>chat y Javier, aunque la app esté cerrada</small></h5>
      <ul className="jv-salud-lista">
        <li>
          <i className="jv-sd-luz" data-ok={push && !ESTADO_PENDIENTE.has(push) ? (push === 'activo' ? 'si' : 'no') : undefined} aria-label={push === 'activo' ? 'Activos' : 'Sin activar'} />
          <span className="jv-sd-tx">
            <b>{push === 'activo' ? 'Activos' : push && ESTADO_PENDIENTE.has(push) ? 'Sin configurar (opcional)' : 'Sin activar'}</b>
            <span className={push && push !== 'activo' && !ESTADO_PENDIENTE.has(push) ? 'jv-sd-error' : undefined}>{push ? TEXTO_ESTADO[push] : 'Se activan al abrir la app del teléfono con tu sesión.'}</span>
            {pushNota && <span className="jv-sd-pie" role="status">{pushNota}</span>}
          </span>
          <span className="jv-sd-ms"><button type="button" className="ai-chip" disabled={pushOcupado} onClick={() => void probarPush()}><BellRing className="w-4 h-4" />{pushOcupado ? 'Probando…' : 'Enviar prueba'}</button></span>
        </li>
        {web && web !== 'sin_soporte' && (
          <li>
            <i className="jv-sd-luz" data-ok={web === 'activo' ? 'si' : web === 'apagado' ? undefined : 'no'} aria-label={web === 'activo' ? 'Activos' : 'Sin activar'} />
            <span className="jv-sd-tx">
              <b>Este navegador: {web === 'activo' ? 'activos' : 'sin activar'}</b>
              <span className={web !== 'activo' && web !== 'apagado' ? 'jv-sd-error' : undefined}>{TEXTO_ESTADO_WEB[web]}</span>
              {webNota && <span className="jv-sd-pie" role="status">{webNota}</span>}
            </span>
            <span className="jv-sd-ms"><button type="button" className="ai-chip" disabled={webOcupado || web === 'bloqueado'} onClick={() => void probarWeb()}><BellRing className="w-4 h-4" />{webOcupado ? 'Probando…' : web === 'activo' ? 'Enviar prueba' : 'Activar'}</button></span>
          </li>
        )}
      </ul>

      <div className="jv-salud-pie">
        <button type="button" className="ai-chip" disabled={probando} onClick={() => void pedir(true)}>
          <RefreshCw className={`w-4 h-4${probando ? ' jv-gira' : ''}`} />{probando ? 'Probando cada IA…' : 'Probar ahora'}
        </button>
        <span>{probando ? 'Tarda hasta 45 s (la IA principal piensa).' : inf?.ultimaPrueba ? `Última prueba ${hace(inf.ultimaPrueba)} · se prueba sola a las 6:45` : 'Se prueba sola todos los días a las 6:45.'}</span>
      </div>
      {error && <p className="ai-voz-error" role="alert">{error}</p>}
    </div>
  );
}
