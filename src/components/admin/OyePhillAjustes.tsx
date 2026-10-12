// =====================================================================
// AJUSTES → «OYE PHILL»
// =====================================================================
// Llamar a Phill con la voz, aunque la app esté cerrada: decís «Oye Phill» y
// se abre en manos libres. El teléfono te escucha con un reconocedor que
// corre en el propio aparato (sin internet): lo que oye mientras espera no
// sale de ahí ni se guarda. Es opcional y empieza apagado.
//
// Acá se baja el «oído» (~40 MB, una sola vez), se dan los permisos de
// Android, se elige qué tan exigente es el llamado y se le enseña cómo lo
// decís (con «Probar», que muestra lo que entiende). Ver
// src/mobile/oyePhill.ts y native-android/oye/.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Download, Pause, Play, Plus, RefreshCcw, Square, TriangleAlert, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useConfirm } from '../ui/Overlays';
import { oyePhill, type AjusteAndroid } from '../../mobile/oyePhill';
import { pedirPermisoNotificaciones } from '../../mobile/notificaciones';
import { aparatoActual } from '../../seguridad/killSwitch';
import {
  esFraseUtil, frasesValidas, FRASE_MAX_PALABRAS, FRASE_MIN_PALABRAS, FRASES_MAX, limpiarFrase, lineaDePrueba, pasosOye, puedeActivar,
  SENSIBILIDADES, textoEstado, type EstadoOye, type Sens,
} from '../../utils/oyePhill';

async function anotar(accion: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const { addAuditLog } = await import('../../utils/storage');
    addAuditLog(session?.user?.email || 'superadmin', 'Seguridad', accion, `Teléfono: ${aparatoActual().modelo || 'sin nombre'}`);
  } catch { /* la bitácora no frena el cambio */ }
}

export default function OyePhillAjustes() {
  const confirm = useConfirm();
  const nativo = oyePhill.disponible();
  // Dentro de la app pero sin el complemento = una APK vieja (la web nueva llega sola, lo nativo hay que instalarlo).
  const apkSinOye = !nativo && oyePhill.enApp();
  const [e, setE] = useState<EstadoOye | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [bajando, setBajando] = useState<{ fase: string; p: number } | null>(null);
  const [probando, setProbando] = useState(false);
  const [oidas, setOidas] = useState<string[]>([]);
  const [parcial, setParcial] = useState('');
  const [nivel, setNivel] = useState(0);
  const [nueva, setNueva] = useState('');
  const probandoRef = useRef(false);
  probandoRef.current = probando;

  const cargar = useCallback(async () => { setE(await oyePhill.estado()); }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // Al volver de una pantalla de Android (permisos, batería) se vuelve a mirar qué quedó dado.
  useEffect(() => {
    if (!nativo) return;
    const volver = () => { if (!document.hidden) void cargar(); };
    document.addEventListener('visibilitychange', volver);
    window.addEventListener('focus', volver);
    return () => { document.removeEventListener('visibilitychange', volver); window.removeEventListener('focus', volver); };
  }, [nativo, cargar]);

  // En vivo: el estado del servicio, lo que oye en la prueba y el nivel del micrófono.
  useEffect(() => {
    if (!nativo) return;
    const quitar = [
      oyePhill.alEstado(x => setE(x)),
      oyePhill.alOir(l => {
        const t = l.texto.trim();
        if (!t) return;
        if (l.fin) { setParcial(''); setOidas(prev => [t, ...prev].slice(0, 5)); } else setParcial(t);
      }),
      oyePhill.alNivel(setNivel),
    ];
    return () => { quitar.forEach(q => q()); };
  }, [nativo]);

  // Al salir de Ajustes la prueba se apaga (usa el micrófono).
  useEffect(() => () => { if (probandoRef.current) void oyePhill.probar(false); }, []);

  // Si el teléfono cortó la prueba (saliste de la app), la pantalla lo sigue.
  useEffect(() => { if (e && !e.probando && probandoRef.current) { setProbando(false); setNivel(0); setParcial(''); } }, [e?.probando]); // eslint-disable-line react-hooks/exhaustive-deps

  const pasos = e ? pasosOye(e) : [];
  const activo = !!e?.activo;
  const apkVieja = nativo && !!e && !e.vosk;
  const puede = !!e && puedeActivar(e);
  const est = e ? textoEstado(e) : null;
  const enPausaManual = e?.motor === 'pausa' && e.detalle === 'pausa';

  const bajar = async () => {
    setAviso(null); setBajando({ fase: 'bajando', p: 0 });
    const r = await oyePhill.bajarModelo((fase, p) => setBajando({ fase, p }));
    setBajando(null);
    if (!r.ok) setAviso({ tipo: 'error', texto: r.error || 'No se pudo bajar el oído.' });
    await cargar();
  };

  const borrar = async () => {
    const si = await confirm({ title: 'Borrar el oído de Phill', message: 'Se apaga «Oye Phill» y se libera el espacio (~50 MB). Podés volver a bajarlo cuando quieras.', confirmText: 'Borrar' });
    if (!si) return;
    setOcupado(true);
    if (probando) { setProbando(false); }
    setE(await oyePhill.borrarModelo());
    await anotar('Oye Phill desactivado (oído borrado)');
    setOcupado(false);
  };

  const activar = async () => {
    setOcupado(true); setAviso(null);
    const r = await oyePhill.iniciar();
    if (!r.ok) { setOcupado(false); setAviso({ tipo: 'error', texto: r.error || 'No se pudo activar.' }); await cargar(); return; }
    await anotar('Oye Phill activado');
    await cargar();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: 'Listo. Salí de la app (con el teléfono desbloqueado) y decí «Oye Phill».' });
  };

  const apagar = async () => {
    setOcupado(true); setAviso(null);
    if (probando) { await oyePhill.probar(false); setProbando(false); }
    await oyePhill.detener();
    await anotar('Oye Phill desactivado');
    await cargar();
    setOcupado(false);
    setAviso({ tipo: 'ok', texto: 'Apagado: Phill ya no te escucha.' });
  };

  const reiniciar = async () => {
    setOcupado(true); setAviso(null);
    await oyePhill.detener();
    const r = await oyePhill.iniciar();
    if (!r.ok) setAviso({ tipo: 'error', texto: r.error || 'No se pudo reiniciar.' });
    await cargar();
    setOcupado(false);
  };

  const pedir = async (id: string) => {
    setAviso(null);
    if (id === 'mic') { setE(await oyePhill.pedirMicrofono()); return; }
    if (id === 'notif') {
      await pedirPermisoNotificaciones().catch(() => { /* se abre la pantalla de Android */ });
      const x = await oyePhill.estado();
      setE(x);
      if (!x.notificaciones) await oyePhill.abrirAjuste('notificaciones');
      return;
    }
    const cual: AjusteAndroid = id === 'overlay' ? 'overlay' : id === 'bateria' ? 'bateria' : 'app';
    await oyePhill.abrirAjuste(cual);
  };

  const guardar = async (cambio: { frases?: string[]; sensibilidad?: Sens }) => { setE(await oyePhill.configurar(cambio)); };

  const agregar = async (texto: string) => {
    setAviso(null);
    const f = limpiarFrase(texto);
    if (!esFraseUtil(f)) { setAviso({ tipo: 'error', texto: `Usá de ${FRASE_MIN_PALABRAS} a ${FRASE_MAX_PALABRAS} palabras, por ejemplo «oye fil».` }); return; }
    const actuales = e?.frases || [];
    const lista = frasesValidas([...actuales, f]);
    if (lista.length === actuales.length) { setAviso({ tipo: 'error', texto: actuales.length >= FRASES_MAX ? `Ya hay ${FRASES_MAX} formas: borrá alguna para agregar otra.` : 'Esa forma ya está.' }); return; }
    await guardar({ frases: lista });
    setNueva('');
    const v = await oyePhill.vocabulario([f]);
    if (v.sabe && v.desconocidas.length) setAviso({ tipo: 'error', texto: `Al oído no le suena «${v.desconocidas.join('», «')}»: esa forma no se va a usar. Probá con «Probar» y agregá lo que entiende.` });
    else setAviso({ tipo: 'ok', texto: `Agregado: «${f}».` });
  };

  const quitar = async (f: string) => {
    const resto = (e?.frases || []).filter(x => x !== f);
    if (!resto.length) return;
    await guardar({ frases: resto });
  };

  const alternarPrueba = async () => {
    setAviso(null);
    if (probando) { await oyePhill.probar(false); setProbando(false); setNivel(0); setParcial(''); await cargar(); return; }
    setOidas([]); setParcial('');
    const r = await oyePhill.probar(true);
    if (!r.ok) { setAviso({ tipo: 'error', texto: r.error || 'No se pudo probar.' }); return; }
    setProbando(true);
  };

  const titulo = apkSinOye ? 'Hace falta la APK nueva'
    : !nativo ? 'Se activa desde la app del teléfono'
    : apkVieja ? 'Hace falta la APK nueva'
      : activo ? 'Activado en este teléfono' : 'Apagado en este teléfono';

  return (
    <div className="ai-aj">
      <h4>Oye Phill <small>llamalo con la voz · sin internet</small></h4>
      <div className="ai-modu">
        <span className="ai-modu-ic"><AudioLines className="w-4 h-4" /></span>
        <span className="ai-modu-t">
          <b>{titulo}</b>
          <span>Decí «Oye Phill» y se abre en manos libres, aunque la app esté cerrada. Te escucha dentro del teléfono, sin internet: lo que oye mientras espera no sale del aparato ni se guarda. Se abre con tu sesión, sin pedir la huella (como el mini-widget).</span>
        </span>
        {nativo && !apkVieja && e && (
          <button type="button" role="switch" aria-checked={activo} className="ai-sw" data-on={activo || undefined}
            disabled={ocupado || !!bajando || (!activo && !puede)} onClick={() => void (activo ? apagar() : activar())} aria-label="«Oye Phill» en este teléfono" />
        )}
      </div>

      {nativo && !apkVieja && e && est && (activo || e.probando || est.tono === 'error') && (
        <p className="ai-oye-estado" data-tono={est.tono} role="status">
          {est.tono === 'error' ? <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" /> : est.tono === 'ok' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : null}
          <span>{est.texto}</span>
        </p>
      )}

      {nativo && !apkVieja && e && (!activo || pasos.some(p => !p.hecho)) && (
        <div className="ai-oye-pasos">
          {pasos.map(p => (
            <div key={p.id} className="ai-oye-paso" data-hecho={p.hecho || undefined}>
              <span className="ai-oye-paso-ic" aria-hidden="true">{p.hecho ? <Check className="w-3.5 h-3.5" /> : <i />}</span>
              <span className="ai-oye-paso-t">
                <b>{p.titulo}{!p.obligatorio && !p.hecho && <em> · recomendado</em>}</b>
                <span>{p.detalle}</span>
                {p.id === 'modelo' && bajando && (
                  <>
                    <span className="ai-oye-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bajando.p * 100)}><i style={{ width: `${Math.round(bajando.p * 100)}%` }} /></span>
                    <span>{bajando.fase === 'descomprimiendo' ? 'Preparándolo…' : 'Bajando…'} {Math.round(bajando.p * 100)}%</span>
                  </>
                )}
              </span>
              {!p.hecho && p.id === 'modelo' && (bajando
                ? <button type="button" className="ai-chip" onClick={() => void oyePhill.cancelarBajada()}><X className="w-4 h-4" />Cancelar</button>
                : <button type="button" className="ai-chip" data-primario onClick={() => void bajar()}><Download className="w-4 h-4" />Bajar</button>)}
              {!p.hecho && p.id !== 'modelo' && (
                <button type="button" className="ai-chip" onClick={() => void pedir(p.id)}>{p.id === 'mic' || p.id === 'notif' ? 'Permitir' : 'Abrir ajustes'}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {nativo && !apkVieja && e?.modeloListo && (
        <>
          <div className="ai-oye-sub">Tu llamado</div>
          <div className="ai-oye-frases">
            {e.frases.map(f => (
              <span key={f} className="ai-oye-frase">
                «{f}»
                <button type="button" onClick={() => void quitar(f)} disabled={e.frases.length <= 1} aria-label={`Quitar «${f}»`} title={e.frases.length <= 1 ? 'Tiene que quedar al menos una' : 'Quitar'}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <form className="ai-oye-nueva" onSubmit={ev => { ev.preventDefault(); void agregar(nueva); }}>
            <input value={nueva} onChange={ev => setNueva(ev.target.value)} placeholder="Otra forma de decirlo, p. ej. «oye fiel»" maxLength={40} aria-label="Agregar otra forma de llamar a Phill" enterKeyHint="done" />
            <button type="submit" className="ai-chip" disabled={!nueva.trim()}><Plus className="w-4 h-4" />Agregar</button>
          </form>
          <p className="ai-mw-nota">«Phill» suena «fil» en español: el oído a veces lo escucha distinto. Si no te responde, usá «Probar», decí «Oye Phill» y tocá «Usar» en lo que más se parezca.</p>

          <div className="ai-oye-sub">Qué tan exigente</div>
          <div className="ai-seg ai-seg-voz" role="radiogroup" aria-label="Qué tan exigente es el llamado">
            {SENSIBILIDADES.map(s => (
              <button key={s.id} type="button" role="radio" aria-checked={e.sensibilidad === s.id} data-on={e.sensibilidad === s.id || undefined} onClick={() => void guardar({ sensibilidad: s.id })}>{s.nombre}</button>
            ))}
          </div>
          <p className="ai-mw-nota">{SENSIBILIDADES.find(s => s.id === e.sensibilidad)?.ayuda}</p>

          <div className="ai-mw-acc">
            <button type="button" className="ai-chip" data-primario={probando || undefined} disabled={ocupado || !!bajando || !e.permisoMic} onClick={() => void alternarPrueba()}>
              {probando ? <><Square className="w-4 h-4" />Terminar la prueba</> : <><Play className="w-4 h-4" />Probar cómo me oye</>}
            </button>
            {activo && (e.motor === 'error' || !e.servicio) && (
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void reiniciar()}><RefreshCcw className="w-4 h-4" />Reiniciar</button>
            )}
            {activo && e.servicio && e.motor !== 'error' && (
              <button type="button" className="ai-chip" disabled={ocupado} onClick={() => void oyePhill.pausar(enPausaManual ? false : true).then(cargar)}>
                {enPausaManual ? <><Play className="w-4 h-4" />Seguir</> : <><Pause className="w-4 h-4" />Pausar 1 hora</>}
              </button>
            )}
          </div>

          {probando && (
            <div className="ai-oye-prueba" role="region" aria-label="Prueba del oído">
              <span>Decí «Oye Phill» y mirá cómo te oye. Si se parece, tocá «Usar».</span>
              <span className="ai-oye-nivel" aria-hidden="true"><i style={{ width: `${Math.round(nivel * 100)}%` }} /></span>
              <div className="ai-oye-lineas" aria-live="polite">
                {parcial && <span className="ai-oye-linea" data-parcial>…<q>{lineaDePrueba(parcial).texto}</q></span>}
                {oidas.map((t, i) => {
                  const l = lineaDePrueba(t);
                  return (
                    <span key={`${i}-${t}`} className="ai-oye-linea">
                      <q>{l.texto}</q>
                      {l.sirve && !(e.frases || []).some(f => f === limpiarFrase(l.texto)) && <button type="button" className="ai-chip" onClick={() => void agregar(l.texto)}><Plus className="w-4 h-4" />Usar</button>}
                      {l.sirve && (e.frases || []).some(f => f === limpiarFrase(l.texto)) && <Check className="w-4 h-4" aria-label="Ya está en tu llamado" />}
                    </span>
                  );
                })}
                {!parcial && oidas.length === 0 && <span className="ai-oye-vacio">Todavía no oí nada.</span>}
              </div>
            </div>
          )}

          {activo && !probando && e.ultimoOido && (
            <p className="ai-mw-nota">Lo último que oyó: «{lineaDePrueba(e.ultimoOido).texto}» ({e.ultimaDecision || 'sin decisión'}).</p>
          )}

          <div className="ai-mw-acc">
            <button type="button" className="ai-chip" disabled={ocupado || !!bajando} onClick={() => void borrar()}>Borrar el oído ({e.modeloMB || '~50'} MB)</button>
          </div>
        </>
      )}

      {(apkVieja || apkSinOye) && <p className="ai-mw-nota">Instalá la APK nueva (la de la última compilación) y volvé aquí para activarlo.</p>}
      {!nativo && !apkSinOye && <p className="ai-mw-nota">Abrí Phill en la app del teléfono → Ajustes → Oye Phill.</p>}
      {nativo && !apkVieja && (
        <p className="ai-mw-nota">Escucha solo con el teléfono desbloqueado y la pantalla encendida; se calla mientras tenés Phill abierto, en llamadas y cuando lo pausás. Si perdés el teléfono, bloquearlo o cerrar sesión también lo apaga. Después de «Oye Phill», Phill funciona como siempre (ahí sí se usa internet).</p>
      )}
      {aviso && <p className="ai-mw-aviso" data-tipo={aviso.tipo} role="status">{aviso.texto}</p>}
    </div>
  );
}
