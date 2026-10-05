// =====================================================================
// ASISTENTE IA — puerta de la APP (panel)
// =====================================================================
// La persona entra con SU sesión (el JWT que manda el panel). Todo lo
// demás vive en nucleo.ts, que comparte con el mini-widget (widget.ts).
// Se despliega como la función «asistente-ia», con verificación de JWT.
// =====================================================================

import { atender } from './nucleo.ts';

Deno.serve((req: Request) => atender(req));
