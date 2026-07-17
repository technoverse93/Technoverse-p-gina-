import { motion, AnimatePresence } from "motion/react";
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { PaginatedTbody } from './PaginationHelper';
import { 
  LayoutDashboard, Package, Wrench, Users, CreditCard, FileSpreadsheet,
  Settings, ShieldCheck, Megaphone, Truck, ShieldAlert, LogOut, Sun, Moon,
  X, Plus, Trash2, Edit, Save, RefreshCw, Key, ArrowRightLeft, Eye, EyeOff, Download, DollarSign, BookOpen, ChevronDown, ChevronRight, ShoppingBag, CheckCircle,
  Home, Sparkles, UserPlus, TrendingUp, BarChart3, Activity, MoreHorizontal
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDB, saveDB, addAuditLog, ADMIN_PASSWORD, saveLogo } from '../utils/storage';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

import { User, Product, Order, RepairOrder, ClientProfile, LogisticsDelivery, MarketingCampaign, AuditLog, Banner } from '../types';
import TallerKanban from './TallerKanban';
import InventarioControl from './InventarioControl';
import ComplianceModule from './ComplianceModule';
import InventarioMundo3D from './InventarioMundo3D';

interface AdminPanelProps {
  onNavigateToStore: () => void;
  onRefreshTrigger?: () => void;
  currentUser: User | null;
  isAuthenticated: boolean;
  onLogin: (user: User) => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
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
  theme,
  toggleTheme
}: AdminPanelProps) {
  const isSavingConfigRef = useRef(false);
  const isSavingProductRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Floating top bar dropdown states
  const [isModulesDropdownOpen, setIsModulesDropdownOpen] = useState(false);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Navigation sidebar
  const [activeTab, setActiveTab] = useState<string>(() => {
    const path = window.location.pathname;
    if (path.startsWith('/admin/')) {
      const tab = path.replace('/admin/', '');
      return tab || 'dashboard';
    }
    return 'dashboard';
  });


  

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
  const [banners, setBanners] = useState<Banner[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);

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
  const [storeLogo, setStoreLogo] = useState('');
  const [storeLogoPreview, setStoreLogoPreview] = useState<string | null>(null);

  // Client form state
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientForm, setClientForm] = useState<Partial<ClientProfile>>({
    name: '', email: '', phone: '', province: 'San José', addressDetail: '', notes: ''
  });

  // Marketing states
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  const [couponForm, setCouponForm] = useState<Partial<MarketingCampaign>>({
    code: '', type: 'Porcentaje', value: 10, limit: 100, active: true
  });
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false);
  const [bannerForm, setBannerForm] = useState<Partial<Banner>>({
    title: '', description: '', type: 'General', active: true
  });

  const handleSaveCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.code || !couponForm.value) return;
    const db = getDB();
    const newCoupon = {
      ...couponForm,
      id: `CAMP-${Date.now()}`,
      used: 0
    } as MarketingCampaign;
    db.marketing_campaigns.push(newCoupon);
    saveDB(db);
    loadAllAdminData();
    setIsCouponModalOpen(false);
    addAuditLog(currentUser?.email || 'admin', 'Mercadeo', 'Crear Cupón', `Cupón ${newCoupon.code} creado`);
  };

  const handleSaveBanner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerForm.title) return;
    const db = getDB();
    if (bannerForm.id) {
      const idx = db.banners.findIndex(b => b && b.id === bannerForm.id);
      if (idx !== -1) {
        db.banners[idx] = bannerForm as Banner;
      }
    } else {
      const newBanner = {
        ...bannerForm,
        id: `BAN-${Date.now()}`
      } as Banner;
      db.banners.push(newBanner);
    }
    saveDB(db);
    loadAllAdminData();
    setIsBannerModalOpen(false);
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
      alert('El nombre del cliente es obligatorio.');
      return;
    }
    if (!clientForm.email) {
      alert('El correo electrónico es obligatorio.');
      return;
    }
    if (!clientForm.phone) {
      alert('El teléfono es obligatorio.');
      return;
    }
    if (!clientForm.addressDetail) {
      alert('La dirección exacta es obligatoria.');
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
      alert('No se pudo guardar el cliente en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    loadAllAdminData();
    setIsClientModalOpen(false);
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
    
    const handleDbUpdate = () => {
      loadAllAdminData();
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
          loadAllAdminData();
        }
      };
    } catch (e) {
      // Ignored
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('storage', handleDbUpdate);
      window.removeEventListener('technoverse_db_updated', handleDbUpdate);
      if (channel) {
        channel.close();
      }
    };
  }, []);

  const loadAllAdminData = () => {
    const db = getDB();
    setProducts(db.products || []);
    setOrders(db.orders || []);
    setRepairs(db.repair_orders || []);
    if (db.settings) {
      setCedulaJuridica(db.settings.cedulaJuridica);
      setCompanyPhone(db.settings.companyPhone || '');
      setCompanyAddress(db.settings.companyAddress || '');
      setPickupHours(db.settings.pickupHours || '');
      setStoreLogo(db.settings.storeLogo || '');
    }
    setClients(db.clients || []);
    setDeliveries(db.deliveries || []);
    setCampaigns(db.marketing_campaigns || []);
    setBanners(db.banners || []);
    setAuditLog(db.audit_log || []);
    
    if (onRefreshTrigger) {
      onRefreshTrigger();
    }
  };

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();

    // Autenticación real contra Supabase Auth (ya no comparación de texto
    // plano local ni Firebase). El rol se determina desde la tabla profiles,
    // que es la fuente de verdad, no un email hardcodeado.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: cleanEmail, password: loginPassword
    });

    if (signInError || !signInData?.user) {
      alert('Credenciales inválidas. Por favor verifique el correo y contraseña.');
      addAuditLog(cleanEmail || 'anonimo', 'Seguridad', 'Intento Fallido', 'Intento de login con credenciales incorrectas.');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, employee_role, name')
      .eq('id', signInData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role === 'Cliente') {
      await supabase.auth.signOut();
      alert('Esta cuenta no tiene acceso al panel de administración.');
      return;
    }

    // Cualquier cuenta autenticada que no sea Cliente es Administrador con
    // acceso total: ya no existe el rol intermedio de Empleado.
    const adminUser: User = { id: 'admin-id', email: cleanEmail, role: 'Dueño', name: profile.name || 'Administrador Technoverse' };
    onLogin(adminUser);
    setLoginEmail(''); setLoginPassword('');
    setLoginToastMessage('Sesión iniciada con éxito como Administrador.');
    setShowLoginToast(true);
    setTimeout(() => setShowLoginToast(false), 3000);
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

      addAuditLog(currentUser?.email || 'admin', 'Configuración', 'Actualizar Ajustes', 'Ajustes fiscales, operativos y logo actualizados', db);
      await saveDB(db);
    } catch (err: any) {
      alert('No se pudo guardar la configuración/logo en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    setStoreLogoPreview(null);
    loadAllAdminData();
    alert('Parámetros de facturación fiscal y de operación residencial guardados con éxito.');
  };

  const handleLogout = async () => {
    if (currentUser) {
      addAuditLog(currentUser.email, 'Seguridad', 'Logout', 'Sesión cerrada por el usuario.');
    }
    await supabase.auth.signOut();
    onLogout();
    setLoginPassword('');
  };

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
      alert('Por favor complete todos los datos con valores positivos.');
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
      alert('No se pudo guardar el producto en la base de datos. Detalle: ' + (err?.message || err));
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
    if (!window.confirm(`¿Seguro que desea eliminar el producto ${name}?`)) return;
    const db = getDB();
    db.products = db.products.filter(p => p && p.id !== prodId);
    try {
      await saveDB(db);
    } catch (err: any) {
      alert('No se pudo eliminar el producto en la base de datos. Detalle: ' + (err?.message || err));
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
        alert('No se pudo crear el usuario. Detalle: ' + (fnData?.error || fnError?.message || 'error desconocido'));
        return;
      }

      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Seguridad', 'Crear Usuario Administrador', `Usuario administrador creado: ${newUserName} (${newUserEmail})`);
      setGeneratedUserPass(finalPass);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const downloadFacturaPDF = (order: Order) => {
    const db = getDB();
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Factura ${order.id}</title>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
            .logo { font-size: 24px; font-weight: bold; color: #0284c7; }
            .details { margin-bottom: 30px; font-size: 14px; }
            .details div { margin-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
            th { background: #f9f9f9; }
            .totals { width: 50%; float: right; }
            .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
            .totals .bold { font-weight: bold; border-top: 2px solid #333; margin-top: 5px; padding-top: 5px; }
            .footer { margin-top: 50px; text-align: center; font-size: 10px; color: #777; clear: both; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">TECHNOVERSE S.A.</div>
            <div>Cédula Jurídica: ${db.settings?.cedulaJuridica || 'Pendiente de configurar'}</div>
            <div>Factura Electrónica ${order.id}</div>
          </div>
          <div class="details">
            <div><strong>Cliente:</strong> ${order.customerName}</div>
            <div><strong>Fecha:</strong> ${new Date(order.timestamp).toLocaleString()}</div>
            <div><strong>Estado:</strong> ${order.status}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${order.items.map(it => it && `
                <tr>
                  <td>${it.productName}</td>
                  <td>${it.quantity}</td>
                  <td>₡${(it.price * it.quantity).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="totals">
            <div><span>Subtotal:</span> <span>₡${(order.total - order.taxAmount - order.shippingCost).toLocaleString()}</span></div>
            <div><span>Envío:</span> <span>₡${order.shippingCost.toLocaleString()}</span></div>
            <div><span>IVA (13%):</span> <span>₡${order.taxAmount.toLocaleString()}</span></div>
            <div class="bold"><span>Total Pagado:</span> <span>₡${order.total.toLocaleString()}</span></div>
          </div>
          <div class="footer">
            Generado por Technoverse Admin Panel de conformidad con la directriz DGT-R-48-2016 del Ministerio de Hacienda.
          </div>
          <script>
            window.onload = () => { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };
  // Credit Note returns
  const handleIssueCreditNote = async (orderId: string) => {
    if (!window.confirm('¿Desea generar una Nota de Crédito fiscal (NC-001) para esta factura? Esto reintegrará automáticamente el stock a bodega.')) {
      return;
    }

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
      id: `NC-00${db.orders.length + 1}`,
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
      alert('No se pudo guardar la nota de crédito en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
    loadAllAdminData();
    if (onRefreshTrigger) onRefreshTrigger();
    alert(`Nota de crédito emitida con éxito. Stock reintegrado.`);
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
    const categories = ['Pantallas', 'Baterías', 'Cámaras', 'Tarjetas Lógicas', 'Fundas'];
    const data = categories.map(cat => cat && ({
      name: cat,
      stock: products.filter(p => p && p.category === cat).length
    }));
    return data.some(d => d && d.stock > 0) ? data : [];
  }, [products]);

  const handleExportCSV = (data: any[], fileName: string) => {
    if (data.length === 0) {
      alert('No hay datos para exportar.');
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
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <div className="animate-pulse text-[var(--text-secondary)] text-sm font-mono">Redireccionando al portal unificado...</div>
      </div>
    );
  }

  const isOwner = currentUser?.role === 'Dueño';

  // Helper to check if a category has any permitted sub-items
  const getPermittedSubItems = (category: 'inventario' | 'administracion') => {
    if (category === 'inventario') {
      const items = [
        { id: 'inventario_productos', label: 'Productos', icon: Package },
        { id: 'inventario_repuestos', label: 'Repuestos', icon: Wrench },
        { id: 'inventario_movimientos', label: 'Movimientos', icon: ArrowRightLeft },
        { id: 'inventario_reportes', label: 'Reportes de Stock', icon: FileSpreadsheet },
      ];
      // Dueño sees everything, as requested to restore visibility in both panels.
      return items.filter(it => it && isOwner || hasPermission(it.id));
    } else {
      const items = [
        { id: 'facturacion', label: 'Contabilidad y FAC', icon: FileSpreadsheet },
        { id: 'cumplimiento', label: 'Cumplimiento Legal', icon: ShieldCheck },
        { id: 'marketing', label: 'Marketing y Banners', icon: Megaphone },
        { id: 'logistica', label: 'Logística Entregas', icon: Truck },
        { id: 'bitacora', label: 'Bitácora de Auditoría', icon: BookOpen },
        { id: 'configuracion', label: 'Configuración General', icon: Settings },
      ];
      return items.filter(it => it && isOwner || hasPermission(it.id));
    }
  };

  const sidebarSections = [
    {
      title: "General",
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }
      ]
    },
    {
      title: "Control de Inventario",
      items: [
        { id: 'inventario_productos', label: 'Productos', icon: Package },
        { id: 'inventario_repuestos', label: 'Repuestos', icon: Wrench },
        { id: 'inventario_movimientos', label: 'Movimientos', icon: ArrowRightLeft },
        { id: 'inventario_reportes', label: 'Reportes de Stock', icon: FileSpreadsheet },
      ]
    },
    {
      title: "Operaciones",
      items: [
        { id: 'taller', label: 'Taller Kanban', icon: Wrench },
        { id: 'clientes', label: 'Clientes CRM', icon: CreditCard }
      ]
    },
    {
      title: "Servicios & Finanzas",
      items: [
        { id: 'facturacion', label: 'Contabilidad y FAC', icon: FileSpreadsheet },
        { id: 'cumplimiento', label: 'Cumplimiento Legal', icon: ShieldCheck },
        { id: 'marketing', label: 'Marketing y Banners', icon: Megaphone },
        { id: 'logistica', label: 'Logística Entregas', icon: Truck },
        { id: 'bitacora', label: 'Bitácora de Auditoría', icon: BookOpen },
        { id: 'configuracion', label: 'Configuración General', icon: Settings },
      ]
    }
  ];

  return (
    <div className="h-dvh bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col overflow-hidden w-full" id="admin-panel-root">
      {showLoginToast && (
        <div className="fixed bottom-6 right-6 z-[998] bg-[#1E293B]/95 border border-[var(--brand-gold-mid)]/50 text-white px-5 py-3 rounded-2xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="p-1 bg-[var(--brand-gold-mid)] rounded-lg">
            <CheckCircle className="w-4 h-4 text-[#1a1408] dark:text-[#14100a]" />
          </div>
          <div>
            <div className="text-[10px] text-[var(--brand-gold-mid)] font-bold uppercase tracking-wider">¡Éxito!</div>
            <div className="text-sm font-sans text-slate-100">{loginToastMessage}</div>
          </div>
        </div>
      )}
      {/* UNIFIED NAVIGATION HEADER WITH BREADCRUMB GLASS DROP-DOWNS */}
      <header className="glass-nav h-12 sm:h-14 sticky top-0 z-50 flex items-center justify-between px-3 md:px-4">
        <div className="flex items-center gap-3 sm:gap-4 overflow-hidden flex-1 min-w-0">
          <button onClick={() => onNavigateToStore? onNavigateToStore() : window.location.reload()} className="hidden lg:flex flex-shrink-0 items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--brand-gold-mid)]/10 text-sky-600 dark:text-[var(--brand-gold-light)] font-bold text-[10px] hover:bg-[var(--brand-gold-mid)]/20 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> Ver tienda</button>
          <div className="flex items-center gap-2 flex-shrink-0">
            <img src={storeLogoPreview || storeLogo || "/logo.png"} alt="Technoverse Logo" className="h-8 w-8 rounded-lg border border-[var(--border-color)] object-contain bg-[var(--bg-surface)] p-0.5" />
            <span className="font-display font-bold text-lg tracking-tight text-[var(--brand-gold-mid)] hidden sm:block">
              Technoverse
            </span>
          </div>

          {/* Navigation Items (Center-Left) */}
          <nav className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0">
            {/* Dashboard */}
            {(isOwner || hasPermission('dashboard')) && (
              <button
                onClick={() => {
                  setActiveTab('dashboard');
                  setActiveDropdown(null);
                }}
                className={`px-4 py-3 text-sm font-bold uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center gap-1 flex-shrink-0 ${
                  activeTab === 'dashboard' 
                    ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] border border-[var(--brand-gold-mid)]/20' 
                    : 'text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
                <span className="hidden md:inline whitespace-nowrap">Dashboard</span>
              </button>
            )}
          </nav>
        </div>

        {/* Right side Profile Dropdown */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            className="p-3 md:p-2.5 rounded-xl border bg-[var(--bg-surface)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--brand-gold-mid)] hover:text-[var(--brand-gold-mid)] transition-all duration-200 flex items-center justify-center cursor-pointer dark:border-[#8f7a5a] dark:text-[#c9b57e]"
            title="Cambiar Tema"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <button
            onClick={onNavigateToStore}
            className="flex lg:hidden items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--brand-gold-mid)]/10 text-sky-400 dark:text-[var(--brand-gold-light)] hover:bg-[var(--brand-gold-mid)]/20 transition text-[10px] font-bold uppercase tracking-wider border border-sky-500 dark:border-[var(--brand-gold-mid)]/20"
            title="Volver a la tienda"
          >
            <Home className="w-3 h-3" />
            Ver tienda
          </button>
          <button
            onClick={handleLogout}
            className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer font-bold text-sm"
          >
            <LogOut className="w-4 h-4" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </header>

      {/* WORKSPACE CONTENT AREA */}
      <div className="flex-1 flex flex-row overflow-hidden w-full relative">
        {/* Sidebar on Desktop / Drawer on Mobile */}
        <aside className={`hidden lg:flex flex-col glass-panel !rounded-none !border-y-0 !border-l-0 transition-all duration-300 overflow-hidden flex-shrink-0 ${isSidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="flex-1 overflow-y-auto py-4 space-y-4 px-3 select-none">
            {/* Sidebar toggle button inside the sidebar top */}
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-2'} mb-2`}>
              {!isSidebarCollapsed && <span className="text-[10px] font-black tracking-wider text-[var(--text-muted)] uppercase">Navegación</span>}
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-slate-800 transition"
                title={isSidebarCollapsed ? "Expandir" : "Contraer"}
              >
                {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 rotate-90" />}
              </button>
            </div>

            {/* Sidebar Sections */}
            {sidebarSections.map((sec, secIdx) => {
              // Filter permitted items
              const permittedItems = sec.items.filter(item => isOwner || hasPermission(item.id));
              if (permittedItems.length === 0) return null;

              return (
                <div key={secIdx} className="space-y-1">
                  {!isSidebarCollapsed && (
                    <div className="text-[9px] uppercase font-bold text-[var(--text-muted)] px-3 py-1.5 tracking-widest border-b border-[var(--border-color)]/30 mb-1">
                      {sec.title}
                    </div>
                  )}
                  {permittedItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id);
                          setActiveDropdown(null);
                        }}
                        className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
                          isActive 
                            ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] border border-[var(--brand-gold-mid)]/20 font-bold' 
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                        }`}
                        title={isSidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[var(--brand-gold-mid)]' : 'text-[var(--text-muted)]'}`} />
                        {!isSidebarCollapsed && <span className="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>


        {/* WORKSPACE CONTENT AREA */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 lg:pb-8 space-y-6 w-full bg-[var(--bg-base)]" style={{ willChange: 'scroll-position' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              {activeTab === 'dashboard' && (
          /* MODULE A: DASHBOARD PRINCIPAL */
          <div className="space-y-8" id="view-dashboard">
            <AnimatePresence mode="wait">
              {!isMounted ? (
                <motion.div 
                  key="skeleton"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-8"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse" />
                    <div className="h-7 bg-slate-200 rounded-lg w-64 animate-pulse" />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 h-[104px] space-y-3">
                        <div className="h-3 bg-[var(--border-color)] rounded w-16 animate-pulse" />
                        <div className="h-6 bg-[var(--border-color)] rounded w-24 animate-pulse" />
                        <div className="h-3 bg-[var(--border-color)] rounded w-20 animate-pulse" />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 h-[380px] space-y-4">
                      <div className="h-4 bg-[var(--border-color)] rounded w-48 animate-pulse" />
                      <div className="flex-1 w-full bg-[var(--border-color)] rounded-xl animate-pulse" style={{ height: '280px' }} />
                    </div>
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 h-[380px] space-y-4">
                      <div className="h-4 bg-[var(--border-color)] rounded w-48 animate-pulse" />
                      <div className="flex-1 w-full bg-[var(--border-color)] rounded-xl animate-pulse" style={{ height: '280px' }} />
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 h-[260px] space-y-4">
                    <div className="h-4 bg-[var(--border-color)] rounded w-64 animate-pulse" />
                    <div className="flex-1 w-full bg-[var(--border-color)] rounded-xl animate-pulse" style={{ height: '180px' }} />
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="content"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="space-y-8"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-[var(--text-secondary)] flex items-center gap-3 tracking-tight">
                      <div className="p-2 bg-blue-600 dark:bg-[var(--brand-gold-mid)] rounded-xl shadow-sm">
                        <LayoutDashboard className="w-5 h-5 text-white dark:text-slate-950" />
                      </div>
                      Centro de Operaciones Technoverse
                    </h3>
                    <div className="hidden sm:flex items-center gap-2 text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest bg-[var(--bg-surface)] px-3 py-1.5 rounded-full border border-[var(--border-color)]">
                      <Activity className="w-3 h-3 text-emerald-500 animate-pulse dark:text-[var(--brand-gold-light)]" /> Sistema en Línea • San José, CR
                    </div>
                  </div>

                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">Ingresos Brutos</span>
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-[var(--text-secondary)] font-mono">₡{totalSalesRevenue.toLocaleString()}</div>
                      <div className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full inline-block dark:text-[var(--brand-gold-light)] dark:bg-[var(--brand-gold-mid)]">Cierre de Caja OK</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">Clientes Activos</span>
                        <Users className="w-3.5 h-3.5 text-blue-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-[var(--text-secondary)] font-mono">{clientsCount}</div>
                      <div className="text-[10px] font-bold text-[var(--text-muted)] italic">Base de Datos CRM</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">En Taller</span>
                        <Wrench className="w-3.5 h-3.5 text-sky-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-sky-600 dark:text-[var(--brand-gold-light)] font-mono">{activeRepairsCount}</div>
                      <div className="text-[10px] font-bold text-[var(--text-muted)]">Reparaciones en Curso</div>
                    </div>

                    <div className={`bg-[var(--bg-surface)] border rounded-2xl p-5 space-y-3 shadow-sm transition-all duration-300 ${
                      repairsAwaitingParts > 0 ? 'border-rose-500' : 'border-[var(--border-color)] hover:shadow-md'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Backlog Repuestos</span>
                        <ShieldAlert className={`w-3.5 h-3.5 ${repairsAwaitingParts > 0 ? 'text-rose-500' : 'text-[var(--text-muted)]'}`} />
                      </div>
                      <div className={`text-xl font-black font-mono ${repairsAwaitingParts > 0 ? 'text-rose-600' : 'text-[var(--text-secondary)]'}`}>
                        {repairsAwaitingParts}
                      </div>
                      <div className={`text-[10px] font-black uppercase ${repairsAwaitingParts > 0 ? 'text-rose-500 animate-pulse' : 'text-[var(--text-muted)]'}`}>
                        {repairsAwaitingParts > 0 ? '⚠️ Acción Requerida' : 'Flujo Optimizado'}
                      </div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">Capacidad Bodega</span>
                        <Package className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <div className="text-xl font-black text-emerald-600 font-mono dark:text-[var(--brand-gold-light)]">{estimatedFreeSpace}%</div>
                      <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-tighter">Espacio Disponible</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-wider">Stock Crítico</span>
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <div className="text-xl font-black text-amber-600 font-mono">{lowStockProductsCount}</div>
                      <div className="text-[10px] font-bold text-[var(--text-muted)] italic">Items por reponer</div>
                    </div>
                  </div>

                  {/* CHARTS */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 shadow-sm flex flex-col h-[380px]">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest">Rendimiento de Ventas Diarias</span>
                        <BarChart3 className="w-4 h-4 text-blue-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="flex-1 w-full min-h-[260px]">
                        {orders.filter(o => o && o.status === 'Completado').length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                            <TrendingUp className="w-12 h-12 mb-2 opacity-10" />
                            <p className="text-xs font-bold uppercase tracking-widest">Aún no hay ventas registradas</p>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dailySalesData}>
                              <defs>
                                <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                              <XAxis 
                                dataKey="name" 
                                stroke="#94a3b8" 
                                fontSize={11} 
                                fontWeight={600}
                                tickLine={false} 
                                axisLine={false}
                                dy={10}
                              />
                              <YAxis 
                                stroke="#94a3b8" 
                                fontSize={11} 
                                fontWeight={600}
                                tickLine={false} 
                                axisLine={false}
                                tickFormatter={(val) => `₡${val/1000}k`}
                              />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: '#fff', 
                                  border: '1px solid #e2e8f0', 
                                  borderRadius: '12px',
                                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                  color: '#1e293b', 
                                  fontSize: '12px',
                                  fontWeight: 'bold'
                                }} 
                              />
                              <Area 
                                type="monotone" 
                                dataKey="ventas" 
                                stroke="#3b82f6" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorVentas)" 
                                animationDuration={1500}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 shadow-sm flex flex-col h-[380px]">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest">Distribución de Inventario</span>
                        <Package className="w-4 h-4 text-emerald-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="flex-1 w-full min-h-[260px]">
                        {inventoryDistData.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                            <Package className="w-12 h-12 mb-2 opacity-10" />
                            <p className="text-xs font-bold uppercase tracking-widest">Sin stock en categorías principales</p>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={inventoryDistData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                              <XAxis 
                                dataKey="name" 
                                stroke="#94a3b8" 
                                fontSize={11} 
                                fontWeight={600}
                                tickLine={false} 
                                axisLine={false}
                                dy={10}
                              />
                              <YAxis 
                                stroke="#94a3b8" 
                                fontSize={11} 
                                fontWeight={600}
                                tickLine={false} 
                                axisLine={false}
                              />
                              <Tooltip 
                                cursor={{fill: '#f8fafc'}} 
                                contentStyle={{ 
                                  backgroundColor: '#fff', 
                                  border: '1px solid #e2e8f0', 
                                  borderRadius: '12px',
                                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                  fontSize: '12px',
                                  fontWeight: 'bold'
                                }} 
                              />
                              <Bar 
                                dataKey="stock" 
                                fill="#10b981" 
                                radius={[6, 6, 0, 0]} 
                                animationDuration={1500}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* SVG Visual Sales Graphic */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 shadow-sm flex flex-col h-[260px]">
                    <div className="flex items-center justify-between mb-6">
                      <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest">Actividad Reciente de Transacciones</span>
                      <CreditCard className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex-1 h-full bg-[var(--bg-base)] rounded-2xl border border-[var(--border-color)] p-6 flex items-end justify-between gap-3 relative" style={{ contain: 'layout style' }}>
                      <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 dark:bg-[var(--brand-gold-mid)] opacity-20" />
                      {orders.length === 0 ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] font-bold uppercase tracking-widest gap-2">
                          <ShoppingBag className="w-8 h-8 opacity-20" />
                          Esperando Primera Venta
                        </div>
                      ) : (
                        orders.slice(-15).map((ord, idx) => (
                          <div
                            key={ord.id}
                            className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-pointer"
                          >
                            <div className="relative w-full h-full flex flex-col justify-end">
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-10">
                                <div className="bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap">
                                  ₡{ord.total.toLocaleString()}
                                </div>
                                <div className="w-2 h-2 bg-slate-800 rotate-45 mx-auto -mt-1" />
                              </div>
                              <motion.div
                                initial={{ scaleY: 0 }}
                                animate={{ scaleY: Math.min(1, Math.max(0.15, ord.total / (totalSalesRevenue || 500000))) }}
                                transition={{ type: 'tween', duration: 0.3 }}
                                style={{ transformOrigin: 'bottom' }}
                                className="w-full h-full bg-blue-600 rounded-t-lg group-hover:bg-blue-700 dark:bg-[var(--brand-gold-mid)] dark:group-hover:bg-[var(--brand-gold-dark)] transition-colors"
                              />
                            </div>
                            <span className="text-[9px] font-black text-[var(--text-muted)] font-mono hidden sm:block">#{ord.id.split('-').pop()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {(activeTab === 'productos' || activeTab.startsWith('inventario_')) && (
          /* MODULE B: PRODUCTOS (INVENTARIO CRUD) */
          <div className="space-y-6" id="view-productos">
            <InventarioControl 
              currentUser={currentUser} 
              onDataChanged={loadAllAdminData} 
              defaultSubTab={activeTab.startsWith('inventario_') ? (activeTab.replace('inventario_', '') as any) : 'productos'}
              onTabChange={(tab) => setActiveTab(`inventario_${tab}`)}
            />
          </div>
        )}
        {activeTab === 'taller' && (
          (isOwner || hasPermission('taller')) ? (
            /* MODULE C: TALLER (KANBAN COMPONENT EMBEDDED) */
            <div className="space-y-4" id="view-taller">
              <TallerKanban activeUserEmail={currentUser?.email} onRepairUpdated={loadAllAdminData} />
            </div>
          ) : (
             <div className="p-8 text-center text-rose-500 font-bold">Acceso denegado. Permisos insuficientes.</div>
          )
        )}
        {activeTab === 'clientes' && (
          /* MODULE E: CLIENTES (CRM) */
          <div className="space-y-6" id="view-clientes">
            <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
              <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Clientes CRM Technoverse
              </h3>
              <button 
                onClick={() => openClientModal()}
                className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Registrar Cliente
              </button>
            </div>

            {isClientModalOpen && (
              <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6 mb-6">
                <h4 className="text-sm font-bold text-[var(--text-primary)] mb-4 uppercase tracking-wider">{editingClient ? 'Editar Cliente' : 'Nuevo Cliente'}</h4>
                <form onSubmit={handleSaveClient} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Nombre Completo</label>
                      <input required type="text" value={clientForm.name} onChange={e => setClientForm({...clientForm, name: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Correo Electrónico</label>
                      <input required type="email" value={clientForm.email} onChange={e => setClientForm({...clientForm, email: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Teléfono</label>
                      <input required type="tel" value={clientForm.phone} onChange={e => setClientForm({...clientForm, phone: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Provincia</label>
                      <select required value={clientForm.province} onChange={e => setClientForm({...clientForm, province: e.target.value as any})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]">
                        {['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'].map(p => p && (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Dirección Exacta</label>
                      <input required type="text" value={clientForm.addressDetail} onChange={e => setClientForm({...clientForm, addressDetail: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Notas Internas</label>
                      <textarea value={clientForm.notes} onChange={e => setClientForm({...clientForm, notes: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]" rows={2} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={() => setIsClientModalOpen(false)} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-rose-500">Cancelar</button>
                    <button type="submit" className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] px-4 py-2 rounded-xl text-sm font-bold transition">Guardar Cliente</button>
                  </div>
                </form>
              </div>
            )}

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                      <th className="p-4">Cliente</th>
                      <th className="p-4">Correo / Teléfono</th>
                      <th className="p-4">Provincia</th>
                      <th className="p-4 text-center">Tarjetas Tokenizadas</th>
                      <th className="p-4 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <PaginatedTbody items={clients} itemsPerPage={10} renderItem={(c) => ( 
                        <tr key={c.id} className="hover:bg-[var(--bg-surface)] ">
                          <td className="p-4 font-bold text-[var(--text-primary)]">{c.name}</td>
                          <td className="p-4 font-mono text-[11px] text-[var(--text-secondary)]">
                            <div>{c.email}</div>
                            <div>{c.phone}</div>
                          </td>
                          <td className="p-4 font-sans text-[var(--text-primary)]">{c.province}</td>
                          <td className="p-4 text-center">
                            {c.cardsTokenized.length > 0 ? (
                              <span className="font-mono text-[10px] text-emerald-400 dark:text-[var(--brand-gold-light)]">
                                Token: Visa (•••• {c.cardsTokenized[0].last4})
                              </span>
                            ) : (
                              <span className="text-[10px] text-[var(--text-secondary)] italic">Ninguna</span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <button onClick={() => openClientModal(c)} className="p-1.5 hover:bg-[var(--bg-surface)] rounded-lg text-sky-400 dark:text-[var(--brand-gold-light)] transition" title="Editar Cliente">
                              <Edit className="w-4 h-4" />
                            </button>
                          </td>
                         </tr> )} />
                </table>
              </div>
            </div>
          </div>

        )}
        {activeTab === 'facturacion' && (
          /* MODULE F: FACTURACIÓN Y CONTABILIDAD */
          <div className="space-y-6" id="view-facturacion">
            <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Historial de Facturación Electrónica (FAC-001)
            </h3>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-2.5">
                <span className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] block">Comprobantes de Ingresos</span>
                <button
                  onClick={() => handleExportCSV(orders.map(o => o && ({ 
                    Consecutivo: o.id, 
                    Fecha: o.timestamp, 
                    Cliente: o.customerName, 
                    Subtotal: o.subtotal, 
                    IVA: o.taxAmount, 
                    Total: o.total, 
                    Estado: o.status 
                  })), 'Reporte_IVA_D104')}
                  className="text-[10px] bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 flex items-center gap-1 text-blue-600 dark:text-[var(--brand-gold-light)] hover:bg-[var(--bg-surface)] font-bold transition"
                >
                  <Download className="w-3.5 h-3.5" /> Generar Reporte IVA (D-104)
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 text-[var(--text-secondary)]">
                      <th className="py-2.5">Consecutivo</th>
                      <th className="py-2.5">Cliente</th>
                      <th className="py-2.5 text-right">Subtotal</th>
                      <th className="py-2.5 text-right">IVA (13%)</th>
                      <th className="py-2.5 text-right">Total Neto</th>
                      <th className="py-2.5 text-center">Estado Hacienda</th>
                      <th className="py-2.5 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <PaginatedTbody items={orders} itemsPerPage={10} renderItem={(o) => ( 
                        <tr key={o.id} className="hover:bg-[var(--bg-surface)] ">
                          <td className="py-2.5 text-sky-400 dark:text-[var(--brand-gold-light)] font-bold">{o.id}</td>
                          <td className="py-2.5 font-sans font-medium text-[var(--text-primary)]">{o.customerName}</td>
                          <td className="py-2.5 text-right">₡{o.subtotal.toLocaleString()}</td>
                          <td className="py-2.5 text-right text-[var(--text-secondary)]">₡{o.taxAmount.toLocaleString()}</td>
                          <td className="py-2.5 text-right font-bold text-emerald-400 dark:text-[var(--brand-gold-light)]">₡{o.total.toLocaleString()}</td>
                          <td className="py-2.5 text-center font-sans">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              o.hdaStatus === 'Aceptado' 
                                ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/15 border border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)] text-emerald-600 dark:text-[var(--brand-gold-light)]' 
                                : 'bg-amber-500/15 border border-amber-500 text-amber-600 animate-pulse'
                            }`}>
                              {o.hdaStatus}
                            </span>
                          </td>
                          <td className="py-2.5 text-center font-sans">
                            {o.status !== 'Devuelto' && o.status !== 'Cancelado' ? (
                              <button
                                onClick={() => handleIssueCreditNote(o.id)}
                                className="bg-rose-500/10 hover:bg-rose-500/30 text-rose-400 text-[10px] font-bold px-2.5 py-1 rounded-lg transition"
                              >
                                Emitir Nota Crédito (NC)
                              </button>
                            ) : (
                              <span className="text-rose-400 text-[10px] font-bold italic">DEVUELTO</span>
                            )}
                          </td>
                         </tr> )} />
                </table>
              </div>
            </div>
          </div>

        )}
        {activeTab === 'cumplimiento' && (
          /* MODULE L: CUMPLIMIENTO LEGAL (EMBEDDED NATIVELY) */
          <div className="space-y-4" id="view-cumplimiento">
            <ComplianceModule 
              onRefreshData={loadAllAdminData} 
              activeUserEmail={currentUser?.email} 
            />
          </div>

        )}
        {activeTab === 'marketing' && (
          /* MODULE H: MARKETING AND CAMPAIGNS */
          <div className="space-y-6" id="view-marketing">
            <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Campañas de Mercadeo y Cupones
            </h3>

            {/* Coupons Section */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-2">
                <span className="text-sm font-bold uppercase tracking-wider text-sky-400 dark:text-[var(--brand-gold-light)]">Cupones de Descuento</span>
                <button
                  onClick={() => setIsCouponModalOpen(true)}
                  className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-xl transition flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" /> Nuevo Cupón
                </button>
              </div>

              {isCouponModalOpen && (
                <form onSubmit={handleSaveCoupon} className="bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-color)]/80 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Código Promocional</label>
                      <input required type="text" value={couponForm.code} onChange={e => setCouponForm({...couponForm, code: e.target.value.toUpperCase()})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] uppercase font-mono" placeholder="TECHNO2026" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Tipo Descuento</label>
                      <select required value={couponForm.type} onChange={e => setCouponForm({...couponForm, type: e.target.value as any})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]">
                        <option value="Porcentaje">% Porcentaje</option>
                        <option value="Fijo">₡ Monto Fijo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Valor</label>
                      <input required type="number" value={couponForm.value} onChange={e => setCouponForm({...couponForm, value: parseFloat(e.target.value)})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Límite de Usos</label>
                      <input required type="number" value={couponForm.limit} onChange={e => setCouponForm({...couponForm, limit: parseInt(e.target.value)})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setIsCouponModalOpen(false)} className="text-[10px] text-[var(--text-secondary)] hover:text-rose-500 px-3 py-1">Cancelar</button>
                    <button type="submit" className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] px-4 py-1.5 rounded-lg text-[10px] font-bold transition">Guardar Cupón</button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 text-[var(--text-secondary)]">
                      <th className="py-2">Código</th>
                      <th className="py-2">Tipo</th>
                      <th className="py-2 text-right">Valor</th>
                      <th className="py-2 text-center">Usos</th>
                      <th className="py-2 text-center">Estado</th>
                      <th className="py-2 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <PaginatedTbody items={campaigns} itemsPerPage={10} renderItem={(c) => ( 
                        <tr key={c.id}>
                          <td className="py-2 font-mono font-bold text-sky-400 dark:text-[var(--brand-gold-light)]">{c.code}</td>
                          <td className="py-2 text-[var(--text-primary)]">{c.type}</td>
                          <td className="py-2 text-right font-mono text-[var(--text-primary)]">{c.type === 'Porcentaje' ? `${c.value}%` : `₡${c.value.toLocaleString()}`}</td>
                          <td className="py-2 text-center text-[var(--text-secondary)]">{c.used} / {c.limit}</td>
                          <td className="py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${c.active ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/20 text-emerald-400 dark:text-[var(--brand-gold-light)]' : 'bg-rose-500/20 text-rose-400'}`}>
                              {c.active ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <button onClick={() => {
                              const db = getDB();
                              const idx = db.marketing_campaigns.findIndex(mc => mc && mc.id === c.id);
                              if (idx !== -1) {
                                db.marketing_campaigns[idx].active = !c.active;
                                saveDB(db);
                                loadAllAdminData();
                              }
                            }} className="text-[10px] text-[var(--text-secondary)] hover:text-rose-500 underline">
                              {c.active ? 'Desactivar' : 'Activar'}
                            </button>
                          </td>
                         </tr> )} />
                </table>
              </div>
            </div>

            {/* BANNERS SECTION */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-2">
                <div>
                  <span className="text-sm font-bold uppercase tracking-wider text-sky-400 dark:text-[var(--brand-gold-light)] block">Banners Promocionales</span>
                  <p className="text-[10px] text-[var(--text-secondary)]">Banners que se muestran en la tienda pública.</p>
                </div>
                <button
                  onClick={() => setIsBannerModalOpen(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-xl transition flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" /> Nuevo Banner
                </button>
              </div>

              {isBannerModalOpen && (
                <form onSubmit={handleSaveBanner} className="bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-color)]/80 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Título</label>
                      <input required type="text" value={bannerForm.title} onChange={e => setBannerForm({...bannerForm, title: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Tipo de Banner</label>
                      <select required value={bannerForm.type} onChange={e => setBannerForm({...bannerForm, type: e.target.value as any})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]">
                        <option value="Lanzamiento">Lanzamiento</option>
                        <option value="Oferta">Oferta Especial</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[9px] text-[var(--text-secondary)] uppercase font-bold mb-1">Descripción</label>
                      <textarea required value={bannerForm.description} onChange={e => setBannerForm({...bannerForm, description: e.target.value})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)]" rows={2} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setIsBannerModalOpen(false)} className="text-[10px] text-[var(--text-secondary)] hover:text-rose-500 px-3 py-1">Cancelar</button>
                    <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] px-4 py-1.5 rounded-lg text-[10px] font-bold transition">Guardar Banner</button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {banners.map(b => b && (
                  <div key={b.id} className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 ${b.active ? 'bg-[var(--bg-surface)]  border-[var(--border-color)]/80' : 'bg-[var(--bg-surface)]   border-[var(--border-color)]/50 opacity-50'}`}>
                    <div className="space-y-2">
                      <span className="bg-[var(--brand-gold-mid)]/10 text-sky-400 dark:text-[var(--brand-gold-light)] border border-sky-500 dark:border-[var(--brand-gold-mid)]/20 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                        {b.type}
                      </span>
                      <h5 className="font-bold text-sm text-[var(--text-primary)]">{b.title}</h5>
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        {b.description}
                      </p>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-[var(--border-color)]/50">
                      <span className={`text-[9px] font-bold ${b.active ? 'text-emerald-400 dark:text-[var(--brand-gold-light)]' : 'text-[var(--text-secondary)]'}`}>
                        {b.active ? '● Activo en Tienda' : '○ Oculto'}
                      </span>
                      <button onClick={() => {
                        const db = getDB();
                        const idx = db.banners.findIndex(ban => ban && ban.id === b.id);
                        if (idx !== -1) {
                          db.banners[idx].active = !b.active;
                          saveDB(db);
                          loadAllAdminData();
                        }
                      }} className="text-[10px] text-sky-400 hover:text-sky-300 dark:hover:text-[var(--brand-gold-light)] dark:text-[var(--brand-gold-light)] underline">
                        {b.active ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                  </div>
                ))}
                {banners.length === 0 && (
                  <div className="col-span-full text-center py-6 text-[11px] text-[var(--text-secondary)] italic border border-[var(--border-color)]/50 border-dashed rounded-xl">
                    No hay banners configurados en el sistema.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'logistica' && (
          /* MODULE I: LOGÍSTICA ENTREGAS */
          <div className="space-y-6" id="view-logistica">
            <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
              <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Truck className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Despacho de Envíos y Logística
              </h3>
            </div>

            {/* Home business logistics explanation */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-3">
              <h4 className="text-sm font-bold uppercase text-sky-400 dark:text-[var(--brand-gold-light)]">Canal de Distribución Residencial</h4>
              <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                Dado que Technoverse opera como microempresa familiar desde la vivienda del CEO, no se cuenta con muelles de carga pesada ni silos de distribución masiva. Despachamos todos los envíos utilizando canales profesionales integrados:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[10px] font-sans">
                <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50">
                  <span className="font-bold text-sky-400 dark:text-[var(--brand-gold-light)] block mb-1">📬 Correos de Costa Rica</span>
                  Envíos a todo el país fuera de la GAM. Despachados de lunes a viernes a las 4:00 PM con número de tracking oficial.
                </div>
                <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50">
                  <span className="font-bold text-emerald-400 dark:text-[var(--brand-gold-light)] block mb-1">🏍️ Mensajería Express GAM</span>
                  Servicios de mensajería motorizada tercerizada para entregas prioritarias (en menos de 24 horas) en San José, Heredia y Alajuela.
                </div>
                <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50">
                  <span className="font-bold text-amber-400 block mb-1">🏠 Retiro en Residencia</span>
                  Los clientes pueden retirar sus dispositivos reparados o repuestos en el domicilio del CEO de lunes a viernes con cita programada.
                </div>
              </div>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden p-5">
              <span className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] block mb-4">Lista de Entregas Activas</span>
              <div className="space-y-3">
                {deliveries.length === 0 ? (
                  <div className="text-center py-6 text-sm text-[var(--text-secondary)] italic">No hay pedidos pendientes de entrega física de mensajería en Costa Rica en este momento.</div>
                ) : (
                  deliveries.map(del => {
                      if (!del || !del.addressDetail) return null; 
if (!del) return null;
                    const addrLower = del.addressDetail.toLowerCase();
                    const isPickup = addrLower.includes('retiro') || addrLower.includes('residencia') || addrLower.includes('oficina') || addrLower.includes('casa');
                    const isGAM = del.province ? ['san jose', 'sanjose', 'heredia', 'alajuela', 'cartago'].includes(del.province.toLowerCase().trim()) : false;
                    
                    let channelLabel = "Correos de Costa Rica (Socio Nacional)";
                    let channelColor = "bg-[var(--brand-gold-mid)]/10 text-sky-400 dark:text-[var(--brand-gold-light)] border-sky-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/20";
                    
                    if (isPickup) {
                      channelLabel = "Retiro Programado en Residencia";
                      channelColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                    } else if (isGAM) {
                      channelLabel = "Mensajería Express GAM (Motorizado)";
                      channelColor = "bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 text-emerald-400 dark:text-[var(--brand-gold-light)] border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/20";
                    }

                    return (
                      <div key={del.id} className="bg-[var(--bg-surface)] p-4 border border-[var(--border-color)]/50 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm font-mono">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[var(--text-primary)]">{del.id} ({del.type})</span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-sans font-bold uppercase border ${channelColor}`}>
                              {channelLabel}
                            </span>
                          </div>
                          <div className="text-[var(--text-secondary)] font-sans">{del.recipientName} | Tel: {del.recipientPhone}</div>
                          <div className="text-[var(--text-secondary)] font-sans">{del.province}, {del.addressDetail}</div>
                        </div>
                        <div className="text-right space-y-1.5 self-end md:self-center">
                          <div className="flex justify-end gap-2 items-center">
                            <span className="text-[10px] text-[var(--text-secondary)]">Estado:</span>
                            <span className="bg-amber-50 border border-amber-200 text-amber-700 font-bold px-2 py-0.5 rounded text-[10px]">
                              {del.status}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              const db = getDB();
                              const idx = db.deliveries.findIndex(d => d && d.id === del.id);
                              if (idx !== -1) {
                                db.deliveries[idx].status = 'Entregado';
                                db.deliveries[idx].digitalSignature = 'Firma-Confirmada-Mensajero';
                                db.audit_log.unshift({
                                  id: `LOG-${Date.now()}`,
                                  userEmail: currentUser?.email || 'admin',
                                  module: 'Logística',
                                  action: 'Entregado',
                                  detail: `Pedido ${del.id} entregado y firmado digitalmente mediante canal: ${channelLabel}.`,
                                  timestamp: new Date().toISOString()
                                });
                                saveDB(db);
                                loadAllAdminData();
                                alert('Entrega marcada como completada y registrada en bitácora.');
                              }
                            }}
                            className="block bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] font-bold px-3 py-1.5 rounded-xl transition font-sans text-[10px] uppercase tracking-wider"
                          >
                            Confirmar Firma Digital / Entrega
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        )}
        {activeTab === 'bitacora' && (
          /* MODULE J: BITÁCORA (AUDITORÍA - DUEÑO SOLO) */
          <div className="space-y-6" id="view-bitacora">
            <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
              <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Bitácora Inmutable de Auditoría Operativa
              </h3>
              <button
                onClick={() => {
                  const db = getDB();
                  db.audit_log = [
                    {
                      id: `LOG-RESET`,
                      userEmail: currentUser?.email || 'admin',
                      module: 'Seguridad',
                      action: 'Reset Bitácora',
                      detail: 'Bitácora depurada por Dueño. Se conservó el registro inicial fiscal.',
                      timestamp: new Date().toISOString()
                    }
                  ];
                  saveDB(db);
                  loadAllAdminData();
                }}
                className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 text-sm font-bold px-3 py-1.5 rounded-xl transition"
              >
                Limpiar Bitácora
              </button>
            </div>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[500px]">
                <table className="w-full min-w-[600px] text-left text-sm border-collapse font-mono leading-relaxed">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                      <th className="p-3">ID / Fecha</th>
                      <th className="p-3">Usuario</th>
                      <th className="p-3 text-center">Módulo</th>
                      <th className="p-3 text-center">Acción</th>
                      <th className="p-3">Detalle Técnico</th>
                    </tr>
                  </thead>
                  <PaginatedTbody items={auditLog} itemsPerPage={10} renderItem={(log) => ( 
                      <tr key={log.id} className="hover:bg-[var(--bg-surface)] ">
                        <td className="p-3">
                          <div className="text-[10px] text-[var(--text-secondary)]">{log.id}</div>
                          <div className="text-[9px] text-[var(--text-secondary)]">{new Date(log.timestamp).toLocaleString()}</div>
                        </td>
                        <td className="p-3 font-medium text-[var(--text-primary)]">{log.userEmail}</td>
                        <td className="p-3 text-center">
                          <span className="bg-blue-50 text-blue-600 dark:text-[var(--brand-gold-light)] border border-blue-100 px-2 py-0.5 rounded text-[10px] uppercase font-bold dark:bg-[var(--brand-gold-mid)] dark:border-[var(--brand-gold-dark)]">
                            {log.module}
                          </span>
                        </td>
                        <td className="p-3 text-center text-[var(--text-primary)] font-bold text-[10px] uppercase">{log.action}</td>
                        <td className="p-3 text-[var(--text-primary)] max-w-sm whitespace-pre-wrap">{log.detail}</td>
                       </tr> )} />
                </table>
              </div>
            </div>
          </div>

        )}
        {activeTab === 'configuracion' && (
          /* MODULE K: CONFIGURACIÓN GENERAL */
          <div className="space-y-6" id="view-configuracion">
            <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Settings className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Configuración General de Technoverse
            </h3>

            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6 space-y-4">
              <h4 className="text-sm font-bold uppercase text-sky-400 dark:text-[var(--brand-gold-light)] pb-2 border-b border-[var(--border-color)]/50">Datos Fiscales de Facturación de Hacienda</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Cédula Jurídica / Física</label>
                  <input
                    type="text"
                    value={cedulaJuridica}
                    onChange={(e) => setCedulaJuridica(e.target.value)}
                    placeholder="Ej. 3-101-000000"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] dark:text-zinc-100 focus:outline-none font-mono placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Teléfono Fiscal Oficial</label>
                  <input
                    type="text"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="Ej. +506 0000 0000"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] dark:text-zinc-100 focus:outline-none font-mono placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Dirección del Domicilio del CEO (Domicilio Fiscal y Punto de Retiro)</label>
                  <input
                    type="text"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    placeholder="Provincia, cantón, distrito y señas exactas"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] dark:text-zinc-100 focus:outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Horarios de Retiro (Estricta Cita Previa)</label>
                  <input
                    type="text"
                    value={pickupHours}
                    onChange={(e) => setPickupHours(e.target.value)}
                    placeholder="Ej. Lunes a viernes, 1pm a 6pm"
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] dark:text-zinc-100 focus:outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>

              {/* COSTA RICAN E-COMMERCE COMPLIANCE NOTE */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3 mt-4">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400 flex items-center gap-1.5">
                  ⚠️ NOTA DE CUMPLIMIENTO LEGAL (COSTA RICA)
                </span>
                <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                  <strong>Facturación electrónica (Hacienda / DGT):</strong> Toda venta debe documentarse mediante comprobante electrónico autorizado (factura, tiquete o nota de crédito electrónica) conforme al Reglamento de Comprobantes Electrónicos para Efectos Tributarios (resolución DGT-R-48-2016 y sus reformas), con el Impuesto al Valor Agregado desglosado por línea según la Ley del IVA (Ley Nº 9635) y transmitido al Ministerio de Hacienda para su validación.
                </p>
                <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                  <strong>Protección al consumidor (MEIC / Ley Nº 7472):</strong> Los precios publicados deben mostrarse en colones costarricenses con impuestos incluidos, sin cargos ocultos. El plazo, costo y condiciones de entrega deben informarse antes de completar la compra. El consumidor tiene derecho a la reversión del cargo y a devoluciones cuando el bien no corresponda a lo ofrecido, conforme a la Ley de Promoción de la Competencia y Defensa Efectiva del Consumidor y su reglamento.
                </p>
                <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                  <strong>Protección de datos personales (PRODHAB / Ley Nº 8968):</strong> Los datos de clientes (identificación, contacto, medios de pago) se recaban con consentimiento informado, se usan únicamente para los fines de la relación comercial y están sujetos a los derechos de acceso, rectificación, cancelación y oposición (ARCO) que otorga la Ley de Protección de la Persona frente al Tratamiento de sus Datos Personales, supervisada por la PRODHAB.
                </p>
              </div>

              {/* SECCIÓN LOGO DE LA TIENDA */}
              <div className="border-t border-[var(--border-color)]/50 pt-4 mt-4 space-y-4">
                <h4 className="text-sm font-bold uppercase text-[var(--brand-gold-mid)] pb-2 border-b border-[var(--border-color)]/50">Logo de la tienda</h4>
                <div className="flex flex-col md:flex-row items-center gap-6">
                  {/* Preview area */}
                  <div className="w-24 h-24 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-color)]/80 flex items-center justify-center overflow-hidden flex-shrink-0">
                    <img
                      src={storeLogoPreview || storeLogo || "/logo.png"}
                      alt="Store Logo Preview"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)]">Seleccionar nueva imagen del logo</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="w-full text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-[var(--brand-gold-mid)] file:text-[var(--text-primary)] hover:file:bg-sky-600 dark:bg-[var(--brand-gold-dark)] file:cursor-pointer transition"
                    />
                    <p className="text-[10px] text-[var(--text-secondary)] leading-normal">
                      Seleccione una imagen de su computadora. Se guardará localmente y se aplicará inmediatamente en todo el sitio (tienda y panel de administración).
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] font-bold text-sm px-5 py-2.5 rounded-xl transition"
                >
                  Guardar Cambios Operativos
                </button>
              </div>
            </div>

            {/* CREACIÓN DE USUARIOS ADMINISTRADORES */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6 space-y-4" id="view-crear-usuario">
              <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/50">
                <h4 className="text-sm font-bold uppercase text-sky-400 dark:text-[var(--brand-gold-light)]">Gestión de Accesos Administrativos</h4>
                <button
                  type="button"
                  onClick={() => { setShowCreateUserForm(!showCreateUserForm); setGeneratedUserPass(null); }}
                  className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] font-bold text-xs px-4 py-2 rounded-xl transition"
                >
                  {showCreateUserForm ? 'Ocultar Formulario' : 'Crear Nuevo Usuario'}
                </button>
              </div>

              {showCreateUserForm && (
                <form onSubmit={handleCreateUserSubmit} className="space-y-4">
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    El usuario creado recibirá acceso total (Administrador) al panel. No existen roles limitados: cualquier cuenta autenticada aquí es Administrador.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Nombre Completo</label>
                      <input
                        type="text"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        required
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Correo Electrónico</label>
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        required
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Contraseña (opcional, se genera una segura si se deja vacío)</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        className="w-full bg-[var(--bg-base)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white dark:text-slate-950 font-bold text-sm px-5 py-2.5 rounded-xl transition disabled:opacity-50"
                  >
                    {isCreatingUser ? 'Creando...' : 'Registrar Usuario y Emitir Credenciales'}
                  </button>
                </form>
              )}

              {generatedUserPass && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                  <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold block mb-1">Contraseña del Nuevo Administrador</span>
                  <span className="font-mono text-sm text-[var(--text-primary)] font-bold">{generatedUserPass}</span>
                </div>
              )}
            </div>
          </div>

        )}
            </motion.div>
          </AnimatePresence>
      </main>
      </div>

      {/* Mobile overflow sheets for the bottom navigation bar (Inventario / Más) */}
      <AnimatePresence>
        {isMobileInventoryMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="floating-sheet-mobile glass-panel rounded-2xl p-2 lg:hidden"
          >
            <div className="px-4 py-2 border-b border-[var(--border-color)] mb-1">
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Control de Inventario</span>
            </div>
            <div className="p-1 space-y-1">
              {getPermittedSubItems('inventario').map(item => item && (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileInventoryMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
                    activeTab === item.id
                      ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-base)] font-bold'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-base)]'
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0 text-[var(--brand-gold-mid)]" />
                  <span className="text-sm font-semibold">{item.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isMobileMoreMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="floating-sheet-mobile glass-panel rounded-2xl p-2 lg:hidden"
          >
            <div className="px-4 py-2 border-b border-[var(--border-color)] mb-1">
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Servicios &amp; Finanzas</span>
            </div>
            <div className="p-1 space-y-1">
              {getPermittedSubItems('administracion').map(item => item && (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileMoreMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
                    activeTab === item.id
                      ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-base)] font-bold'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-base)]'
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0 text-[var(--brand-gold-mid)]" />
                  <span className="text-sm font-semibold">{item.label}</span>
                </button>
              ))}
              <div className="border-t border-[var(--border-color)] my-1 pt-1">
                <button
                  onClick={() => {
                    setIsMobileMoreMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-rose-500 hover:bg-rose-500/10 transition cursor-pointer font-bold"
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-semibold">Cerrar Sesión</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global bottom navigation bar (mobile only) — replaces the hamburger + drawer entirely */}
      <nav className="bottom-nav-bar lg:hidden flex items-stretch">
        {(isOwner || hasPermission('dashboard')) && (
          <button
            className={`bottom-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('dashboard');
              setActiveDropdown(null);
              setIsMobileInventoryMenuOpen(false);
              setIsMobileMoreMenuOpen(false);
            }}
          >
            <span className="bn-icon-wrap"><LayoutDashboard className="w-5 h-5" /></span>
            Dashboard
          </button>
        )}
        {getPermittedSubItems('inventario').length > 0 && (
          <button
            className={`bottom-nav-item ${isMobileInventoryMenuOpen || activeTab.startsWith('inventario_') ? 'active' : ''}`}
            onClick={() => {
              if (isMobileInventoryMenuOpen) { setIsMobileInventoryMenuOpen(false); return; }
              setIsMobileMoreMenuOpen(false);
              setActiveDropdown(null);
              setIsMobileInventoryMenuOpen(true);
            }}
          >
            <span className="bn-icon-wrap"><Package className="w-5 h-5" /></span>
            Inventario
          </button>
        )}
        {hasPermission('taller') && (
          <button
            className={`bottom-nav-item ${activeTab === 'taller' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('taller');
              setActiveDropdown(null);
              setIsMobileInventoryMenuOpen(false);
              setIsMobileMoreMenuOpen(false);
            }}
          >
            <span className="bn-icon-wrap"><Wrench className="w-5 h-5" /></span>
            Taller
          </button>
        )}
        {(isOwner || hasPermission('clientes')) && (
          <button
            className={`bottom-nav-item ${activeTab === 'clientes' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('clientes');
              setActiveDropdown(null);
              setIsMobileInventoryMenuOpen(false);
              setIsMobileMoreMenuOpen(false);
            }}
          >
            <span className="bn-icon-wrap"><CreditCard className="w-5 h-5" /></span>
            Clientes
          </button>
        )}
        {getPermittedSubItems('administracion').length > 0 && (
          <button
            className={`bottom-nav-item ${isMobileMoreMenuOpen ? 'active' : ''}`}
            onClick={() => {
              if (isMobileMoreMenuOpen) { setIsMobileMoreMenuOpen(false); return; }
              setIsMobileInventoryMenuOpen(false);
              setActiveDropdown(null);
              setIsMobileMoreMenuOpen(true);
            }}
          >
            <span className="bn-icon-wrap"><MoreHorizontal className="w-5 h-5" /></span>
            Más
          </button>
        )}
      </nav>
    </div>
  );
}
