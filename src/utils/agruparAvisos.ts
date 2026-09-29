/**
 * Agrupa avisos repetidos sin retrasar el primero.
 *
 * ---------------------------------------------------------------------
 * POR QUÉ EXISTE (rendimiento)
 * ---------------------------------------------------------------------
 * `notifyUpdate()` (storage.ts) avisa a la pantalla de que la base
 * cambió, y CADA oyente responde clonando la base entera (`getDB()`).
 * Al arrancar se disparaban ~13 avisos seguidos (uno por tabla que
 * termina de cargar) y cada guardado disparaba 2 — con varios oyentes
 * montados, eran decenas de clonados completos en el hilo principal,
 * que es justo lo que congela un teléfono de gama baja.
 *
 * ---------------------------------------------------------------------
 * LA GARANTÍA QUE IMPORTA
 * ---------------------------------------------------------------------
 * Todos los oyentes RELEEN el estado completo al recibir el aviso, no
 * procesan el aviso en sí. Por eso alcanza con asegurar que llegue UN
 * aviso DESPUÉS del último cambio: los intermedios no aportan nada.
 *
 *   · El primer aviso sale AL INSTANTE (borde de subida). Un mensaje de
 *     chat o un guardado no esperan nada: la latencia percibida es la
 *     misma que antes.
 *   · Los que llegan dentro de la ventana no salen uno por uno: se
 *     colapsan en UNO solo, al cerrarse la ventana (borde de bajada).
 *     Ese aviso final es el que garantiza que nadie se quede con un
 *     estado viejo.
 */
export function agruparAvisos(disparar: () => void, ventanaMs = 50): () => void {
  let ultimo = 0;
  let pendiente: ReturnType<typeof setTimeout> | null = null;

  return () => {
    const ahora = Date.now();
    const desdeElUltimo = ahora - ultimo;

    if (desdeElUltimo >= ventanaMs && pendiente === null) {
      ultimo = ahora;
      disparar();
      return;
    }

    if (pendiente === null) {
      pendiente = setTimeout(() => {
        pendiente = null;
        ultimo = Date.now();
        disparar();
      }, Math.max(0, ventanaMs - desdeElUltimo));
    }
  };
}
