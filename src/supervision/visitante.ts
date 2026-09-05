// =====================================================================
// SUPERVISIÓN · lado del CLIENTE que navega la tienda
// =====================================================================
// Hermano de grabador.ts, pero para quien NO es personal: el comprador
// que anda viendo el catálogo, tenga sesión o no, en web o en la APK.
//
// ---------------------------------------------------------------------
// LA REGLA DE PRIVACIDAD, Y CÓMO SE CUMPLE
// ---------------------------------------------------------------------
// Al cliente se le identifica ÚNICA Y EXCLUSIVAMENTE por el MODELO de su
// aparato ("Honor X6b", "SM-A125M", "Tablet"). Nada más.
//
// No se manda —ni existe columna donde guardarlo— correo, nombre, IP ni
// user_id. Aunque el visitante tenga sesión iniciada, aquí no viaja quién
// es. En la consola se lee "un Honor X6b está en /tienda", jamás "Fulano
// está en /tienda". La tabla `supervision_visitantes` está hecha así a
// propósito, para que la regla no dependa de que alguien se acuerde.
//
// El `visita` es el id aleatorio del aparato que la tienda ya usaba para
// sus visitas (utils/dispositivo.ts). Es un número al azar, no una
// identidad.
//
// ALCANCE: rrweb solo ve NUESTRA propia página. No puede leer, ni ve,
// nada de lo que la persona haga fuera de la aplicación.
//
// ---------------------------------------------------------------------
// CÓMO SABE QUE LO MIRAN SIN PODER ESPIAR A NADIE
// ---------------------------------------------------------------------
// El visitante no tiene permiso de lectura sobre la tabla —no puede ver
// a otros visitantes ni ponerse `watch` a sí mismo—. Lo que hace es
// latir: la función `visitante_latido` guarda su presencia y le DEVUELVE
// si el Superadmin pidió su espejo. Ese booleano es lo único que sabe.
// =====================================================================

import { supabase } from '../supabaseClient';
import { obtenerDeviceId } from '../utils/dispositivo';
import { leerDatosDelAparato } from '../utils/huella';
import { crearEspejo, type Espejo } from './motorEspejo';

let latidoTimer: ReturnType<typeof setInterval> | null = null;
let espejo: Espejo | null = null;
let visita: string | null = null;
let modelo = '';
let tipo = '';

function entorno(): string {
  try { if ((window as any)?.Capacitor?.isNativePlatform?.()) return 'apk'; } catch { /* web */ }
  return 'web';
}
function rutaActual(): string {
  try { return (location.pathname || '/') + (location.hash || ''); } catch { return '/'; }
}

async function latir(): Promise<void> {
  if (!visita) return;
  try {
    const { data, error } = await supabase.rpc('visitante_latido', {
      p_visita: visita,
      p_modelo: modelo,
      p_tipo: tipo,
      p_entorno: entorno(),
      p_ruta: rutaActual(),
    });
    if (error) return;

    const quierenVerme = data === true;
    if (quierenVerme && espejo && !espejo.transmitiendo()) await espejo.arrancar();
    else if (!quierenVerme && espejo && espejo.transmitiendo()) await espejo.parar();
  } catch { /* el latido es best-effort: nunca debe estorbar la compra */ }
}

/**
 * Arranca la presencia del visitante. Idempotente y silencioso: si algo
 * falla, la tienda sigue funcionando igual.
 */
export function iniciarVisitante(): void {
  if (typeof window === 'undefined') return;
  detenerVisitante();

  const id = obtenerDeviceId();
  if (!id) return;   // sin almacenamiento no hay a quién atribuir la visita
  visita = id;

  // El modelo se lee una vez: no cambia mientras la app está abierta.
  void leerDatosDelAparato()
    .then(datos => {
      modelo = (datos?.dispositivo || '').trim();
      tipo = (datos?.tipo || '').trim();
    })
    .catch(() => { /* se queda sin modelo: aparecerá como "Aparato" */ })
    .finally(() => {
      espejo = crearEspejo({ topic: `espejo:v:${id}` });
      void latir();
      latidoTimer = setInterval(() => void latir(), 10000);
    });
}

/** Corta presencia y transmisión. */
export function detenerVisitante(): void {
  if (latidoTimer) { clearInterval(latidoTimer); latidoTimer = null; }
  if (espejo) {
    const e = espejo;
    espejo = null;
    void e.parar().finally(() => e.cerrar());
  }
  visita = null;
}
