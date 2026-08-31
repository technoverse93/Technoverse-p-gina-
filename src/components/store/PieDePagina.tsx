// =====================================================================
// PIE DE PÁGINA DE LA TIENDA
// =====================================================================
// Cuatro bloques: preguntas frecuentes, cómo contactar, dónde estamos e
// información legal.
//
// ---------------------------------------------------------------------
// TODO SALE DE LA CONFIGURACIÓN REAL, Y LO QUE NO ESTÉ NO SE DIBUJA
// ---------------------------------------------------------------------
// El teléfono, las direcciones, el horario y la cédula jurídica vienen de
// `app_settings` (los mismos campos que el panel ya edita en
// Configuración). Nada de eso está escrito a mano aquí.
//
// Y si un dato no está cargado, su bloque simplemente NO aparece. Es
// deliberado: un pie de página con "Teléfono: —" o con una dirección de
// ejemplo es peor que no tener el bloque, porque le promete al cliente un
// canal que no existe. Cuando el dato se cargue desde el panel, el bloque
// se dibuja solo.
// =====================================================================

import React from 'react';
import { MessageCircle, Phone, MapPin, Clock, Navigation } from 'lucide-react';
import type { AppSettings } from '../../types';

interface Props {
  settings?: AppSettings | null;
  /** Lleva a la pantalla de soporte/reparaciones de la propia tienda. */
  onIrASoporte?: () => void;
}

/**
 * Deja el teléfono como lo quiere WhatsApp: solo dígitos, con el código de
 * país de Costa Rica cuando el número viene de ocho cifras (que es como se
 * escribe localmente).
 */
function telefonoParaWhatsApp(bruto: string): string {
  const digitos = (bruto || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length === 8) return `506${digitos}`;
  return digitos;
}

/** Buscador de mapas por TEXTO. No se inventan coordenadas que no tenemos. */
function enlaceGoogleMaps(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

function enlaceWaze(direccion: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(direccion)}&navigate=yes`;
}

const PREGUNTAS: { p: string; r: string }[] = [
  {
    p: '¿Cuánto tarda una reparación?',
    r: 'Depende del equipo y del repuesto. Muchas reparaciones comunes se entregan el mismo día; cuando hay que pedir una pieza, se le avisa el tiempo estimado antes de empezar. Puede consultar el estado de su orden desde “Soporte Técnico”.',
  },
  {
    p: '¿Las reparaciones tienen garantía?',
    r: 'Sí. Cada trabajo se entrega con su garantía indicada en el comprobante, y el plazo queda registrado en el sistema junto con la orden. Guarde su comprobante: es lo que respalda el reclamo.',
  },
  {
    p: '¿Qué formas de pago aceptan?',
    r: 'Efectivo y SINPE Móvil. Cada compra o reparación genera su comprobante electrónico, que se envía al correo registrado.',
  },
  {
    p: '¿Los productos son nuevos o reacondicionados?',
    r: 'Se indica en la ficha de cada producto, junto con la garantía que le corresponde. Si algo no está claro, escríbanos por el chat antes de comprar.',
  },
  {
    p: '¿Puedo reservar o encargar un equipo que no está en existencias?',
    r: 'Sí. Si un artículo aparece como “Bajo pedido”, escríbanos por WhatsApp o por el chat de la tienda y le confirmamos disponibilidad y tiempo de entrega.',
  },
];

// `key?: any` es la convención que ya usa el resto del proyecto (ver
// `ProductCardProps`): la configuración de TypeScript de aquí no trata a
// `key` como atributo especial de JSX, así que hay que declararlo.
interface PreguntaProps { key?: any; p: string; r: string }

/**
 * Pregunta y respuesta EXPUESTAS de una: nada de acordeón. La respuesta se
 * separa de la pregunta con su propia tarjeta (fondo apenas más claro que
 * el del pie de página) para que la vista, con las cinco ya abiertas, se
 * lea como bloques distintos y no como un solo párrafo denso.
 */
function Pregunta({ p, r }: PreguntaProps): React.ReactElement {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.035)' }}>
      {/* Color en línea por lo mismo que en el banner: las reglas sin
          capa de index.css le ganan a las utilidades de Tailwind, y aquí
          el fondo es oscuro a la fuerza. */}
      <div className="text-[13px] font-semibold" style={{ color: '#E9ECF1' }}>{p}</div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: '#A7AFBD' }}>
        {r}
      </p>
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-3 text-[11px] font-black uppercase tracking-[0.14em]"
      style={{ color: '#6EE7B7' }}
    >
      {children}
    </h3>
  );
}

export default function PieDePagina({ settings, onIrASoporte }: Props) {
  const telefono = (settings?.companyPhone || '').trim();
  const wa = telefonoParaWhatsApp(telefono);
  const direccionTienda = (settings?.companyAddress || '').trim();
  const direccionTaller = (settings?.workshopAddress || '').trim();
  const horario = (settings?.pickupHours || '').trim();
  const cedula = (settings?.cedulaJuridica || '').trim();

  const ubicaciones = [
    { etiqueta: 'Tienda', direccion: direccionTienda },
    { etiqueta: 'Taller', direccion: direccionTaller },
  ].filter(u => !!u.direccion);

  const enlace = 'text-[12.5px] transition-colors hover:underline';

  return (
    <footer
      /* Sin separación en teléfono: ese `mt-16` dejaba 64 px de fondo vacío
         entre la última fila de productos y el pie, justo pasado el borde de
         la pantalla. Con el catálogo corto era una franja en blanco que había
         que recorrer sin nada que ver antes de llegar al pie. En pantallas
         grandes sí separa dos bloques que se ven a la vez, y ahí se conserva. */
      className="mt-0 md:mt-16 border-t border-white/10"
      style={{ background: '#0F1217' }}
    >
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-5 py-12 md:grid-cols-2 md:gap-8 md:py-10 lg:grid-cols-4 md:px-8">

        {/* ------------------------- Marca ------------------------- */}
        <div className="lg:col-span-1">
          <div className="mb-2 text-[15px] font-black" style={{ color: '#FFFFFF' }}>
            Technoverse
          </div>
          <p className="text-[12.5px] leading-relaxed" style={{ color: '#A7AFBD' }}>
            Venta de dispositivos y accesorios, y servicio técnico especializado
            en reparación de celulares en Costa Rica.
          </p>
          {onIrASoporte && (
            <button
              type="button"
              onClick={onIrASoporte}
              className="mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-bold transition-colors"
              style={{ background: '#0F766E', color: '#FFFFFF' }}
            >
              Consultar mi reparación
            </button>
          )}
        </div>

        {/* --------------------- Preguntas frecuentes --------------------- */}
        <div className="lg:col-span-1">
          <Titulo>Preguntas frecuentes</Titulo>
          <div className="space-y-2.5">
            {PREGUNTAS.map(q => <Pregunta key={q.p} {...q} />)}
          </div>
        </div>

        {/* -------------------------- Contacto -------------------------- */}
        <div className="lg:col-span-1">
          <Titulo>Contacto</Titulo>
          <ul className="space-y-2.5">
            {wa && (
              <li>
                <a
                  href={`https://wa.me/${wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-2 ${enlace}`}
                  style={{ color: '#A7AFBD' }}
                >
                  <MessageCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  WhatsApp {telefono}
                </a>
              </li>
            )}
            {telefono && (
              <li>
                <a
                  href={`tel:${telefono.replace(/\s/g, '')}`}
                  className={`inline-flex items-center gap-2 ${enlace}`}
                  style={{ color: '#A7AFBD' }}
                >
                  <Phone className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {telefono}
                </a>
              </li>
            )}
            {horario && (
              <li className="flex items-start gap-2 text-[12.5px]" style={{ color: '#A7AFBD' }}>
                <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{horario}</span>
              </li>
            )}
            {!wa && !telefono && !horario && (
              <li className="text-[12.5px]" style={{ color: '#8C97A8' }}>
                Escríbanos por el chat de la tienda.
              </li>
            )}
          </ul>
        </div>

        {/* ------------------------- Ubicaciones ------------------------- */}
        <div className="lg:col-span-1">
          <Titulo>Ubicaciones</Titulo>
          {ubicaciones.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: '#8C97A8' }}>
              Consúltenos la dirección por WhatsApp o por el chat.
            </p>
          ) : (
            <ul className="space-y-4">
              {ubicaciones.map(u => (
                <li key={u.etiqueta}>
                  <div className="mb-1 flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#6EE7B7' }} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-bold" style={{ color: '#E9ECF1' }}>{u.etiqueta}</div>
                      <div className="text-[12px] leading-relaxed" style={{ color: '#A7AFBD' }}>{u.direccion}</div>
                    </div>
                  </div>
                  <div className="ml-6 flex flex-wrap gap-2">
                    <a
                      href={enlaceGoogleMaps(u.direccion)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] font-semibold transition-colors hover:border-white/35"
                      style={{ color: '#E9ECF1' }}
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Google Maps
                    </a>
                    <a
                      href={enlaceWaze(u.direccion)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] font-semibold transition-colors hover:border-white/35"
                      style={{ color: '#E9ECF1' }}
                    >
                      <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> Waze
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------------------------- Legal ---------------------------- */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-[11.5px] md:flex-row md:items-center md:justify-between md:px-8"
             style={{ color: '#8C97A8' }}>
          <div className="space-y-1">
            <div>© {new Date().getFullYear()} Technoverse Costa Rica. Todos los derechos reservados.</div>
            {cedula && <div>Cédula jurídica: {cedula}</div>}
          </div>
          <div className="md:text-right">
            Sus datos personales se tratan conforme a la Ley 8968 de Protección
            de la Persona frente al tratamiento de sus datos personales.
          </div>
        </div>
      </div>
    </footer>
  );
}
