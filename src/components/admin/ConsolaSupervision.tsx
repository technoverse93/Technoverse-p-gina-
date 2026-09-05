// =====================================================================
// CONSOLA DE SUPERVISIÓN (Zero Trust · Etapa 3)
// =====================================================================
// El "espejo virtual": lista quién está en línea y, al elegir a alguien,
// reproduce su pantalla en vivo con rrweb. Exclusiva del Superadmin (RLS +
// gate en AdminPanel).
//
// Flujo: al elegir a un empleado se pone `watch = true` en su fila. Eso le
// dice a SU cliente que empiece a grabar (ver grabador.ts).
//
// ---------------------------------------------------------------------
// POR DÓNDE LLEGAN LOS FOTOGRAMAS
// ---------------------------------------------------------------------
// Camino rápido: BROADCAST en el canal privado `espejo:<id>`. No toca la
// base, así que el fotograma llega prácticamente en el acto. Vienen
// comprimidos y troceados; aquí se reensamblan y se descomprimen.
//
// Camino de respaldo: los INSERT de `supervision_events`, que es como
// funcionaba antes. Solo se usa si el canal privado no se pudo
// establecer. Se escuchan los dos a la vez: si el rápido funciona, el
// lento nunca llega, porque el grabador no lo usa.
// =====================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Smartphone, Monitor, RefreshCw, Radio } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { soloHora } from '../chat/formatoChat';

interface Presencia {
  user_id: string;
  email: string | null;
  ruta: string | null;
  entorno: string | null;
  last_seen: string;
  watch: boolean;
}

const ONLINE_MS = 40000;

export default function ConsolaSupervision() {
  const [gente, setGente] = useState<Presencia[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [estado, setEstado] = useState<'idle' | 'esperando' | 'vivo'>('idle');
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const lienzoRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<any>(null);
  const iniciandoRef = useRef(false);
  const colaRef = useRef<any[]>([]);
  const canalEventosRef = useRef<any>(null);
  const canalEspejoRef = useRef<any>(null);
  const trozosRef = useRef<Map<string, { n: number; partes: string[] }>>(new Map());
  // Cuando el usuario cambia de tema, el espejo debe REMONTARSE con la
  // foto nueva en vez de intentar parchear el DOM viejo.
  const remontarRef = useRef(false);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  // --------------------------- Presencia ---------------------------
  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('supervision_state')
      .select('user_id, email, ruta, entorno, last_seen, watch')
      .order('last_seen', { ascending: false });
    const filas = (data as Presencia[]) || [];
    setGente(filas);
    return filas;
  }, []);

  useEffect(() => {
    cargar();
    const canal = supabase
      .channel('supervision-presencia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supervision_state' }, () => cargar())
      .subscribe();
    const t = setInterval(cargar, 12000);
    return () => { supabase.removeChannel(canal); clearInterval(t); };
  }, [cargar]);

  const enLinea = (p: Presencia) => Date.now() - new Date(p.last_seen).getTime() < ONLINE_MS;

  // --------------------------- Escala del espejo ---------------------------
  const ajustarEscala = useCallback((w: number, h: number) => {
    const cont = lienzoRef.current;
    if (!cont || !w || !h) return;
    const escala = Math.min(1, cont.clientWidth / w);
    const wrap = cont.querySelector('.replayer-wrapper') as HTMLElement | null;
    if (wrap) {
      wrap.style.transform = `scale(${escala})`;
      wrap.style.transformOrigin = 'top left';
    }
    cont.style.height = `${Math.round(h * escala)}px`;
  }, []);

  // --------------------------- Reproductor ---------------------------
  const destruirReplayer = useCallback(() => {
    try { replayerRef.current?.pause?.(); } catch { /* nada */ }
    replayerRef.current = null;
    colaRef.current = [];
    trozosRef.current.clear();
    if (lienzoRef.current) lienzoRef.current.innerHTML = '';
  }, []);

  // Arranca el reproductor SOLO cuando ya tenemos una foto completa
  // (evento tipo 2). rrweb no puede pintar el interior sin ella: por eso,
  // si se engancha entre foto y foto, todo el panel se veía en blanco.
  // Como el grabador reenvía una foto cada 12 s, esto se autocura solo.
  const iniciarSiHayFoto = useCallback(async () => {
    if (replayerRef.current || iniciandoRef.current) return;
    const cola = colaRef.current;
    let snap = -1;
    for (let i = cola.length - 1; i >= 0; i--) { if (cola[i]?.type === 2) { snap = i; break; } }
    if (snap === -1) return; // todavía sin foto: seguir esperando
    // rrweb quiere el Meta (tipo 4) justo antes de la foto.
    const desde = (snap > 0 && cola[snap - 1]?.type === 4) ? snap - 1 : snap;
    const eventosIniciales = cola.slice(desde);
    iniciandoRef.current = true;
    try {
      const { Replayer } = await import('rrweb');
      if (!lienzoRef.current) { iniciandoRef.current = false; return; }
      lienzoRef.current.innerHTML = '';
      const r = new Replayer(eventosIniciales, {
        root: lienzoRef.current,
        liveMode: true,
        mouseTail: false,
        speed: 1,
      });
      r.on('resize', (e: any) => ajustarEscala(e?.width, e?.height));
      r.startLive();
      replayerRef.current = r;
      colaRef.current = [];
      setEstado('vivo');
    } catch {
      /* si rrweb no cargó, se queda en "esperando" hasta el próximo checkout */
    } finally {
      iniciandoRef.current = false;
    }
  }, [ajustarEscala]);

  const manejarLote = useCallback((lote: any[]) => {
    if (!Array.isArray(lote) || lote.length === 0) return;

    for (const ev of lote) {
      // Evento propio del grabador (tipo 5) avisando de un cambio de tema:
      // la clase global de <html> cambió, así que el DOM que ya está
      // pintado dejó de ser válido. Se tira el reproductor y se vuelve a
      // montar con la foto completa que viene justo detrás. Sin esto, el
      // panel del supervisado se veía en blanco al pasar a oscuro.
      if (ev?.type === 5 && ev?.data?.tag === 'tema') {
        destruirReplayer();
        remontarRef.current = true;
        continue;
      }

      if (replayerRef.current) {
        try { replayerRef.current.addEvent(ev); } catch { /* evento suelto */ }
        continue;
      }

      // Aún sin reproductor: acumula hasta que llegue una foto completa.
      colaRef.current.push(ev);
      if (colaRef.current.length > 2000) colaRef.current = colaRef.current.slice(-2000);
    }

    if (!replayerRef.current) {
      remontarRef.current = false;
      void iniciarSiHayFoto();
    }
  }, [iniciarSiHayFoto, destruirReplayer]);

  /** Reensambla los trozos del canal rápido y descomprime los eventos. */
  const manejarTrozo = useCallback(async (p: any) => {
    if (!p?.id || typeof p.d !== 'string') return;
    const mapa = trozosRef.current;
    const entrada = mapa.get(p.id) || { n: p.n || 1, partes: [] };
    entrada.partes[p.i || 0] = p.d;
    mapa.set(p.id, entrada);

    const completo = entrada.partes.filter(Boolean).length === entrada.n;
    if (!completo) return;
    mapa.delete(p.id);

    try {
      const crudo = JSON.parse(entrada.partes.join(''));
      const { unpack } = await import('rrweb');
      // El grabador comprime cada evento; `unpack` devuelve el objeto.
      const eventos = (crudo as any[]).map(e => { try { return unpack(e); } catch { return e; } });
      manejarLote(eventos);
    } catch { /* lote corrupto: el próximo checkout lo arregla */ }
  }, [manejarLote]);

  // --------------------------- Enganche / desenganche ---------------------------
  const cerrarCanales = useCallback(() => {
    if (canalEventosRef.current) { try { supabase.removeChannel(canalEventosRef.current); } catch { /* nada */ } canalEventosRef.current = null; }
    if (canalEspejoRef.current) { try { supabase.removeChannel(canalEspejoRef.current); } catch { /* nada */ } canalEspejoRef.current = null; }
  }, []);

  const soltar = useCallback(async (userId: string | null) => {
    cerrarCanales();
    destruirReplayer();
    if (userId) { try { await supabase.from('supervision_state').update({ watch: false }).eq('user_id', userId); } catch { /* nada */ } }
  }, [destruirReplayer, cerrarCanales]);

  /** Abre los dos caminos (rápido y respaldo) y pide la grabación. */
  const engancharA = useCallback(async (userId: string) => {
    setEstado('esperando');

    // Camino rápido: canal privado de broadcast.
    try {
      const espejo = supabase.channel(`espejo:${userId}`, { config: { private: true } });
      espejo.on('broadcast', { event: 'lote' }, (msg: any) => {
        if (selRef.current === userId) void manejarTrozo(msg?.payload);
      });
      espejo.subscribe();
      canalEspejoRef.current = espejo;
    } catch { /* si el canal no se puede abrir, queda el respaldo */ }

    // Camino de respaldo: la tabla, como antes.
    const canal = supabase
      .channel(`supervision-ev-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'supervision_events', filter: `user_id=eq.${userId}` },
        (payload: any) => { if (selRef.current === userId) void manejarLote(payload?.new?.lote || []); })
      .subscribe();
    canalEventosRef.current = canal;

    // Se pide la grabación DESPUÉS de estar escuchando, para no perderse
    // la primera foto.
    try { await supabase.from('supervision_state').update({ watch: true }).eq('user_id', userId); } catch { /* nada */ }
  }, [manejarLote, manejarTrozo]);

  const mirar = useCallback(async (userId: string) => {
    if (sel === userId) { await soltar(userId); setSel(null); setEstado('idle'); return; }
    await soltar(sel);
    setSel(userId);
    await engancharA(userId);
  }, [sel, soltar, engancharA]);

  // --------------------------- Botón "Actualizar" ---------------------------
  // Dos trabajos distintos, según lo que pase de verdad:
  //
  //   a) La ficha quedó colgada porque la persona ya cerró sesión o cerró
  //      la app  → se retira de la lista en el acto.
  //   b) La persona sigue conectada pero el espejo no cargó → se fuerza
  //      una reconexión limpia del canal (se suelta y se vuelve a pedir la
  //      grabación), que es lo que destraba la pantalla.
  const actualizar = useCallback(async () => {
    setRefrescando(true);
    setAviso(null);
    try {
      const filas = await cargar();

      // (a) Barre las fichas que ya no laten. Si alguien solo estaba en
      // segundo plano, vuelve a aparecer con su próximo latido (10 s).
      const caducadas = filas.filter(p => !enLinea(p)).map(p => p.user_id);
      if (caducadas.length > 0) {
        try { await supabase.from('supervision_state').delete().in('user_id', caducadas); } catch { /* nada */ }
        setGente(prev => prev.filter(p => !caducadas.includes(p.user_id)));
      }

      const actual = selRef.current;
      if (!actual) {
        setAviso(caducadas.length > 0 ? `Se retiraron ${caducadas.length} sesión(es) cerradas.` : 'Lista al día.');
        return;
      }

      const fila = filas.find(p => p.user_id === actual);
      if (!fila || !enLinea(fila)) {
        // (a) A quien mirábamos ya no está: se suelta y se quita.
        await soltar(actual);
        setSel(null);
        setEstado('idle');
        setAviso('Esa persona ya cerró sesión. Se quitó de la lista.');
        return;
      }

      // (b) Sigue conectada: reconexión limpia del canal.
      await soltar(actual);
      destruirReplayer();
      await new Promise(r => setTimeout(r, 400));
      await engancharA(actual);
      setAviso('Canal reconectado. Reintentando el espejo…');
    } finally {
      setRefrescando(false);
    }
  }, [cargar, soltar, engancharA, destruirReplayer]);

  // Al desmontar, suelta a quien se esté mirando (para su grabación).
  useEffect(() => () => { void soltar(selRef.current); }, [soltar]);

  const seleccionado = gente.find(p => p.user_id === sel) || null;

  return (
    <div className="tv-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <MonitorPlay className="w-[18px] h-[18px]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-[15px] text-[var(--text-primary)] leading-tight">Supervisión</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)]">Espejo en vivo de la sesión del personal.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {aviso && (
            <span className="hidden sm:block text-[11px] text-[var(--text-secondary)] max-w-[280px] truncate">{aviso}</span>
          )}
          <button
            type="button"
            onClick={() => void actualizar()}
            disabled={refrescando}
            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition disabled:opacity-60"
            aria-label="Actualizar"
          >
            <RefreshCw className={`w-4 h-4 ${refrescando ? 'animate-spin' : ''}`} />
            <span className="text-[11.5px] font-semibold">Actualizar</span>
          </button>
        </div>
      </div>

      {aviso && (
        <p className="sm:hidden text-[11.5px] text-[var(--text-secondary)] -mt-1">{aviso}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        {/* Selector de personal conectado */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sunken)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Conectados</span>
          </div>
          {gente.filter(enLinea).length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-3 py-6 text-center">Nadie del personal en línea.</p>
          ) : (
            gente.filter(enLinea).map(p => {
              const esApk = p.entorno === 'apk';
              const activo = p.user_id === sel;
              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => void mirar(p.user_id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--border-color)]/50 last:border-b-0 transition ${
                    activo ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-sunken)]'
                  }`}
                >
                  <span className="relative shrink-0">
                    <span className="w-8 h-8 rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent)] flex items-center justify-center font-display font-bold text-[12px]">
                      {(p.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--ok)] border-2 border-[var(--bg-surface)]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-[var(--text-primary)] truncate">{p.email || 'desconocido'}</span>
                    <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-secondary)] truncate">
                      {esApk ? <Smartphone className="w-3 h-3 shrink-0" /> : <Monitor className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{p.ruta || '—'}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Espejo */}
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-base)] overflow-hidden min-h-[280px] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text-primary)] truncate">
              {seleccionado ? seleccionado.email : 'Elegí a alguien de la izquierda'}
            </span>
            {estado === 'vivo' && (
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                <Radio className="w-3 h-3 animate-pulse" /> En vivo
              </span>
            )}
            {estado === 'esperando' && (
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-sunken)] text-[var(--text-muted)]">Conectando…</span>
            )}
          </div>

          {/* Lienzo del reproductor. Fondo oscuro neutro para que la
              pantalla replicada resalte sea cual sea el tema. */}
          <div className="flex-1 relative bg-[#0b0f0e] overflow-hidden">
            <div ref={lienzoRef} className="w-full" />
            {estado !== 'vivo' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                <MonitorPlay className="w-9 h-9 text-white/20" />
                <p className="text-[12.5px] text-white/45">
                  {seleccionado ? 'Esperando la señal del dispositivo…' : 'El espejo aparece al elegir a alguien conectado.'}
                </p>
              </div>
            )}
          </div>

          {seleccionado && (
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-surface)] flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <span className="truncate">{seleccionado.ruta || '—'}</span>
              <span className="font-mono tabular-nums shrink-0">visto {soloHora(seleccionado.last_seen)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
