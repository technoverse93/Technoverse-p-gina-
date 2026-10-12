// =====================================================================
// LA TARJETA DEL TELÉFONO — lo que Javier hizo (o preparó) en tu celular
// =====================================================================
// Cuando le pedís «poneme una alarma», «llamá a Laura» o «abrí Spotify», la
// orden se ejecuta en el acto en el teléfono y esta tarjeta deja a la vista
// qué se hizo. Si hay dudas (dos Laura, dos apps parecidas, falta el permiso
// de contactos) muestra las opciones para que toques la correcta. En una
// conversación vieja no se vuelve a ejecutar nada solo: un botón la repite.
// =====================================================================

import { AlarmClock, AppWindow, Play, CalendarPlus, Check, ExternalLink, Flashlight, Loader2, MapPin, MessageCircle, MessageSquare, Music, Phone, RotateCw, Settings, ShieldCheck, Smartphone, Timer, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEstadoTelefono, type AccionTelefono, type PedidoTelefono } from '../../utils/telefono';

const ICONOS: Record<AccionTelefono, LucideIcon> = {
  alarma: AlarmClock, temporizador: Timer, abrir_app: AppWindow, llamar: Phone, whatsapp: MessageCircle, sms: MessageSquare,
  calendario: CalendarPlus, mapa: MapPin, musica: Music, multimedia: Music, linterna: Flashlight, ajustes: Settings, enlace: ExternalLink, youtube: Play,
};

/** Repetirlas no hace daño (una alarma o un temporizador duplicados, sí). */
const REPETIBLES: AccionTelefono[] = ['llamar', 'whatsapp', 'sms', 'mapa', 'abrir_app', 'enlace', 'multimedia'];

export type EjecutarTelefono = (p: PedidoTelefono, o?: { elegido?: string; forzar?: boolean }) => void;

export default function TarjetaTelefono({ pedido, onEjecutar }: { pedido: PedidoTelefono; onEjecutar: EjecutarTelefono }) {
  const est = useEstadoTelefono(pedido.id);
  const Icono = ICONOS[pedido.accion] || Smartphone;
  const estado = est?.estado;
  const Estado = estado === 'ejecutando' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
    : estado === 'hecho' ? <Check className="w-3.5 h-3.5" aria-hidden="true" />
      : estado === 'error' || estado === 'solo_app' || estado === 'sin_contacto' ? <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" /> : null;
  const etiqueta = estado === 'ejecutando' ? 'Haciéndolo…' : estado === 'hecho' ? 'Hecho' : estado === 'elegir' ? 'Elegí una' : estado === 'permiso' ? 'Falta un permiso' : estado === 'web' ? 'Listo para abrir' : estado ? 'No se pudo' : '';

  return (
    <article className="jv-tel" data-estado={estado || 'viejo'} aria-label={pedido.titulo}>
      <header>
        <span className="jv-tel-ic" aria-hidden="true"><Icono className="w-4 h-4" /></span>
        <b>{pedido.titulo}</b>
        {etiqueta && <span className="jv-tel-est">{Estado}{etiqueta}</span>}
      </header>
      {est?.mensaje && <p className="jv-tel-msj" role="status">{est.mensaje}</p>}
      <div className="jv-tel-botones">
        {estado === 'elegir' && est?.opciones?.map(o => (
          <button key={`${o.valor}${o.etiqueta}`} type="button" className="ai-chip" onClick={() => onEjecutar(pedido, { elegido: o.valor })}>
            {o.etiqueta}{o.detalle ? <small>{o.detalle}</small> : null}
          </button>
        ))}
        {estado === 'permiso' && <button type="button" className="ai-chip" onClick={() => onEjecutar(pedido, { forzar: true })}><ShieldCheck className="w-4 h-4" />Dar permiso</button>}
        {estado === 'web' && est?.enlace && <a className="ai-chip" href={est.enlace} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" />Abrir</a>}
        {(estado === 'error' || estado === 'sin_contacto') && <button type="button" className="ai-chip" onClick={() => onEjecutar(pedido, { forzar: true })}><RotateCw className="w-4 h-4" />Reintentar</button>}
        {!est && <button type="button" className="ai-chip" onClick={() => onEjecutar(pedido, { forzar: true })}><RotateCw className="w-4 h-4" />Hacerlo de nuevo</button>}
        {estado === 'hecho' && REPETIBLES.includes(pedido.accion) && <button type="button" className="ai-chip" onClick={() => onEjecutar(pedido, { forzar: true })}><RotateCw className="w-4 h-4" />Repetir</button>}
      </div>
    </article>
  );
}
