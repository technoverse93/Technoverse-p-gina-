// =====================================================================
// FLUJO DE VOZ — Javier habla mientras la respuesta todavía llega
// =====================================================================
// La respuesta llega en trozos (eventos «texto» de la función). En vez de
// esperar a que termine para empezar a hablar, este módulo va sacando
// ORACIONES COMPLETAS apenas se forman: la primera se dice a los ~1–2 s y
// el resto se va diciendo mientras sigue llegando.
//
//  · Una oración está completa cuando después del punto (o ?, !, …, :, ;)
//    llegó un espacio o un salto de línea (así «3.5» o «₡12.500» no se
//    parten) y no es una abreviatura («Sr.», «Dra.», «etc.»).
//  · Las tablas y los bloques de código no se leen: se avisa al final que
//    están en pantalla (igual que paraHablar, ver textoHablado.ts).
//  · Una frase larga sin punto se corta en la coma; y la PRIMERA se corta
//    antes (en la primera coma razonable) para que el audio salga cuanto antes.
// Lógica pura: se prueba sin navegador (ver los scripts de prueba).
// =====================================================================

import { enOraciones, esFinDeOracion, limpiarInline, MAX_CARACTERES } from './textoHablado';

export interface FlujoHabla {
  /** Suma texto nuevo (markdown, tal como llega). Devuelve las oraciones que quedaron completas. */
  agregar(delta: string): string[];
  /**
   * El texto se quedó quieto: saca lo que esté esperando. Con `todo`, la respuesta está
   * completa (aunque falte cerrar) y sale hasta lo último; sin `todo`, solo si lo pendiente
   * ya terminó en punto, pregunta o exclamación.
   */
  vaciar(todo?: boolean): string[];
  /** Fin del texto: devuelve lo que faltaba y los avisos («te dejé una tabla en pantalla»). */
  cerrar(): string[];
  /** El texto se borró y vuelve a empezar (otro modelo, revisión). */
  reiniciar(): void;
  /** Caracteres recibidos desde el último reinicio. */
  recibido(): number;
}

/** Hasta dónde (índice, exclusive) hay oraciones completas en una línea en curso. 0 si ninguna. */
function corteDeOraciones(linea: string, desde: number): number {
  let ultimo = 0;
  for (let i = Math.max(desde, 0); i < linea.length - 1; i++) if (esFinDeOracion(linea, i)) ultimo = i + 1;
  return ultimo;
}

/** La última coma (con espacio después) hasta `limite`: no se corta «1,5 millones». */
function ultimaComa(linea: string, limite: number): number {
  for (let i = Math.min(limite, linea.length - 2); i >= 0; i--) if (linea[i] === ',' && /\s/.test(linea[i + 1])) return i;
  return -1;
}

/** El prefijo de lista («1. », «- ») que no cuenta como final de oración. */
function largoMarcador(linea: string): number {
  const m = /^\s*(?:\d+[.)]|[-*•>#]+)\s+/.exec(linea);
  return m ? m[0].length : 0;
}

export function crearFlujoHabla(opciones: { maxCaracteres?: number } = {}): FlujoHabla {
  const tope = opciones.maxCaracteres ?? MAX_CARACTERES;
  let bruto = '';
  let pos = 0;                 // hasta dónde se procesó `bruto`
  let enCodigo = false, hayTabla = false, hayCodigo = false;
  let dichos = 0;              // caracteres ya entregados para decir
  let cortado = false;         // pasó el tope: no se dice más
  let primera = true;          // todavía no salió ninguna oración
  let cerrado = false;

  const entregar = (s: string, salida: string[]) => {
    const t = s.trim();
    // Sin una letra o un número no hay nada que decir («1.», «—»).
    if (!t || !/[\p{L}\p{N}]/u.test(t) || /^\d+[.)]?$/.test(t)) return;
    if (dichos + t.length > tope) { cortado = true; return; }
    dichos += t.length + 1;
    primera = false;
    salida.push(t);
  };
  const decirTexto = (trozo: string, salida: string[]) => {
    if (cortado) return;
    // La numeración de una lista («1. ») no se lee: las pausas ya separan los puntos.
    const limpio = limpiarInline(trozo).replace(/^\s*\d+[.)]\s+/gm, '').replace(/\n+/g, ' ').trim();
    for (const o of enOraciones(limpio)) entregar(o, salida);
  };
  const lineaCompleta = (linea: string, salida: string[]) => {
    if (/^\s*```/.test(linea)) { enCodigo = !enCodigo; if (enCodigo) hayCodigo = true; return; }
    if (enCodigo) return;
    if (/^\s*\|.*\|\s*$/.test(linea)) { hayTabla = true; return; }
    if (!linea.trim()) return;
    decirTexto(linea, salida);
  };

  const procesar = (final: boolean): string[] => {
    const salida: string[] = [];
    while (pos < bruto.length && !cortado) {
      const nl = bruto.indexOf('\n', pos);
      if (nl >= 0) { const l = bruto.slice(pos, nl); pos = nl + 1; lineaCompleta(l, salida); continue; }
      const resto = bruto.slice(pos);
      if (final) { pos = bruto.length; lineaCompleta(resto, salida); break; }
      // Línea en curso: dentro de código, o que parece tabla o cerco de código, espera al salto.
      if (enCodigo || /^\s*(?:`{1,3}|\|)/.test(resto)) break;
      let corte = corteDeOraciones(resto, largoMarcador(resto));
      // Una frase larga sin punto: se corta en la coma. La primera, apenas hay un poco de
      // texto (para que el audio salga ya); las demás, solo si se alargan mucho.
      if (!corte) {
        if (primera && resto.length >= 50) {
          const c = ultimaComa(resto, resto.length - 2);
          if (c >= 24) corte = c + 1;
        } else if (!primera && resto.length >= 240) {
          const c = ultimaComa(resto, 240);
          if (c > 80) corte = c + 1;
          else { const e = resto.lastIndexOf(' ', 240); if (e > 80) corte = e; }
        }
      }
      if (corte > 0) { const trozo = resto.slice(0, corte); pos += corte; decirTexto(trozo, salida); }
      break;
    }
    return salida;
  };

  return {
    agregar(delta: string): string[] {
      if (cerrado || !delta) return [];
      bruto += delta;
      return procesar(false);
    },
    vaciar(todo = false): string[] {
      if (cerrado || cortado) return [];
      const resto = bruto.slice(pos);
      if (!resto.trim() || enCodigo || /^\s*(?:`{1,3}|\|)/.test(resto)) return [];
      if (!todo && !/[.!?…]\s*$/.test(resto)) return [];
      const salida: string[] = [];
      pos = bruto.length;
      lineaCompleta(resto, salida);
      return salida;
    },
    cerrar(): string[] {
      if (cerrado) return [];
      const salida = procesar(true);
      cerrado = true;
      if (cortado) salida.push('El resto está en pantalla.');
      if (hayTabla) salida.push('Te dejé una tabla en pantalla.');
      if (hayCodigo) salida.push('Te dejé un bloque de código en pantalla.');
      return salida;
    },
    reiniciar(): void {
      bruto = ''; pos = 0; enCodigo = false; hayTabla = false; hayCodigo = false; dichos = 0; cortado = false; primera = true; cerrado = false;
    },
    recibido: () => bruto.length,
  };
}
