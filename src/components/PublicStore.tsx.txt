import { motion, AnimatePresence } from "motion/react";
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { PaginatedGrid } from './PaginationHelper';
import { 
  ShoppingBag, Search, ChevronDown, Trash2, ArrowRight,
  MapPin, CreditCard, CheckCircle, Smartphone, Wrench, Settings,
  MessageSquare, Sparkles, AlertCircle, FileDown, Heart, ShieldAlert,
  User as UserIcon, X, LogOut, Sun, Moon, Home, LayoutGrid
} from 'lucide-react';
import { ProductCard } from './ProductCard';
import { CustomSelect } from './CustomSelect';
import { MarketingRow } from './MarketingRow';
import { FeaturedCategoriesCarousel } from './FeaturedCategoriesCarousel';
import { Product, Order, OrderItem, RepairOrder } from '../types';
import { supabase } from '../supabaseClient';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { processSaleAtomic } from '../utils/transactions';
import LiveChat from './LiveChat';
import { useToast } from './ui/Overlays';
import {
  IdentificacionTipo, TipoDoc, MedioPago, validateCedula, computeInvoiceTotals,
  buildInvoicePdfBlob, generateQrDataUrl, InvoiceData
} from '../utils/invoicePdf';

import { User } from '../types';

const DEFAULT_CAABYS = '8399000000000';

interface PublicStoreProps {
  onNavigateToAdmin: () => void;
  onRefreshTrigger?: number;
  currentUser: User | null;
  isAuthenticated: boolean;
  onLogin: (user: User) => void;
  onLogout: () => void;
  autoOpenLogin?: boolean;
  onClearAutoOpenLogin?: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const COSTA_RICA_PROVINCES = [
  'San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'
];


function usePagination(items, itemsPerPage = 10) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [items.length]);
  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);
  return { page, setPage, totalPages, startIndex, visibleItems, itemsPerPage };
}

export default function PublicStore({ 
  onNavigateToAdmin, 
  onRefreshTrigger,
  currentUser,
  isAuthenticated,
  onLogin,
  onLogout,
  autoOpenLogin,
  onClearAutoOpenLogin,
  theme,
  toggleTheme
}: PublicStoreProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [dbInstance, setDbInstance] = useState<any>(null);
  const [storeLogo, setStoreLogo] = useState<string | null>(null);
  const db = getDB();
  const handleDropdownEnter = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const dropdown = button.querySelector('.dynamic-dropdown') as HTMLElement;
    if (dropdown) {
      if (spaceRight < 320) {
        dropdown.style.left = 'auto';
        dropdown.style.right = '0';
      } else {
        dropdown.style.left = '0';
        dropdown.style.right = 'auto';
      }
    }
  };

  useEffect(() => {
    const loadLogo = () => import("../utils/storage").then(mod => mod.getLogo().then(logo => { if (logo) setStoreLogo(logo); }));
    loadLogo();
    window.addEventListener("store_logo_updated", loadLogo);
    return () => window.removeEventListener("store_logo_updated", loadLogo);
  }, []);

  // Dropdown states for Option 3 Glass Header
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isCartDropdownOpen, setIsCartDropdownOpen] = useState(false);
  const [isCartBouncing, setIsCartBouncing] = useState(false);
  const [isCatalogDropdownOpen, setIsCatalogDropdownOpen] = useState(false);
  const catalogCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openCatalogDropdown = () => {
    if (catalogCloseTimer.current) { clearTimeout(catalogCloseTimer.current); catalogCloseTimer.current = null; }
    setIsAccountDropdownOpen(false);
    setIsCartDropdownOpen(false);
    setIsCatalogDropdownOpen(true);
  };
  const scheduleCloseCatalogDropdown = () => {
    if (catalogCloseTimer.current) clearTimeout(catalogCloseTimer.current);
    catalogCloseTimer.current = setTimeout(() => setIsCatalogDropdownOpen(false), 180);
  };
  useEffect(() => {
    return () => { if (catalogCloseTimer.current) clearTimeout(catalogCloseTimer.current); };
  }, []);

  // Unified login & registration states
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regProvince, setRegProvince] = useState('San José');
  const [regAddress, setRegAddress] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // App state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSearchProductId, setSelectedSearchProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'store' | 'repairs'>('store');
  
  // Shopping cart state
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Checkout process state
  const [checkoutStep, setCheckoutStep] = useState<number>(0); // 0 = cart, 1 = delivery, 2 = payment, 3 = confirmed
  const [shippingProvince, setShippingProvince] = useState<string>('San José');
  const [shippingAddress, setShippingAddress] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  
  // Payment States
  const [paymentMethod, setPaymentMethod] = useState<'SINPE' | 'Tarjeta'>('SINPE');
  const [sinpePhone, setSinpePhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  // Datos fiscales (Facturación Electrónica CR v4.3 — registro interno)
  const [fiscalTipoDoc, setFiscalTipoDoc] = useState<TipoDoc>('04');
  const [fiscalIdType, setFiscalIdType] = useState<IdentificacionTipo>('01');
  const [fiscalIdValue, setFiscalIdValue] = useState('');
  const [fiscalEmail, setFiscalEmail] = useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [invoiceInfo, setInvoiceInfo] = useState<{ id: string; clave: string; consecutivo: string; qrDataUrl: string; pdfUrl: string | null } | null>(null);

  // Marketing states
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);

  // Interactive product detail modal state
  const [selectedProductDetail, setSelectedProductDetail] = useState<Product | null>(null);
  const [detailQuantity, setDetailQuantity] = useState<number>(1);
  // Avisos unificados vía el kit de superposiciones (top-center, capa
  // pointer-events:none): reemplaza el toast propio fixed bottom-right z-[998]
  // que se sobreponía a los menús (hojas inferiores) y bloqueaba el toque.
  const toast = useToast();

  // Repair Request Form state
  const [repairDevice, setRepairDevice] = useState('');
  const [repairDamage, setRepairDamage] = useState('');
  const [repairCustomerName, setRepairCustomerName] = useState('');
  const [repairCustomerEmail, setRepairCustomerEmail] = useState('');
  const [generatedTicket, setGeneratedTicket] = useState<string | null>(null);

  // Active Hero Slide
  const [heroSlide, setHeroSlide] = useState(0);
  useEffect(() => {
    if (isCartOpen || selectedProductDetail || isLoginModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => { document.body.style.overflow = "auto"; };
  }, [isCartOpen, selectedProductDetail, isLoginModalOpen]);

  // Dynamic dropdown positioning to prevent going off-screen (desktop only —
  // on mobile these panels use a fixed bottom-sheet layout via Tailwind classes)
  useLayoutEffect(() => {
    const handleDropdownPosition = () => {
      if (window.innerWidth < 768) return;
      const dropdowns = document.querySelectorAll('.dynamic-dropdown');
      dropdowns.forEach(dropdown => {
        const el = dropdown as HTMLElement;
        // Reset to default right-0 first to get accurate rect
        el.style.right = '0px';
        el.style.left = 'auto';
        
        const rect = el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const width = el.offsetWidth;
        
        // Transform origin is top right, so rect.right is stable during scale animation.
        // We calculate the final unscaled left edge.
        const finalLeftEdge = rect.right - width;
        
        if (finalLeftEdge < 16) {
          // If it overflows left, shift it right by decreasing 'right' (making it negative)
          const shift = 16 - finalLeftEdge;
          el.style.right = `-${shift}px`;
        } else if (rect.right > viewportWidth - 16) {
          // If it overflows right, shift it left by increasing 'right'
          const shift = rect.right - (viewportWidth - 16);
          el.style.right = `${shift}px`;
        }
      });
    };

    handleDropdownPosition();
    window.addEventListener('resize', handleDropdownPosition);
    return () => window.removeEventListener('resize', handleDropdownPosition);
  }, [isAccountDropdownOpen, isCartDropdownOpen]);

  // Real-time Cart bounce engine (200ms scale feedback)
  const prevCartCount = React.useRef(0);
  useEffect(() => {
    const totalQty = cart.reduce((sum, it) => sum + it.quantity, 0);
    if (totalQty !== prevCartCount.current) {
      setIsCartBouncing(true);
      const timer = setTimeout(() => setIsCartBouncing(false), 200);
      prevCartCount.current = totalQty;
      return () => clearTimeout(timer);
    }
  }, [cart]);

  useEffect(() => {
    if (autoOpenLogin) {
      setIsLoginModalOpen(true);
      setIsRegisterMode(false);
      if (onClearAutoOpenLogin) {
        onClearAutoOpenLogin();
      }
    }
  }, [autoOpenLogin]);

  const handleClientLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();

    // Autenticación real y segura vía Supabase Auth (contraseñas nunca viajan
    // en texto plano ni se comparan en el navegador).
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: loginPassword,
    });

    if (authError || !authData.user) {
      toast.error('Credenciales inválidas. Por favor verifique el correo y contraseña.');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      toast.error('No se pudo cargar el perfil de la cuenta. Contacte al administrador.');
      return;
    }

    const loggedUser: User = {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      name: profile.name || profile.email,
    };

    onLogin(loggedUser);
    setIsLoginModalOpen(false);
    setLoginEmail('');
    setLoginPassword('');
    toast.success(`Bienvenido, ${loggedUser.name}. Sesión iniciada con éxito.`);
  };

  const handleClientRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim() || !regPhone.trim() || !regAddress.trim() || !regPassword.trim()) {
      toast.warning('Por favor complete todos los datos.');
      return;
    }

    const cleanEmail = regEmail.trim().toLowerCase();

    // Supabase Auth crea la cuenta y un ÚNICO trigger en la base de datos
    // (handle_new_user) genera de forma atómica tanto el perfil de "profiles"
    // como el perfil comercial en "client_profiles", leyendo estos metadatos.
    // Así el cliente SIEMPRE queda guardado y visible para el admin, sin
    // depender de una segunda petición del frontend (que fallaba sin sesión).
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password: regPassword,
      options: {
        data: {
          name: regName.trim(),
          phone: regPhone.trim(),
          province: regProvince,
          address: regAddress.trim(),
          source: 'portal_cliente',
        },
      },
    });

    if (authError) {
      toast.error('Error creando la cuenta: ' + (authError.message || 'el correo ya podría estar registrado.'));
      return;
    }
    if (!authData.user) {
      toast.error('No se pudo crear la cuenta. Intente de nuevo.');
      return;
    }

    // Si el proyecto de Supabase requiere confirmación de correo, todavía no
    // hay sesión activa: se le pide confirmar antes de iniciar sesión. El
    // perfil comercial ya quedó creado por el trigger, así que no se pierde.
    if (!authData.session) {
      toast.success(`¡Cuenta creada! Revisa tu correo (${cleanEmail}) para confirmarla antes de iniciar sesión.`);
      setIsLoginModalOpen(false);
      setIsRegisterMode(false);
      setRegName(''); setRegEmail(''); setRegPhone(''); setRegAddress(''); setRegPassword('');
      return;
    }

    const clientUser: User = {
      id: authData.user.id,
      email: cleanEmail,
      role: 'Cliente',
      name: regName.trim(),
    };

    onLogin(clientUser);
    setIsLoginModalOpen(false);
    toast.success(`¡Cuenta creada con éxito! Bienvenido a Technoverse, ${regName.trim()}.`);

    setRegName('');
    setRegEmail('');
    setRegPhone('');
    setRegAddress('');
    setRegPassword('');
  };

  useEffect(() => {
    loadStoreProducts();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'technoverse_db') {
        loadStoreProducts();
      }
    };
    const handleCustomUpdate = () => {
      loadStoreProducts();
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('technoverse_db_updated', handleCustomUpdate);
    window.addEventListener('product:created', handleCustomUpdate);
    window.addEventListener('stock:update', handleCustomUpdate);

    // BroadcastChannel for instant multi-tab sync
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('technoverse_db_channel');
      channel.onmessage = (event) => {
        if (event.data && event.data.type === 'UPDATE_DB') {
          loadStoreProducts();
        }
      };
    } catch (err) {
      // BroadcastChannel not supported or restricted
    }

    // Dynamic 1-second interval checks to guarantee real-time updates inside nested frames
    const interval = setInterval(() => {
      loadStoreProducts();
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('technoverse_db_updated', handleCustomUpdate);
      window.removeEventListener('product:created', handleCustomUpdate);
      window.removeEventListener('stock:update', handleCustomUpdate);
      if (channel) {
        channel.close();
      }
      clearInterval(interval);
    };
  }, [onRefreshTrigger]);

  const loadStoreProducts = () => {
    // IMPORTANTE: leer SIEMPRE datos frescos con getDB(). Antes se usaba la
    // variable "db" capturada en el primer render (cuando Supabase aún no
    // había respondido y estaba vacía), por eso el visitante anónimo veía
    // todo vacío hasta que un re-render (p. ej. al iniciar sesión) traía datos
    // nuevos. Con getDB() aquí, cada tick/evento refleja el estado real.
    const freshDb = getDB();
    setDbInstance(freshDb);
    setStoreLogo(freshDb.settings?.storeLogo || null);
    // Filter out spare part categories from public store
    const SPARE_PART_CATEGORIES = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];
    setProducts((freshDb.products || []).filter(p => p && p.active !== false && Number(p.stock) > 0 && !SPARE_PART_CATEGORIES.includes(p.category) && p.category !== 'Repuestos'));
    setBanners(freshDb.banners ? freshDb.banners.filter(b => b && b.active) : []);
  };

  // Search input autocompletion logic in Spanish
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setSelectedSearchProductId(null);
    if (!val.trim()) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    const matched = products.filter(p => p && (
      (p.name && p.name.toLowerCase().includes(val.toLowerCase())) ||
      (p.category && p.category.toLowerCase().includes(val.toLowerCase())) ||
      (p.sku && p.sku.toLowerCase().includes(val.toLowerCase()))
    ));
    setSearchResults(matched);
    setShowSearchDropdown(true);
  };

  const handleSelectSearchProduct = (p: Product) => {
    setSearchQuery(p.name);
    setShowSearchDropdown(false);
    setSelectedSearchProductId(p.id);
  };

  const handleResetSearch = () => {
    setSearchQuery('');
    setSelectedSearchProductId(null);
    loadStoreProducts();
  };

  const getProductDiscountedPrice = (prod: Product) => prod.price;

  // Shipping calculation based on destination province
  const calculateShippingCost = (prov: string) => prov === 'San José' ? 2500 : 4000;

  const handleAddToCart = (prod: Product) => {
    if (prod.stock <= 0) {
      toast.warning('¡Disculpe! Este producto se encuentra agotado.');
      return;
    }

    const existingIdx = cart.findIndex(it => it.product.id === prod.id);
    if (existingIdx !== -1) {
      if (cart[existingIdx].quantity >= prod.stock) {
        toast.warning(`¡Lo sentimos! Solo hay ${prod.stock} unidades disponibles en stock de este artículo.`);
        return;
      }
      setCart(cart.map((it, idx) => idx === existingIdx ? { ...it, quantity: it.quantity + 1 } : it));
    } else {
      setCart([...cart, { product: prod, quantity: 1 }]);
    }
    setIsCartOpen(true);
  };

  const handleAddToCartWithQty = (prod: Product, qty: number) => {
    if (prod.stock <= 0) {
      toast.warning('¡Disculpe! Este producto se encuentra agotado.');
      return;
    }
    if (qty > prod.stock) {
      toast.warning(`¡Lo sentimos! Solo hay ${prod.stock} unidades disponibles en stock de este artículo.`);
      return;
    }

    const existingIdx = cart.findIndex(it => it.product.id === prod.id);
    if (existingIdx !== -1) {
      const newTotalQty = cart[existingIdx].quantity + qty;
      if (newTotalQty > prod.stock) {
        toast.warning(`¡Lo sentimos! No puede superar el stock de ${prod.stock} unidades en total en su carrito.`);
        return;
      }
      setCart(cart.map((it, idx) => idx === existingIdx ? { ...it, quantity: newTotalQty } : it));
    } else {
      setCart([...cart, { product: prod, quantity: qty }]);
    }

    // Aviso de confirmación (unificado en el kit)
    toast.success(`¡Añadido con éxito! ${qty} x ${prod.name}`);

    // Close the product modal and open the cart dropdown so they see it
    setSelectedProductDetail(null);
    setIsCartDropdownOpen(true);
  };

  const handleUpdateCartQty = (idx: number, newQty: number) => {
    if (newQty <= 0) {
      setCart(cart.filter((_, i) => i !== idx));
      return;
    }

    const item = cart[idx];
    if (newQty > item.product.stock) {
      toast.warning(`Únicamente hay ${item.product.stock} unidades disponibles en stock.`);
      return;
    }

    setCart(cart.map((it, i) => i === idx ? { ...it, quantity: newQty } : it));
  };

  const handleRemoveFromCart = (idx: number) => {
    setCart(cart.filter((_, i) => i !== idx));
  };

  // Calculations for subtotal, discount, tax, shipping, total
  const cartSubtotal = cart.reduce((sum, it) => sum + (it.product.price * it.quantity), 0);
  
  const discountedSubtotal = cartSubtotal;

  let couponDiscountAmount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.type === 'Porcentaje') {
      couponDiscountAmount = Math.round(discountedSubtotal * (appliedCoupon.value / 100));
    } else {
      couponDiscountAmount = appliedCoupon.value;
    }
  }

  const subtotalAfterCoupon = Math.max(0, discountedSubtotal - couponDiscountAmount);

  const cartShipping = cart.length > 0 ? calculateShippingCost(shippingProvince) : 0;
  
  // IVA 13% Costa Rica applied to subtotal minus discounts
  const cartTax = Math.round(subtotalAfterCoupon * 0.13);
  const cartTotal = subtotalAfterCoupon + cartShipping + cartTax;

  const handleApplyCoupon = () => {
    
    const coupon = db.marketing_campaigns?.find(c => c.code.toUpperCase() === couponCode.toUpperCase() && c.active);
    if (!coupon) {
      toast.error("Cupón no encontrado o inactivo.");
      return;
    }
    if (coupon.used >= coupon.limit) {
      toast.warning("El cupón ha excedido su límite de usos.");
      return;
    }
    setAppliedCoupon(coupon);
  };

  // Complete functional checkout and stock update
  const handleConfirmOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    if (!recipientName.trim()) {
      toast.warning('El nombre del destinatario es obligatorio.');
      return;
    }
    if (!recipientPhone.trim()) {
      toast.warning('El número de teléfono es obligatorio.');
      return;
    }
    if (!shippingAddress.trim()) {
      toast.warning('La dirección de envío es obligatoria.');
      return;
    }
    if (!fiscalEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fiscalEmail.trim())) {
      toast.warning('Ingrese un correo electrónico válido para el comprobante fiscal.');
      return;
    }
    if (fiscalTipoDoc === '01') {
      const cedulaError = validateCedula(fiscalIdType, fiscalIdValue);
      if (cedulaError) {
        toast.warning(cedulaError);
        return;
      }
    } else if (fiscalIdValue.trim()) {
      const cedulaError = validateCedula(fiscalIdType, fiscalIdValue);
      if (cedulaError) {
        toast.warning(cedulaError);
        return;
      }
    }

    // Verify stock availability once more
    let isStockValid = true;
    cart.forEach(it => {
      const dbProd = db.products.find(p => p.id === it.product.id);
      if (!dbProd || dbProd.stock < it.quantity) {
        toast.error(`¡Error! El stock del producto ${it.product.name} ha cambiado. Solo quedan ${dbProd?.stock || 0} disponibles.`);
        isStockValid = false;
      }
    });

    if (!isStockValid) return;

    setIsSubmittingOrder(true);

    // Redención atómica del cupón (1 solo uso): se hace aquí, al confirmar,
    // no en "Aplicar" (que solo previsualiza el descuento) — así el cupón se
    // consume una única vez aunque dos clientes lo apliquen casi al mismo
    // tiempo, y si ya lo usaron/venció justo antes de este clic, se corta la
    // compra ANTES de tocar stock u órdenes, en vez de dejar el descuento
    // aplicado sin respaldo del lado del servidor.
    if (appliedCoupon) {
      const { error: couponError } = await supabase.rpc('redeem_coupon', { p_code: appliedCoupon.code });
      if (couponError) {
        toast.error('El cupón ya no está disponible (usado, inactivo o vencido). Quítelo para continuar.');
        setAppliedCoupon(null);
        setIsSubmittingOrder(false);
        return;
      }
    }

    // Stock deduction is handled atomically by processSaleAtomic in Firestore.
    // Do NOT deduct stock locally here — that would conflict with the transaction.

    // Create Order FAC-XXX
    const orderNum = db.orders.length + 1;
    const invoiceId = `FAC-00${orderNum}`;

    const newOrder: Order = {
      id: invoiceId,
      customerId: `CRM-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: recipientName.trim(),
      customerEmail: fiscalEmail.trim(),
      items: cart.map(it => it && ({
        productId: it.product.id,
        productName: it.product.name,
        quantity: it.quantity,
        price: it.product.price,
        discountApplied: it.product.price - getProductDiscountedPrice(it.product)
      })),
      subtotal: cartSubtotal,
      membershipDiscount: 0,
      shippingCost: cartShipping,
      taxAmount: cartTax,
      total: cartTotal,
      paymentMethod: paymentMethod,
      paymentDetails: {
        phone: paymentMethod === 'SINPE' ? sinpePhone : undefined,
        cardLast4: paymentMethod === 'Tarjeta' ? cardNumber.slice(-4) : undefined
      },
      status: 'Completado',
      xmlVerified: false,
      hdaStatus: 'Pendiente', // Starts pending to allow compliance audit
      timestamp: new Date().toISOString()
    };

    
    const result = await processSaleAtomic(cart, newOrder);
    if (!result.success) {
      toast.error(result.error);
      setIsSubmittingOrder(false);
      return;
    }

    // Log inventory movements (el stock ya se ajustó de forma atómica en Supabase dentro de processSaleAtomic).
    // Se usa un for...of secuencial (no forEach) para que cada saveDB() espere
    // al anterior; de lo contrario varias escrituras casi simultáneas sobre el
    // mismo documento pueden pisarse entre sí y perder movimientos.
    for (const it of cart) {
      const freshMovDb = getDB();
      freshMovDb.inventory_movements.unshift({
        id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: it.product.id,
        productName: it.product.name,
        quantityChange: -it.quantity,
        type: 'Salida',
        notes: `Venta directa e-commerce. Orden ${newOrder.id}`,
        timestamp: new Date().toISOString(),
        userEmail: 'cliente@technoverse.com'
      });
      try {
        await saveDB(freshMovDb);
      } catch (err: any) {
        console.error('No se pudo registrar el movimiento de inventario:', err?.message || err);
      }
    }

    // Ensure client registration in CRM

    let client = db.clients?.find(c => c.name.toLowerCase() === recipientName.trim().toLowerCase());
    if (!client) {
      db.clients.push({
        id: newOrder.customerId,
        name: recipientName.trim(),
        email: `${recipientName.replace(/\s+/g, '').toLowerCase()}@correo.cr`,
        phone: recipientPhone.trim(),
        province: shippingProvince as any,
        addressDetail: shippingAddress.trim(),
        cardsTokenized: paymentMethod === 'Tarjeta' ? [{ last4: cardNumber.slice(-4), brand: 'Visa' }] : [],
        balance: 0,
        notes: 'Cliente registrado automáticamente desde checkout.'
      });
    }

    // Register logistics delivery
    if (!db.deliveries) db.deliveries = [];
    db.deliveries.unshift({
      id: invoiceId,
      type: 'Orden',
      recipientName: recipientName.trim(),
      recipientPhone: recipientPhone.trim(),
      province: shippingProvince,
      addressDetail: shippingAddress.trim(),
      status: 'Pendiente',
      incidences: []
    });
    
    // Save only clients, deliveries, and orders — NOT products (el stock ya se ajustó en Supabase por processSaleAtomic).
    // Re-read getDB() to get the freshest product data from onSnapshot, then add our non-product changes.
    const freshDb = getDB();
    freshDb.clients = db.clients;
    freshDb.deliveries = db.deliveries;
    if (!freshDb.orders) freshDb.orders = [];
    freshDb.orders.push(newOrder);

    try {
      await saveDB(freshDb);
    } catch (err: any) {
      toast.error('La venta se procesó y el stock se descontó, pero la factura no se pudo registrar en la base de datos. Detalle: ' + (err?.message || err) + '. Por favor contacte a soporte indicando este número: ' + invoiceId, 12000);
      setIsSubmittingOrder(false);
      return;
    }

    addAuditLog('cliente@technoverse.com', 'Ventas', 'Crear Compra', `Factura ${invoiceId} emitida por un monto de ₡${cartTotal.toLocaleString()} para ${recipientName}`);

    // Comprobante fiscal v4.3 (registro interno): la venta y el stock ya
    // quedaron confirmados arriba, así que un fallo aquí NUNCA debe revertir
    // ni bloquear la compra — solo se informa y queda pendiente de soporte.
    try {
      const medioPago: MedioPago = paymentMethod === 'Tarjeta' ? '02' : '04';
      const { items: invoiceItems, subtotal: invSubtotal, ivaTotal: invIva, total: invTotal } = computeInvoiceTotals(
        cart.map(it => ({
          caabys: it.product.caabys || DEFAULT_CAABYS,
          description: it.product.name,
          qty: it.quantity,
          unitPrice: getProductDiscountedPrice(it.product)
        }))
      );
      const { data: issued, error: issueErr } = await supabase.rpc('issue_invoice', {
        p_order_id: invoiceId,
        p_tipo_doc: fiscalTipoDoc,
        p_customer_identification_type: fiscalIdType,
        p_customer_identification: fiscalIdValue.trim(),
        p_customer_name: recipientName.trim(),
        p_customer_email: fiscalEmail.trim(),
        p_medio_pago: medioPago,
        p_items: invoiceItems,
        p_subtotal: invSubtotal,
        p_iva_total: invIva,
        p_total: invTotal
      });
      if (issueErr) throw issueErr;

      const invoiceData: InvoiceData = {
        id: issued.id,
        clave: issued.clave,
        consecutivo: issued.consecutivo,
        tipoDoc: fiscalTipoDoc,
        fechaISO: new Date().toISOString(),
        emisorCedula: issued.emisorCedula,
        emisorNombre: 'Technoverse Costa Rica S.A.',
        customerIdentificationType: fiscalIdType,
        customerIdentification: fiscalIdValue.trim(),
        customerName: recipientName.trim(),
        customerEmail: fiscalEmail.trim(),
        medioPago,
        items: invoiceItems,
        subtotal: invSubtotal,
        ivaTotal: invIva,
        total: invTotal
      };

      const { blob, qrText } = await buildInvoicePdfBlob(invoiceData);
      // pdfPath es único por comprobante (issued.id viene del consecutivo
      // atómico de issue_invoice, nunca se repite), así que nunca hace falta
      // sobrescribir un PDF ya subido — upsert:true convertía este insert en
      // un INSERT ... ON CONFLICT DO UPDATE, y Postgres exige una política
      // RLS de UPDATE para esa rama aunque el conflicto nunca ocurra en la
      // práctica; como storage.objects solo tenía política de INSERT para
      // el bucket "invoices", toda subida fallaba con "new row violates
      // row-level security policy" pese a que la venta ya se había cobrado.
      const pdfPath = `${issued.id}.pdf`;
      const { error: uploadErr } = await supabase.storage.from('invoices').upload(pdfPath, blob, { contentType: 'application/pdf' });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('invoices').getPublicUrl(pdfPath);
      await supabase.rpc('set_invoice_pdf', { p_invoice_id: issued.id, p_pdf_url: pub.publicUrl, p_qr_data: qrText });

      const qrDataUrl = await generateQrDataUrl(qrText);
      setInvoiceInfo({ id: issued.id, clave: issued.clave, consecutivo: issued.consecutivo, qrDataUrl, pdfUrl: pub.publicUrl });

      // Envío de correo best-effort (Gmail SMTP vía Edge Function): si falla,
      // la venta y el comprobante ya quedaron generados y descargables. La
      // función relee destinatario/monto/PDF desde el propio registro en BD.
      supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId: issued.id }
      }).catch(() => {});
    } catch (err: any) {
      setInvoiceInfo(null);
      toast.warning('La compra se procesó correctamente, pero el comprobante fiscal no se pudo generar. Detalle: ' + (err?.message || err) + '. Contacte a soporte indicando el número ' + invoiceId, 12000);
    }

    setIsSubmittingOrder(false);
    setConfirmedOrder(newOrder);
    setCheckoutStep(3); // Completed!
    setCart([]);
    loadStoreProducts();
  };

  // Public Technical Service Ticket Form submit
  const handleCreatePublicRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairCustomerName.trim() || !repairCustomerEmail.trim() || !repairDevice.trim() || !repairDamage.trim()) {
      toast.warning('Por favor complete todos los datos.');
      return;
    }

    
    const num = Math.floor(100 + Math.random() * 900);
    const repId = `GT-${num}`;
    const tktId = `TKT-${num}`;

    const newRepair: RepairOrder = {
      id: repId,
      ticket: tktId,
      customerId: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: repairCustomerName.trim(),
      customerEmail: repairCustomerEmail.trim().toLowerCase(),
      device: repairDevice.trim(),
      damageReported: repairDamage.trim(),
      repuestos: [],
      laborCost: 0,
      totalCost: 0,
      status: 'Pendiente',
      warrantyMonths: 3, // default legal minimum
      createdAt: new Date().toISOString(),
      bitacora: [
        {
          status: 'Pendiente',
          notes: 'Dispositivo registrado externamente por el cliente en el portal público.',
          timestamp: new Date().toISOString(),
          user: repairCustomerEmail.trim()
        }
      ]
    };

    db.repair_orders.push(newRepair);
    try {
      await saveDB(db);
    } catch (err: any) {
      toast.error('No se pudo registrar el ticket de reparación. Detalle: ' + (err?.message || err));
      return;
    }

    addAuditLog(repairCustomerEmail, 'Taller', 'Orden Externa', `Ticket público ${tktId} registrado para reparación de ${repairDevice}`);

    setGeneratedTicket(tktId);
    setRepairDevice('');
    setRepairDamage('');
  };

  // Categories list
  const SPARE_PART_CATEGORIES = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];
  const CATEGORIES = ['Todos', 'Dispositivos', 'Estuches', 'Cargadores', 'Audio'];

  const checkCategoryMatch = (prodCat: string, storeCat: string) => {
    if (!prodCat || !storeCat) return false;
    const pc = prodCat.toLowerCase();
    const sc = storeCat.toLowerCase();
    if (sc === 'todos') return true;
    if (sc === 'estuches') {
      return pc.includes('estuches') || pc.includes('fundas') || pc.includes('protectores');
    }
    if (sc === 'dispositivos') {
      return pc.includes('dispositivos') || pc.includes('teclados') || pc.includes('mouse');
    }
    if (sc === 'audio') {
      return pc.includes('audio') || pc.includes('audífonos') || pc.includes('audifonos');
    }
    if (sc === 'cargadores') {
      return pc.includes('cargadores') || pc.includes('cables') || pc.includes('cargador');
    }
    return pc.includes(sc) || sc.includes(pc);
  };

  // useMemo: este filtro recorría TODA la lista de productos en CADA render
  // (cada tecla del buscador, abrir el carrito, cualquier cambio de estado no
  // relacionado). Ahora solo se recalcula cuando cambian sus entradas reales,
  // aligerando el hilo principal en equipos como el Galaxy A12.
  // (checkCategoryMatch y SPARE_PART_CATEGORIES son puros/constantes; se omiten
  // de las dependencias a propósito.)
  const filteredProducts = useMemo(() => products.filter(p => { if (!p) return false;
    // 0. Hidden/Inactive filter
    if (p.active === false) return false;
    if (SPARE_PART_CATEGORIES.includes(p.category)) return false;

    // 1. Category filter
    if (selectedCategory && selectedCategory !== 'Todos') {
      if (!checkCategoryMatch(p.category, selectedCategory)) {
        return false;
      }
    }
    // 2. Selected search product filter
    if (selectedSearchProductId) {
      if (p.id !== selectedSearchProductId) return false;
    } else if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const match = (p.name && p.name.toLowerCase().includes(query)) ||
                    (p.category && p.category.toLowerCase().includes(query)) ||
                    (p.sku && p.sku.toLowerCase().includes(query));
      if (!match) return false;
    }
    return true;
  }), [products, selectedCategory, selectedSearchProductId, searchQuery]);
  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] font-sans relative" id="store-page-root">
      
      {/* Compact 48px/56px Header */}
      <header className="h-14 sm:h-16 fixed top-0 left-0 right-0 z-40 glass-nav flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4 lg:gap-8">
          <button 
            onClick={() => { setActiveTab('store'); setSelectedCategory(null); }}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className="relative w-8 h-8 flex-shrink-0">
              <img 
                src={storeLogo || "/logo.png"} 
                alt="Technoverse Logo" 
                width={32} 
                height={32}
                className="h-8 w-8 rounded-lg border border-[var(--border-color)] shadow-sm object-contain bg-[var(--bg-surface)] p-0.5" 
              />
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-[var(--brand-gold-mid)] hidden sm:block">
              Technoverse
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-6">
            {/* Catalog Dropdown */}
            <div
              className="relative"
              onMouseEnter={openCatalogDropdown}
              onMouseLeave={scheduleCloseCatalogDropdown}
            >
              <button
                className="group flex items-center gap-1.5 text-sm font-bold text-[var(--text-secondary)] hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] tracking-wide uppercase transition-colors"
                onClick={() => (isCatalogDropdownOpen ? setIsCatalogDropdownOpen(false) : openCatalogDropdown())}
                aria-expanded={isCatalogDropdownOpen}
                aria-controls="catalog-dropdown"
              >
                Catálogo <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isCatalogDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isCatalogDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                    id="catalog-dropdown"
                    className="absolute top-full left-0 mt-2 w-[280px] max-w-[calc(100vw-32px)] sm:w-64 glass-panel rounded-2xl p-2 z-[70]"
                    style={{ willChange: 'transform, opacity', transformOrigin: 'top left' }}
                  >
                    <div className="px-4 py-2 border-b border-slate-50 mb-1">
                      <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Explorar Categorías</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                      {CATEGORIES.map(cat => cat && (
                        <button
                          key={cat}
                          onClick={() => {
                            setSelectedCategory(cat === 'Todos' ? null : cat);
                            setActiveTab('store');
                            setIsCatalogDropdownOpen(false);
                          }}
                          className="w-full text-left py-3 px-4 hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] text-sm rounded-xl transition-all font-semibold flex items-center justify-between group/item break-words whitespace-normal"
                        >
                          <span className="flex-1 mr-2 leading-tight">{cat}</span>
                          <ArrowRight className="w-3 h-3 opacity-0 group-hover/item:opacity-100 -translate-x-2 group-hover/item:translate-x-0 transition-all flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => setActiveTab('repairs')}
              className={`text-sm font-bold tracking-wide uppercase transition-colors px-2 py-1 rounded-lg ${activeTab === 'repairs' ? 'text-blue-600 dark:text-[var(--brand-gold-light)] bg-blue-50 dark:bg-[var(--brand-gold-mid)]/10' : 'text-[var(--text-secondary)] hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)]'}`}
            >
              Soporte Técnico
            </button>
          </nav>
        </div>

        {/* Search input with autocomplete */}
        <div className="flex-1 max-w-lg mx-4 lg:mx-8 relative hidden sm:block">
          <div className="relative flex items-center bg-[var(--bg-surface)] border border-[var(--border-color)] focus-within:border-blue-500 dark:focus-within:border-[var(--brand-gold-dark)] focus-within:ring-2 focus-within:ring-blue-500/20 dark:focus-within:ring-[var(--brand-gold-mid)] rounded-2xl px-4 py-2 transition-all duration-200">
            <Search className="w-4 h-4 text-[var(--text-muted)] mr-3 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar dispositivos, repuestos o accesorios..."
              className="w-full bg-transparent text-sm text-[var(--text-secondary)] focus:outline-none placeholder-slate-400 font-medium"
            />
            {searchQuery && (
              <button 
                onClick={handleResetSearch} 
                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <AnimatePresence>
            {showSearchDropdown && searchResults.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute top-full left-0 right-0 mt-2 glass-panel rounded-2xl overflow-hidden max-h-[400px] overflow-y-auto z-[70] py-2"
                id="search-suggestions-dropdown"
              >
                {searchResults.map(p => p && (
                  <button
                    key={p.id}
                    onClick={() => handleSelectSearchProduct(p)}
                    className="w-full text-left p-4 hover:bg-[var(--bg-surface)] transition-colors flex items-center justify-between border-b border-slate-50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--border-color)] rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <Smartphone className="w-5 h-5 text-[var(--text-muted)]" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[var(--text-secondary)]">{p.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono uppercase">SKU: {p.sku} • {p.category}</div>
                      </div>
                    </div>
                    <div className="text-sm font-bold text-blue-600 dark:text-[var(--brand-gold-light)] font-mono">₡{p.price.toLocaleString()}</div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User context selector and Cart trigger */}
        <div className="flex items-center gap-2 sm:gap-4">
          
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-3 md:p-2.5 rounded-xl glass-pill text-[var(--text-secondary)] hover:border-[var(--brand-gold-mid)] hover:text-[var(--brand-gold-mid)] transition-all duration-200 flex items-center justify-center cursor-pointer"
            title="Cambiar Tema"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* Account Dropdown — trigger button lives in the header on desktop only; on
              mobile this same state is triggered from the bottom navigation bar */}
          <div className="relative">
            <div className="hidden md:block">
              <button
                onClick={() => {
                  // Sin sesión: abrir el modal CENTRADO (no el dropdown inferior
                  // con inputs, que el teclado móvil empuja y rompe). Con sesión:
                  // el dropdown solo muestra el menú (sin inputs), sin problema.
                  setIsCartDropdownOpen(false);
                  setIsCatalogDropdownOpen(false);
                  setSearchQuery('');
                  if (!isAuthenticated) {
                    setIsRegisterMode(false);
                    setIsLoginModalOpen(true);
                    setIsAccountDropdownOpen(false);
                  } else {
                    setIsAccountDropdownOpen(!isAccountDropdownOpen);
                  }
                }}
                className={`group p-3 md:p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center relative cursor-pointer ${
                  isAccountDropdownOpen
                    ? 'btn-glass-primary'
                    : 'glass-pill text-[var(--text-secondary)] hover:border-[var(--brand-gold-mid)] hover:text-[var(--brand-gold-mid)]'
                }`}
                title="Mi Cuenta"
              >
                <UserIcon className="w-5 h-5" />
                {isAuthenticated && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-emerald-500 dark:bg-[var(--brand-gold-mid)] rounded-full border-2 border-white shadow-sm" />
                )}
              </button>
            </div>

            <AnimatePresence>
              {isAccountDropdownOpen && isAuthenticated && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.95, transformOrigin: 'top right' }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="fixed inset-x-3 bottom-20 md:absolute md:inset-x-auto md:left-auto md:right-0 md:bottom-auto md:top-full md:mt-3 w-auto md:w-80 max-w-none md:max-w-[calc(100vw-32px)] max-h-[70vh] md:max-h-[85vh] glass-panel rounded-2xl overflow-y-auto z-[70] dynamic-dropdown"
                  id="account-dropdown"
                  style={{ willChange: 'transform, opacity' }}
                >
                  {!isAuthenticated ? (
                    <form onSubmit={handleClientLoginSubmit} className="p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3 mb-1">
                        <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest">Portal de Clientes</span>
                        <ShoppingBag className="w-4 h-4 text-blue-500 dark:text-[var(--brand-gold-light)] opacity-20" />
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-[var(--text-muted)] mb-1.5 ml-1 tracking-wider">
                            Correo Electrónico
                          </label>
                          <input
                            type="email"
                            required
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            placeholder="usuario@ejemplo.com"
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-4 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)]/10 rounded-xl px-4 py-3 text-sm text-[var(--text-secondary)] focus:outline-none transition-all font-medium"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-[var(--text-muted)] mb-1.5 ml-1 tracking-wider">
                            Contraseña
                          </label>
                          <input
                            type="password"
                            required
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="••••••••••••"
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-4 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)]/10 rounded-xl px-4 py-3 text-sm text-[var(--text-secondary)] focus:outline-none transition-all"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full btn-glass-primary font-bold text-sm py-3.5 rounded-xl active:scale-[0.98]"
                      >
                        Iniciar Sesión
                      </button>

                      <div className="pt-4 flex flex-col items-center gap-3 border-t border-slate-50">
                        <button
                          type="button"
                          onClick={() => {
                            setIsLoginModalOpen(true);
                            setIsRegisterMode(true);
                            setIsAccountDropdownOpen(false);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] font-bold transition-colors hover:underline"
                        >
                          ¿No tienes cuenta? Regístrate aquí
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col">
                      <div className="p-5 bg-[var(--bg-surface)] border-b border-[var(--border-color)]">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-blue-600 dark:bg-[var(--brand-gold-mid)] rounded-full flex items-center justify-center text-white font-black text-xl shadow-inner dark:text-slate-950">
                            {currentUser?.name?.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-black text-[var(--text-secondary)] whitespace-normal break-words leading-tight">{currentUser?.name}</div>
                            <div className="text-[10px] text-[var(--text-muted)] whitespace-normal break-words mb-1">{currentUser?.email}</div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-100 text-blue-600 dark:text-[var(--brand-gold-light)] tracking-tighter dark:bg-[var(--brand-gold-mid)]">
                              {currentUser?.role}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-2 space-y-1">
                        {currentUser?.role !== 'Cliente' && (
                          <button
                            onClick={onNavigateToAdmin}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-blue-50 dark:hover:bg-[var(--brand-gold-mid)]/10 hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] rounded-xl transition-colors"
                          >
                            <Settings className="w-4 h-4" /> Panel de Control
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setActiveTab('repairs');
                            setIsAccountDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-blue-50 dark:hover:bg-[var(--brand-gold-mid)]/10 hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] rounded-xl transition-colors"
                        >
                          <Wrench className="w-4 h-4" /> Mis Reparaciones
                        </button>
                        <button
                          onClick={() => {
                            // Link to orders or something
                            setIsAccountDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-blue-50 dark:hover:bg-[var(--brand-gold-mid)]/10 hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] rounded-xl transition-colors"
                        >
                          <ShoppingBag className="w-4 h-4" /> Historial de Compras
                        </button>
                        <div className="h-px bg-[var(--border-color)] mx-4 my-1" />
                        <button
                          onClick={onLogout}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                        >
                          <LogOut className="w-4 h-4" /> Cerrar Sesión
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Cart Dropdown Trigger — button lives in the header on desktop only; on
              mobile this same state is triggered from the bottom navigation bar */}
          <div className="relative">
            <div className="hidden md:block">
              <button
                onClick={() => {
                  setIsCartDropdownOpen(!isCartDropdownOpen);
                  setIsAccountDropdownOpen(false);
                  setIsCatalogDropdownOpen(false);
                  setSearchQuery('');
                }}
                className={`p-3 md:p-2.5 rounded-xl transition-all duration-300 relative flex items-center justify-center cursor-pointer ${
                  isCartDropdownOpen
                    ? 'btn-glass-primary'
                    : 'glass-pill text-[var(--text-secondary)] hover:border-[var(--brand-gold-mid)] hover:text-[var(--brand-gold-mid)]'
                } ${isCartBouncing ? 'scale-110' : 'scale-100'}`}
                title="Carrito"
              >
                <ShoppingBag className="w-5 h-5" />
                {cart.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white text-[10px] font-black min-w-[20px] h-5 rounded-full flex items-center justify-center border-2 border-white px-1 shadow-sm">
                    {cart.reduce((sum, it) => sum + it.quantity, 0)}
                  </span>
                )}
              </button>
            </div>

            <AnimatePresence>
              {isCartDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.95, transformOrigin: 'top right' }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="fixed inset-x-3 bottom-20 md:absolute md:inset-x-auto md:left-auto md:right-0 md:bottom-auto md:top-full md:mt-3 w-auto md:w-96 max-w-none md:max-w-[calc(100vw-32px)] glass-panel rounded-2xl overflow-hidden z-[70] flex flex-col max-h-[70vh] md:max-h-[600px] dynamic-dropdown"
                  id="cart-dropdown"
                  style={{ willChange: 'transform, opacity' }}
                >
                  <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--bg-base)]">
                    <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest">Carrito de Compras</span>
                    <button onClick={() => setIsCartDropdownOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {cart.length === 0 ? (
                      <div className="py-12 text-center flex flex-col items-center gap-3">
                        <div className="w-16 h-16 bg-[var(--bg-surface)] rounded-full flex items-center justify-center text-[var(--text-muted)]">
                          <ShoppingBag className="w-8 h-8" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-[var(--text-secondary)]">Tu carrito está vacío</p>
                          <p className="text-[11px] text-[var(--text-muted)]">¿Buscas algo especial? Explora nuestro catálogo.</p>
                        </div>
                      </div>
                    ) : (
                      cart.map((it, idx) => (
                        <div key={idx} className="flex gap-4 group/item">
                          <div className="w-16 h-16 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)] flex-shrink-0 flex items-center justify-center overflow-hidden p-1">
                            {it.product.imageUrl ? (
                              <img src={it.product.imageUrl} alt="" className="w-full h-full object-contain group-hover/item:scale-110 transition-transform duration-300" />
                            ) : (
                              <Smartphone className="w-6 h-6 text-[var(--text-muted)]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex justify-between items-start">
                              <h4 className="text-sm font-bold text-[var(--text-secondary)] whitespace-normal break-words pr-2">{it.product.name}</h4>
                              <button 
                                onClick={() => handleRemoveFromCart(idx)}
                                className="text-[var(--text-muted)] hover:text-rose-500 p-0.5 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex justify-between items-end mt-1">
                              <div className="text-[11px] font-bold text-[var(--text-muted)]">
                                {it.quantity} x ₡{getProductDiscountedPrice(it.product).toLocaleString()}
                              </div>
                              <div className="text-sm font-black text-blue-600 dark:text-[var(--brand-gold-light)] font-mono">
                                ₡{(getProductDiscountedPrice(it.product) * it.quantity).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {cart.length > 0 && (
                    <div className="p-4 bg-[var(--bg-surface)] border-t border-[var(--border-color)] space-y-4">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-xs font-bold text-[var(--text-muted)] uppercase">Subtotal</span>
                        <span className="text-lg font-black text-[var(--text-secondary)] font-mono">
                          ₡{cart.reduce((sum, it) => sum + (getProductDiscountedPrice(it.product) * it.quantity), 0).toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setIsCartOpen(true);
                          setCheckoutStep(0);
                          setIsCartDropdownOpen(false);
                        }}
                        className="w-full btn-glass-primary font-bold py-4 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]"
                      >
                        Finalizar Compra <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </header>

      {/* Mobile catalog floating sheet — triggered from the bottom navigation bar.
          Reuses the same isCatalogDropdownOpen state as the desktop dropdown;
          the desktop version above is unreachable on mobile (hidden md:flex ancestor),
          so this is a dedicated mobile-anchored rendering of the same category list. */}
      <AnimatePresence>
        {isCatalogDropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="floating-sheet-mobile glass-panel rounded-2xl p-2 md:hidden"
          >
            <div className="px-4 py-2 border-b border-[var(--border-color)] mb-1">
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Explorar Categorías</span>
            </div>
            <div className="p-1 space-y-1">
              {CATEGORIES.map(cat => cat && (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat === 'Todos' ? null : cat);
                    setActiveTab('store');
                    setIsCatalogDropdownOpen(false);
                  }}
                  className={`w-full text-left py-3 px-4 text-sm rounded-xl transition-all font-semibold ${
                    (selectedCategory === cat || (cat === 'Todos' && selectedCategory === null))
                      ? 'bg-[var(--brand-gold-mid)] text-[#1a1408] dark:text-[#14100a]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-blue-600 dark:hover:text-[var(--brand-gold-light)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global bottom navigation bar (mobile only) — replaces the hamburger menu
          entirely. Drives the exact same state/handlers as the desktop header. */}
      <nav className="bottom-nav-bar md:hidden flex items-stretch">
        <button
          className={`bottom-nav-item ${activeTab === 'store' && !isCatalogDropdownOpen ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('store');
            setSelectedCategory(null);
            setIsCatalogDropdownOpen(false);
            setIsAccountDropdownOpen(false);
            setIsCartDropdownOpen(false);
          }}
        >
          <span className="bn-icon-wrap"><Home className="w-5 h-5" /></span>
          Inicio
        </button>
        <button
          className={`bottom-nav-item ${isCatalogDropdownOpen ? 'active' : ''}`}
          onClick={() => {
            if (isCatalogDropdownOpen) { setIsCatalogDropdownOpen(false); return; }
            setIsAccountDropdownOpen(false);
            setIsCartDropdownOpen(false);
            setIsCatalogDropdownOpen(true);
          }}
        >
          <span className="bn-icon-wrap"><LayoutGrid className="w-5 h-5" /></span>
          Catálogo
        </button>
        <button
          className={`bottom-nav-item ${activeTab === 'repairs' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('repairs');
            setIsCatalogDropdownOpen(false);
            setIsAccountDropdownOpen(false);
            setIsCartDropdownOpen(false);
          }}
        >
          <span className="bn-icon-wrap"><Wrench className="w-5 h-5" /></span>
          Soporte
        </button>
        <button
          className={`bottom-nav-item ${isAccountDropdownOpen || (isLoginModalOpen && !isAuthenticated) ? 'active' : ''}`}
          onClick={() => {
            setIsCatalogDropdownOpen(false);
            setIsCartDropdownOpen(false);
            setSearchQuery('');
            if (!isAuthenticated) {
              // Sin sesión: modal centrado (el teclado no rompe el layout).
              setIsAccountDropdownOpen(false);
              setIsRegisterMode(false);
              setIsLoginModalOpen(true);
              return;
            }
            // Con sesión: menú inferior (sin inputs), toggle normal.
            if (isAccountDropdownOpen) { setIsAccountDropdownOpen(false); return; }
            setIsAccountDropdownOpen(true);
          }}
        >
          <span className="bn-icon-wrap"><UserIcon className="w-5 h-5" /></span>
          Cuenta
        </button>
        <button
          className={`bottom-nav-item relative ${isCartDropdownOpen ? 'active' : ''}`}
          onClick={() => {
            if (isCartDropdownOpen) { setIsCartDropdownOpen(false); return; }
            setIsCatalogDropdownOpen(false);
            setIsAccountDropdownOpen(false);
            setIsCartDropdownOpen(true);
            setSearchQuery('');
          }}
        >
          <span className="bn-icon-wrap relative">
            <ShoppingBag className="w-5 h-5" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-rose-600 text-white text-[9px] font-black min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                {cart.reduce((sum, it) => sum + it.quantity, 0)}
              </span>
            )}
          </span>
          Carrito
        </button>
      </nav>
      {/* Main Body */}
      <main className="pt-16 sm:pt-20 pb-28 md:pb-20 px-4 md:px-6 max-w-7xl mx-auto space-y-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
        {activeTab === 'store' ? (
          /* PUBLIC STORE VIEW */
          <>
            {/* Banner Carousel (Amazon-inspired) */}
            {banners.length > 0 && (
              <div className="relative h-44 bg-gradient-to-r from-blue-500/5 via-white to-[#D4AF37]/5 dark:bg-[var(--bg-surface)] dark:bg-none rounded-3xl border border-[var(--border-color)] flex items-center justify-between p-8 overflow-hidden shadow-sm mb-8">
                <div className="space-y-2 max-w-md z-10">
                  <span className="text-[10px] bg-[var(--brand-gold-mid)] text-[#1a1408] dark:text-[#14100a] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">{banners[0].type}</span>
                  <h2 className="text-xl md:text-2xl font-extrabold text-[var(--text-primary)] tracking-tight leading-none">
                    {banners[0].title}
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)] font-sans">
                    {banners[0].description}
                  </p>
                </div>
                <div className="relative hidden md:block">
                  <Smartphone className="w-24 h-24 text-blue-500 dark:text-[var(--brand-gold-light)]/10 absolute -top-12 -right-12 animate-pulse" />
                  <Sparkles className="w-16 h-16 text-[var(--brand-gold-mid)]/10 animate-bounce" />
                </div>
              </div>
            )}

            {/* Featured Categories Carousel */}
            <FeaturedCategoriesCarousel 
              categories={CATEGORIES} 
              onSelectCategory={(cat) => setSelectedCategory(cat === 'Todos' ? null : cat)}
              selectedCategory={selectedCategory || 'Todos'}
            />

            {/* Marketing Row - Tendencias */}
            {!selectedCategory && filteredProducts.length > 4 && (
              <MarketingRow 
                title="Tendencias" 
                products={filteredProducts.slice(0, 8)} // Passed top items, row will slice to 4
                onProductClick={(prod) => { setSelectedProductDetail(prod); setDetailQuantity(1); }}
                onAddToCart={handleAddToCart}
                getProductDiscountedPrice={getProductDiscountedPrice}
              />
            )}

            {/* Products grid */}
            <div>
              <h3 className="font-extrabold text-base text-[var(--text-primary)] mb-6">
                {selectedCategory ? `Explorando: ${selectedCategory}` : 'Nuestros Productos Disponibles'}
              </h3>
              
              {filteredProducts.length === 0 ? (
                /* Empty state warning - clean and without admin login prompt */
                <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-3xl p-12 text-center max-w-md mx-auto space-y-4 shadow-sm animate-in fade-in">
                  <AlertCircle className="w-12 h-12 text-[var(--brand-gold-mid)] mx-auto opacity-70" />
                  <h4 className="font-bold text-sm text-[var(--text-primary)]">Sin stock disponible</h4>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed font-sans">
                    Actualmente no disponemos de artículos en esta categoría. Estamos trabajando para renovar nuestro inventario lo antes posible.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {paginatedProducts.map(prod => prod && (
                    <ProductCard
                      key={prod.id}
                      prod={prod}
                      onClick={() => { setSelectedProductDetail(prod); setDetailQuantity(1); }}
                      onAddToCart={handleAddToCart}
                      getProductDiscountedPrice={getProductDiscountedPrice}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* PUBLIC REPAIRS SUPPORT PORTAL */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="repairs-portal-section">
            
            {/* Left side: Technical Service Registration form */}
            <div className="glass-panel-strong rounded-3xl p-6 text-[var(--text-primary)] space-y-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-6 h-6 text-blue-600 dark:text-[var(--brand-gold-light)]" />
                <div>
                  <h3 className="font-bold text-base text-[var(--text-primary)]">Registrar Solicitud de Reparación en Línea</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Envía tus datos y los detalles de tu dispositivo para abrir una orden de diagnóstico.</p>
                </div>
              </div>

              <form onSubmit={handleCreatePublicRepair} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={repairCustomerName}
                      onChange={(e) => setRepairCustomerName(e.target.value)}
                      placeholder="Ej. Andrés Madrigal Quirós"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Correo Electrónico (Para Alertas)</label>
                    <input
                      type="email"
                      required
                      value={repairCustomerEmail}
                      onChange={(e) => setRepairCustomerEmail(e.target.value)}
                      placeholder="andres@correo.cr"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Dispositivo (Marca, Modelo, Color)</label>
                  <input
                    type="text"
                    required
                    value={repairDevice}
                    onChange={(e) => setRepairDevice(e.target.value)}
                    placeholder="Ej. iPhone 13 Pro 128GB Azul Sierra"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] transition"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Descripción Manual de Daño del Equipo</label>
                  <textarea
                    required
                    rows={3}
                    value={repairDamage}
                    onChange={(e) => setRepairDamage(e.target.value)}
                    placeholder="Detalla detalladamente qué falla presenta tu equipo. El técnico utilizará esta información para el diagnóstico inicial."
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] resize-none transition"
                  />
                </div>

                <div className="bg-blue-50 border border-blue-100 dark:border-[var(--brand-gold-dark)] rounded-xl p-3 text-[10px] leading-relaxed text-blue-700 dark:text-[var(--brand-gold-light)]">
                  ⚠️ <strong>Garantía Mínima Legal Protegida:</strong> De conformidad con la Ley 7472 (Defensa del Consumidor de Costa Rica), todo hardware reparado en Technoverse incluye una garantía real certificada de un mínimo de 3 meses naturales.
                </div>

                <button
                  type="submit"
                  className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[#1a1408] dark:text-[#14100a] font-extrabold text-sm py-3 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
                >
                  Abrir Ticket de Reparación Oficial
                </button>
              </form>

              {generatedTicket && (
                <div className="bg-[var(--bg-surface)] rounded-2xl p-4 border border-[var(--border-color)] space-y-2 text-center animate-in fade-in">
                  <CheckCircle className="w-8 h-8 text-blue-600 dark:text-[var(--brand-gold-light)] mx-auto animate-bounce" />
                  <h4 className="font-bold text-sm text-[var(--text-primary)]">¡Ticket de Soporte Generado!</h4>
                  <p className="text-[10px] text-[var(--text-secondary)]">Su dispositivo ha sido registrado con éxito. Puede consultar el estado en tiempo real ingresando su número de ticket en la sección derecha de esta página.</p>
                  <div className="font-mono text-base font-bold text-blue-600 dark:text-[var(--brand-gold-light)] select-text">{generatedTicket}</div>
                </div>
              )}
            </div>

            {/* Right side: Public lookup section (rendered directly inside workshop component) */}
            <div className="space-y-6">
              <div className="glass-panel-strong rounded-3xl p-6 text-[var(--text-primary)] shadow-sm">
                <h3 className="font-bold text-sm mb-2 text-blue-600 dark:text-[var(--brand-gold-light)] flex items-center gap-1.5">
                  <Heart className="w-5 h-5 text-[var(--brand-gold-mid)]" /> ¿Por qué reparar con Technoverse?
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  Ofrecemos los mejores estándares inspirados en Apple y Amazon para Costa Rica. Cada reparación es documentada con estricta trazabilidad de repuestos (reintegrando el stock de forma veraz), y se genera un hash único descargable para certificar la vigencia de tu garantía ante cualquier ente fiscal o de consumo.
                </p>
              </div>

              {/* Taller public lookup widget loaded natively to support 100% functionality */}
              <div className="glass-panel-strong rounded-3xl p-5 shadow-sm space-y-3">
                <div className="text-sm font-bold text-[var(--text-primary)]">Buscador y Monitor Fiscal de Garantías:</div>
                <div className="p-4 text-sm text-[var(--text-primary)] leading-relaxed bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]/50">
                  🔍 Usa la barra superior de consulta en <strong>Soporte Técnico</strong> para verificar cualquier reparación por su número de ticket (ej: TKT-123) o por el correo registrado. Pruébalo abriendo una solicitud a la izquierda.
                </div>
              </div>
            </div>

          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Centered Cart & Checkout Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" id="shopping-cart-sidebar">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => { setIsCartOpen(false); setCheckoutStep(0); }} />

          <div className="relative max-w-2xl w-full glass-panel-strong rounded-3xl shadow-sm flex flex-col justify-between text-[var(--text-primary)] overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200" id="checkout-cart-modal-container">
            {/* Cart Header */}
            <div className="p-5 bg-[var(--bg-surface)] border-b border-[var(--border-color)] flex items-center justify-between">
              <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[var(--brand-gold-mid)]" /> Resumen de Compra (Checkout Seguro)
              </h3>
              <button 
                onClick={() => {
                  setIsCartOpen(false);
                  setCheckoutStep(0);
                }}
                className="text-sm font-semibold bg-[var(--bg-base)] hover:bg-rose-50 text-[var(--text-secondary)] hover:text-rose-600 px-3 py-1.5 rounded-xl transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>

            {/* Checkout steps content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Stepper indicators */}
              <div className="grid grid-cols-4 gap-1 text-[9px] font-bold text-center uppercase tracking-wider border-b border-[var(--border-color)] pb-3">
                <div className={checkoutStep >= 0 ? 'text-blue-600 dark:text-[var(--brand-gold-light)] font-extrabold' : 'text-[var(--text-primary)]'}>1. Resumen</div>
                <div className={checkoutStep >= 1 ? 'text-blue-600 dark:text-[var(--brand-gold-light)] font-extrabold' : 'text-[var(--text-primary)]'}>2. Envío</div>
                <div className={checkoutStep >= 2 ? 'text-blue-600 dark:text-[var(--brand-gold-light)] font-extrabold' : 'text-[var(--text-primary)]'}>3. Pago</div>
                <div className={checkoutStep >= 3 ? 'text-emerald-600 dark:text-[var(--brand-gold-light)] font-extrabold' : 'text-[var(--text-primary)]'}>4. Autorizado</div>
              </div>

              {checkoutStep === 0 && (
                /* STEP 0: Cart list */
                <div className="space-y-3">
                  {cart.length === 0 ? (
                    <div className="text-center py-16 text-sm text-[var(--text-primary)] italic">Tu carrito de compras se encuentra vacío.</div>
                  ) : (
                    cart.map((it, idx) => (
                      <div key={idx} className="bg-[var(--bg-surface)] p-3 rounded-2xl border border-[var(--border-color)]/40 flex gap-3 text-sm justify-between items-center">
                        <div className="flex gap-2.5 truncate items-center">
                          {it.product.imageUrl ? (
                            <img src={it.product.imageUrl} alt="" className="w-12 h-12 object-contain bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg p-1" />
                          ) : (
                            <div className="w-12 h-12 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg flex items-center justify-center text-sm">📱</div>
                          )}
                          <div className="truncate">
                            <h4 className="font-bold text-[var(--text-primary)] truncate">{it.product.name}</h4>
                            <span className="text-[10px] text-[var(--text-primary)] font-mono">Stock: {it.product.stock} un.</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end justify-between">
                          <span className="font-mono font-bold text-[var(--text-primary)]">₡{getProductDiscountedPrice(it.product).toLocaleString()}</span>
                          
                          <div className="flex items-center gap-2 mt-1">
                            <button 
                              onClick={() => handleUpdateCartQty(idx, it.quantity - 1)}
                              className="bg-[var(--bg-surface)] hover:bg-[var(--bg-base)] border border-[var(--border-color)] w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
                            >
                              -
                            </button>
                            <span className="font-mono font-bold">{it.quantity}</span>
                            <button 
                              onClick={() => handleUpdateCartQty(idx, it.quantity + 1)}
                              className="bg-[var(--bg-surface)] hover:bg-[var(--bg-base)] border border-[var(--border-color)] w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
                            >
                              +
                            </button>
                            <button 
                              onClick={() => handleRemoveFromCart(idx)}
                              className="text-rose-500 hover:text-rose-600 ml-1.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {checkoutStep === 1 && (
                /* STEP 1: Delivery Information */
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-blue-600 dark:text-[var(--brand-gold-light)] uppercase tracking-wider">Detalles de Envío</h4>
                  
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Nombre Completo del Receptor</label>
                    <input
                      type="text"
                      required
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Ej. Juan Solís Quesada"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Teléfono de Contacto</label>
                    <input
                      type="text"
                      required
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="Ej. +506 8800 1122"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none transition"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Provincia</label>
                      <CustomSelect
                        value={shippingProvince}
                        onChange={setShippingProvince}
                        options={COSTA_RICA_PROVINCES.filter(Boolean).map(prov => ({ value: prov, label: prov }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Tarifa de Envío</label>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm text-blue-600 dark:text-[var(--brand-gold-light)] font-bold font-mono">
                        ₡{calculateShippingCost(shippingProvince).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Dirección Exacta de Entrega</label>
                    <textarea
                      required
                      rows={2}
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Ej. De la iglesia católica 200m oeste y 50m norte, portón verde."
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none resize-none transition"
                    />
                  </div>
                </div>
              )}

              {checkoutStep === 2 && (
                /* STEP 2: Secure Payment Gateway simulator */
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-blue-600 dark:text-[var(--brand-gold-light)] uppercase tracking-wider">Pasarela de Pago Segura</h4>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('SINPE')}
                      className={`py-2 text-center rounded-xl font-bold text-sm border transition cursor-pointer ${
                        paymentMethod === 'SINPE'
                          ? 'bg-blue-50 dark:bg-[var(--brand-gold-mid)]/10 border-blue-500 dark:border-[var(--brand-gold-dark)] text-blue-600 dark:text-[var(--brand-gold-light)]'
                          : 'bg-[var(--bg-surface)] border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'
                      }`}
                    >
                      SINPE Móvil
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('Tarjeta')}
                      className={`py-2 text-center rounded-xl font-bold text-sm border transition cursor-pointer ${
                        paymentMethod === 'Tarjeta'
                          ? 'bg-blue-50 dark:bg-[var(--brand-gold-mid)]/10 border-blue-500 dark:border-[var(--brand-gold-dark)] text-blue-600 dark:text-[var(--brand-gold-light)]'
                          : 'bg-[var(--bg-surface)] border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'
                      }`}
                    >
                      Tarjeta Crédito
                    </button>
                  </div>

                  {paymentMethod === 'SINPE' ? (
                    <div className="bg-[var(--bg-surface)] rounded-2xl p-4 border border-[var(--border-color)]/60 space-y-3">
                      <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        Transfiera mediante SINPE Móvil al número oficial de la empresa:
                        <strong className="text-[var(--text-primary)] block mt-1 font-mono text-sm">+506 6421 4795</strong>
                        Asociado a: <strong>Technoverse Costa Rica S.A.</strong>
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Teléfono remitente SINPE</label>
                        <input
                          type="text"
                          required
                          value={sinpePhone}
                          onChange={(e) => setSinpePhone(e.target.value)}
                          placeholder="Ej. 88123456"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[var(--bg-surface)] rounded-2xl p-4 border border-[var(--border-color)]/60 space-y-3">
                      <span className="text-[9px] text-[var(--text-primary)] block leading-relaxed uppercase font-bold tracking-wider">Tokenizador Local Seguro</span>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Número de Tarjeta (16 dígitos)</label>
                        <input
                          type="text"
                          maxLength={16}
                          required
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ''))}
                          placeholder="4000 1234 5678 9010"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Nombre en Tarjeta</label>
                          <input
                            type="text"
                            required
                            value={cardName}
                            onChange={(e) => setCardName(e.target.value)}
                            placeholder="Ej. JUAN SOLIS"
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none"
                          />
                        </div>
                        <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl px-4 py-3 flex items-center justify-center">
                          <CreditCard className="w-6 h-6 text-[var(--text-primary)]" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100 dark:border-[var(--brand-gold-dark)] text-[10px] text-blue-700 dark:text-[var(--brand-gold-light)] leading-normal flex gap-2">
                    <ShieldAlert className="w-4.5 h-4.5 flex-shrink-0 text-blue-500 dark:text-[var(--brand-gold-light)]" />
                    <span>
                      <strong>Protección PRODHAB (Ley 8968):</strong> Los datos de pago son encriptados en tránsito (cifrado simulado AES-256) y tokenizados inmediatamente. Technoverse nunca almacena números completos de tarjetas.
                    </span>
                  </div>

                  <div className="bg-[var(--bg-surface)] rounded-2xl p-4 border border-[var(--border-color)]/60 space-y-3">
                    <h4 className="text-sm font-bold text-blue-600 dark:text-[var(--brand-gold-light)] uppercase tracking-wider">Datos Fiscales del Comprobante</h4>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFiscalTipoDoc('04')}
                        className={`py-2 text-center rounded-xl font-bold text-xs border transition cursor-pointer ${
                          fiscalTipoDoc === '04'
                            ? 'bg-blue-50 dark:bg-[var(--brand-gold-mid)]/10 border-blue-500 dark:border-[var(--brand-gold-dark)] text-blue-600 dark:text-[var(--brand-gold-light)]'
                            : 'bg-[var(--bg-base)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        Tiquete Electrónico
                      </button>
                      <button
                        type="button"
                        onClick={() => setFiscalTipoDoc('01')}
                        className={`py-2 text-center rounded-xl font-bold text-xs border transition cursor-pointer ${
                          fiscalTipoDoc === '01'
                            ? 'bg-blue-50 dark:bg-[var(--brand-gold-mid)]/10 border-blue-500 dark:border-[var(--brand-gold-dark)] text-blue-600 dark:text-[var(--brand-gold-light)]'
                            : 'bg-[var(--bg-base)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        Factura Electrónica
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Tipo de Identificación</label>
                        <CustomSelect
                          value={fiscalIdType}
                          onChange={(v) => setFiscalIdType(v as IdentificacionTipo)}
                          options={[
                            { value: '01', label: 'Cédula Física' },
                            { value: '02', label: 'Cédula Jurídica' },
                            { value: '03', label: 'DIMEX' },
                            { value: '04', label: 'NITE' }
                          ]}
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">
                          Identificación{fiscalTipoDoc === '01' ? '' : ' (opcional)'}
                        </label>
                        <input
                          type="text"
                          value={fiscalIdValue}
                          onChange={(e) => setFiscalIdValue(e.target.value.replace(/\D/g, ''))}
                          placeholder="Solo números"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                    {(fiscalTipoDoc === '01' || fiscalIdValue.trim()) && validateCedula(fiscalIdType, fiscalIdValue) && (
                      <p className="text-[10px] text-rose-500 font-medium -mt-1">{validateCedula(fiscalIdType, fiscalIdValue)}</p>
                    )}

                    <div>
                      <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Correo para el Comprobante</label>
                      <input
                        type="email"
                        required
                        value={fiscalEmail}
                        onChange={(e) => setFiscalEmail(e.target.value)}
                        placeholder="correo@ejemplo.com"
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                      />
                    </div>

                    <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed">
                      Registro interno con el formato oficial de Hacienda (Clave de 50 dígitos, CAABYS, IVA desglosado). Aún no está conectado a la transmisión electrónica real ante el Ministerio de Hacienda.
                    </p>
                  </div>
                </div>
              )}

              {checkoutStep === 3 && confirmedOrder && (
                /* STEP 3: Order Confirmation & Fiscal receipt */
                <div className="bg-emerald-50 border border-emerald-200 dark:border-[var(--brand-gold-dark)] rounded-2xl p-4 space-y-4 animate-in fade-in">
                  <div className="text-center space-y-1">
                    <CheckCircle className="w-10 h-10 text-emerald-500 dark:text-[var(--brand-gold-light)] mx-auto animate-bounce" />
                    <h4 className="font-bold text-sm text-[var(--text-primary)]">¡Compra Confirmada!</h4>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {invoiceInfo ? 'Comprobante fiscal (registro interno) generado correctamente.' : 'Su pedido quedó registrado. El comprobante fiscal está pendiente de generar.'}
                    </p>
                  </div>

                  <div className="bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-color)] space-y-1.5 text-sm text-[var(--text-primary)] shadow-sm">
                    <div>Orden: <strong className="text-emerald-600 dark:text-[var(--brand-gold-light)] font-mono">{confirmedOrder.id}</strong></div>
                    <div>Fecha: <span className="font-mono text-[var(--text-secondary)]">{new Date(confirmedOrder.timestamp).toLocaleString()}</span></div>
                    <div>Receptor: <strong className="text-[var(--text-primary)]">{confirmedOrder.customerName}</strong></div>
                    <div>Impuesto IVA (13%): <strong className="font-mono text-[var(--text-primary)]">₡{confirmedOrder.taxAmount.toLocaleString()}</strong></div>
                    <div className="text-sm font-bold border-t border-[var(--border-color)] pt-2 mt-2">Total Pagado: <span className="text-emerald-600 dark:text-[var(--brand-gold-light)] font-mono">₡{confirmedOrder.total.toLocaleString()}</span></div>
                  </div>

                  {invoiceInfo && (
                    <div className="bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-color)] space-y-2 text-[11px] text-[var(--text-primary)] shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div>Comprobante: <strong className="font-mono">{invoiceInfo.id}</strong></div>
                          <div className="break-all">Clave: <span className="font-mono text-[var(--text-secondary)]">{invoiceInfo.clave}</span></div>
                          <div className="break-all">Consecutivo: <span className="font-mono text-[var(--text-secondary)]">{invoiceInfo.consecutivo}</span></div>
                        </div>
                        <img src={invoiceInfo.qrDataUrl} alt="Código QR de verificación interna" className="w-16 h-16 rounded-lg border border-[var(--border-color)] shrink-0" />
                      </div>
                      {invoiceInfo.pdfUrl && (
                        <a
                          href={invoiceInfo.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1.5 text-blue-600 dark:text-[var(--brand-gold-light)] font-bold"
                        >
                          <FileDown className="w-3.5 h-3.5" /> Descargar comprobante (PDF)
                        </a>
                      )}
                    </div>
                  )}

                  <div className="text-[10px] text-[var(--text-primary)] text-center leading-relaxed">
                    Comprobante con el formato oficial de Hacienda v4.3 (Clave de 50 dígitos, CAABYS, IVA desglosado) para uso interno/contable. Aún no se transmite electrónicamente ante el Ministerio de Hacienda: eso requiere certificado digital y credenciales de ATV.
                  </div>
                </div>
              )}

            </div>

            {/* Cart footer calculations */}
            <div className="p-5 bg-[var(--bg-surface)] border-t border-[var(--border-color)] space-y-4">
              {checkoutStep < 3 ? (
                <>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Subtotal:</span>
                      <span className="font-mono">₡{cartSubtotal.toLocaleString()}</span>
                    </div>
                    {/* Coupon UI */}
                    {checkoutStep === 0 && (
                      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-color)] mt-2">
                        <input 
                          type="text"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value)}
                          placeholder="Cupón de descuento"
                          className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] uppercase font-mono flex-1 focus:outline-none focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)]"
                          disabled={!!appliedCoupon}
                        />
                        <button
                          onClick={handleApplyCoupon}
                          disabled={!couponCode || !!appliedCoupon}
                          className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] disabled:bg-slate-200 disabled:text-[var(--text-primary)] text-[#1a1408] dark:text-[#14100a] font-bold px-3 py-1.5 rounded-lg transition text-sm cursor-pointer"
                        >
                          {appliedCoupon ? 'Aplicado' : 'Aplicar'}
                        </button>
                      </div>
                    )}
                    {appliedCoupon && (
                      <div className="flex justify-between text-blue-600 dark:text-[var(--brand-gold-light)] font-bold">
                        <span>Cupón ({appliedCoupon.code}):</span>
                        <span className="font-mono">-₡{
                          appliedCoupon.type === 'Porcentaje' 
                            ? Math.round(discountedSubtotal * (appliedCoupon.value / 100)).toLocaleString() 
                            : appliedCoupon.value.toLocaleString()
                        }</span>
                      </div>
                    )}

                    <div className="flex justify-between text-[var(--text-secondary)] mt-2 border-t border-[var(--border-color)] pt-2">
                      <span>Envío ({shippingProvince}):</span>
                      <span className="font-mono">₡{cartShipping.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[var(--text-secondary)] font-mono">
                      <span>IVA Desglosado (13%):</span>
                      <span>₡{cartTax.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[var(--text-primary)] font-extrabold text-sm border-t border-[var(--border-color)] pt-2">
                      <span>Monto Total Neto:</span>
                      <span className="font-mono text-blue-600 dark:text-[var(--brand-gold-light)]">₡{cartTotal.toLocaleString()}</span>
                    </div>
                  </div>

                  {checkoutStep === 0 && (
                    <button
                      onClick={() => {
                        if (cart.length === 0) return;
                        setCheckoutStep(1);
                      }}
                      disabled={cart.length === 0}
                      className="w-full bg-[var(--brand-gold-mid)] hover:bg-[#c49f2c] disabled:bg-slate-200 disabled:text-[var(--text-primary)] text-[#1a1408] dark:text-[#14100a] font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-1.5 uppercase transition cursor-pointer"
                    >
                      Continuar a Envío <ArrowRight className="w-4 h-4" />
                    </button>
                  )}

                  {checkoutStep === 1 && (
                    <button
                      onClick={() => {
                        if (!recipientName.trim()) {
                          toast.warning('El nombre del destinatario es obligatorio.');
                          return;
                        }
                        if (!recipientPhone.trim()) {
                          toast.warning('El número de teléfono es obligatorio.');
                          return;
                        }
                        if (!shippingAddress.trim()) {
                          toast.warning('La dirección de envío es obligatoria.');
                          return;
                        }
                        setCheckoutStep(2);
                      }}
                      className="w-full bg-[var(--brand-gold-mid)] hover:bg-[#c49f2c] text-[#1a1408] dark:text-[#14100a] font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-1.5 uppercase transition cursor-pointer"
                    >
                      Continuar al Pago <ArrowRight className="w-4 h-4" />
                    </button>
                  )}

                  {checkoutStep === 2 && (
                    <button
                      onClick={handleConfirmOrder}
                      disabled={isSubmittingOrder}
                      className="w-full bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] disabled:opacity-60 text-[#1a1408] dark:text-[#14100a] font-extrabold text-sm py-3 rounded-xl flex items-center justify-center gap-1.5 uppercase transition shadow-sm cursor-pointer"
                    >
                      {isSubmittingOrder ? 'Procesando...' : 'Confirmar Pago y Generar Comprobante'}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => {
                    setIsCartOpen(false);
                    setCheckoutStep(0);
                    setConfirmedOrder(null);
                    setAppliedCoupon(null);
                    setCouponCode('');
                    setInvoiceInfo(null);
                    setFiscalIdValue('');
                    setFiscalEmail('');
                  }}
                  className="w-full bg-slate-200 hover:bg-slate-300 text-[var(--text-primary)] font-bold text-sm py-3 rounded-xl transition uppercase cursor-pointer"
                >
                  Regresar a la Tienda
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Login / Register Unified Modal */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsLoginModalOpen(false)} />

          {/* max-h + overflow-y-auto: en móvil, al abrir el teclado el formulario
              (sobre todo el de registro, que es alto) se desplaza dentro del modal
              sin empujar ni romper la barra inferior. my-auto lo mantiene centrado
              cuando cabe, y el scroll interno lo salva cuando no. */}
          <div className="relative max-w-md w-full my-auto max-h-[92dvh] overflow-y-auto glass-panel-strong rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 text-[var(--text-primary)] animate-in zoom-in-95 duration-200" id="login-register-modal">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-gradient-to-tr from-[#3B82F6] to-blue-600 dark:bg-[var(--brand-gold-mid)] dark:bg-none rounded-2xl flex items-center justify-center border border-white/40 shadow-sm mx-auto">
                <span className="text-white dark:text-[#14100a] text-lg">🔑</span>
              </div>
              <h2 className="text-lg font-extrabold tracking-tight font-display text-[var(--text-primary)]">
                {isRegisterMode ? 'Crear Cuenta' : 'Iniciar Sesión'}
              </h2>
              <p className="text-[10px] text-[var(--text-primary)] uppercase font-bold tracking-wider">
                Technoverse - Portal Seguro de Cliente
              </p>
            </div>

            {isRegisterMode ? (
              <form onSubmit={handleClientRegisterSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Nombre Completo</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Ej. María Solano Brenes"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none transition"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Correo Electrónico</label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="maria@correo.cr"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Teléfono</label>
                    <input
                      type="text"
                      required
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="88884444"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none transition"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Provincia</label>
                  <CustomSelect
                    value={regProvince}
                    onChange={setRegProvince}
                    options={COSTA_RICA_PROVINCES.filter(Boolean).map(prov => ({ value: prov, label: prov }))}
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Dirección de Entrega Exacta</label>
                  <input
                    type="text"
                    required
                    value={regAddress}
                    onChange={(e) => setRegAddress(e.target.value)}
                    placeholder="Calle, avenidas, señas particulares"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Contraseña</label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[#1a1408] dark:text-[#14100a] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider transition shadow-sm mt-2 cursor-pointer"
                >
                  Registrarse y Entrar
                </button>
              </form>
            ) : (
              <form onSubmit={handleClientLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Correo Electrónico</label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="ejemplo@correo.com"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-secondary)] mb-1 tracking-wider">Contraseña</label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] focus:border-blue-500 dark:focus:border-[var(--brand-gold-mid)] dark:focus:border-[var(--brand-gold-mid)] focus:ring-1 focus:ring-blue-500 dark:focus:ring-[var(--brand-gold-mid)] dark:focus:ring-[var(--brand-gold-mid)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[var(--brand-gold-mid)] hover:bg-[var(--brand-gold-dark)] text-[#1a1408] dark:text-[#14100a] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider transition shadow-sm mt-2 cursor-pointer"
                >
                  Iniciar Sesión
                </button>
              </form>
            )}

            <div className="text-center pt-3 border-t border-[var(--border-color)]">
              <button
                onClick={() => setIsRegisterMode(!isRegisterMode)}
                className="text-sm text-blue-600 hover:text-blue-700 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] font-bold cursor-pointer"
              >
                {isRegisterMode ? '¿Ya tienes cuenta? Inicia Sesión' : '¿No tienes cuenta? Regístrate Aquí'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Floating Chat component for real-time customer support */}
      <LiveChat />

      {/* INTERACTIVE PRODUCT DETAIL MODAL */}
      {selectedProductDetail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in duration-200">
          <div 
            className="glass-panel-strong rounded-3xl shadow-sm overflow-hidden w-full max-w-xl max-h-[90vh] flex flex-col md:flex-row animate-in zoom-in-95 duration-250"
            id="product-detail-modal"
          >
            {/* Left side: Photo */}
            <div className="md:w-1/2 bg-[var(--bg-surface)] flex items-center justify-center p-6 relative min-h-[220px]">
              {selectedProductDetail.imageUrl ? (
                <img 
                  src={selectedProductDetail.imageUrl} 
                  alt={selectedProductDetail.name} 
                  className="max-h-56 max-w-full object-contain rounded-xl"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-[var(--text-primary)]">
                  <Smartphone className="w-16 h-16 text-[var(--text-secondary)] mb-2" />
                  <span className="text-sm font-mono">Sin Imagen</span>
                </div>
              )}
              {/* Category tag */}
              <span className="absolute top-4 left-4 bg-slate-900 border border-slate-800 text-[var(--brand-gold-mid)] px-2.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider">
                {selectedProductDetail.category}
              </span>
            </div>

            {/* Right side: Information */}
            <div className="md:w-1/2 p-6 flex flex-col justify-between space-y-4 overflow-y-auto">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="font-extrabold text-base text-[var(--text-primary)] leading-tight">
                    {selectedProductDetail.name}
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] text-[var(--text-primary)] font-mono">
                    <span>SKU: {selectedProductDetail.sku}</span>
                    <span>•</span>
                    <span className="text-[var(--brand-gold-mid)]">Garantía: {selectedProductDetail.warranty || '90 días'}</span>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {selectedProductDetail.description || 'Dispositivo de alta calidad de Technoverse, completamente verificado por nuestro equipo técnico para ofrecer el máximo rendimiento.'}
                </p>

                {/* Stock tracker */}
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${selectedProductDetail.stock === 0 ? 'bg-rose-500' : 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]'}`} />
                  <span className="text-sm font-bold text-[var(--text-primary)]">
                    {selectedProductDetail.stock === 0 
                      ? 'Agotado' 
                      : `Stock disponible: ${selectedProductDetail.stock} unidades`}
                  </span>
                </div>

                {/* Price Display */}
                <div>
                  <div className="text-[10px] uppercase font-mono text-[var(--text-primary)] tracking-wider">Precio Final:</div>
                  <div className="flex items-baseline gap-2">
                    {(() => {
                      const discountedPrice = getProductDiscountedPrice(selectedProductDetail);
                      const isDiscounted = discountedPrice < selectedProductDetail.price;
                      return isDiscounted ? (
                        <>
                          <span className="text-xl font-black text-blue-600 dark:text-[var(--brand-gold-light)] font-mono">
                            ₡{discountedPrice.toLocaleString()}
                          </span>
                          <span className="text-sm text-[var(--text-primary)] line-through font-mono">
                            ₡{selectedProductDetail.price.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="text-xl font-black text-[var(--text-primary)] font-mono">
                          ₡{selectedProductDetail.price.toLocaleString()}
                        </span>
                      );
                    })()}
                    <span className="text-[9px] text-[var(--text-primary)]">IVA incluido</span>
                  </div>
                </div>
              </div>

              {/* Selector and Actions */}
              <div className="space-y-4 pt-4 border-t border-[var(--border-color)]">
                {selectedProductDetail.stock > 0 ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-bold text-[var(--text-primary)]">Cantidad:</span>
                    <div className="flex items-center border border-[var(--border-color)] rounded-xl overflow-hidden bg-[var(--bg-surface)] ">
                      <button
                        onClick={() => setDetailQuantity(Math.max(1, detailQuantity - 1))}
                        className="px-3 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-base)] font-extrabold cursor-pointer transition text-sm"
                      >
                        -
                      </button>
                      <span className="px-4 py-1 text-sm font-bold text-[var(--text-primary)] font-mono">
                        {detailQuantity}
                      </span>
                      <button
                        onClick={() => setDetailQuantity(Math.min(selectedProductDetail.stock, detailQuantity + 1))}
                        className="px-3 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-base)] font-extrabold cursor-pointer transition text-sm"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-rose-50 text-rose-600 border border-rose-100 rounded-xl p-2.5 text-center text-sm font-bold">
                    Artículo temporalmente sin stock
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setSelectedProductDetail(null)}
                    className="w-full bg-[var(--bg-base)] hover:bg-slate-200 text-[var(--text-primary)] font-bold text-sm py-2.5 rounded-xl uppercase tracking-wider text-center transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleAddToCartWithQty(selectedProductDetail, detailQuantity)}
                    disabled={selectedProductDetail.stock === 0}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider text-center transition cursor-pointer shadow-sm ${
                      selectedProductDetail.stock === 0
                        ? 'bg-slate-200 text-[var(--text-primary)] cursor-not-allowed'
                        : 'bg-[var(--brand-gold-mid)] hover:bg-[#c49f2c] text-[#1a1408] dark:text-[#14100a]'
                    }`}
                  >
                    Añadir al carrito
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
