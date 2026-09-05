import { createClient } from '@supabase/supabase-js';
import { cabeceraClientInfo } from './utils/dispositivo';

// Estas llaves son públicas por diseño: la seguridad real la dan las políticas
// RLS (Row Level Security) que ya están activas en cada tabla de Supabase.
const supabaseUrl = 'https://hzatdfrjcqiimgqxcwwh.supabase.co';
const supabaseKey = 'sb_publishable_M7Sw70peDBPoyhTri7abdg_ksB9gCMY';

// =====================================================================
// POR QUÉ SE TOCA LA CABECERA X-Client-Info
// =====================================================================
// Aquí viaja la marca del aparato, y de eso depende que el bloqueo por
// aparato funcione.
//
// El problema que resuelve: la base de datos no puede leer el
// localStorage del navegador, así que no tenía forma de saber QUÉ EQUIPO
// estaba haciendo una compra. El bloqueo solo vivía en Cloudflare, que
// únicamente ve las peticiones de la página web — la APK no pasa por
// ahí. Resultado: un aparato bloqueado seguía comprando desde la APK.
//
// Por qué esta cabecera y no una nueva: supabase-js YA la envía en todas
// sus peticiones, así que reutilizarla no puede provocar un rechazo por
// CORS. Inventar una cabecera nueva sí podía, y si el servidor la
// rechazaba dejaba de funcionar la tienda entera.
//
// El valor se calcula UNA vez al arrancar, no en cada petición: la marca
// no cambia mientras la aplicación está abierta.
// =====================================================================
// =====================================================================
// POR QUÉ SE SUBE EL LÍMITE DE EVENTOS DE REALTIME
// =====================================================================
// supabase-js viene con `eventsPerSecond: 10` por defecto. Ese número no
// es una sugerencia: el cliente ESTRANGULA de verdad lo que manda por el
// socket a diez mensajes por segundo, y encola el resto.
//
// Para el chat da igual —nadie escribe diez mensajes por segundo—, pero
// el espejo de supervisión manda fotogramas del DOM: en cuanto alguien
// escribe rápido o hace scroll, la cola se llena y el espejo se ve con
// retraso aunque la red vaya bien. Era el cuello de botella real del
// "va lentísimo".
//
// 200/s deja pasar el espejo holgado y sigue siendo un techo sano por si
// algo se desbocara.
// =====================================================================
export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    headers: {
      'X-Client-Info': cabeceraClientInfo(),
    },
  },
  realtime: {
    params: { eventsPerSecond: 200 },
  },
});
