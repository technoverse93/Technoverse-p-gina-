import { ShieldCheck, Smartphone, Phone } from 'lucide-react';

/**
 * Pantalla única para Android en navegador.
 *
 * Es lo ÚNICO que se pinta: ni catálogo, ni chat, ni panel. Ese es el
 * punto — una captura de pantalla aquí no se lleva nada porque no hay
 * nada que llevarse (ver `seguridad/soloApp.ts` para el porqué).
 *
 * Lleva el teléfono de la tienda a propósito: si a alguien se le cierra
 * la puerta del navegador, tiene que quedarle una forma de comprar. Un
 * muro sin salida no protege nada, solo pierde al cliente.
 */
export default function AvisoSoloApp({ telefono }: { telefono?: string }) {
  const tel = (telefono || '+506 6421 4795').trim();
  const telLimpio = tel.replace(/[^0-9+]/g, '');

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent)] flex items-center justify-center">
          <ShieldCheck className="w-8 h-8" />
        </div>

        <h1 className="font-display font-bold text-[20px] leading-tight">
          Technoverse CR se usa desde la app
        </h1>

        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Por seguridad, en Android la tienda funciona únicamente dentro de
          nuestra aplicación. Instalala y vas a encontrar el catálogo, tus
          consultas y tus órdenes de reparación en el mismo lugar.
        </p>

        <div className="w-full mt-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
            <Smartphone className="w-4 h-4 text-[var(--accent)] shrink-0" />
            ¿Todavía no la tenés?
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)] text-left">
            Escribinos y te pasamos el enlace de instalación. También
            atendemos pedidos y consultas por teléfono, como siempre.
          </p>
          <a
            href={`https://wa.me/${telLimpio.replace(/^\+/, '')}`}
            className="mt-1 inline-flex items-center justify-center gap-2 w-full rounded-lg px-4 py-2.5 bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-[13px]"
          >
            <Phone className="w-4 h-4" />
            {tel}
          </a>
        </div>

        <p className="text-[11px] leading-relaxed text-[var(--text-muted)] mt-1">
          Desde una computadora podés seguir usando la tienda con normalidad.
        </p>
      </div>
    </div>
  );
}
