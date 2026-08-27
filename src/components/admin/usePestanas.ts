// =====================================================================
// PESTAÑAS DEL PANEL — el estado de "qué hay abierto"
// =====================================================================
// El panel pasa de tener UNA pantalla a la vez a comportarse como un
// navegador: se abren las pestañas que hagan falta, se alterna entre
// ellas y se cierran de una en una.
//
// ---------------------------------------------------------------------
// QUÉ PROBLEMA RESUELVE
// ---------------------------------------------------------------------
// Antes, cambiar de módulo desmontaba el anterior por completo (el
// contenido iba dentro de un `<motion.div key={activeTab}>`, y cambiar
// la `key` en React destruye el árbol y lo vuelve a construir). Eso
// significaba que ir a consultar una existencia en medio de un cobro
// borraba el cobro a medio llenar: al volver, el formulario estaba en
// blanco y había que escribirlo otra vez.
//
// Con pestañas, cada módulo abierto se monta UNA vez y se queda montado.
// Cambiar de pestaña solo cambia cuál se pinta.
//
// ---------------------------------------------------------------------
// UNA PESTAÑA ES UN MÓDULO, NO UNA VISTA
// ---------------------------------------------------------------------
// Decisión deliberada: la pestaña se identifica por el MÓDULO
// (`inventario_productos`, `cobros`…), no por la carpeta. Si se
// identificara por carpeta, pasear por las cinco vistas de Inventario
// dejaría cinco pestañas abiertas del mismo módulo y la barra se
// llenaría sola en un minuto.
//
// La carpeta abierta dentro de cada módulo se recuerda aparte, en
// `carpetaPorModulo`: al volver a la pestaña de Inventario, se vuelve a
// la vista en la que se estaba, no a la primera.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { resolverModulo, resolverCarpeta } from './adminNav';

/** Módulo que siempre está abierto y que no se puede cerrar. */
export const PESTANA_INICIAL = 'dashboard';

/**
 * Cuántas pestañas se permiten a la vez.
 *
 * Existe un tope porque cada pestaña abierta es un módulo montado
 * consumiendo memoria y suscripciones de Realtime. Ocho es holgado para
 * el trabajo real —nadie usa ocho módulos a la vez— y evita que la barra
 * acabe con veinte pestañas de dos letras cada una.
 */
export const MAX_PESTANAS = 8;

export interface EstadoPestanas {
  /** Módulos abiertos, en el orden en que se abrieron. */
  abiertas: string[];
  /** El módulo que se está viendo. */
  activa: string;
  /** El `activeTab` completo: incluye la carpeta abierta del módulo activo. */
  tabActivo: string;
  /** Abre el módulo que corresponda al tab, o lo activa si ya estaba. */
  abrir: (tab: string) => void;
  /** Cierra una pestaña. La inicial no se cierra. */
  cerrar: (modulo: string) => void;
  /** Cierra todas menos la inicial. */
  cerrarTodas: () => void;
  /** El `activeTab` de un módulo abierto, con su carpeta recordada. */
  tabDe: (modulo: string) => string;
  /** Si el módulo ya se abrió alguna vez (y por tanto está montado). */
  estaAbierta: (modulo: string) => boolean;
}

export function usePestanas(tabInicial: string): EstadoPestanas {
  // El módulo con el que arranca la sesión. Normalmente el panel
  // general; si se entró por /admin/<algo>, ese módulo — un enlace
  // compartido tiene que abrir lo que promete.
  const moduloInicial = resolverModulo(tabInicial).id;

  const [abiertas, setAbiertas] = useState<string[]>(() =>
    moduloInicial === PESTANA_INICIAL ? [PESTANA_INICIAL] : [PESTANA_INICIAL, moduloInicial]
  );
  const [activa, setActiva] = useState<string>(moduloInicial);

  // Carpeta abierta dentro de cada módulo. Se guarda en una ref y no en
  // estado porque cambiarla NO debe repintar la barra de pestañas: la
  // pestaña sigue diciendo "Inventario" tanto si se mira Productos como
  // si se mira Repuestos.
  const carpetaPorModulo = useRef<Record<string, string>>({});
  // Se siembra con la carpeta que venía en la URL, si venía alguna.
  const carpetaInicial = resolverCarpeta(tabInicial);
  if (carpetaInicial && !carpetaPorModulo.current[moduloInicial]) {
    carpetaPorModulo.current[moduloInicial] = carpetaInicial.tab;
  }

  // Se fuerza un repintado cuando cambia la carpeta activa, porque el
  // CONTENIDO sí depende de ella aunque la barra no.
  const [, repintar] = useState(0);

  const tabDe = useCallback((modulo: string) => {
    return carpetaPorModulo.current[modulo] || modulo;
  }, []);

  const abrir = useCallback((tab: string) => {
    const modulo = resolverModulo(tab).id;
    const carpeta = resolverCarpeta(tab);

    // Si el destino es una carpeta concreta, se recuerda para ese módulo.
    // Si es el módulo "a secas" y ya había una carpeta recordada, se
    // respeta: volver a una pestaña devuelve a donde se estaba.
    if (carpeta && carpeta.tab === tab) {
      carpetaPorModulo.current[modulo] = tab;
    }

    setAbiertas(prev => {
      if (prev.includes(modulo)) return prev;
      // Al llegar al tope se descarta la más antigua que NO sea la
      // inicial ni la que se acaba de activar.
      const siguiente = [...prev, modulo];
      if (siguiente.length <= MAX_PESTANAS) return siguiente;
      const sacrificable = siguiente.find(m => m !== PESTANA_INICIAL && m !== modulo);
      return sacrificable ? siguiente.filter(m => m !== sacrificable) : siguiente;
    });
    setActiva(modulo);
    repintar(n => n + 1);
  }, []);

  const cerrar = useCallback((modulo: string) => {
    if (modulo === PESTANA_INICIAL) return;
    setAbiertas(prev => {
      const idx = prev.indexOf(modulo);
      if (idx === -1) return prev;
      const siguiente = prev.filter(m => m !== modulo);
      // Al cerrar la pestaña que se está viendo, se pasa a la vecina de
      // la izquierda — que es lo que hace cualquier navegador y lo que
      // la mano ya espera.
      setActiva(actual => {
        if (actual !== modulo) return actual;
        return siguiente[Math.max(0, idx - 1)] || PESTANA_INICIAL;
      });
      return siguiente;
    });
    // La carpeta recordada muere con la pestaña: reabrirla debe entrar
    // por la vista principal, no por donde se quedó hace dos horas.
    delete carpetaPorModulo.current[modulo];
  }, []);

  const cerrarTodas = useCallback(() => {
    setAbiertas([PESTANA_INICIAL]);
    setActiva(PESTANA_INICIAL);
    carpetaPorModulo.current = {};
  }, []);

  const estaAbierta = useCallback((modulo: string) => abiertas.includes(modulo), [abiertas]);

  return {
    abiertas,
    activa,
    tabActivo: tabDe(activa),
    abrir,
    cerrar,
    cerrarTodas,
    tabDe,
    estaAbierta,
  };
}

/**
 * Recuerda dónde estaba el scroll de cada pestaña y lo devuelve al
 * volver.
 *
 * Hace falta porque las pestañas inactivas se ocultan con
 * `display: none`, y un elemento sin caja no conserva su `scrollTop`: sin
 * esto, volver a una pestaña donde se había bajado veinte filas
 * devolvía siempre al principio de la lista.
 */
export function useScrollPorPestana(activa: string, contenedor: RefObject<HTMLElement | null>) {
  const posiciones = useRef<Record<string, number>>({});
  const anterior = useRef<string>(activa);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;

    // Se guarda lo del que se acaba de dejar y se restaura lo del nuevo.
    if (anterior.current !== activa) {
      posiciones.current[anterior.current] = el.scrollTop;
      anterior.current = activa;
    }
    el.scrollTop = posiciones.current[activa] || 0;
  }, [activa, contenedor]);

  // Mientras se está dentro de una pestaña se anota su posición, para
  // que también sobreviva a cerrar y reabrir otra.
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    let pendiente = 0;
    const alDesplazar = () => {
      // Se anota en el siguiente cuadro y no en cada evento: el scroll
      // dispara decenas de veces por segundo y escribir en un objeto en
      // cada uno es trabajo tirado en el hilo principal.
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = 0;
        posiciones.current[activa] = el.scrollTop;
      });
    };
    el.addEventListener('scroll', alDesplazar, { passive: true });
    return () => {
      el.removeEventListener('scroll', alDesplazar);
      if (pendiente) cancelAnimationFrame(pendiente);
    };
  }, [activa, contenedor]);
}
