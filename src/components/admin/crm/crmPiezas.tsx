// =====================================================================
// CRM · PIEZAS COMPARTIDAS (íconos, avatar, aviso de migración, fecha de seguimiento)
// =====================================================================

import {
  Bell, CheckCircle2, ClipboardList, FileText, Hand, HeartHandshake, Info, MessageCircle, MessageSquare, PenLine, Phone, Receipt,
  ShoppingBag, Sparkles, StickyNote, UserCheck, UserPlus, Wallet, Wrench, ArrowRightLeft, FileInput,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CanalCrm, EtapaCrm, TipoEventoCrm } from '../../../utils/crmLogica';
import { iniciales } from '../../../utils/crmLogica';

export const ICONO_ETAPA: Record<EtapaCrm, LucideIcon> = {
  nuevo: Sparkles, conversacion: MessageCircle, cotizacion: FileText, pago_pendiente: Wallet, cerrado: CheckCircle2, postventa: HeartHandshake,
};

export const ICONO_CANAL: Record<CanalCrm, LucideIcon> = {
  chat_web: MessageSquare, tienda_form: ClipboardList, registro: UserCheck, pedido: ShoppingBag, taller: Wrench, manual: PenLine,
};

export const ICONO_EVENTO: Record<TipoEventoCrm, LucideIcon> = {
  creado: UserPlus, etapa: ArrowRightLeft, nota: StickyNote, chat: MessageSquare, pedido: Receipt, taller: Wrench, registro: UserCheck,
  formulario: FileInput, recordatorio: Bell, contacto: Phone, sistema: Info,
};

export function Avatar({ nombre, email, grande = false }: { nombre?: string | null; email?: string | null; grande?: boolean }) {
  return <span className="crm-av" data-grande={grande || undefined} aria-hidden="true">{iniciales(nombre, email)}</span>;
}

/** Lo que se ve mientras la migración del CRM no está aplicada en la base. */
export function AvisoMigracion() {
  return (
    <div className="crm-aviso" role="status">
      <Hand className="w-5 h-5 flex-none" aria-hidden="true" />
      <div className="min-w-0">
        <div className="crm-aviso-t">Falta un paso para estrenar el CRM</div>
        <p className="crm-aviso-p">
          El panel ya está listo, pero la base todavía no tiene las tablas del CRM. Aplicá <code>supabase/migracion_crm.sql</code> (una sola
          vez, tarda un segundo): trae a los contactos que ya existen —clientes, chats, equipos del taller y pedidos— y desde ahí cada chat,
          registro, pedido o equipo nuevo se suma solo al embudo.
        </p>
      </div>
    </div>
  );
}

/** Texto corto de «cuándo» con un estilo según urgencia. */
export function ChipSeguimiento({ estado, texto }: { estado: 'vencido' | 'hoy' | 'proximo'; texto: string }) {
  return (
    <span className="crm-seg" data-estado={estado} title={estado === 'vencido' ? 'Seguimiento vencido' : estado === 'hoy' ? 'Seguimiento para hoy' : 'Próximo seguimiento'}>
      <Bell className="w-3 h-3 flex-none" aria-hidden="true" />
      <span className="tv-1l">{texto}</span>
    </span>
  );
}
