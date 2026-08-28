// La animación de entrada por módulo se retiró junto con el
// `<motion.div key={activeTab}>`: con pestañas, el módulo ya no se
// desmonta al salir, así que no hay entrada ni salida que animar. El
// cambio de pestaña se resuelve con una transición de opacidad en CSS,
// que corre en el compositor y no cuesta trabajo en el hilo principal.
import React, { Activity, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { PaginatedTbody } from './PaginationHelper';
import { CustomSelect } from './CustomSelect';
import {
  CheckCircle, ChevronDown, Download, Edit, Eye, EyeOff, FileSpreadsheet, Key, Mail, Megaphone, Plus, RefreshCw, Save, Trash2, UserPlus, Users,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getDB, saveDB, addAuditLog, ADMIN_PASSWORD, saveLogo } from '../utils/storage';
import { cerrarSesionConservandoBiometria } from '../utils/biometria';
import { CATEGORIAS_TIENDA, normalizarCategoria, esRepuesto } from '../utils/categorias';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

import { User, Product, Order, RepairOrder, ClientProfile, LogisticsDelivery, MarketingCampaign, AuditLog } from '../types';
import { useToast, useConfirm } from './ui/Overlays';

// ---------------------------------------------------------------------
// TECHNOVERSE CONSOLE
// ---------------------------------------------------------------------
// El armazón (riel, barra superior, dock móvil, buscador de módulos) y
// las piezas de interfaz viven fuera de este archivo. Este componente
// se queda con lo que le corresponde: los datos y las operaciones del
// negocio. Antes mezclaba las dos cosas en 2.200 líneas, y por eso
// tocar el menú obligaba a navegar por medio módulo de facturación.
import AdminShell from './admin/AdminShell';
import AdminDashboard from './admin/AdminDashboard';
import { PageHead, Card, Btn, Field, Chip, TableShell, Empty } from './admin/AdminKit';
import { resolverModulo, PESTANA_NUEVA } from './admin/adminNav';
import NuevaPestana from './admin/NuevaPestana';
import { usePestanas, useScrollPorPestana } from './admin/usePestanas';
import { ContextoPestanaActiva } from './admin/AdminKit';
import { esAdminSupremo } from '../utils/securityPin';

// Cargados solo cuando se visita su pestaña: reduce el JS que el A12 tiene
// que parsear/ejecutar en el arranque del panel.
const TallerKanban = lazy(() => import('./TallerKanban'));
const InventarioControl = lazy(() => import('./InventarioControl'));
const ChatCRM = lazy(() => import('./chat/ChatCRM'));
const CyberSecurityPanel = lazy(() => import('./CyberSecurityPanel'));
const ClienteFicha = lazy(() => import('./ClienteFicha'));
// El módulo de cobros carga jsPDF y qrcode al emitir: se trae aparte para
// no sumar ese peso al arranque del panel.
const FacturacionPanel = lazy(() => import('./FacturacionPanel'));
const GestionUsuariosPanel = lazy(() => import('./admin/GestionUsuariosPanel'));

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center py-24 text-[var(--text-muted)] text-sm gap-2">
    <RefreshCw className="w-4 h-4 animate-spin" /> Cargando módulo...
  </div>
);

interface AdminPanelProps {
  onNavigateToStore: () => void;
  onRefreshTrigger?: () => void;
  currentUser: User | null;
  isAuthenticated: boolean;
  onLogin: (user: User) => void;
  onLogout: () => void;
}


function usePagination(items, itemsPerPage = 10) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [items.length]);
  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);
  return { page, setPage, totalPages, startIndex, visibleItems, itemsPerPage };
}

export default function AdminPanel({ 
  onNavigateToStore, 
  onRefreshTrigger,
  currentUser,
  isAuthenticated,
  onLogin,
  onLogout,
}: AdminPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const isSavingConfigRef = useRef(false);
  const isSavingProductRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  
  // Floating top bar dropdown states
  const [isModulesDropdownOpen, setIsModulesDropdownOpen] = useState(false);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  /**
   * El módulo con el que arranca la sesión.
   *
   * Se lee UNA vez, de la dirección, para que un enlace compartido o un
   * marcador abra lo que promete. Si no hay ruta, se entra por el panel
   * general: el panel NO abre módulos por su cuenta, igual que un
   * navegador no abre pestañas solo.
   */
  const tabInicial = useMemo(() => {
    const path = window.location.pathname;
    if (path.startsWith('/admin/')) {
      const tab = path.replace('/admin/', '');
      // La pestaña 'bitacora' ya no existe por separado: se fusionó dentro
      // del Centro de Ciberseguridad. Sin esta traducción, un enlace o un
      // marcador viejo a /admin/bitacora abriría el panel en blanco.
      if (tab === 'bitacora') return 'ciberseguridad';
      // 'cumplimiento' y 'logistica' se retiraron del panel. Sin esta
      // traducción, un enlace o un marcador viejo a esas rutas abriría el
      // panel en blanco, sin menú y sin ningún mensaje.
      if (tab === 'cumplimiento' || tab === 'logistica') return 'dashboard';
      return tab || 'dashboard';
    }
    return 'dashboard';
  }, []);

  // Navegación por pestañas. `activeTab` se conserva como nombre porque
  // es lo que consume medio archivo; ahora sale del motor de pestañas y
  // ya no es un estado suelto.
  const pestanas = usePestanas(tabInicial);
  const activeTab = pestanas.tabActivo;
  const scrollRef = useRef<HTMLElement | null>(null);
  useScrollPorPestana(pestanas.activa, scrollRef);


  

  const [isInventoryExpanded, setIsInventoryExpanded] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Mobile bottom-navigation overflow sheets (replace the old hamburger drawer)
  const [isMobileInventoryMenuOpen, setIsMobileInventoryMenuOpen] = useState(false);
  const [isMobileMoreMenuOpen, setIsMobileMoreMenuOpen] = useState(false);

  useLayoutEffect(() => {
    // Dynamic dropdown positioning to prevent going off-screen
    const handleDropdownPosition = () => {
      if (!activeDropdown) return;
      const dropdowns = document.querySelectorAll('.dynamic-dropdown');
      dropdowns.forEach(dropdown => {
    if (!dropdown) return;
        const el = dropdown as HTMLElement;
        // Reset to default left-0 first
        el.style.left = '0';
        el.style.right = 'auto';
        
        const rect = el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        if (rect.right > viewportWidth - 16) {
          // Switch to right alignment if it overflows
          el.style.left = 'auto';
          el.style.right = '0';
        }
      });
    };

    handleDropdownPosition();
    window.addEventListener('resize', handleDropdownPosition);
    return () => window.removeEventListener('resize', handleDropdownPosition);
  }, [activeDropdown]);

  useEffect(() => {
    if (activeTab.startsWith('inventario_')) {
      setIsInventoryExpanded(true);
    }
    window.history.replaceState(null, '', `/admin/${activeTab}`);
  }, [activeTab]);
  
  // Database entities
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [repairs, setRepairs] = useState<RepairOrder[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [deliveries, setDeliveries] = useState<LogisticsDelivery[]>([]);
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);

  // ---------------------------------------------------------------------
  // COMPROBANTES REALES (tabla invoices), por pedido
  // ---------------------------------------------------------------------
  // HALLAZGO DE AUDITORÍA CORREGIDO: `orders.hdaStatus` es un campo
  // simulado, previo al motor de facturación real. La tabla `invoices`
  // —la que crea `issue_invoice()`— sí sabe si el correo llegó
  // (`email_status`), y esa columna no se leía en ninguna pantalla: el
  // personal no tenía forma de saber que un comprobante no llegó al
  // cliente sin consultar la base directamente.
  const [facturasPorPedido, setFacturasPorPedido] = useState<
    Record<string, { id: string; consecutivo: string; pdfUrl: string | null; emailStatus: string | null }>
  >({});
  const [reenviandoFactura, setReenviandoFactura] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'facturacion') return;
    let vigente = true;

    const recargarFacturas = () => {
      supabase
        .from('invoices')
        .select('id, order_id, consecutivo, pdf_url, email_status')
        .then(({ data, error }) => {
          if (!vigente || error || !data) return;
          const mapa: typeof facturasPorPedido = {};
          for (const f of data as any[]) {
            mapa[f.order_id] = {
              id: f.id, consecutivo: f.consecutivo, pdfUrl: f.pdf_url, emailStatus: f.email_status,
            };
          }
          setFacturasPorPedido(mapa);
        });
    };

    recargarFacturas();

    // FALLO CORREGIDO: `invoices` no forma parte del espejo local con
    // Realtime (TABLE_CONFIGS, en storage.ts) — es una consulta aparte,
    // así que sin esto era la única pantalla del panel que necesitaba F5
    // para enterarse de un `email_status` que cambió (por ejemplo, un
    // reenvío de correo hecho desde OTRO dispositivo). Un canal propio,
    // vivo solo mientras esta pestaña está abierta, cierra ese hueco sin
    // tocar el espejo local genérico que usan las demás tablas.
    const canal = supabase
      .channel('facturacion-invoices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, recargarFacturas)
      .subscribe();

    return () => {
      vigente = false;
      supabase.removeChannel(canal);
    };
  }, [activeTab, orders]);

  /**
   * Reenvía el correo de un comprobante que no llegó.
   *
   * Llama a la MISMA función que usa el checkout — no hay una versión
   * distinta para reintentos — así que el resultado es idéntico a como
   * habría salido la primera vez.
   */
  const reenviarComprobante = async (invoiceId: string) => {
    setReenviandoFactura(invoiceId);
    try {
      const { error } = await supabase.functions.invoke('send-invoice-email', { body: { invoiceId } });
      if (error) throw error;
      toast.success('Se reenvió el comprobante.');
    } catch (e: any) {
      toast.error('No se pudo reenviar: ' + (e?.message || e));
    } finally {
      setReenviandoFactura(null);
    }
  };

  // Product CRUD state
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState('Dispositivos');
  const [prodPrice, setProdPrice] = useState<number>(0);
  const [prodCost, setProdCost] = useState<number>(0);
  const [prodStock, setProdStock] = useState<number>(0);
  const [prodImage, setProdImage] = useState('');
  const [prodDiscount, setProdDiscount] = useState<number>(0);
  const [prodRow, setProdRow] = useState('A');
  const [prodShelf, setProdShelf] = useState('1');
  const [prodPhysicalLocation, setProdPhysicalLocation] = useState('');

  // New admin user creation state
  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [promotedUserEmail, setPromotedUserEmail] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [generatedUserPass, setGeneratedUserPass] = useState<string | null>(null);
  const [showLoginToast, setShowLoginToast] = useState(false);
  const [loginToastMessage, setLoginToastMessage] = useState('');

  // General parameters state
  const [cedulaJuridica, setCedulaJuridica] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [pickupHours, setPickupHours] = useState('');
  // URL del "Catch Hook" de Zapier que dispara el cron de publicaciones
  // programadas de Instagram (ver marketing_requests en storage.ts).
  const [instagramWebhookUrl, setInstagramWebhookUrl] = useState('');
  const [storeLogo, setStoreLogo] = useState('');
  const [storeLogoPreview, setStoreLogoPreview] = useState<string | null>(null);

  // Client form state
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  // Correo del cliente cuyo reseteo de contraseña está en curso; deshabilita
  // su botón puntual mientras la Edge Function responde (evita doble envío).
  const [resettingClientEmail, setResettingClientEmail] = useState<string | null>(null);
  // Cliente cuya ficha completa está abierta (historial, contraseña,
  // correo, activo/inactivo y los derechos de la Ley 8968).
  const [clienteFicha, setClienteFicha] = useState<ClientProfile | null>(null);
  const [clientForm, setClientForm] = useState<Partial<ClientProfile>>({
    name: '', email: '', phone: '', province: 'San José', addressDetail: '', notes: ''
  });

  // Marketing states
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  // Regla fija del negocio: todo cupón nuevo es de un (1) solo uso y vence a
  // los 60 días de creado (la fecha la calcula la BD; el límite se fuerza
  // aquí y de nuevo en handleSaveCoupon para que no se pueda alterar).
  const [couponForm, setCouponForm] = useState<Partial<MarketingCampaign>>({
    code: '', type: 'Porcentaje', value: 10, limit: 1, active: true
  });

  const handleSaveCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.code || !couponForm.value) return;
    const db = getDB();
    const newCoupon = {
      ...couponForm,
      id: `CAMP-${Date.now()}`,
      limit: 1, // regla fija: un solo uso, sin importar lo que traiga el formulario
      used: 0
    } as MarketingCampaign;
    db.marketing_campaigns.push(newCoupon);
    saveDB(db);
    loadAllAdminData();
    setIsCouponModalOpen(false);
    addAuditLog(currentUser?.email || 'admin', 'Mercadeo', 'Crear Cupón', `Cupón ${newCoupon.code} creado`);
  };


  const openClientModal = (client?: ClientProfile) => {
    if (client) {
      setEditingClient(client);
      setClientForm(client);
    } else {
      setEditingClient(null);
      setClientForm({ name: '', email: '', phone: '', province: 'San José', addressDetail: '', notes: '' });
    }
    setIsClientModalOpen(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name) {
      toast.warning('El nombre del cliente es obligatorio.');
      return;
    }
    if (!clientForm.email) {
      toast.warning('El correo electrónico es obligatorio.');
      return;
    }
    if (!clientForm.phone) {
      toast.warning('El teléfono es obligatorio.');
      return;
    }
    if (!clientForm.addressDetail) {
      toast.warning('La dirección exacta es obligatoria.');
      return;
    }

    const db = getDB();
    if (editingClient) {
      const idx = db.clients.findIndex(c => c && c.id === editingClient.id);
      if (idx !== -1) {
        db.clients[idx] = { ...db.clients[idx], ...clientForm } as ClientProfile;
        addAuditLog(currentUser?.email || 'admin', 'CRM', 'Editar Cliente', `Cliente actualizado: ${clientForm.name}`, db);
      }
    } else {
      const newClient: ClientProfile = {
        ...(clientForm as ClientProfile),
        id: `CLI-${Math.floor(10000 + Math.random() * 90000)}`,
        cardsTokenized: [],
        balance: 0
      };
      db.clients.push(newClient);
      addAuditLog(currentUser?.email || 'admin', 'CRM', 'Crear Cliente', `Nuevo cliente registrado: ${clientForm.name}`, db);
    }

    try {
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo guardar el cliente en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    loadAllAdminData();
    setIsClientModalOpen(false);
  };

  // Forzar reseteo de contraseña de un cliente. La cuenta de Auth y el envío
  // del correo de recuperación viven en la Edge Function 'admin-force-password-reset'
  // (service_role, verifica que quien llama sea Dueño) — nunca se maneja la
  // llave de servicio ni se toca la sesión del admin desde el navegador.
  const handleForcePasswordReset = async (email: string, name: string) => {
    if (!email || resettingClientEmail) return;
    const ok = await confirm({
      title: 'Forzar reseteo de contraseña',
      message: `Se enviará un correo de restablecimiento de contraseña a ${name} (${email}). El cliente deberá seguir el enlace para definir una nueva contraseña.`,
      confirmText: 'Enviar correo de reseteo'
    });
    if (!ok) return;

    setResettingClientEmail(email);
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-password-reset', {
        body: { email }
      });
      if (error || !data?.success) {
        toast.error('No se pudo forzar el reseteo. Detalle: ' + (data?.error || error?.message || 'error desconocido'));
        return;
      }
      toast.success(`Correo de reseteo de contraseña enviado a ${email}.`);
      addAuditLog(currentUser?.email || 'admin', 'CRM', 'Forzar Reseteo Contraseña', `Reseteo forzado para ${name} (${email}).`);
    } catch (err: any) {
      toast.error('No se pudo forzar el reseteo. Detalle: ' + (err?.message || err));
    } finally {
      setResettingClientEmail(null);
    }
  };

  // Load Admin Data
  useEffect(() => {
    loadAllAdminData();
    setIsMounted(true);
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarCollapsed(true);
      } else {
        setIsSidebarCollapsed(false);
      }
    };
    
    // -------------------------------------------------------------------
    // RECARGA AGRUPADA — el tirón más caro del panel
    // -------------------------------------------------------------------
    // `loadAllAdminData()` no es barato: llama a `getDB()`, que clona en
    // profundidad la base ENTERA (once tablas, síncrono, en el hilo
    // principal), y después reemplaza ocho arreglos de estado, con lo que
    // se vuelve a pintar TODA pestaña montada.
    //
    // Y se disparaba una vez por evento. Una sincronización de Realtime
    // que trae productos, pedidos y reparaciones en la misma ráfaga son
    // tres eventos seguidos: tres clonaciones completas y tres pasadas de
    // repintado para llegar exactamente al mismo estado final. Eso es el
    // bloqueo del hilo principal y la caída de fotogramas que se siente al
    // trabajar mientras entran datos.
    //
    // Con `requestAnimationFrame` todos los eventos de una misma ráfaga
    // colapsan en UNA sola recarga, justo antes del siguiente pintado. No
    // se pierde ninguna actualización: la que se ejecuta lee el estado más
    // reciente, que ya incluye lo que trajeron las demás. Y como solo hay
    // una devolución de llamada encolada a la vez, con la aplicación en
    // segundo plano —donde el navegador congela `rAF`— no se acumula
    // trabajo: al volver se ejecuta una vez y con los datos al día.
    let recargaPendiente = 0;
    const pedirRecarga = () => {
      if (recargaPendiente) return;
      recargaPendiente = requestAnimationFrame(() => {
        recargaPendiente = 0;
        loadAllAdminData();
      });
    };

    const handleDbUpdate = () => {
      pedirRecarga();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('storage', handleDbUpdate);
    window.addEventListener('technoverse_db_updated', handleDbUpdate);

    // Also set up BroadcastChannel to receive updates in real-time across tabs/contexts
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('technoverse_db_channel');
      channel.onmessage = (event) => {
        if (event.data && event.data.type === 'UPDATE_DB') {
          pedirRecarga();
        }
      };
    } catch (e) {
      // Ignored
    }

    return () => {
      if (recargaPendiente) cancelAnimationFrame(recargaPendiente);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('storage', handleDbUpdate);
      window.removeEventListener('technoverse_db_updated', handleDbUpdate);
      if (channel) {
        channel.close();
      }
    };
  }, []);

  // `useCallback` con dependencias vacías: no lee NADA del closure —solo
  // llama a `set...`, que React garantiza estables—, así que ahora la
  // lista vacía es literal y no una aproximación. Sin esto, cada tecla en
  // CUALQUIER formulario del panel recreaba esta función y rompía la
  // memoización de los cinco módulos lazy a los que se les pasa como
  // `onDataChanged`/`onRepairUpdated`.
  const loadAllAdminData = useCallback(() => {
    const db = getDB();
    setProducts(db.products || []);
    setOrders(db.orders || []);
    setRepairs(db.repair_orders || []);
    if (db.settings) {
      setCedulaJuridica(db.settings.cedulaJuridica);
      setCompanyPhone(db.settings.companyPhone || '');
      setCompanyAddress(db.settings.companyAddress || '');
      setPickupHours(db.settings.pickupHours || '');
      setInstagramWebhookUrl(db.settings.instagramWebhookUrl || '');
      setStoreLogo(db.settings.storeLogo || '');
    }
    setClients(db.clients || []);
    setDeliveries(db.deliveries || []);
    setCampaigns(db.marketing_campaigns || []);
    setAuditLog(db.audit_log || []);

    // AQUÍ IBA UN `onRefreshTrigger()` EN CADA RECARGA. Se quitó porque no
    // refrescaba nada y costaba un repintado del árbol ENTERO.
    //
    // `onRefreshTrigger` es `triggerRefresh` de App.tsx, que hace
    // `setRefreshTrigger(n + 1)`. Ese estado tiene UN solo consumidor:
    // la prop `onRefreshTrigger` de `PublicStore`. Y `PublicStore` y este
    // panel son las dos ramas EXCLUYENTES del mismo ternario en App.tsx
    // (`currentView === 'store' ? <PublicStore/> : <AdminPanel/>`), así
    // que mientras el panel está abierto la tienda no está montada y no
    // hay nadie leyendo ese número.
    //
    // El efecto real era, por cada actualización de la base: repintar
    // App.tsx completo —y con él todo el panel y todas sus pestañas
    // montadas— para mover un contador que nadie mira. Encima del
    // repintado que ya causan los ocho `set...` de arriba.
    //
    // La tienda sigue enterándose de los cambios: al salir del panel,
    // `onNavigateToStore` llama a `triggerRefresh()` explícitamente antes
    // de cambiar de vista, y además `PublicStore` se monta de cero y lee
    // la base al montarse.
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawBase64 = reader.result as string;
        try {
          const { compressImage } = await import('../utils/storage');
          const compressed = await compressImage(rawBase64, 400, 400, 0.7);
          setStoreLogoPreview(compressed);
        } catch (err) {
          console.error('Error compressing logo:', err);
          setStoreLogoPreview(rawBase64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // ---------------------------------------------------------------------
  // NOTA: el panel NO tiene formulario de acceso propio.
  // ---------------------------------------------------------------------
  // Se entra SIEMPRE por el formulario de la tienda, que es el que pasa
  // por el portero de ciberseguridad y el que ofrece la huella. Si aquí
  // no hay una sesión válida, el componente devuelve la pantalla de
  // redirección de más abajo y App vuelve a la tienda con el acceso
  // abierto.
  //
  // Antes vivía aquí un `handleLogin` completo —con su propio
  // `iniciarSesionVigilada` y su lectura de perfil— que NINGÚN elemento
  // de la interfaz podía invocar: no existía el formulario que lo
  // llamara. Se eliminó porque además arrastraba dos
  // `supabase.auth.signOut()` de alcance global que, de haberse llegado
  // a ejecutar dentro de la APK, habrían revocado el pase guardado
  // detrás de la huella y roto la biometría en un intento de acceso
  // fallido.

  const handleAnonimizarCliente = async (cliente: ClientProfile) => {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: `Se van a borrar de forma irreversible el nombre, correo, teléfono, dirección y tarjetas de ${cliente.name}. Sus compras y comprobantes SE CONSERVAN —Hacienda obliga a guardarlos— pero quedarán a nombre de "Cliente anónimo". Esto no se puede deshacer. ¿Continuar?`,
      confirmText: 'Eliminar y anonimizar',
      variant: 'danger'
    });
    if (!ok) return;

    const db = getDB();
    const i = db.clients.findIndex(c => c.id === cliente.id);
    if (i === -1) { toast.error('No se encontró el cliente.'); return; }

    const nombreOriginal = db.clients[i].name;
    db.clients[i].name = 'CLIENTE ANÓNIMO (DERECHO AL OLVIDO)';
    db.clients[i].email = `anonimo-${cliente.id.toLowerCase()}@technoverse.com`;
    db.clients[i].phone = '+506 0000 0000';
    db.clients[i].addressDetail = 'ELIMINADO BAJO SOLICITUD DE LEY 8968';
    db.clients[i].cardsTokenized = [];
    db.clients[i].balance = 0;
    db.clients[i].notes = `Información personal purgada el ${new Date().toLocaleDateString('es-CR')} conforme a la Ley 8968.`;

    addAuditLog(currentUser?.email || 'admin', 'Protección Datos', 'Derecho Olvido',
      `Purga de datos personales completada para ${nombreOriginal} (${cliente.id}) conforme a la Ley 8968.`, db);

    await saveDB(db);
    loadAllAdminData();
    toast.success('Cliente anonimizado. Su historial de compras se conservó intacto.');
  };

  const handleSaveConfig = async () => {
    // Evita que un doble clic/doble toque en el celular dispare el mismo
    // guardado varias veces en paralelo (eso causaba conflictos 409 en
    // Supabase y hacía que la pantalla revirtiera cambios que sí se habían
    // guardado).
    if (isSavingConfigRef.current) return;
    isSavingConfigRef.current = true;
    try {
      await handleSaveConfigInner();
    } finally {
      isSavingConfigRef.current = false;
    }
  };

  const handleSaveConfigInner = async () => {
    try {
      // El logo se guarda PRIMERO con saveLogo(), que persiste la imagen
      // comprimida directamente en Supabase (app_settings.store_logo).
      if (storeLogoPreview) {
        await saveLogo(storeLogoPreview);
      }

      // CRÍTICO: se vuelve a leer getDB() DESPUÉS de guardar el logo. Antes
      // "db" se capturaba ANTES de guardar el logo (sin el logo nuevo), y el
      // saveDB() de aquí abajo lo usaba tal cual — eso sobreescribía el logo
      // recién guardado de vuelta al valor viejo en el mismo clic. Por eso
      // Supabase confirmaba la subida pero la interfaz no lo reflejaba: el
      // propio guardado lo revertía un instante después.
      const db = getDB();
      if (!db.settings) db.settings = {} as any;
      db.settings.cedulaJuridica = cedulaJuridica;
      db.settings.companyPhone = companyPhone;
      db.settings.companyAddress = companyAddress;
      db.settings.pickupHours = pickupHours;
      db.settings.instagramWebhookUrl = instagramWebhookUrl.trim();

      addAuditLog(currentUser?.email || 'admin', 'Configuración', 'Actualizar Ajustes', 'Ajustes fiscales, operativos y logo actualizados', db);
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo guardar la configuración/logo en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    setStoreLogoPreview(null);
    loadAllAdminData();
    toast.success('Parámetros de facturación fiscal y de operación residencial guardados con éxito.');
  };

  const handleLogout = useCallback(async () => {
    if (currentUser) {
      addAuditLog(currentUser.email, 'Seguridad', 'Logout', 'Sesión cerrada por el usuario.');
    }
    // En la APK se cierra con alcance local: `signOut()` a secas revoca en
    // el servidor TODOS los pases de la cuenta, incluido el que guarda la
    // huella, y por eso cerrar sesión mataba la biometría.
    await cerrarSesionConservandoBiometria();
    onLogout();
  }, [currentUser, onLogout]);

  // Check RBAC permission for modules
  // Ya no existen roles secundarios: cualquier usuario autenticado en el
  // panel es Administrador con acceso total.
  const hasPermission = (_tab: string): boolean => !!currentUser;

  // Product CRUD triggers
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Evita doble envío (doble clic/doble toque) creando el mismo producto
    // dos veces en paralelo, lo que antes causaba un conflicto 409 en
    // Supabase y revertía la pantalla.
    if (isSavingProductRef.current) return;
    isSavingProductRef.current = true;
    try {
      await handleProductSubmitInner();
    } finally {
      isSavingProductRef.current = false;
    }
  };

  const handleProductSubmitInner = async () => {
    if (!prodName.trim() || prodPrice <= 0 || prodCost <= 0) {
      toast.warning('Por favor complete todos los datos con valores positivos.');
      return;
    }

    const db = getDB();

    if (editingProductId) {
      // Edit product
      const idx = db.products.findIndex(p => p && p.id === editingProductId);
      if (idx !== -1) {
        const oldProd = db.products[idx];
        const locationChanged = oldProd.physicalLocation !== prodPhysicalLocation;
        
        db.products[idx] = {
          ...db.products[idx],
          name: prodName,
          category: prodCategory,
          price: prodPrice,
          cost: prodCost,
          stock: prodStock,
          imageUrl: prodImage,
          discountPercent: prodDiscount,
          physicalLocation: prodPhysicalLocation
        };
        
        addAuditLog(currentUser?.email || 'admin', 'Inventario', 'Editar Producto', `Artículo modificado: ${prodName} (SKU: ${db.products[idx].sku})`);
        
        if (locationChanged) {
          addAuditLog(
            currentUser?.email || 'admin', 
            'Inventario', 
            'Ubicación Física', 
            `Ubicación en casa cambiada para "${prodName}" (SKU: ${db.products[idx].sku}): de "${oldProd.physicalLocation || 'Ninguna'}" a "${prodPhysicalLocation || 'Ninguna'}"`
          );
        }
      }
    } else {
      // Create product
      const sku = `TV-${Math.floor(10000 + Math.random() * 90000)}`;
      const newProduct: Product = {
        id: `PROD-${Date.now()}`,
        name: prodName,
        sku,
        category: prodCategory,
        price: prodPrice,
        cost: prodCost,
        stock: prodStock,
        imageUrl: prodImage,
        discountPercent: prodDiscount,
        physicalLocation: prodPhysicalLocation
      };
      db.products.push(newProduct);
      addAuditLog(currentUser?.email || 'admin', 'Inventario', 'Crear Producto', `Nuevo artículo registrado: ${prodName} (SKU: ${sku}) en la ubicación: "${prodPhysicalLocation || 'Sin asignar'}"`);
    }

    try {
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo guardar el producto en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    loadAllAdminData();
    setShowProductForm(false);
    setEditingProductId(null);
    clearProductForm();
    if (onRefreshTrigger) onRefreshTrigger();
  };

  const clearProductForm = () => {
    setProdName('');
    setProdPrice(0);
    setProdCost(0);
    setProdStock(0);
    setProdImage('');
    setProdDiscount(0);
    setProdPhysicalLocation('');
  };

  const handleEditProductClick = (p: Product) => {
    setEditingProductId(p.id);
    setProdName(p.name);
    setProdCategory(p.category);
    setProdPrice(p.price);
    setProdCost(p.cost);
    setProdStock(p.stock);
    setProdImage(p.imageUrl);
    setProdDiscount(p.discountPercent);
    setProdPhysicalLocation(p.physicalLocation || '');
    setShowProductForm(true);
  };

  const handleDeleteProduct = async (prodId: string, name: string) => {
    const ok = await confirm({
      title: 'Eliminar producto',
      message: `¿Seguro que desea eliminar el producto ${name}?`,
      confirmText: 'Eliminar',
      variant: 'danger'
    });
    if (!ok) return;
    const db = getDB();
    db.products = db.products.filter(p => p && p.id !== prodId);
    try {
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo eliminar el producto en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    addAuditLog(currentUser?.email || 'admin', 'Inventario', 'Eliminar Producto', `Artículo eliminado: ${name}`);
    loadAllAdminData();
    if (onRefreshTrigger) onRefreshTrigger();
  };

  // Creación de nuevos usuarios administradores (acceso total). La cuenta de
  // Supabase Auth y la fila en profiles se crean del lado del servidor (Edge
  // Function con service_role key), para no exponer esa llave en el
  // navegador ni cerrar la sesión del admin actual.
  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim() || isCreatingUser) return;
    setIsCreatingUser(true);
    try {
      const finalPass = newUserPassword.trim() || `Admin-${Math.floor(100000 + Math.random() * 900000)}`;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('create-admin-user', {
        body: {
          email: newUserEmail.trim().toLowerCase(),
          password: finalPass,
          name: newUserName.trim()
        }
      });

      if (fnError || !fnData?.success) {
        // Cuando la Edge Function responde con un status distinto de 2xx,
        // supabase-js NO pone el cuerpo de la respuesta en `fnData`: lo
        // envuelve en un FunctionsHttpError genérico ("Edge Function
        // returned a non-2xx status code") y dejamos escapar ese mensaje
        // inútil en vez del motivo real ("este correo ya existe", "faltan
        // datos", etc.) que la función sí manda en el cuerpo JSON.
        let detalle = fnData?.error || fnError?.message || 'error desconocido';
        if (fnError instanceof FunctionsHttpError) {
          try {
            const cuerpo = await fnError.context.json();
            if (cuerpo?.error) detalle = cuerpo.error;
          } catch {
            // Cuerpo no era JSON; nos quedamos con el mensaje genérico.
          }
        }
        toast.error('No se pudo crear el usuario. Detalle: ' + detalle);
        return;
      }

      const yaExistia = !!fnData?.promoted;
      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Seguridad', yaExistia ? 'Ascender Usuario Existente a Administrador' : 'Crear Usuario Administrador', yaExistia ? `Cuenta existente ascendida a administrador: ${newUserName} (${newUserEmail})` : `Usuario administrador creado: ${newUserName} (${newUserEmail})`);
      if (yaExistia) {
        // Ya tenía cuenta (por ejemplo, se había registrado como cliente):
        // solo se le subió el rol, su contraseña NO cambió. Mostrar
        // `finalPass` aquí sería mostrar una contraseña que no sirve.
        setGeneratedUserPass(null);
        setPromotedUserEmail(newUserEmail.trim().toLowerCase());
        toast.success('El correo ya tenía una cuenta: se le dio acceso de administrador. Su contraseña actual no cambió.');
      } else {
        setPromotedUserEmail(null);
        setGeneratedUserPass(finalPass);
      }
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
    } finally {
      setIsCreatingUser(false);
    }
  };

  // HALLAZGO DE AUDITORÍA CORREGIDO (prioridad Media): aquí vivía
  // `downloadFacturaPDF()`, un SEGUNDO generador de comprobantes,
  // independiente de src/utils/invoicePdf.ts, que imprimía "TECHNOVERSE
  // S.A." y "Cédula Jurídica: {valor}" — el error legal que ya se había
  // corregido en el generador real seguía vivo aquí, sin que nadie lo
  // notara porque NINGÚN botón llamaba a esta función: era código muerto.
  //
  // Era una trampa: el nombre suena a una función útil ("descargar
  // factura en PDF"), así que reconectarla a un botón algún día era un
  // error fácil de cometer, y habría hecho reaparecer el error legal en
  // producción. Se elimina en vez de corregirla: el comprobante real ya
  // existe, en invoicePdf.ts, y usarlo desde aquí sería duplicar lógica
  // que ya está probada.

  // Credit Note returns
  const handleIssueCreditNote = async (orderId: string) => {
    const ok = await confirm({
      title: 'Emitir Nota de Crédito',
      message: '¿Desea generar una Nota de Crédito fiscal (NC-001) para esta factura? Esto reintegrará automáticamente el stock a bodega.',
      confirmText: 'Emitir NC-001'
    });
    if (!ok) return;

    const db = getDB();
    const oIdx = db.orders.findIndex(o => o && o.id === orderId);
    if (oIdx === -1) return;

    const ord = db.orders[oIdx];
    db.orders[oIdx].status = 'Devuelto';

    // Reintegrate stock
    ord.items.forEach(it => {
    if (!it) return;
      const pIdx = db.products.findIndex(p => p && p.id === it.productId);
      if (pIdx !== -1) {
        db.products[pIdx].stock += it.quantity;
        db.inventory_movements.unshift({
          id: `MOV-${Date.now()}`,
          productId: it.productId,
          productName: it.productName,
          quantityChange: it.quantity,
          type: 'Devolución',
          notes: `Reintegro por Nota de Crédito NC-001 (Factura original: ${orderId})`,
          timestamp: new Date().toISOString(),
          userEmail: currentUser?.email || 'admin'
        });
      }
    });

    // Generate refund order
    db.orders.push({
      ...ord,
      // Mismo motivo que en la tienda: contar la copia local daba números
      // repetidos y la base rechazaba la fila. Fecha + tramo al azar es
      // único sin consultar nada.
      id: `NC-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      status: 'Cancelado',
      subtotal: -ord.subtotal,
      membershipDiscount: -ord.membershipDiscount,
      shippingCost: -ord.shippingCost,
      taxAmount: -ord.taxAmount,
      total: -ord.total,
      timestamp: new Date().toISOString()
    });

    db.audit_log.unshift({
      id: `LOG-${Date.now()}`,
      userEmail: currentUser?.email || 'admin',
      module: 'Contabilidad',
      action: 'Nota de Crédito',
      detail: `Devolución formalizada. Nota de crédito emitida para ${ord.customerName} sobre factura ${orderId}. Reintegrados artículos a stock.`,
      timestamp: new Date().toISOString()
    });

    try {
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo guardar la nota de crédito en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    loadAllAdminData();
    if (onRefreshTrigger) onRefreshTrigger();
    toast.success(`Nota de crédito emitida con éxito. Stock reintegrado.`);
  };

  // Image pre-view upload simulation
  const handleImageUploadSim = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProdImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // KPI calculations
  const totalSalesRevenue = orders.filter(o => o && o.status === 'Completado').reduce((sum, o) => sum + o.total, 0);
  const activeRepairsCount = repairs.filter(r => r && r.status !== 'Entregada' && r.status !== 'Cancelada').length;
  const clientsCount = clients.length;
  const lowStockProductsCount = products.filter(p => p && p.stock <= 3).length;
  const repairsAwaitingParts = repairs.filter(r => r && r.status === 'Esperando repuestos').length;
  const totalStockItems = products.reduce((sum, p) => sum + (p ? (p.stock || 0) : 0), 0);
  const estimatedFreeSpace = Math.max(0, 100 - Math.min(100, Math.round((totalStockItems / 300) * 100)));

  // Real data for charts
  const dailySalesData = React.useMemo(() => {
    const last5Days = [...Array(5)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (4 - i));
      return {
        name: d.toLocaleDateString('es-CR', { weekday: 'short' }),
        dateStr: d.toISOString().split('T')[0],
        ventas: 0
      };
    });

    orders.filter(o => o && o.status === 'Completado').forEach(o => {
    if (!o) return;
      const orderDate = o.timestamp.split('T')[0];
      const day = last5Days.find(d => d && d.dateStr === orderDate);
      if (day) {
        day.ventas += o.total;
      }
    });

    return last5Days;
  }, [orders]);

  const inventoryDistData = React.useMemo(() => {
    // Este gráfico contaba productos en categorías que no existen en el sistema
    // —Pantallas, Cámaras, Tarjetas Lógicas—, así que el conteo siempre daba
    // cero y la tarjeta mostraba "Sin stock" aunque hubiera inventario.
    // Ahora usa las categorías reales de la tienda y la misma traducción que
    // el catálogo, para que los productos guardados con nombres viejos
    // ("Otros", "Mouse") también se cuenten.
    const data = CATEGORIAS_TIENDA.map(cat => ({
      name: cat,
      stock: products.filter(p => p && !esRepuesto(p.category) && normalizarCategoria(p.category) === cat).length
    }));
    return data.some(d => d && d.stock > 0) ? data : [];
  }, [products]);

  const handleExportCSV = (data: any[], fileName: string) => {
    if (data.length === 0) {
      toast.warning('No hay datos para exportar.');
      return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row => row && headers.map(header => header && JSON.stringify(row[header] ?? '')).join(','))
    ].join('\n');
    
    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${fileName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    addAuditLog(currentUser?.email || 'admin', 'Sistema', 'Exportar CSV', `Exportado archivo: ${fileName}.csv`);
  };

  if (!isAuthenticated || !currentUser || currentUser.role === 'Cliente') {
    return (
      <div className="min-h-dvh bg-[var(--bg-base)] flex items-center justify-center">
        <div className="animate-pulse text-[var(--text-secondary)] text-sm font-mono">Redireccionando al portal unificado...</div>
      </div>
    );
  }

  const isOwner = currentUser?.role === 'Dueño';

  /**
  /**
   * Abre un módulo en una pestaña —o salta a la suya si ya estaba
   * abierta— y deja la dirección apuntando a él.
   *
   * Lo segundo importa: la pestaña inicial se decide leyendo
   * /admin/<tab>, así que sin actualizar la dirección, recargar la
   * página siempre devolvía al panel general y un enlace compartido no
   * abría nunca el módulo que se quería enseñar. Se usa `replaceState` y
   * no `pushState` para no llenar el historial: quien pulsa "atrás"
   * espera salir del panel, no recorrer los doce módulos que visitó.
   */
  const irAModulo = useCallback((tab: string) => {
    pestanas.abrir(tab);
    setActiveDropdown(null);
    try { window.history.replaceState(null, '', `/admin/${tab}`); } catch { /* la navegación funciona igual */ }
  }, [pestanas.abrir]);

  // Antes era un arrow function inline en el JSX de Inventario: nuevo en
  // cada render, así que `InventarioControl` no podía memoizarse aunque
  // se envolviera en `React.memo` — su prop `onTabChange` cambiaba de
  // identidad de todas formas.
  const alCambiarSubTabInventario = useCallback(
    (sub: string) => irAModulo(`inventario_${sub}`),
    [irAModulo]
  );

  /**
   * Elegir un módulo desde dentro de «Nueva pestaña»: a diferencia de
   * `irAModulo`, esto REEMPLAZA esa pestaña por el módulo en vez de sumar
   * una más — ver `elegirDesdeNueva` en `usePestanas.ts`.
   */
  const elegirDesdeNueva = useCallback((tab: string) => {
    pestanas.elegirDesdeNueva(tab);
    setActiveDropdown(null);
    try { window.history.replaceState(null, '', `/admin/${tab}`); } catch { /* la navegación funciona igual */ }
  }, [pestanas.elegirDesdeNueva]);

  const esSupremo = useMemo(() => esAdminSupremo(currentUser?.email), [currentUser]);

  /**
   * El contenido de UNA pestaña.
   *
   * Se llama una vez por módulo abierto, no una vez por render del
   * panel: cada pestaña se monta cuando se abre y se queda montada
   * mientras siga abierta. Por eso un cobro a medio llenar sigue ahí
   * después de ir a consultar una existencia y volver — antes el
   * contenido vivía dentro de un `<motion.div key={activeTab}>`, y
   * cambiar la `key` en React destruye el árbol entero y lo reconstruye
   * desde cero.
   */
  const renderModulo = (tab: string) => (
    <>
          {tab === PESTANA_NUEVA && (
            <NuevaPestana
              onElegir={elegirDesdeNueva}
              esSupremo={esSupremo}
              abiertas={pestanas.abiertas}
            />
          )}
          {tab === 'dashboard' && (
            <AdminDashboard
              products={products}
              orders={orders}
              repairs={repairs}
              clients={clients}
              isMounted={isMounted}
              onNavigate={irAModulo}
            />
          )}
        {(tab === 'productos' || tab.startsWith('inventario_')) && (
          <Suspense fallback={<TabLoadingFallback />}>
            <InventarioControl
              currentUser={currentUser}
              onDataChanged={loadAllAdminData}
              defaultSubTab={tab.startsWith('inventario_') ? (tab.replace('inventario_', '') as any) : 'productos'}
              onTabChange={alCambiarSubTabInventario}
            />
          </Suspense>
        )}

        {tab === 'taller' && (
          <Suspense fallback={<TabLoadingFallback />}>
            <TallerKanban activeUserEmail={currentUser?.email} onRepairUpdated={loadAllAdminData} />
          </Suspense>
        )}

        {/* ------------------------------------------------------------------
            COBROS
            Panel de facturación, separado del taller a propósito: el taller
            registra el trabajo y aquí se cobra. Son dos actos distintos.
            ------------------------------------------------------------------ */}
        {tab === 'cobros' && (
          <Suspense fallback={<TabLoadingFallback />}>
            <FacturacionPanel currentUser={currentUser} onDataChanged={loadAllAdminData} />
          </Suspense>
        )}

        {tab === 'chat' && (
          <Suspense fallback={<TabLoadingFallback />}>
            <ChatCRM currentUser={currentUser} onDataChanged={loadAllAdminData} />
          </Suspense>
        )}

        {/* ------------------------------------------------------------------
            CLIENTES
            ------------------------------------------------------------------ */}
        {tab === 'clientes' && (
          <div className="tv-stack" id="view-clientes">
            <PageHead
              title="Clientes"
              subtitle={resolverModulo('clientes').descripcion}
              actions={
                <Btn variant="primary" icon={Plus} onClick={() => openClientModal()}>
                  Registrar cliente
                </Btn>
              }
            />

            {isClientModalOpen && (
              <Card title={editingClient ? 'Editar cliente' : 'Nuevo cliente'}>
                <form onSubmit={handleSaveClient} className="tv-stack">
                  <div className="tv-grid tv-grid-2">
                    <Field label="Nombre completo">
                      <input required type="text" className="tv-input" value={clientForm.name}
                        onChange={e => setClientForm({ ...clientForm, name: e.target.value })} />
                    </Field>
                    <Field label="Correo electrónico">
                      <input required type="email" className="tv-input" value={clientForm.email}
                        onChange={e => setClientForm({ ...clientForm, email: e.target.value })} />
                    </Field>
                    <Field label="Teléfono">
                      <input required type="tel" className="tv-input" value={clientForm.phone}
                        onChange={e => setClientForm({ ...clientForm, phone: e.target.value })} />
                    </Field>
                    <Field label="Provincia">
                      <CustomSelect
                        value={clientForm.province || ''}
                        onChange={(val) => setClientForm({ ...clientForm, province: val as any })}
                        options={['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'].map(p => ({ value: p, label: p }))}
                      />
                    </Field>
                    <Field label="Dirección exacta">
                      <input required type="text" className="tv-input" value={clientForm.addressDetail}
                        onChange={e => setClientForm({ ...clientForm, addressDetail: e.target.value })} />
                    </Field>
                    <Field label="Notas internas">
                      <textarea rows={2} className="tv-input" value={clientForm.notes}
                        onChange={e => setClientForm({ ...clientForm, notes: e.target.value })} />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setIsClientModalOpen(false)}>Cancelar</Btn>
                    <Btn type="submit" variant="primary" icon={Save}>Guardar cliente</Btn>
                  </div>
                </form>
              </Card>
            )}

            <Card title={`${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}`} padded={false}>
              {clients.length === 0 ? (
                <Empty
                  icon={Users}
                  title="Todavía no hay clientes"
                  text="Se registran solos cuando alguien crea su cuenta en la tienda, o se pueden agregar a mano desde el botón de arriba."
                />
              ) : (
                <TableShell
                  head={<>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Provincia</th>
                    <th style={{ textAlign: 'center' }}>Tarjetas</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </>}
                >
                  <PaginatedTbody items={clients} itemsPerPage={10} renderItem={(c) => (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.name}</td>
                      <td className="text-[12px] text-[var(--text-secondary)]">
                        <div className="font-mono">{c.email}</div>
                        <div className="font-mono">{c.phone}</div>
                      </td>
                      <td>{c.province}</td>
                      <td style={{ textAlign: 'center' }}>
                        {c.cardsTokenized.length > 0
                          ? <Chip tone="ok">•••• {c.cardsTokenized[0].last4}</Chip>
                          : <span className="text-[12px] text-[var(--text-muted)]">Ninguna</span>}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn variant="ghost" onClick={() => setClienteFicha(c)}>Ver ficha</Btn>
                          <button type="button" className="tv-icon-btn" onClick={() => openClientModal(c)} title="Editar cliente" aria-label="Editar cliente">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="tv-icon-btn"
                            onClick={() => handleForcePasswordReset(c.email, c.name)}
                            disabled={resettingClientEmail === c.email}
                            title="Forzar cambio de contraseña"
                            aria-label="Forzar cambio de contraseña"
                          >
                            {resettingClientEmail === c.email ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            className="tv-icon-btn hover:!text-[#E5484D]"
                            onClick={() => handleAnonimizarCliente(c)}
                            title="Eliminar cliente (anonimiza sus datos y conserva el historial)"
                            aria-label="Eliminar cliente"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )} />
                </TableShell>
              )}
            </Card>

            {clienteFicha && (
              <Suspense fallback={null}>
                <ClienteFicha
                  cliente={clienteFicha}
                  pedidos={orders}
                  adminEmail={currentUser?.email}
                  onCerrar={() => setClienteFicha(null)}
                  onCambios={loadAllAdminData}
                />
              </Suspense>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------
            CONTABILIDAD
            ------------------------------------------------------------------ */}
        {tab === 'facturacion' && (
          <div className="tv-stack" id="view-facturacion">
            <PageHead
              title="Contabilidad"
              subtitle={resolverModulo('facturacion').descripcion}
              actions={
                <Btn icon={Download} onClick={() => handleExportCSV(orders.map(o => o && ({
                  Consecutivo: o.id,
                  Fecha: o.timestamp,
                  Cliente: o.customerName,
                  Subtotal: o.subtotal,
                  IVA: o.taxAmount,
                  Total: o.total,
                  Estado: o.status,
                })), 'Reporte_IVA_D104')}>
                  Reporte IVA (D-104)
                </Btn>
              }
            />

            <Card title="Comprobantes electrónicos" padded={false}>
              {orders.length === 0 ? (
                <Empty
                  icon={FileSpreadsheet}
                  title="Sin comprobantes emitidos"
                  text="Cada venta completada genera aquí su comprobante, con el IVA desglosado y su estado ante Hacienda."
                />
              ) : (
                <TableShell
                  head={<>
                    <th>Consecutivo</th>
                    <th>Cliente</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                    <th style={{ textAlign: 'right' }}>IVA (13%)</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'center' }}>Hacienda</th>
                    <th style={{ textAlign: 'center' }}>Correo</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </>}
                >
                  <PaginatedTbody items={orders} itemsPerPage={10} renderItem={(o) => {
                    const factura = facturasPorPedido[o.id];
                    const enviado = factura?.emailStatus === 'enviado';
                    return (
                    <tr key={o.id}>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">{o.id}</td>
                      <td className="font-semibold">{o.customerName}</td>
                      <td style={{ textAlign: 'right' }} className="tabular-nums">₡{o.subtotal.toLocaleString('es-CR')}</td>
                      <td style={{ textAlign: 'right' }} className="tabular-nums text-[var(--text-secondary)]">₡{o.taxAmount.toLocaleString('es-CR')}</td>
                      <td style={{ textAlign: 'right' }} className="tabular-nums font-semibold">₡{o.total.toLocaleString('es-CR')}</td>
                      <td style={{ textAlign: 'center' }}>
                        <Chip tone={o.hdaStatus === 'Aceptado' ? 'ok' : 'accent'}>{o.hdaStatus}</Chip>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {!factura ? (
                          <span className="text-[10px] text-[var(--text-secondary)]">Sin comprobante</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <Chip tone={enviado ? 'ok' : 'alert'}>{enviado ? 'Enviado' : 'Pendiente'}</Chip>
                            {!enviado && (
                              <button
                                type="button"
                                className="tv-icon-btn"
                                title="Reenviar comprobante por correo"
                                aria-label="Reenviar comprobante por correo"
                                disabled={reenviandoFactura === factura.id}
                                onClick={() => reenviarComprobante(factura.id)}
                              >
                                {reenviandoFactura === factura.id
                                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                                  : <Mail className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {o.status !== 'Devuelto' && o.status !== 'Cancelado' ? (
                          <Btn variant="danger" onClick={() => handleIssueCreditNote(o.id)}>Nota de crédito</Btn>
                        ) : (
                          <Chip tone="alert">Devuelto</Chip>
                        )}
                      </td>
                    </tr>
                    );
                  }} />
                </TableShell>
              )}
            </Card>
          </div>
        )}

        {/* ------------------------------------------------------------------
            MARKETING
            ------------------------------------------------------------------ */}
        {tab === 'marketing' && (
          <div className="tv-stack" id="view-marketing">
            <PageHead
              title="Marketing"
              subtitle={resolverModulo('marketing').descripcion}
              actions={
                <Btn variant="primary" icon={Plus} onClick={() => setIsCouponModalOpen(true)}>
                  Nuevo cupón
                </Btn>
              }
            />

            {isCouponModalOpen && (
              <Card title="Nuevo cupón">
                <form onSubmit={handleSaveCoupon} className="tv-stack">
                  <div className="tv-grid tv-grid-2">
                    <Field label="Código promocional">
                      <input required type="text" className="tv-input font-mono uppercase" placeholder="TECHNO2026"
                        value={couponForm.code}
                        onChange={e => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="Tipo de descuento">
                      <CustomSelect
                        value={couponForm.type || ''}
                        onChange={(val) => setCouponForm({ ...couponForm, type: val as any })}
                        options={[
                          { value: 'Porcentaje', label: '% Porcentaje' },
                          { value: 'Fijo', label: '₡ Monto fijo' },
                        ]}
                      />
                    </Field>
                    <Field label="Valor">
                      <input required type="number" className="tv-input" value={couponForm.value}
                        onChange={e => setCouponForm({ ...couponForm, value: parseFloat(e.target.value) })} />
                    </Field>
                    <Field
                      label="Límite de usos"
                      hint="Regla fija del sistema: un solo uso por cupón, y vence a los 60 días de creado."
                    >
                      <input disabled type="number" className="tv-input" value={1} />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setIsCouponModalOpen(false)}>Cancelar</Btn>
                    <Btn type="submit" variant="primary" icon={Save}>Guardar cupón</Btn>
                  </div>
                </form>
              </Card>
            )}

            <Card title="Cupones de descuento" padded={false}>
              {campaigns.length === 0 ? (
                <Empty
                  icon={Megaphone}
                  title="Sin cupones creados"
                  text="Un cupón permite aplicar un descuento en la tienda con un código. Cada uno sirve para una sola compra."
                />
              ) : (
                <TableShell
                  head={<>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th style={{ textAlign: 'center' }}>Usos</th>
                    <th style={{ textAlign: 'center' }}>Vence</th>
                    <th style={{ textAlign: 'center' }}>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </>}
                >
                  <PaginatedTbody items={campaigns} itemsPerPage={10} renderItem={(c) => (
                    <tr key={c.id}>
                      <td className="font-mono font-bold">{c.code}</td>
                      <td>{c.type}</td>
                      <td style={{ textAlign: 'right' }} className="tabular-nums">
                        {c.type === 'Porcentaje' ? `${c.value}%` : `₡${c.value.toLocaleString('es-CR')}`}
                      </td>
                      <td style={{ textAlign: 'center' }} className="text-[var(--text-secondary)]">{c.used} / {c.limit}</td>
                      <td style={{ textAlign: 'center' }} className="text-[var(--text-secondary)]">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('es-CR') : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <Chip tone={c.active ? 'ok' : undefined}>{c.active ? 'Activo' : 'Inactivo'}</Chip>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Btn variant="ghost" onClick={() => {
                          const db = getDB();
                          const idx = db.marketing_campaigns.findIndex(mc => mc && mc.id === c.id);
                          if (idx !== -1) {
                            db.marketing_campaigns[idx].active = !c.active;
                            saveDB(db);
                            loadAllAdminData();
                          }
                        }}>
                          {c.active ? 'Desactivar' : 'Activar'}
                        </Btn>
                      </td>
                    </tr>
                  )} />
                </TableShell>
              )}
            </Card>
          </div>
        )}

        {/* ------------------------------------------------------------------
            CIBERSEGURIDAD
            Absorbe la antigua pestaña "Bitácora de Auditoría": esa tabla
            vive ahora como una sección de este panel, con los mismos
            datos y el mismo botón de limpiar.
            ------------------------------------------------------------------ */}
        {tab === 'ciberseguridad' && (
          <Suspense fallback={<TabLoadingFallback />}>
            <CyberSecurityPanel
              auditLog={auditLog}
              currentUserEmail={currentUser?.email}
              onAuditLogChanged={loadAllAdminData}
            />
          </Suspense>
        )}

        {/* ------------------------------------------------------------------
            CONFIGURACIÓN
            ------------------------------------------------------------------ */}
        {tab === 'configuracion' && (
          <div className="tv-stack" id="view-configuracion">
            <PageHead
              title="Configuración"
              subtitle={resolverModulo('configuracion').descripcion}
              actions={<Btn variant="primary" icon={Save} onClick={handleSaveConfig}>Guardar cambios</Btn>}
            />

            <Card title="Datos fiscales">
              <div className="tv-grid tv-grid-2">
                {/* El emisor es una persona física. La etiqueta decía "Cédula
                    jurídica" y el ejemplo mostraba un número de sociedad, lo
                    que llevaba a cargar el dato equivocado. El nombre interno
                    del campo no cambia: renombrarlo obligaría a tocar a la vez
                    la base, la función que emite las facturas y el PDF. */}
                <Field
                  label="Identificación del emisor"
                  hint="Es la que sale impresa en cada comprobante y viaja en el QR de verificación."
                >
                  <input type="text" className="tv-input font-mono" placeholder="119090965"
                    value={cedulaJuridica} onChange={e => setCedulaJuridica(e.target.value)} />
                </Field>
                <Field label="Teléfono fiscal oficial">
                  <input type="text" className="tv-input font-mono" placeholder="+506 0000 0000"
                    value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} />
                </Field>
                <Field label="Domicilio fiscal y punto de retiro">
                  <input type="text" className="tv-input" placeholder="Provincia, cantón, distrito y señas exactas"
                    value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} />
                </Field>
                <Field label="Horarios de retiro" hint="El retiro es estrictamente con cita previa.">
                  <input type="text" className="tv-input" placeholder="Lunes a viernes, 1pm a 6pm"
                    value={pickupHours} onChange={e => setPickupHours(e.target.value)} />
                </Field>
              </div>
            </Card>

            <Card title="Integraciones">
              <Field
                label="Webhook de Instagram (Zapier)"
                hint='URL del "Catch Hook" de un Zap (Webhook → Instagram Publish Photo). Con esto configurado, las publicaciones programadas desde Inventario salen solas en la fecha elegida, sin que nadie tenga que abrir la aplicación en ese momento.'
              >
                <input type="url" className="tv-input font-mono" placeholder="https://hooks.zapier.com/hooks/catch/…"
                  value={instagramWebhookUrl} onChange={e => setInstagramWebhookUrl(e.target.value)} />
              </Field>
            </Card>

            <Card title="Logo de la tienda">
              <div className="flex flex-col sm:flex-row items-start gap-5">
                <div className="w-20 h-20 rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-sunken)] flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={storeLogoPreview || storeLogo || '/logo.png'} alt="" className="max-w-full max-h-full object-contain" />
                </div>
                <Field
                  label="Nueva imagen"
                  className="flex-1 w-full"
                  hint="Se aplica de inmediato en la tienda y en el panel. La imagen se comprime antes de guardarse."
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="w-full text-[13px] text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3.5 file:rounded-[10px] file:border-0 file:text-[12.5px] file:font-bold file:bg-[var(--accent)] file:text-[var(--accent-ink)] file:cursor-pointer"
                  />
                </Field>
              </div>
            </Card>

            <Card title="Accesos administrativos">
              <div className="tv-stack">
                <p className="tv-hint !mt-0">
                  Toda cuenta creada aquí recibe acceso total al panel. No existen roles limitados: cualquier
                  cuenta autenticada en el panel es Administrador.
                </p>

                <div>
                  <Btn onClick={() => { setShowCreateUserForm(!showCreateUserForm); setGeneratedUserPass(null); setPromotedUserEmail(null); }}>
                    {showCreateUserForm ? 'Ocultar formulario' : 'Crear nuevo usuario'}
                  </Btn>
                </div>

                {showCreateUserForm && (
                  <form onSubmit={handleCreateUserSubmit} className="tv-stack">
                    <div className="tv-grid tv-grid-2">
                      <Field label="Nombre completo">
                        <input type="text" required className="tv-input"
                          value={newUserName} onChange={e => setNewUserName(e.target.value)} />
                      </Field>
                      <Field label="Correo electrónico">
                        <input type="email" required className="tv-input font-mono"
                          value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Contraseña" hint="Si se deja vacía, el sistema genera una segura y la muestra una sola vez.">
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          className="tv-input font-mono pr-10"
                          value={newUserPassword}
                          onChange={e => setNewUserPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 tv-icon-btn !w-7 !h-7"
                          aria-label={showPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </Field>
                    <div>
                      <Btn type="submit" variant="primary" disabled={isCreatingUser} icon={UserPlus}>
                        {isCreatingUser ? 'Creando…' : 'Registrar usuario'}
                      </Btn>
                    </div>
                  </form>
                )}

                {generatedUserPass && (
                  <div className="rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-sunken)] p-4">
                    <div className="tv-label !mb-1">Contraseña del nuevo administrador</div>
                    <div className="font-mono text-[15px] font-bold text-[var(--text-primary)] break-all">{generatedUserPass}</div>
                    <p className="tv-hint">
                      Anótela ahora: no se vuelve a mostrar y no queda guardada en ninguna parte del panel.
                    </p>
                  </div>
                )}

                {promotedUserEmail && (
                  <div className="rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-sunken)] p-4">
                    <div className="tv-label !mb-1">Cuenta existente ascendida</div>
                    <div className="font-mono text-[15px] font-bold text-[var(--text-primary)] break-all">{promotedUserEmail}</div>
                    <p className="tv-hint">
                      Este correo ya tenía cuenta (por ejemplo, como cliente); ahora tiene acceso total al panel. Su contraseña sigue siendo la que ya tenía.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* La nota legal va al final y contraída: es información de
                referencia que hay que poder consultar, no algo que deba
                competir por la atención cada vez que se abre la pantalla.
                Antes ocupaba media pantalla en un recuadro ámbar. */}
            <details className="tv-card">
              <summary className="tv-card-head cursor-pointer list-none">
                <span className="tv-card-title">Nota de cumplimiento legal (Costa Rica)</span>
                <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
              </summary>
              <div className="tv-card-body space-y-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                <p>
                  <strong className="text-[var(--text-primary)]">Facturación electrónica (Hacienda / DGT):</strong>{' '}
                  toda venta debe documentarse mediante comprobante electrónico autorizado (factura, tiquete o nota
                  de crédito electrónica) conforme al Reglamento de Comprobantes Electrónicos para Efectos
                  Tributarios (resolución DGT-R-48-2016 y sus reformas), con el Impuesto al Valor Agregado
                  desglosado por línea según la Ley del IVA (Ley N.º 9635) y transmitido al Ministerio de Hacienda
                  para su validación.
                </p>
                <p>
                  <strong className="text-[var(--text-primary)]">Protección al consumidor (MEIC / Ley N.º 7472):</strong>{' '}
                  los precios publicados deben mostrarse en colones costarricenses con impuestos incluidos, sin
                  cargos ocultos. El plazo, costo y condiciones de entrega deben informarse antes de completar la
                  compra. La persona consumidora tiene derecho a la reversión del cargo y a devoluciones cuando el
                  bien no corresponda a lo ofrecido.
                </p>
                <p>
                  <strong className="text-[var(--text-primary)]">Protección de datos (PRODHAB / Ley N.º 8968):</strong>{' '}
                  los datos de clientes (identificación, contacto, medios de pago) se recaban con consentimiento
                  informado, se usan únicamente para los fines de la relación comercial y están sujetos a los
                  derechos de acceso, rectificación, cancelación y oposición.
                </p>
              </div>
            </details>
          </div>
        )}

        {/* ------------------------------------------------------------------
            GESTIÓN DE USUARIOS — solo administrador supremo
            ------------------------------------------------------------------
            Doble gateo, a propósito: AdminShell.tsx ya oculta la entrada de
            menú para llegar a `tab === 'gestion_usuarios'` si la cuenta
            no es la supremo, pero eso no impide que alguien fuerce el tab a
            mano. Este `esAdminSupremo(...)` de aquí es la comprobación de
            frontend que de verdad bloquea el RENDERIZADO del panel — y aun
            así, cada función que el panel llama vuelve a comprobarlo en el
            servidor (ver GestionUsuariosPanel.tsx). */}
        {tab === 'gestion_usuarios' && esAdminSupremo(currentUser?.email) && (
          <Suspense fallback={<TabLoadingFallback />}>
            <GestionUsuariosPanel currentUser={currentUser} />
          </Suspense>
        )}
    </>
  );

  return (
    <AdminShell
      activeTab={activeTab}
      onNavigate={irAModulo}
      currentUser={currentUser}
      onLogout={handleLogout}
      onNavigateToStore={onNavigateToStore}
      logoUrl={storeLogoPreview || storeLogo || undefined}
      pestanasAbiertas={pestanas.abiertas}
      pestanaActiva={pestanas.activa}
      onCerrarPestana={pestanas.cerrar}
      scrollRef={scrollRef}
    >
      {showLoginToast && (
        <div className="fixed bottom-6 right-6 z-[998] tv-card px-4 py-3 flex items-center gap-3 shadow-lg">
          <CheckCircle className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
          <span className="text-sm text-[var(--text-primary)]">{loginToastMessage}</span>
        </div>
      )}

      {/* -------------------------------------------------------------
          UN PANEL POR PESTAÑA ABIERTA
          -------------------------------------------------------------
          `<Activity mode="hidden">` es la pieza que hace que esto salga
          gratis. Hace tres cosas que a mano no se pueden hacer bien:

          1. CONSERVA EL ESTADO del módulo oculto —que es todo el punto de
             las pestañas: el cobro a medio llenar sigue ahí.
          2. DESMONTA SUS EFECTOS. Los intervalos, las suscripciones de
             Realtime y los listeners de una pestaña de fondo se apagan
             solos y se vuelven a montar al volver. Sin esto, cinco
             pestañas abiertas serían cinco módulos consultando a Supabase
             en segundo plano para nada.
          3. RENDERIZA EN BAJA PRIORIDAD. React deja el trabajo de lo
             oculto por detrás de todo lo visible, así que escribir en un
             formulario no compite con el repintado de cuatro módulos que
             nadie está mirando.

          El `<div>` con `hidden` sigue estando porque Activity oculta su
          contenido pero no nos da dónde colgar la clase ni el rol. */}
      {pestanas.abiertas.map(modulo => {
        const esActiva = modulo === pestanas.activa;
        return (
          <Activity key={modulo} mode={esActiva ? 'visible' : 'hidden'}>
            <div className="tv-tab-panel" hidden={!esActiva} role="tabpanel">
              {/* Aunque estén ocultas, las pestañas de fondo se renderizan
                  al menos una vez. Sin esta marca sus `PageHead` mandaban
                  acciones y subtítulo a la regleta igual que la activa: se
                  veían las acciones de Cobros y las de Inventario a la vez,
                  y los dos subtítulos pegados en la misma línea. */}
              <ContextoPestanaActiva.Provider value={esActiva}>
                {renderModulo(pestanas.tabDe(modulo))}
              </ContextoPestanaActiva.Provider>
            </div>
          </Activity>
        );
      })}
    </AdminShell>
  );
}
