import { motion, AnimatePresence } from "motion/react";
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { PaginatedTbody } from './PaginationHelper';
import { 
  LayoutDashboard, Package, Wrench, Users, CreditCard, FileSpreadsheet, 
  Settings, ShieldCheck, Heart, Megaphone, Truck, ShieldAlert, LogOut, Sun, Moon, 
  Menu, X, Plus, Trash2, Edit, Save, RefreshCw, Key, ArrowRightLeft, Eye, Download, DollarSign, BookOpen, ChevronDown, ChevronRight, ShoppingBag,
  Home, Sparkles, UserPlus, TrendingUp, BarChart3, Activity
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDB, saveDB, addAuditLog, ADMIN_PASSWORD, saveLogo } from '../utils/storage';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

import { User, Product, Employee, Payroll, Order, RepairOrder, ClientProfile, MembershipTier, LogisticsDelivery, MarketingCampaign, AuditLog, Banner } from '../types';
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
  const [showConfigSubmenu, setShowConfigSubmenu] = useState(false);
  
  // Navigation sidebar
  const [activeTab, setActiveTab] = useState<string>(() => {
    const path = window.location.pathname;
    if (path.startsWith('/admin/')) {
      const tab = path.replace('/admin/', '');
      return tab || 'dashboard';
    }
    return 'dashboard';
  });

  useEffect(() => {
    if (activeDropdown !== 'profile') {
      setShowConfigSubmenu(false);
    }
  }, [activeDropdown]);

  

  const [isInventoryExpanded, setIsInventoryExpanded] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [repairs, setRepairs] = useState<RepairOrder[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [memberships, setMemberships] = useState<MembershipTier[]>([]);
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
  const [prodMemberships, setProdMemberships] = useState<('Plata' | 'Oro' | 'Platino')[]>(['Plata', 'Oro', 'Platino']);

  // Employee CRUD state
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPassword, setEmpPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [empRole, setEmpRole] = useState<Employee['role']>('Técnico');
  const [empSalary, setEmpSalary] = useState<number>(450000);
  const [empContract, setEmpContract] = useState<Employee['contractType']>('Indefinido');
  const [empRemoteBonus, setEmpRemoteBonus] = useState<number>(50000);
  const [generatedEmpPass, setGeneratedEmpPass] = useState<string | null>(null);
  const [payrollMonth, setPayrollMonth] = useState('2026-07');
  const [payrollEmployeeId, setPayrollEmployeeId] = useState('all');
  const [selectedPaySlip, setSelectedPaySlip] = useState<Payroll | null>(null);
  useEffect(() => {
    if (selectedPaySlip) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => { document.body.style.overflow = "auto"; };
  }, [selectedPaySlip]);

  // General parameters state
  const [cedulaJuridica, setCedulaJuridica] = useState('3-101-987452');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [pickupHours, setPickupHours] = useState('Lunes a Viernes: 8:00 AM - 5:00 PM (Retiros con cita previa)');
  const [storeLogo, setStoreLogo] = useState('');
  const [storeLogoPreview, setStoreLogoPreview] = useState<string | null>(null);

  // Client form state
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientForm, setClientForm] = useState<Partial<ClientProfile>>({
    name: '', email: '', phone: '', province: 'San José', addressDetail: '', membershipTier: 'Normal', notes: ''
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
      setClientForm({ name: '', email: '', phone: '', province: 'San José', addressDetail: '', membershipTier: 'Normal', notes: '' });
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
        addAuditLog(currentUser?.email || 'admin', 'CRM', 'Editar Cliente', `Cliente actualizado: ${clientForm.name} (Membresía: ${clientForm.membershipTier})`, db);
      }
    } else {
      const newClient: ClientProfile = {
        ...(clientForm as ClientProfile),
        id: `CLI-${Math.floor(10000 + Math.random() * 90000)}`,
        cardsTokenized: [],
        balance: 0
      };
      db.clients.push(newClient);
      addAuditLog(currentUser?.email || 'admin', 'CRM', 'Crear Cliente', `Nuevo cliente registrado: ${clientForm.name} (Membresía: ${clientForm.membershipTier})`, db);
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
    setEmployees(db.employees || []);
    setPayrolls(db.payroll || []);
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
    setMemberships(db.membership_tiers || []);
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

    if (profile.role === 'Dueño') {
      const adminUser: User = { id: 'admin-id', email: cleanEmail, role: 'Dueño', name: profile.name || 'Administrador Technoverse' };
      onLogin(adminUser);
      setLoginEmail(''); setLoginPassword('');
      alert('Sesión iniciada con éxito como Administrador.');
      return;
    }

    // Empleado: buscamos su registro operativo (salario, rol interno, activo/inactivo).
    const db = getDB();
    const emp = db.employees.find(e => e && e.email.toLowerCase() === cleanEmail);
    if (!emp || !emp.active) {
      await supabase.auth.signOut();
      alert('Su cuenta de empleado no está activa. Contacte al administrador.');
      return;
    }

    const empUser: User = {
      id: emp.id,
      email: emp.email,
      role: 'Empleado',
      employeeRole: emp.role,
      name: emp.name
    };
    onLogin(empUser);

    // Auto routing according to employee permissions
    if (emp.role === 'Técnico') setActiveTab('taller');
    else if (emp.role === 'Soporte') setActiveTab('chat');
    else if (emp.role === 'Bodega') setActiveTab('inventario_productos');
    else if (emp.role === 'Contabilidad') setActiveTab('facturacion');
    else if (emp.role === 'Oficial de Cumplimiento') setActiveTab('cumplimiento');
    else setActiveTab('dashboard');

    addAuditLog(emp.email, 'Seguridad', 'Login Exitoso', `Sesión iniciada por empleado con rol: ${emp.role}`);
    setLoginEmail(''); setLoginPassword('');
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
    const db = getDB();
    if (!db.settings) db.settings = {} as any;
    db.settings.cedulaJuridica = cedulaJuridica;
    db.settings.companyPhone = companyPhone;
    db.settings.companyAddress = companyAddress;
    db.settings.pickupHours = pickupHours;

    try {
      // El logo se guarda con saveLogo(), que persiste la imagen comprimida
      // directamente en Supabase (app_settings.store_logo).
      if (storeLogoPreview) {
        await saveLogo(storeLogoPreview);
      }
      addAuditLog(currentUser?.email || 'admin', 'Configuración', 'Actualizar Ajustes', 'Ajustes fiscales, operativos y logo actualizados', db);
      await saveDB(db);
    } catch (err: any) {
      alert('No se pudo guardar la configuración/logo en la base de datos. Detalle: ' + (err?.message || err));
      return;
    }
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
  const hasPermission = (tab: string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'Dueño') return true; // Owner has root access
    
    const role = currentUser.employeeRole;
    if (!role) return false;

    switch (tab) {
      case 'dashboard':
        return ['Dueño', 'Contabilidad', 'Oficial de Cumplimiento'].includes(role);
      case 'productos':
      case 'inventario_productos':
      case 'inventario_movimientos':
      case 'inventario_reportes':
      case 'inventario_repuestos':
        return ['Bodega'].includes(role); // Owner sees these via separate menu if needed, but following prompt's strict role separation
      case 'taller':
        return ['Técnico'].includes(role);
      case 'empleados':
        return false; // Dueño only (handled by isOwner check)
      case 'clientes':
        return ['Dueño', 'Soporte', 'Contabilidad'].includes(role);
      case 'facturacion':
        return ['Dueño', 'Contabilidad'].includes(role);
      case 'cumplimiento':
        return ['Dueño', 'Oficial de Cumplimiento', 'Contabilidad'].includes(role);
      case 'memberships':
        return ['Dueño', 'Contabilidad', 'Marketing'].includes(role);
      case 'marketing':
        return ['Marketing'].includes(role);
      case 'logistica':
        return ['Repartidor', 'Bodega'].includes(role);
      case 'bitacora':
        return false; // Dueño only (handled by isOwner check)
      case 'configuracion':
        return ['Dueño', 'Contabilidad'].includes(role);
      default:
        return false;
    }
  };

  // Enforce RBAC on tab change
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      if (!hasPermission(activeTab)) {
        alert("Acceso denegado. No tienes permisos para ver esta sección.");
        if (currentUser.role === 'Dueño') {
          setActiveTab('dashboard');
        } else {
          const role = currentUser.employeeRole;
          if (role === 'Técnico') setActiveTab('taller');
          else if (role === 'Soporte') setActiveTab('clientes');
          else if (role === 'Bodega') setActiveTab('inventario_productos');
          else if (role === 'Contabilidad') setActiveTab('facturacion');
          else if (role === 'Oficial de Cumplimiento') setActiveTab('cumplimiento');
          else if (role === 'Marketing') setActiveTab('marketing');
          else if (role === 'Repartidor') setActiveTab('logistica');
          else setActiveTab('dashboard');
        }
      }
    }
  }, [activeTab, isAuthenticated, currentUser]);

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
          applicableMemberships: prodMemberships,
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
        applicableMemberships: prodMemberships,
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
    setProdMemberships(p.applicableMemberships);
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

  // Employee creation / editing
  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empEmail.trim() || empSalary < 350000 || empRemoteBonus < 0) return;
    const db = getDB();
    let finalPass = empPassword.trim() || `Emp-${Math.floor(100000 + Math.random() * 900000).toString()}`;

    if (editingEmployeeId) {
      // Editing Mode
      const empIndex = db.employees.findIndex(em => em && em.id === editingEmployeeId);
      if (empIndex === -1) {
        alert('Empleado no encontrado.');
        return;
      }
      
      const emailExists = db.employees.some(em => em && em.id !== editingEmployeeId && em.email.toLowerCase() === empEmail.trim().toLowerCase());
      if (emailExists) {
        alert('Ya existe otro empleado registrado con ese correo electrónico.');
        return;
      }

      const oldEmp = db.employees[empIndex];
      db.employees[empIndex] = {
        ...oldEmp,
        name: empName.trim(),
        email: empEmail.trim().toLowerCase(),
        role: empRole,
        baseSalary: empSalary,
        contractType: empContract,
        password: finalPass,
        remoteBonus: empRemoteBonus
      };

      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Recursos Humanos', 'Editar Empleado', `Empleado modificado: ${empName} (Rol: ${empRole})`, db);
      try {
        await saveDB(db);
      } catch (err: any) {
        alert('No se pudo guardar el empleado en la base de datos. Detalle: ' + (err?.message || err));
        return;
      }
      alert('Empleado actualizado con éxito.');

      setEditingEmployeeId(null);
    } else {
      // Creation Mode: la cuenta de Supabase Auth y las filas en profiles/employees
      // se crean del lado del servidor (Edge Function con service_role key), para
      // no exponer esa llave en el navegador ni cerrar la sesión del admin actual.
      const exists = db.employees.some(em => em && em.email.toLowerCase() === empEmail.trim().toLowerCase());
      if (exists) {
        alert('Ya existe un empleado registrado con ese correo electrónico.');
        return;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke('create-employee', {
        body: {
          email: empEmail.trim().toLowerCase(),
          password: finalPass,
          name: empName.trim(),
          role: empRole,
          baseSalary: empSalary,
          contractType: empContract,
          remoteBonus: empRemoteBonus
        }
      });

      if (fnError || !fnData?.success) {
        alert('No se pudo crear el empleado. Detalle: ' + (fnData?.error || fnError?.message || 'error desconocido'));
        return;
      }

      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Recursos Humanos', 'Crear Empleado', `Empleado registrado: ${empName} (Rol: ${empRole}, Subsidio Remoto: ₡${empRemoteBonus.toLocaleString()})`);
      setGeneratedEmpPass(finalPass);
    }

    // Reset Form Fields
    setEmpName('');
    setEmpEmail('');
    setEmpPassword('');
    setEmpRemoteBonus(50000);
    loadAllAdminData();
  };

  const handleEditEmployeeClick = (emp: Employee) => {
    setEditingEmployeeId(emp.id);
    setEmpName(emp.name);
    setEmpEmail(emp.email);
    setEmpRole(emp.role);
    setEmpSalary(emp.baseSalary);
    setEmpContract(emp.contractType);
    setEmpRemoteBonus(emp.remoteBonus ?? 0);
    setEmpPassword(emp.password || '');
    setShowEmployeeForm(true);
  };

  const handleCancelEmployeeEdit = () => {
    setEditingEmployeeId(null);
    setEmpName('');
    setEmpEmail('');
    setEmpPassword('');
    setEmpRemoteBonus(50000);
    setShowEmployeeForm(false);
  };

  // Toggle employee state
  
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
            <div>Cédula Jurídica: ${db.settings?.cedulaJuridica || '3-101-555444'}</div>
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
const handleToggleEmployeeState = (empId: string, name: string, currentState: boolean) => {
    const db = getDB();
    const idx = db.employees.findIndex(e => e && e.id === empId);
    if (idx !== -1) {
      db.employees[idx].active = !currentState;
      addAuditLog(currentUser?.email || 'admin', 'Recursos Humanos', 'Editar Empleado', `Estado de empleado ${name} cambiado a ${!currentState ? 'Activo' : 'Inactivo'}`, db);
      saveDB(db);
      loadAllAdminData();
    }
  };

  // Generate monthly payroll report
  const handleGeneratePayroll = () => {
    if (employees.length === 0) {
      alert('Primero registre empleados para poder generar una planilla mensual.');
      return;
    }

    const db = getDB();
    const currentMonth = payrollMonth;
    let empsToProcess = db.employees.filter(e => e && e.active);
    if (payrollEmployeeId !== 'all') {
      empsToProcess = empsToProcess.filter(e => e && e.id === payrollEmployeeId);
    }

    let generatedCount = 0;

    empsToProcess.forEach(emp => {
    if (!emp) return;
      const exists = db.payroll.some(p => p && p.employeeId === emp.id && p.month === currentMonth);
      if (exists) return;

      const salary = emp.baseSalary;
      const remoteSub = emp.remoteBonus || 0;
      const ccssEmp = Math.round(salary * 0.0967);
      const ccssPat = Math.round(salary * 0.2633);
      const ins = Math.round(salary * 0.015);
      const lptEmp = Math.round(salary * 0.01);
      const lptPat = Math.round(salary * 0.015);
      const fcl = Math.round(salary * 0.03);
      
      let renta = 0;
      if (salary > 941000) {
        renta = Math.round((salary - 941000) * 0.10);
      }

      const neto = salary - ccssEmp - lptEmp - renta + remoteSub;
      const totalLaboral = salary + ccssPat + ins + lptPat + fcl + remoteSub;

      db.payroll.push({
        id: `PAY-${Math.floor(10000 + Math.random() * 90000)}`,
        employeeId: emp.id,
        employeeName: emp.name,
        month: currentMonth,
        baseSalary: salary,
        ccssTrabajador: ccssEmp,
        ccssPatrono: ccssPat,
        insSeguro: ins,
        lptTrabajador: lptEmp,
        lptPatrono: lptPat,
        fclPatrono: fcl,
        retencionRenta: renta,
        bonos: remoteSub,
        horasExtra: 0,
        salarioNeto: neto,
        costoLaboralTotal: totalLaboral,
        status: 'Pagado'
      });
      generatedCount++;
    });

    if (generatedCount === 0) {
      alert(`Ya se generó la planilla para ${payrollEmployeeId === 'all' ? 'todos los empleados' : 'este empleado'} en el mes ${currentMonth}.`);
      return;
    }

    db.audit_log.unshift({
      id: `LOG-${Date.now()}`,
      userEmail: currentUser?.email || 'admin',
      module: 'Contabilidad',
      action: 'Generar Planilla',
      detail: `Planilla para ${generatedCount} empleado(s) en ${currentMonth} generada exitosamente.`,
      timestamp: new Date().toISOString()
    });
    
    saveDB(db);
    loadAllAdminData();
    alert(`Se generó exitosamente la planilla para ${generatedCount} empleado(s).`);
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

  // Membership modifications
  const handleUpdateMembership = (id: 'Plata' | 'Oro' | 'Platino', field: keyof MembershipTier, value: any) => {
    const db = getDB();
    const idx = db.membership_tiers.findIndex(m => m && m.id === id);
    if (idx !== -1) {
      db.membership_tiers[idx] = { ...db.membership_tiers[idx], [field]: value };
      saveDB(db);
      loadAllAdminData();
    }
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
        { id: 'empleados', label: 'Personal y Nómina', icon: Users },
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
        { id: 'empleados', label: 'Personal y Nómina', icon: Users },
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
    <div className="h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col overflow-hidden w-full" id="admin-panel-root">
      {/* UNIFIED NAVIGATION HEADER WITH BREADCRUMB GLASS DROP-DOWNS */}
      <header className="bg-[var(--bg-surface)] h-12 sm:h-14 border-b border-[var(--border-color)]/80 sticky top-0 z-50 flex items-center justify-between px-3 md:px-4">
        {/* Mobile menu toggle */}
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
          className="lg:hidden mr-2 p-2 rounded-xl text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800 transition flex-shrink-0"
          title="Menú"
        >
          <Menu className="w-5 h-5" />
        </button>
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
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--brand-gold-mid)]/10 text-sky-400 dark:text-[var(--brand-gold-light)] hover:bg-[var(--brand-gold-mid)]/20 transition text-[10px] font-bold uppercase tracking-wider border border-sky-500 dark:border-[var(--brand-gold-mid)]/20"
            title="Volver a la tienda"
          >
            <Home className="w-3 h-3" />
            Ver tienda
          </button>
          <div className="relative" onMouseEnter={handleDropdownEnter}>
            <button 
              onClick={() => {
                setActiveDropdown(activeDropdown === 'profile' ? null : 'profile');
              }}
              className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border border-[var(--border-color)] transition cursor-pointer text-[var(--text-primary)] "
            >
              <div className="w-6 h-6 rounded-full bg-[var(--bg-base)] text-[var(--text-primary)] flex items-center justify-center font-bold text-[10px] uppercase border border-[var(--border-color)]">
                {currentUser?.name.substring(0, 2)}
              </div>
              <span className="text-sm font-bold text-[var(--text-primary)] hidden sm:inline">
                {currentUser?.name.split(' ')[0]}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            </button>
            {activeDropdown === 'profile' && (
              <div className="absolute top-full mt-2 min-w-[260px] bg-[var(--bg-surface)] dynamic-dropdown border border-[var(--border-color)] rounded-2xl shadow-sm p-4 z-50 transition-all duration-200 ease-out text-[var(--text-primary)] animate-in fade-in slide-in-from-top-2">
                <div className="px-4 py-3 border-b border-[var(--border-color)] mb-2">
                  <div className="text-sm font-bold text-[var(--text-primary)] truncate">{currentUser?.name}</div>
                  <div className="text-[9px] text-[var(--brand-gold-mid)] font-extrabold uppercase tracking-wider">
                    {currentUser?.role === 'Dueño' ? 'Dueño Principal' : `Empleado: ${currentUser?.employeeRole}`}
                  </div>
                </div>

                <div className="border-t border-[var(--border-color)] my-1 pt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowConfigSubmenu(!showConfigSubmenu);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800 rounded-xl text-left font-medium transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-[var(--brand-gold-mid)]" />
                      <span>Configuraciones</span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform duration-200 ${showConfigSubmenu ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showConfigSubmenu && (
                    <div className="mt-1 space-y-1 pl-2 pr-2 border-l-2 border-[var(--brand-gold-mid)]/30 ml-4 max-h-[45vh] overflow-y-auto">
                      {/* Inventario Subitems */}
                      {getPermittedSubItems('inventario').length > 0 && (
                        <>
                          <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] px-3 py-1 tracking-wider border-b border-[var(--border-color)] mb-1 mt-2 first:mt-0">
                            Control Inventario
                          </div>
                          {getPermittedSubItems('inventario').map(sub => sub && (
                            <button
                              key={sub.id}
                              onClick={() => {
                                setActiveTab(sub.id);
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl text-left transition cursor-pointer ${
                                activeTab === sub.id
                                  ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] font-bold'
                                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                              }`}
                            >
                              <sub.icon className="w-3.5 h-3.5 text-[var(--brand-gold-mid)] flex-shrink-0" />
                              <span>{sub.label}</span>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Taller & CRM Subitems */}
                      {(hasPermission('taller') || isOwner || hasPermission('clientes')) && (
                        <>
                          <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] px-3 py-1 tracking-wider border-b border-[var(--border-color)] mb-1 mt-2">
                            Operaciones
                          </div>
                          {hasPermission('taller') && (
                            <button
                              onClick={() => {
                                setActiveTab('taller');
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl text-left transition cursor-pointer ${
                                activeTab === 'taller'
                                  ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] font-bold'
                                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                              }`}
                            >
                              <Wrench className="w-3.5 h-3.5 text-[var(--brand-gold-mid)] flex-shrink-0" />
                              <span>Taller</span>
                            </button>
                          )}
                          {(isOwner || hasPermission('clientes')) && (
                            <button
                              onClick={() => {
                                setActiveTab('clientes');
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl text-left transition cursor-pointer ${
                                activeTab === 'clientes'
                                  ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] font-bold'
                                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                              }`}
                            >
                              <CreditCard className="w-3.5 h-3.5 text-[var(--brand-gold-mid)] flex-shrink-0" />
                              <span>Clientes CRM</span>
                            </button>
                          )}
                        </>
                      )}

                      {/* Administración Subitems */}
                      {getPermittedSubItems('administracion').length > 0 && (
                        <>
                          <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] px-3 py-1 tracking-wider border-b border-[var(--border-color)] mb-1 mt-2">
                            Servicios & Finanzas
                          </div>
                          {getPermittedSubItems('administracion').map(sub => sub && (
                            <button
                              key={sub.id}
                              onClick={() => {
                                setActiveTab(sub.id);
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-xl text-left transition cursor-pointer ${
                                activeTab === sub.id
                                  ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] font-bold'
                                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                              }`}
                            >
                              <sub.icon className="w-3.5 h-3.5 text-[var(--brand-gold-mid)] flex-shrink-0" />
                              <span>{sub.label}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-[var(--border-color)] my-1 pt-1">
                  <button
                    onClick={() => {
                      handleLogout();
                      setActiveDropdown(null);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl text-left font-bold transition cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Cerrar Sesión</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* WORKSPACE CONTENT AREA */}
      <div className="flex-1 flex flex-row overflow-hidden w-full relative">
        {/* Sidebar on Desktop / Drawer on Mobile */}
        <aside className={`hidden lg:flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-color)]/85 transition-all duration-300 overflow-hidden flex-shrink-0 ${isSidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="flex-1 overflow-y-auto py-4 space-y-4 px-3 select-none">
            {/* Sidebar toggle button inside the sidebar top */}
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-2'} mb-2`}>
              {!isSidebarCollapsed && <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Navegación</span>}
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
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
                    <div className="text-[9px] uppercase font-bold text-slate-500 px-3 py-1.5 tracking-widest border-b border-[var(--border-color)]/30 mb-1">
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
                        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[var(--brand-gold-mid)]' : 'text-slate-400'}`} />
                        {!isSidebarCollapsed && <span className="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Mobile Menu Drawer Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              {/* Back-drop overlay */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 bg-black z-40 lg:hidden"
              />

              {/* Drawer content */}
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                className="fixed inset-y-0 left-0 w-72 bg-[var(--bg-surface)] border-r border-[var(--border-color)] z-50 flex flex-col p-4 space-y-4 lg:hidden"
              >
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2">
                    <img src={storeLogoPreview || storeLogo || "/logo.png"} alt="Technoverse Logo" className="h-8 w-8 rounded-lg object-contain bg-[var(--bg-surface)] p-0.5" />
                    <span className="font-display font-bold text-base text-[var(--brand-gold-mid)]">Technoverse</span>
                  </div>
                  <button 
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1 select-none">
                  {sidebarSections.map((sec, secIdx) => {
                    const permittedItems = sec.items.filter(item => isOwner || hasPermission(item.id));
                    if (permittedItems.length === 0) return null;

                    return (
                      <div key={secIdx} className="space-y-1">
                        <div className="text-[9px] uppercase font-bold text-slate-500 px-3 py-1 tracking-widest border-b border-[var(--border-color)]/30 mb-1">
                          {sec.title}
                        </div>
                        {permittedItems.map(item => {
                          const Icon = item.icon;
                          const isActive = activeTab === item.id;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                setActiveTab(item.id);
                                setIsMobileMenuOpen(false);
                                setActiveDropdown(null);
                              }}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
                                isActive 
                                  ? 'text-[var(--brand-gold-mid)] bg-[var(--bg-surface)] border border-[var(--brand-gold-mid)]/20 font-bold' 
                                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface)] hover:bg-slate-800'
                              }`}
                            >
                              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[var(--brand-gold-mid)]' : 'text-slate-400'}`} />
                              <span className="text-xs font-semibold">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* WORKSPACE CONTENT AREA */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 w-full bg-[var(--bg-base)]">
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
                      <div className="flex-1 w-full bg-[var(--bg-surface)]/50 rounded-xl animate-pulse" style={{ height: '280px' }} />
                    </div>
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 h-[380px] space-y-4">
                      <div className="h-4 bg-[var(--border-color)] rounded w-48 animate-pulse" />
                      <div className="flex-1 w-full bg-[var(--bg-surface)]/50 rounded-xl animate-pulse" style={{ height: '280px' }} />
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 h-[260px] space-y-4">
                    <div className="h-4 bg-[var(--border-color)] rounded w-64 animate-pulse" />
                    <div className="flex-1 w-full bg-[var(--bg-surface)]/50 rounded-xl animate-pulse" style={{ height: '180px' }} />
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
                      <div className="p-2 bg-blue-600 dark:bg-[var(--brand-gold-mid)] rounded-xl shadow-lg shadow-blue-100">
                        <LayoutDashboard className="w-5 h-5 text-white" />
                      </div>
                      Centro de Operaciones Technoverse
                    </h3>
                    <div className="hidden sm:flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-[var(--bg-surface)] px-3 py-1.5 rounded-full border border-[var(--border-color)]">
                      <Activity className="w-3 h-3 text-emerald-500 animate-pulse dark:text-[var(--brand-gold-light)]" /> Sistema en Línea • San José, CR
                    </div>
                  </div>

                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Ingresos Brutos</span>
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-[var(--text-secondary)] font-mono">₡{totalSalesRevenue.toLocaleString()}</div>
                      <div className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full inline-block dark:text-[var(--brand-gold-light)] dark:bg-[var(--brand-gold-mid)]">Cierre de Caja OK</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Clientes Activos</span>
                        <Users className="w-3.5 h-3.5 text-blue-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-[var(--text-secondary)] font-mono">{clientsCount}</div>
                      <div className="text-[10px] font-bold text-slate-500 italic">Base de Datos CRM</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">En Taller</span>
                        <Wrench className="w-3.5 h-3.5 text-sky-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="text-xl font-black text-sky-600 dark:text-[var(--brand-gold-light)] font-mono">{activeRepairsCount}</div>
                      <div className="text-[10px] font-bold text-slate-500">Reparaciones en Curso</div>
                    </div>

                    <div className={`bg-[var(--bg-surface)] border rounded-2xl p-5 space-y-3 shadow-sm transition-all duration-300 ${
                      repairsAwaitingParts > 0 ? 'border-rose-500 bg-rose-50 shadow-rose-100' : 'border-[var(--border-color)] hover:shadow-md'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Backlog Repuestos</span>
                        <ShieldAlert className={`w-3.5 h-3.5 ${repairsAwaitingParts > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
                      </div>
                      <div className={`text-xl font-black font-mono ${repairsAwaitingParts > 0 ? 'text-rose-600' : 'text-[var(--text-secondary)]'}`}>
                        {repairsAwaitingParts}
                      </div>
                      <div className={`text-[10px] font-black uppercase ${repairsAwaitingParts > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-500'}`}>
                        {repairsAwaitingParts > 0 ? '⚠️ Acción Requerida' : 'Flujo Optimizado'}
                      </div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Capacidad Bodega</span>
                        <Package className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <div className="text-xl font-black text-emerald-600 font-mono dark:text-[var(--brand-gold-light)]">{estimatedFreeSpace}%</div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Espacio Disponible</div>
                    </div>

                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Stock Crítico</span>
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      <div className="text-xl font-black text-amber-600 font-mono">{lowStockProductsCount}</div>
                      <div className="text-[10px] font-bold text-slate-500 italic">Items por reponer</div>
                    </div>
                  </div>

                  {/* CHARTS */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl p-6 shadow-sm flex flex-col h-[380px]">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Rendimiento de Ventas Diarias</span>
                        <BarChart3 className="w-4 h-4 text-blue-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="flex-1 w-full min-h-[260px]">
                        {orders.filter(o => o && o.status === 'Completado').length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
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
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Distribución de Inventario</span>
                        <Package className="w-4 h-4 text-emerald-500 dark:text-[var(--brand-gold-light)]" />
                      </div>
                      <div className="flex-1 w-full min-h-[260px]">
                        {inventoryDistData.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
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
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Actividad Reciente de Transacciones</span>
                      <CreditCard className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex-1 h-full bg-[var(--bg-surface)]/50 rounded-2xl border border-[var(--border-color)] p-6 flex items-end justify-between gap-3 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-emerald-500 to-blue-500 dark:from-[var(--brand-gold-mid)] dark:via-[var(--brand-gold-light)] dark:to-[var(--brand-gold-dark)] opacity-20" />
                      {orders.length === 0 ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-slate-400 font-bold uppercase tracking-widest gap-2">
                          <ShoppingBag className="w-8 h-8 opacity-20" />
                          Esperando Primera Venta
                        </div>
                      ) : (
                        orders.slice(-15).map((ord, idx) => (
                          <motion.div 
                            key={ord.id} 
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.min(100, Math.max(15, (ord.total / (totalSalesRevenue || 500000)) * 100))}%` }}
                            className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-pointer"
                          >
                            <div className="relative w-full h-full flex flex-col justify-end">
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-10">
                                <div className="bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow-xl whitespace-nowrap">
                                  ₡{ord.total.toLocaleString()}
                                </div>
                                <div className="w-2 h-2 bg-slate-800 rotate-45 mx-auto -mt-1" />
                              </div>
                              <div 
                                className="w-full bg-blue-500/80 rounded-t-lg group-hover:bg-blue-600 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)] transition-all shadow-sm"
                                style={{ height: '100%' }}
                              />
                            </div>
                            <span className="text-[9px] font-black text-slate-400 font-mono hidden sm:block">#{ord.id.split('-').pop()}</span>
                          </motion.div>
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
        {activeTab === 'empleados' && (
          /* MODULE D: EMPLEADOS Y NÓMINAS */
          <div className="space-y-6" id="view-empleados">
            <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
              <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Planilla Mensual y Cargas Sociales CCSS (Recursos Humanos)
              </h3>
              <button
                onClick={() => setShowEmployeeForm(!showEmployeeForm)}
                className="bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] font-bold text-sm px-4 py-2 rounded-xl transition"
              >
                {showEmployeeForm ? 'Ocultar Formulario' : 'Registrar Nuevo Colaborador'}
              </button>
            </div>

            {/* EMPLOYEE CREATION/EDITING FORM */}
            {showEmployeeForm && (
              <form onSubmit={handleEmployeeSubmit} className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6 space-y-4">
                <h4 className="text-sm font-bold uppercase text-sky-400 dark:text-[var(--brand-gold-light)] pb-2 border-b border-[var(--border-color)]/50">
                  {editingEmployeeId ? 'Ficha de Modificación de Colaborador' : 'Ficha de Empleo Oficial de Costa Rica'}
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Nombre Completo del Colaborador</label>
                    <input
                      type="text"
                      required
                      value={empName}
                      onChange={(e) => setEmpName(e.target.value)}
                      placeholder="Ej. Manuel Solano Rojas"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Correo Institucional</label>
                    <input
                      type="email"
                      required
                      value={empEmail}
                      onChange={(e) => setEmpEmail(e.target.value)}
                      placeholder="manuel@technoverse.com"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Rol Operativo (RBAC en Casa)</label>
                    <select
                      value={empRole}
                      onChange={(e: any) => setEmpRole(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none"
                    >
                      <option value="Soporte">Soporte (Chat Remoto)</option>
                      <option value="Técnico">Técnico Especialista (Remoto / Taller)</option>
                      <option value="Bodega">Auxiliar Doméstico (Stock en casa)</option>
                      <option value="Contabilidad">Contabilidad (Por horas)</option>
                      <option value="Marketing">Marketing (Gestión Digital)</option>
                      <option value="Repartidor">Mensajero / Gestor legal (Por horas)</option>
                      <option value="Oficial de Cumplimiento">Gestor de Cumplimiento Legal</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Salario Base (CRC)</label>
                    <input
                      type="number"
                      min="350000"
                      required
                      value={empSalary}
                      onChange={(e) => setEmpSalary(Math.max(1, parseInt(e.target.value) || 0))}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Subsidio Luz/Internet (Remoto)</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={empRemoteBonus}
                      onChange={(e) => setEmpRemoteBonus(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Tipo de Contrato</label>
                    <select
                      value={empContract}
                      onChange={(e: any) => setEmpContract(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none"
                    >
                      <option value="Indefinido">Tiempo Indefinido</option>
                      <option value="Temporal">Tiempo Temporal</option>
                      <option value="Servicios Profesionales">Servicios Profesionales</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Contraseña de Acceso</label>
                    <div className="flex gap-1.5">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={empPassword}
                        onChange={(e) => setEmpPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const passHex = Math.floor(100000 + Math.random() * 900000).toString();
                          setEmpPassword(`Emp-${passHex}`);
                        }}
                        className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-[10px] px-2.5 py-1.5 rounded-xl transition cursor-pointer shrink-0 dark:text-slate-950"
                      >
                        Generar
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="bg-slate-200 hover:bg-slate-300 text-[var(--text-secondary)] font-bold text-[10px] px-2.5 py-1.5 rounded-xl transition cursor-pointer shrink-0"
                      >
                        {showPassword ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="flex-1 bg-[var(--brand-gold-mid)] hover:bg-[#C5A028] text-[var(--text-primary)] font-bold text-sm py-3 rounded-xl uppercase tracking-wider transition cursor-pointer"
                  >
                    {editingEmployeeId ? 'Guardar Cambios del Colaborador' : 'Registrar Colaborador y Emitir Credenciales'}
                  </button>
                  {editingEmployeeId && (
                    <button
                      type="button"
                      onClick={handleCancelEmployeeEdit}
                      className="bg-slate-200 hover:bg-slate-300 text-[var(--text-secondary)] font-bold text-sm py-3 px-6 rounded-xl uppercase tracking-wider transition cursor-pointer"
                    >
                      Cancelar Edición
                    </button>
                  )}
                </div>

                {generatedEmpPass && !editingEmployeeId && (
                  <div className="bg-[var(--bg-surface)] p-4 border border-dashed border-emerald-500 dark:border-[var(--brand-gold-mid)]/50 rounded-xl space-y-2 text-center">
                    <h5 className="text-emerald-400 dark:text-[var(--brand-gold-light)] text-sm font-bold">¡Credenciales de Seguridad Autogeneradas!</h5>
                    <p className="text-[10px] text-[var(--text-secondary)]">Por motivos de seguridad informática, copie estos datos de inmediato ya que no volverán a mostrarse:</p>
                    <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-12 mt-2">
                      <div>
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold block mb-1">Contraseña de Empleado</span>
                        <span className="font-mono text-base font-bold text-[var(--text-primary)] tracking-widest">{generatedEmpPass}</span>
                      </div>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* Employees Table */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden p-5 space-y-4">
              <span className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] block">Personal Contratado</span>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)]/80 bg-[var(--bg-surface)] text-[var(--text-secondary)] font-mono">
                      <th className="p-3">Colaborador</th>
                      <th className="p-3">Rol en Domicilio / Horas</th>
                      <th className="p-3 text-right">Salario Base</th>
                      <th className="p-3 text-right">Subsidio Remoto</th>
                      <th className="p-3 text-center">Tipo Contrato</th>
                      <th className="p-3 text-center">Fecha Ingreso</th>
                      <th className="p-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <PaginatedTbody items={employees} itemsPerPage={10} renderItem={(emp) => ( 
                        <tr key={emp.id} className="hover:bg-[var(--bg-surface)] transition">
                          <td className="p-3 font-bold text-[var(--text-primary)]">{emp.name}</td>
                          <td className="p-3">
                            <span className="bg-[var(--brand-gold-mid)]/10 text-sky-600 dark:text-[var(--brand-gold-light)] border border-sky-500 dark:border-[var(--brand-gold-mid)]/20 px-2 py-0.5 rounded font-bold uppercase text-[9px]">
                              {emp.role === 'Bodega' ? 'Auxiliar Domicilio' : emp.role === 'Repartidor' ? 'Mensajero Legal' : emp.role}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono">₡{emp.baseSalary.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono text-emerald-600 font-semibold dark:text-[var(--brand-gold-light)]">₡{(emp.remoteBonus ?? 0).toLocaleString()}</td>
                          <td className="p-3 text-center text-[var(--text-secondary)] text-[11px]">{emp.contractType}</td>
                          <td className="p-3 text-center font-mono text-[10px] text-[var(--text-secondary)]">{emp.dateJoined}</td>
                          <td className="p-3 text-center flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleEditEmployeeClick(emp)}
                              className="bg-sky-500 border border-sky-500 dark:border-[var(--brand-gold-mid)] text-sky-600 dark:text-[var(--brand-gold-light)] font-bold text-[10px] uppercase px-2 py-1 rounded transition hover:bg-sky-500 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)]/20 cursor-pointer"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleToggleEmployeeState(emp.id, emp.name, emp.active)}
                              className={`text-[9px] font-bold px-2 py-1 rounded uppercase tracking-wider cursor-pointer ${
                                emp.active 
                                  ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/15 border border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)] text-emerald-600 dark:text-[var(--brand-gold-light)]' 
                                  : 'bg-rose-500/15 border border-rose-500 text-rose-600'
                              }`}
                            >
                              {emp.active ? 'Activo' : 'Suspendido'}
                            </button>
                          </td>
                         </tr> )} />
                </table>
              </div>
            </div>

            {/* Monthly Payroll Generator */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-[var(--border-color)]/50 pb-3">
                <div>
                  <h4 className="text-sm font-bold uppercase text-sky-400 dark:text-[var(--brand-gold-light)]">Planilla Mensual Consolidada (Deducciones Legales de Costa Rica)</h4>
                  <p className="text-[10px] text-[var(--text-secondary)]">Procesa salarios netos restando el 9.67% de CCSS Obrero, LPT 1%, INS y retenciones de renta según tramos.</p>
                </div>
                <button
                  onClick={handleGeneratePayroll}
                  className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] font-bold text-sm px-4 py-2.5 rounded-xl transition"
                >
                  Procesar y Cerrar Planilla Julio 2026
                </button>
              </div>

              {payrolls.length === 0 ? (
                <div className="py-6 text-center text-sm text-[var(--text-secondary)] italic">No hay nóminas procesadas en este mes. Presione el botón superior para generarlas en tiempo real.</div>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse font-mono">
                      <thead>
                        <tr className="border-b border-[var(--border-color)]/80 text-[var(--text-secondary)]">
                          <th className="py-2">Empleado</th>
                          <th className="py-2 text-right">Salario Bruto</th>
                          <th className="py-2 text-right">Subsidio Remoto</th>
                          <th className="py-2 text-right">CCSS Obrero (9.67%)</th>
                          <th className="py-2 text-right">Aporte CCSS Patrón (26.33%)</th>
                          <th className="py-2 text-right">Retención Renta</th>
                          <th className="py-2 text-right">Salario Neto</th>
                          <th className="py-2 text-center">Acción</th>
                        </tr>
                      </thead>
                      <PaginatedTbody items={payrolls} itemsPerPage={10} renderItem={(pay) => ( 
                          <tr key={pay.id} className="hover:bg-[var(--bg-surface)] ">
                            <td className="py-2 font-sans font-medium text-[var(--text-primary)]">{pay.employeeName}</td>
                            <td className="py-2 text-right">₡{pay.baseSalary.toLocaleString()}</td>
                            <td className="py-2 text-right text-emerald-400 dark:text-[var(--brand-gold-light)] font-semibold">+₡{(pay.bonos || 0).toLocaleString()}</td>
                            <td className="py-2 text-right text-rose-400">-₡{pay.ccssTrabajador.toLocaleString()}</td>
                            <td className="py-2 text-right text-[var(--text-secondary)]">₡{pay.ccssPatrono.toLocaleString()}</td>
                            <td className="py-2 text-right text-rose-400">-₡{pay.retencionRenta.toLocaleString()}</td>
                            <td className="py-2 text-right font-bold text-[var(--text-primary)]">₡{pay.salarioNeto.toLocaleString()}</td>
                            <td className="py-2 text-center">
                              <button
                                onClick={() => setSelectedPaySlip(pay)}
                                className="bg-[var(--brand-gold-mid)]/10 text-sky-400 dark:text-[var(--brand-gold-light)] border border-sky-500 dark:border-[var(--brand-gold-mid)]/20 hover:bg-[var(--brand-gold-mid)]/20 px-2.5 py-1 rounded-lg text-[10px] font-sans font-bold transition"
                              >
                                Ver Detalle
                              </button>
                            </td>
                           </tr> )} />
                    </table>
                  </div>
                  
                  {/* Export action */}
                  <div className="flex justify-end pt-2 border-t border-[var(--border-color)]/50">
                    <button
                      onClick={() => handleExportCSV(payrolls, `Planilla_${payrollMonth}`)}
                      className="text-[10px] bg-[var(--bg-surface)] border border-[var(--border-color)]/80 hover:bg-[var(--bg-surface)] rounded-lg px-3 py-1.5 flex items-center gap-1 transition font-bold"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600 dark:text-[var(--brand-gold-light)]" /> Exportar Planilla Oficial CSV
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pay Slip Modal */}
            {selectedPaySlip && (
              <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl w-full max-w-lg p-6 text-[var(--text-primary)] space-y-4 shadow-sm relative animate-in fade-in zoom-in duration-150">
                  <div className="flex justify-between items-start border-b border-[var(--border-color)]/80 pb-3">
                    <div>
                      <h4 className="font-bold text-sm text-sky-400 dark:text-[var(--brand-gold-light)]">Comprobante de Pago de Planilla</h4>
                      <p className="text-[10px] text-[var(--text-secondary)] font-mono">Technoverse S.A. | Cédula Jurídica: {cedulaJuridica}</p>
                    </div>
                    <button
                      onClick={() => setSelectedPaySlip(null)}
                      className="text-sm bg-[var(--bg-surface)] hover:bg-rose-600 px-2 py-1 rounded-lg transition"
                    >
                      Cerrar
                    </button>
                  </div>

                  <div className="bg-[var(--bg-surface)] p-4 border border-[var(--border-color)]/50 rounded-xl space-y-2 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">Colaborador:</span>
                      <span className="text-[var(--text-primary)] font-bold">{selectedPaySlip.employeeName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">ID Comprobante:</span>
                      <span className="text-blue-600 dark:text-[var(--brand-gold-light)] font-bold">{selectedPaySlip.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">Periodo Fiscal:</span>
                      <span className="text-[var(--text-primary)]">{selectedPaySlip.month} (Julio 2026)</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block tracking-wider">Detalle del Pago</span>
                    
                    <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]/50 p-3 space-y-2 text-sm">
                      {/* Income */}
                      <div className="flex justify-between">
                        <span>Salario Base Mensual</span>
                        <span className="font-mono text-[var(--text-primary)]">₡{selectedPaySlip.baseSalary.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-emerald-400 dark:text-[var(--brand-gold-light)]">
                        <span>Subsidio Teletrabajo (Internet, Luz)</span>
                        <span className="font-mono font-bold">+₡{(selectedPaySlip.bonos || 0).toLocaleString()}</span>
                      </div>

                      <div className="border-t border-[var(--border-color)]/50 my-2"></div>

                      {/* Deductions */}
                      <div className="flex justify-between text-rose-400">
                        <span>Carga Social CCSS Obrero (9.67%)</span>
                        <span className="font-mono">-₡{selectedPaySlip.ccssTrabajador.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-rose-400">
                        <span>Aporte LPT Obrero (1.00%)</span>
                        <span className="font-mono">-₡{Math.round(selectedPaySlip.baseSalary * 0.01).toLocaleString()}</span>
                      </div>
                      {selectedPaySlip.retencionRenta > 0 && (
                        <div className="flex justify-between text-rose-400">
                          <span>Impuesto sobre la Renta (Tramos)</span>
                          <span className="font-mono">-₡{selectedPaySlip.retencionRenta.toLocaleString()}</span>
                        </div>
                      )}

                      <div className="border-t border-sky-500 dark:border-[var(--brand-gold-mid)]/20 my-2"></div>

                      {/* Final Net Salary */}
                      <div className="flex justify-between text-white font-bold text-sm bg-[var(--brand-gold-mid)]/10 p-2.5 rounded-lg border border-sky-500 dark:border-[var(--brand-gold-mid)]/20">
                        <span>Monto Neto Depositado</span>
                        <span className="font-mono text-emerald-400 dark:text-[var(--brand-gold-light)]">₡{selectedPaySlip.salarioNeto.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Employer legal costs */}
                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block tracking-wider">Aportes Patronales Legales (Cargas Sociales de Ley)</span>
                    <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]/50 p-3 text-[10px] space-y-1 text-[var(--text-secondary)] font-mono">
                      <div className="flex justify-between">
                        <span>CCSS Seguro de Salud y Pensiones (26.33%)</span>
                        <span>₡{selectedPaySlip.ccssPatrono.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>INS Riesgos del Trabajo (1.50%)</span>
                        <span>₡{selectedPaySlip.insSeguro.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fondo de Capitalización Laboral (FCL 3.00%)</span>
                        <span>₡{selectedPaySlip.fclPatrono.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Aporte LPT Patrón (1.50%)</span>
                        <span>₡{selectedPaySlip.lptPatrono.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[var(--text-primary)] font-bold border-t border-[var(--border-color)]/50 pt-1 mt-1">
                        <span>Costo Laboral Total Technoverse</span>
                        <span className="text-[var(--text-primary)]">₡{selectedPaySlip.costoLaboralTotal.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[8px] text-[var(--text-secondary)] text-center uppercase tracking-wide leading-relaxed">
                    *Comprobante generado por Technoverse bajo la legislación laboral de Costa Rica. Fondos transferidos electrónicamente vía SINPE a cuentas del colaborador.
                  </p>
                </div>
              </div>
            )}

          </div>

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
                      <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono mb-1">Nivel de Membresía</label>
                      <select required value={clientForm.membershipTier} onChange={e => setClientForm({...clientForm, membershipTier: e.target.value as any})} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-4 py-3 text-sm text-[var(--text-primary)]">
                        <option value="Normal">Normal</option>
                        {memberships.filter(m => m && m.active).map(m => m && (
                          <option key={m.id} value={m.id}>{m.name}</option>
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
                    <button type="button" onClick={() => setIsClientModalOpen(false)} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-white">Cancelar</button>
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
                      <th className="p-4 text-center">Nivel de Membresía</th>
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
                            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${
                              c.membershipTier === 'Platino' ? 'bg-indigo-600 dark:bg-[var(--brand-gold-mid)] text-white' :
                              c.membershipTier === 'Oro' ? 'bg-amber-500 text-[var(--text-primary)]' :
                              c.membershipTier === 'Plata' ? 'bg-slate-300 text-[var(--text-primary)]' :
                              'bg-slate-700 text-[var(--text-primary)]'
                            }`}>
                              {c.membershipTier}
                            </span>
                          </td>
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
        {activeTab === 'memberships' && (
          /* MODULE G: MEMBRESÍAS EDITABLES */
          <div className="space-y-6" id="view-memberships">
            <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-500 animate-pulse" /> Ficha de Configuración de Membresías
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {memberships.map(tier => tier && (
                <div key={tier.id} className={`bg-[var(--bg-surface)]  border ${tier.active ? 'border-sky-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50' : 'border-[var(--border-color)]/80 opacity-50'} rounded-2xl p-6 space-y-4 flex flex-col justify-between`}>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] font-mono">Technoverse Plus</span>
                      <button 
                        onClick={() => handleUpdateMembership(tier.id, 'active', !tier.active)}
                        className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${tier.active ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 text-emerald-400 dark:text-[var(--brand-gold-light)]'}`}
                      >
                        {tier.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                    <h4 className="text-base font-extrabold text-[var(--text-primary)]">{tier.name}</h4>
                    
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono">Precio Mensual (Colones)</label>
                        <input
                          type="number"
                          value={tier.price}
                          onChange={(e) => handleUpdateMembership(tier.id, 'price', Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-[var(--text-secondary)] uppercase font-mono">Descuento en compras (%)</label>
                        <input
                          type="number"
                          max="100"
                          value={tier.discountPercent}
                          onChange={(e) => handleUpdateMembership(tier.id, 'discountPercent', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50 space-y-2">
                    <span className="text-[9px] text-[var(--text-secondary)] uppercase block font-bold">Distribución Residencial:</span>
                    <div className="text-[10px] font-mono text-[var(--text-primary)]">Retiro en Residencia: <strong className="text-emerald-400 dark:text-[var(--brand-gold-light)]">Gratis (₡0)</strong></div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase">San José GAM (Express)</label>
                      <input 
                        type="number" 
                        value={tier.shippingSJ}
                        onChange={(e) => handleUpdateMembership(tier.id, 'shippingSJ', Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded px-2 py-1 text-sm text-[var(--text-primary)]" 
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[var(--text-secondary)] uppercase">Otras Prov. (Correos CR)</label>
                      <input 
                        type="number" 
                        value={tier.shippingOther}
                        onChange={(e) => handleUpdateMembership(tier.id, 'shippingOther', Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded px-2 py-1 text-sm text-[var(--text-primary)]" 
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
                    <button type="button" onClick={() => setIsCouponModalOpen(false)} className="text-[10px] text-[var(--text-secondary)] hover:text-white px-3 py-1">Cancelar</button>
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
                            }} className="text-[10px] text-[var(--text-secondary)] hover:text-white underline">
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
                    <button type="button" onClick={() => setIsBannerModalOpen(false)} className="text-[10px] text-[var(--text-secondary)] hover:text-white px-3 py-1">Cancelar</button>
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
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Cédula Jurídica (Simulada)</label>
                  <input
                    type="text"
                    value={cedulaJuridica}
                    onChange={(e) => setCedulaJuridica(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Teléfono Fiscal Oficial</label>
                  <input
                    type="text"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none font-mono"
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
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Horarios de Retiro (Estricta Cita Previa)</label>
                  <input
                    type="text"
                    value={pickupHours}
                    onChange={(e) => setPickupHours(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
                  />
                </div>
              </div>

              {/* COSTA RICAN HOME BUSINESS COMPLIANCE NOTE */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-2 mt-4">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400 flex items-center gap-1.5">
                  ⚠️ NOTA DE CUMPLIMIENTO LEGAL: OPERACIÓN DOMICILIARIA (COSTA RICA)
                </span>
                <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                  De conformidad con la reglamentación de las municipalidades costarricenses y la Dirección General de Tributación de Hacienda, Technoverse se encuentra registrado bajo la modalidad de <strong>microempresa de base tecnológica operada desde el hogar</strong> (régimen pyme o simplificado, según corresponda).
                </p>
                <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                  La actividad principal de reparación técnica, mantenimiento e inventario de repuestos se realiza respetando el <strong>Uso de Suelo Residencial No Molesto</strong>, sin bodegaje industrial ni afectación al vecindario. Las entregas se gestionan mediante Correos de Costa Rica o mensajería independiente, y los retiros se realizan estrictamente bajo cita previa.
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
                      Seleccione una imagen de su computadora. Se guardará localmente y se aplicará inmediatamente en todo el sitio (tienda, panel de administración y empleados).
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
          </div>

        )}
            </motion.div>
          </AnimatePresence>
      </main>
      </div>
    </div>
  );
}
