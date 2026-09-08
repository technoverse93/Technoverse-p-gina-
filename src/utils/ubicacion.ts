// =====================================================================
// UBICACIÓN DEL VISITANTE — GPS real, con su permiso
// =====================================================================
// Hermano de `capturarUbicacionPrecisa` en adminLogin.ts, pero para quien
// NO es personal: el visitante anónimo de la tienda. Antes esa cuenta
// estaba fuera por completo —a un cliente "jamás se le pide"—; ahora el
// mismo interruptor "Ubicación" del aviso de consentimiento gobierna a
// los dos por igual (ver seguridad/consentimiento.ts).
//
// FALLA EN SILENCIO, SIEMPRE
// ---------------------------------------------------------------------
// Si el navegador no tiene geolocalización, si la persona la niega, si
// el GPS no tiene señal o si el guardado falla: no pasa nada. Nunca debe
// afectar la compra ni la navegación por esto.
//
// CUÁNDO SE LLAMA
// ---------------------------------------------------------------------
// Solo desde `visitante.ts`, después de que el primer latido ya creó la
// fila en `supervision_visitantes` — el RPC actualiza esa fila, no la
// crea, así que llamarlo antes no guardaría nada.
// =====================================================================

import { supabase } from '../supabaseClient';

export function capturarUbicacionVisitante(visita: string): void {
  try {
    if (!visita || typeof navigator === 'undefined' || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        supabase.rpc('registrar_ubicacion_visitante', {
          p_visita: visita,
          p_lat: pos.coords.latitude,
          p_lon: pos.coords.longitude,
          p_precision_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        }).then(
          () => { /* listo */ },
          () => { /* si no se pudo guardar, la visita sigue igual */ }
        );
      },
      () => { /* permiso negado o sin señal: no se guarda nada */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  } catch {
    /* la ubicación jamás puede afectar la navegación de la tienda */
  }
}
