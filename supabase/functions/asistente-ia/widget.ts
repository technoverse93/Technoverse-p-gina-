// =====================================================================
// ASISTENTE IA — puerta del MINI-WIDGET del teléfono
// =====================================================================
// La ventanita nativa del widget (native-android/jarvis/JarvisRapido.java)
// pregunta aquí SIN sesión y SIN huella, con la llave que el superadmin
// activó en su teléfono (cabecera `x-jarvis-widget`, ver llaves.ts). El
// núcleo la valida y, por esta puerta, solo deja PREGUNTAR: nada de
// acciones. La función de la app (index.ts) no acepta llaves de widget.
//
// Se despliega como la función «jarvis-widget» SIN verificación de JWT en
// la entrada (el teléfono no tiene sesión): la seguridad es la llave.
// =====================================================================

import { atender } from './nucleo.ts';

Deno.serve((req: Request) => atender(req, { widget: true }));
