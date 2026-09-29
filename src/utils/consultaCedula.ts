// =====================================================================
// AUTOCOMPLETAR POR IDENTIFICACIÓN
// =====================================================================
// Al escribir una cédula completa se buscan, en este orden:
//
//   1. El HISTORIAL propio (`invoices`): si ese cliente ya compró, salen
//      su nombre y su correo. Solo el personal puede leerlo (RLS), así
//      que en la tienda pública esta capa simplemente no devuelve nada.
//   2. HACIENDA, por la Edge Function `consultar-cedula`: nombre y tipo
//      con los que está inscrita la persona o empresa.
//
// Lo que ninguna fuente tiene es el teléfono: Hacienda no lo publica y la
// factura no lo guarda. Ese campo sigue siendo manual, y la pantalla lo
// dice en vez de dejarlo parecer un olvido.
//
// NADA del cobro depende de esto. Si Hacienda no responde, la consulta
// termina en un mensaje y el formulario se llena a mano como siempre.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { detectarTipo, motivoInvalida, type TipoIdentificacion } from './identificacionCR';

export interface DatosEncontrados {
  nombre?: string;
  correo?: string;
  tipo?: TipoIdentificacion;
  /** De dónde salió cada cosa, para decírselo a quien cobra. */
  fuentes: Array<'historial' | 'hacienda'>;
  /** Estado tributario que informa Hacienda (p. ej. "Inscrito"), si lo hay. */
  situacion?: string;
}

export type EstadoConsulta = 'inactivo' | 'buscando' | 'encontrado' | 'noEncontrado' | 'error';

export interface ResultadoConsulta {
  estado: EstadoConsulta;
  datos?: DatosEncontrados;
  mensaje?: string;
}

const CACHE = new Map<string, DatosEncontrados | null>();

async function desdeHistorial(id: string): Promise<Partial<DatosEncontrados> | null> {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('customer_name, customer_email, customer_identification_type')
      .eq('customer_identification', id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    const f = data[0] as any;
    return {
      nombre: f.customer_name || undefined,
      correo: f.customer_email || undefined,
      tipo: (f.customer_identification_type as TipoIdentificacion) || undefined,
    };
  } catch {
    return null;
  }
}

/** Devuelve `null` si no está en Hacienda; lanza si Hacienda no se pudo consultar. */
async function desdeHacienda(id: string): Promise<Partial<DatosEncontrados> | null> {
  const { data, error } = await supabase.functions.invoke('consultar-cedula', { body: { identificacion: id } });
  if (error || !data?.ok) {
    throw new Error(data?.error || 'No se pudo consultar Hacienda.');
  }
  if (!data.encontrado) return null;
  const tipo = ['01', '02', '03', '04'].includes(data.tipo) ? (data.tipo as TipoIdentificacion) : undefined;
  return { nombre: data.nombre || undefined, tipo, situacion: data.estado || undefined };
}

export async function consultarIdentificacion(
  id: string,
  opciones: { usarHistorial: boolean },
): Promise<ResultadoConsulta> {
  const llave = `${opciones.usarHistorial ? 'p' : 't'}:${id}`;
  if (CACHE.has(llave)) {
    const previo = CACHE.get(llave)!;
    return previo ? { estado: 'encontrado', datos: previo } : { estado: 'noEncontrado' };
  }

  const [historial, hacienda] = await Promise.allSettled([
    opciones.usarHistorial ? desdeHistorial(id) : Promise.resolve(null),
    desdeHacienda(id),
  ]);

  const h = historial.status === 'fulfilled' ? historial.value : null;
  const g = hacienda.status === 'fulfilled' ? hacienda.value : null;

  if (!h && !g) {
    // Distinguir "no está" de "no se pudo mirar": decirle a alguien que su
    // cédula no existe porque Hacienda estaba caída sería un error nuestro.
    if (hacienda.status === 'rejected') {
      return {
        estado: 'error',
        mensaje: 'No se pudo consultar Hacienda ahora mismo. Complete los datos a mano.',
      };
    }
    CACHE.set(llave, null);
    return { estado: 'noEncontrado' };
  }

  const fuentes: DatosEncontrados['fuentes'] = [];
  if (h) fuentes.push('historial');
  if (g) fuentes.push('hacienda');

  // El nombre de Hacienda manda sobre el del historial: es el registrado
  // y el que el comprobante debe llevar. El correo solo puede venir del
  // historial.
  const datos: DatosEncontrados = {
    nombre: g?.nombre || h?.nombre,
    correo: h?.correo,
    tipo: g?.tipo || h?.tipo,
    situacion: g?.situacion,
    fuentes,
  };
  CACHE.set(llave, datos);
  return { estado: 'encontrado', datos };
}

interface OpcionesHook {
  /** Identificación en dígitos, sin guiones. */
  digitos: string;
  /** Tipo elegido; sirve para no buscar una cédula que ya se sabe inválida. */
  tipo: TipoIdentificacion;
  usarHistorial: boolean;
  /** Se llama UNA vez por cédula, cuando llegan datos. */
  onDatos: (d: DatosEncontrados) => void;
  /** Apagarlo (p. ej. si el campo es opcional y está vacío). */
  activo?: boolean;
}

/**
 * Busca sola cuando la identificación está completa.
 *
 * Espera un instante tras la última tecla (no dispara con cada dígito) y
 * descarta respuestas de una cédula que ya no es la escrita: sin eso, una
 * consulta lenta de la cédula anterior pisaría los datos de la actual.
 */
export function useConsultaIdentificacion({ digitos, tipo, usarHistorial, onDatos, activo = true }: OpcionesHook) {
  const [resultado, setResultado] = useState<ResultadoConsulta>({ estado: 'inactivo' });
  const alLlegar = useRef(onDatos);
  alLlegar.current = onDatos;
  const ultimaAplicada = useRef('');
  const vuelo = useRef(0);

  const buscar = async (id: string) => {
    const mio = ++vuelo.current;
    setResultado({ estado: 'buscando' });
    const r = await consultarIdentificacion(id, { usarHistorial });
    if (mio !== vuelo.current) return;   // ya se escribió otra cédula
    setResultado(r);
    if (r.estado === 'encontrado' && r.datos && ultimaAplicada.current !== id) {
      ultimaAplicada.current = id;
      alLlegar.current(r.datos);
    }
  };

  useEffect(() => {
    // Una cédula incompleta o inválida no se manda a ningún lado.
    const completa = detectarTipo(digitos) !== null && motivoInvalida(tipo, digitos) === null;
    if (!activo || !completa) {
      vuelo.current++;
      setResultado({ estado: 'inactivo' });
      return;
    }
    const t = setTimeout(() => { void buscar(digitos); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitos, tipo, activo]);

  return {
    resultado,
    /** Reintento manual (botón «Buscar»). */
    buscarAhora: () => { ultimaAplicada.current = ''; void buscar(digitos); },
    /** Olvida lo aplicado: para cuando se limpia el formulario. */
    reiniciar: () => { ultimaAplicada.current = ''; vuelo.current++; setResultado({ estado: 'inactivo' }); },
  };
}
