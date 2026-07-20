/**
 * ============================================================================
 * Technoverse · Kit de superposiciones (Overlays) — grado producción
 * ============================================================================
 * Sistema único, agnóstico e inyectable para erradicar los diálogos nativos
 * bloqueantes del sistema operativo (window.alert / window.confirm /
 * window.prompt) y unificar la capa flotante de toda la app:
 *
 *   • useToast()   → avisos no bloqueantes (reemplaza alert()).
 *   • useConfirm() → confirmación asíncrona con Promise<boolean> (reemplaza
 *                    confirm()); soporta variante destructiva.
 *   • <Modal>      → diálogo modal accesible (ESC, backdrop, scroll-lock).
 *   • <Dropdown>   → menú anclado por Portal (evade stacking contexts).
 *   • <Tooltip>    → tooltip por Portal (reemplaza title="").
 *
 * Todo se renderiza con React Portals a <body>, de modo que ningún
 * `overflow:hidden`, `transform` o stacking-context de un ancestro pueda
 * recortar o tapar la superposición.
 *
 * ── Arquitectura de z-index (alineada con la escala de index.css) ───────────
 *   40  chrome fijo permanente (navbar / bottom-nav)
 *   45  botón flotante de chat (FAB)
 *   70  capas flotantes transitorias (Dropdown, Tooltip)
 *  100  modales / confirmaciones (backdrop bloqueante intencional)
 *  110  toasts / avisos
 *
 * "A prueba de fallos": el contenedor de toasts se monta con
 * `pointer-events:none` y solo cada tarjeta individual recupera
 * `pointer-events:auto`. Así los avisos NUNCA capturan clics ni bloquean el
 * botón de chat u otros elementos fijos, aunque visualmente se solapen. Los
 * modales se DESMONTAN por completo al cerrarse (render condicional, no
 * display:none), evitando backdrops huérfanos que atrapen el puntero.
 *
 * Optimizado para gama de entrada (Galaxy A12): sin librerías de animación,
 * contextos separados (un toast no re-renderiza el árbol de confirmación),
 * scroll-lock con contador de referencias y respeto a prefers-reduced-motion.
 * ============================================================================
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  HelpCircle,
} from 'lucide-react';

/* ───────────────────────────── Escala z-index ───────────────────────────── */

export const Z = {
  fab: 45,
  floating: 70,
  modal: 100,
  toast: 110,
} as const;

/* ─────────────────────── Utilidades internas compartidas ─────────────────── */

// Solo en cliente (Vite SPA); guarda por si se pre-renderiza.
const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined';

// Bloqueo de scroll del <body> con contador: soporta modales apilados sin que
// uno al cerrarse reactive el scroll mientras otro sigue abierto.
let scrollLocks = 0;
let savedOverflow = '';
function lockScroll() {
  if (!canUseDOM) return;
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks++;
}
function unlockScroll() {
  if (!canUseDOM) return;
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

// Portal a <body> con un contenedor propio que se limpia al desmontar.
function Portal({ children }: { children: React.ReactNode }) {
  const elRef = useRef<HTMLElement | null>(null);
  if (canUseDOM && !elRef.current) {
    elRef.current = document.createElement('div');
    elRef.current.setAttribute('data-tv-overlay', '');
  }
  useEffect(() => {
    if (!canUseDOM || !elRef.current) return;
    const el = elRef.current;
    document.body.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);
  if (!elRef.current) return null;
  return createPortal(children, elRef.current);
}

// Cierra con la tecla Escape mientras `active`.
function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [active, onEscape]);
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════════════════ */

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const MODAL_MAXW: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Oculta la X superior (p.ej. cuando el cierre solo debe ser vía botones). */
  hideClose?: boolean;
  /** Permitir cerrar al hacer clic en el backdrop (default: true). */
  closeOnBackdrop?: boolean;
  /** id opcional del contenedor para pruebas / anclajes. */
  id?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  hideClose = false,
  closeOnBackdrop = true,
  id,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<Element | null>(null);

  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    lockScroll();
    lastFocused.current = document.activeElement;
    // Foco al panel para accesibilidad de teclado.
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      unlockScroll();
      // Restaura el foco al disparador previo.
      if (lastFocused.current instanceof HTMLElement) lastFocused.current.focus();
    };
  }, [open]);

  // DESMONTAJE total al cerrar: sin backdrop huérfano que atrape el puntero.
  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-center justify-center p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
        style={{ zIndex: Z.modal }}
        role="dialog"
        aria-modal="true"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-hidden="true"
        />
        {/* Panel */}
        <div
          ref={panelRef}
          id={id}
          tabIndex={-1}
          className={`relative w-full ${MODAL_MAXW[size]} glass-panel-strong rounded-2xl outline-none flex flex-col max-h-[90vh] motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200`}
        >
          {(title || !hideClose) && (
            <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-[var(--border-color)]">
              <h3 className="text-base font-bold text-[var(--text-primary)] leading-tight">
                {title}
              </h3>
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar"
                  className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div className="px-5 py-4 overflow-y-auto text-sm text-[var(--text-secondary)]">
            {children}
          </div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TOASTS  (avisos no bloqueantes — reemplaza window.alert)
   ══════════════════════════════════════════════════════════════════════════ */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: React.ReactNode;
  duration: number;
}

interface ToastApi {
  show: (message: React.ReactNode, type?: ToastType, durationMs?: number) => string;
  success: (message: React.ReactNode, durationMs?: number) => string;
  error: (message: React.ReactNode, durationMs?: number) => string;
  warning: (message: React.ReactNode, durationMs?: number) => string;
  info: (message: React.ReactNode, durationMs?: number) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_META: Record<
  ToastType,
  { Icon: typeof CheckCircle2; ring: string; iconColor: string }
> = {
  success: { Icon: CheckCircle2, ring: 'border-emerald-500/40', iconColor: 'text-emerald-500' },
  error: { Icon: XCircle, ring: 'border-rose-500/40', iconColor: 'text-rose-500' },
  warning: { Icon: AlertTriangle, ring: 'border-amber-500/40', iconColor: 'text-amber-500' },
  info: { Icon: Info, ring: 'border-sky-500/40', iconColor: 'text-sky-500' },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <Portal>
      {/* Contenedor pointer-events:none → NUNCA bloquea clics (ni el FAB). */}
      <div
        className="fixed top-3 left-0 right-0 flex flex-col items-center gap-2 px-3 pointer-events-none"
        style={{ zIndex: Z.toast }}
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => {
          const meta = TOAST_META[t.type];
          const Icon = meta.Icon;
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto w-full max-w-sm flex items-start gap-3 px-4 py-3 rounded-xl glass-panel-strong border ${meta.ring} motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${meta.iconColor}`} />
              <p className="flex-1 text-sm text-[var(--text-primary)] leading-snug break-words">
                {t.message}
              </p>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Descartar aviso"
                className="shrink-0 -mr-1 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Portal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRM  (confirmación asíncrona — reemplaza window.confirm)
   ══════════════════════════════════════════════════════════════════════════ */

export interface ConfirmOptions {
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

/* ══════════════════════════════════════════════════════════════════════════
   PROVIDER  (monta toasts + confirm; se coloca en la raíz de la app)
   ══════════════════════════════════════════════════════════════════════════ */

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  /* ---- Toasts ---- */
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current[id];
    if (handle) {
      window.clearTimeout(handle);
      delete timers.current[id];
    }
  }, []);

  const show = useCallback(
    (message: React.ReactNode, type: ToastType = 'success', durationMs = 4500) => {
      const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => {
        // Techo defensivo: máximo 4 avisos visibles a la vez (memoria/DOM).
        const next = [...prev, { id, type, message, duration: durationMs }];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });
      if (durationMs > 0) {
        timers.current[id] = window.setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss]
  );

  const toastApi = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, d) => show(m, 'success', d),
      error: (m, d) => show(m, 'error', d ?? 6000),
      warning: (m, d) => show(m, 'warning', d ?? 5500),
      info: (m, d) => show(m, 'info', d),
      dismiss,
    }),
    [show, dismiss]
  );

  useEffect(() => {
    // Limpieza de timers pendientes al desmontar el provider.
    return () => {
      const pending = timers.current;
      Object.keys(pending).forEach((k) => window.clearTimeout(pending[k]));
      timers.current = {};
    };
  }, []);

  /* ---- Confirm ---- */
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: '',
  });

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, open: true, resolve });
    });
  }, []);

  const closeConfirm = useCallback(
    (result: boolean) => {
      setConfirmState((prev) => {
        prev.resolve?.(result);
        return { ...prev, open: false, resolve: undefined };
      });
    },
    []
  );

  const isDanger = confirmState.variant === 'danger';

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        <ToastViewport toasts={toasts} onDismiss={dismiss} />

        <Modal
          open={confirmState.open}
          onClose={() => closeConfirm(false)}
          size="sm"
          hideClose
          closeOnBackdrop
          title={
            <span className="flex items-center gap-2">
              {isDanger ? (
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
              ) : (
                <HelpCircle className="w-5 h-5 text-sky-500 shrink-0" />
              )}
              {confirmState.title ?? 'Confirmar acción'}
            </span>
          }
          footer={
            <>
              <button
                type="button"
                onClick={() => closeConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-color)] hover:text-[var(--text-primary)] transition"
              >
                {confirmState.cancelText ?? 'Cancelar'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => closeConfirm(true)}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition ${
                  isDanger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-sky-600 hover:bg-sky-700 dark:bg-[var(--brand-gold-mid)] dark:text-slate-950 dark:hover:bg-[var(--brand-gold-light)]'
                }`}
              >
                {confirmState.confirmText ?? 'Confirmar'}
              </button>
            </>
          }
        >
          <p className="leading-relaxed">{confirmState.message}</p>
        </Modal>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

/* ─────────────────────────────── Hooks públicos ──────────────────────────── */

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast debe usarse dentro de <OverlayProvider>.');
  }
  return ctx;
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm debe usarse dentro de <OverlayProvider>.');
  }
  return ctx;
}

/* ══════════════════════════════════════════════════════════════════════════
   DROPDOWN  (menú anclado por Portal — evade overflow/stacking del ancestro)
   ══════════════════════════════════════════════════════════════════════════ */

export interface DropdownProps {
  /** Nodo disparador. Recibe props de accesibilidad; debe reenviarlos. */
  button: React.ReactElement;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'start' | 'end';
  /** Ancho del menú en px (default: iguala al disparador si es mayor). */
  width?: number;
}

function computeMenuRect(
  anchor: DOMRect,
  align: 'start' | 'end',
  menuWidth: number
) {
  const gap = 6;
  const vw = window.innerWidth;
  let left = align === 'end' ? anchor.right - menuWidth : anchor.left;
  // Clamp horizontal para no salir del viewport (crítico en móvil).
  left = Math.max(8, Math.min(left, vw - menuWidth - 8));
  const top = anchor.bottom + gap;
  return { left, top };
}

export function Dropdown({ button, children, align = 'start', width }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useEscape(open, close);

  const recompute = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuWidth = width ?? Math.max(rect.width, 160);
    const { left, top } = computeMenuRect(rect, align, menuWidth);
    setPos({ left, top, minWidth: menuWidth });
  }, [align, width]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, recompute]);

  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => recompute();
    window.addEventListener('resize', onScrollResize);
    window.addEventListener('scroll', onScrollResize, true);
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => {
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
      document.removeEventListener('pointerdown', onDocPointer, true);
    };
  }, [open, recompute]);

  // Inyecta ref + toggle en el disparador sin romper sus props propias.
  const trigger = React.cloneElement(button as React.ReactElement<any>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const { ref } = button as any;
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') (ref as any).current = node;
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (e: React.MouseEvent) => {
      (button.props as any).onClick?.(e);
      if (!e.defaultPrevented) setOpen((v) => !v);
    },
  });

  return (
    <>
      {trigger}
      {open && pos && (
        <Portal>
          <div
            ref={menuRef}
            role="menu"
            className="fixed glass-panel rounded-xl p-1 overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
            style={{
              zIndex: Z.floating,
              left: pos.left,
              top: pos.top,
              minWidth: pos.minWidth,
            }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </Portal>
      )}
    </>
  );
}

export function DropdownItem({
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'text-rose-500 hover:bg-rose-500/10'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TOOLTIP  (por Portal — reemplaza el atributo title="")
   ══════════════════════════════════════════════════════════════════════════ */

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  const recompute = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const top = side === 'top' ? r.top - 8 : r.bottom + 8;
    setPos({ left: r.left + r.width / 2, top });
  }, [side]);

  const openTip = useCallback(() => {
    recompute();
    setOpen(true);
  }, [recompute]);
  const closeTip = useCallback(() => setOpen(false), []);

  const trigger = React.cloneElement(children as React.ReactElement<any>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const { ref } = children as any;
      if (typeof ref === 'function') ref(node);
      else if (ref && typeof ref === 'object') (ref as any).current = node;
    },
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      (children.props as any).onMouseEnter?.(e);
      openTip();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (children.props as any).onMouseLeave?.(e);
      closeTip();
    },
    onFocus: (e: React.FocusEvent) => {
      (children.props as any).onFocus?.(e);
      openTip();
    },
    onBlur: (e: React.FocusEvent) => {
      (children.props as any).onBlur?.(e);
      closeTip();
    },
  });

  return (
    <>
      {trigger}
      {open && pos && (
        <Portal>
          <div
            id={id}
            role="tooltip"
            className="fixed max-w-[220px] px-2.5 py-1.5 rounded-lg text-[11px] font-medium leading-snug text-white bg-slate-900 dark:bg-slate-800 border border-white/10 shadow-lg pointer-events-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
            style={{
              zIndex: Z.floating,
              left: pos.left,
              top: pos.top,
              transform:
                side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
