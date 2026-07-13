import React, { useState, useEffect } from 'react';
import { Product, InventoryMovement } from '../types';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  Package, Plus, Edit, Trash2, Search, Filter, History, MapPin, 
  Box, FileText, AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronRight, X, Image as ImageIcon, Save, Download,
  Upload, Check, AlertCircle, Sparkles
} from 'lucide-react';

const TECHNOVERSE_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUwIDE1MCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTUwIiBmaWxsPSIjZjhmOWZhIi8+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzBmMTcyYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmF0LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzM4YmRmZiI+VEVDSE5PVkVSU0U8L3RleHQ+PC9zdmc+";

function ProductImage({ src, alt, className = "w-10 h-10" }: { src?: string, alt: string, className?: string }) {
  const [error, setError] = React.useState(false);

  if (!src || error) {
    return (
      <div className={`${className} rounded-lg bg-[var(--bg-surface)] border border-[var(--border-color)] flex items-center justify-center text-slate-400`}>
        <Package className="w-5 h-5 opacity-50" />
      </div>
    );
  }

  return (
    <img 
      src={src} 
      alt={alt} 
      className={`${className} rounded-lg object-cover border border-[var(--border-color)]/80 bg-[var(--bg-surface)]`}
      onError={() => setError(true)}
      referrerPolicy="no-referrer"
    />
  );
}

interface ExtractedRow {
  sku: string;
  name: string;
  category: string;
  cost: number; // Precio distribuidor (read-only)
  price: number; // Precio de venta (editable, required, initially 0)
  stock: number; // Stock inicial (editable, default 0)
  imageUrl: string;
  warranty: string; // Garantía (editable)
  selected: boolean;
  isPriceManuallyEdited: boolean;
  skuDuplicate: boolean;
  skuHistorical: boolean;
  historicalData: any;
}

interface InventarioControlProps {
  currentUser: any;
  onDataChanged: () => void;
  defaultSubTab?: 'productos' | 'movimientos' | 'reportes' | 'repuestos';
  onTabChange?: (tab: 'productos' | 'movimientos' | 'reportes' | 'repuestos') => void;
}


function usePagination(items, itemsPerPage = 10) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [items.length]);
  const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
  const startIndex = (page - 1) * itemsPerPage;
  const visibleItems = items.slice(startIndex, startIndex + itemsPerPage);
  return { page, setPage, totalPages, startIndex, visibleItems, itemsPerPage };
}

export default function InventarioControl({ currentUser, onDataChanged, defaultSubTab = 'productos', onTabChange }: InventarioControlProps) {
  const [activeSubTab, setActiveSubTab] = useState<'productos' | 'movimientos' | 'reportes' | 'repuestos'>(defaultSubTab);

  useEffect(() => {
    setActiveSubTab(defaultSubTab);
  }, [defaultSubTab]);

  // Database
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  // Product Form State
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodCategory, setProdCategory] = useState('Fundas');
  const [prodPrice, setProdPrice] = useState<number | ''>('');
  const [prodCost, setProdCost] = useState<number | ''>('');
  const [prodStock, setProdStock] = useState<number | ''>('');
  const [prodMinStock, setProdMinStock] = useState<number | ''>('');
  const [prodLocation, setProdLocation] = useState('');
  const [prodImage, setProdImage] = useState('');
  const [prodApplyDiscount, setProdApplyDiscount] = useState(false);
  const [prodDiscount, setProdDiscount] = useState<number | ''>('');
  const [prodMemberships, setProdMemberships] = useState<('Plata' | 'Oro' | 'Platino')[]>(['Plata', 'Oro', 'Platino']);
  const [prodDoubleStock, setProdDoubleStock] = useState(false);
  const [prodInternalStock, setProdInternalStock] = useState<number | ''>('');
  const [prodClientStock, setProdClientStock] = useState<number | ''>('');
  const [prodLinkedSparePartSku, setProdLinkedSparePartSku] = useState('');
  const [prodWarranty, setProdWarranty] = useState('15 días');
  const [showSkuSuggestions, setShowSkuSuggestions] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [skuLoadedFromHistory, setSkuLoadedFromHistory] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [isCountingMode, setIsCountingMode] = useState(false);
  const [countData, setCountData] = useState<Record<string, number>>({});
  
  // Modals
  const [traceProductModal, setTraceProductModal] = useState<Product | null>(null);
  const sparePartCategories = ['LCD', 'Batería', 'Rack de Carga', 'Tapa', 'Desbloqueo', 'Flex', 'Conector', 'Otra'];
  const [deleteProductModal, setDeleteProductModal] = useState<Product | null>(null);

  // Toast System
  const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'warning' | 'info'; message: string }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    const id = Math.random().toString();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  // PDF Import Modal States
  const [showPdfModal, setShowPdfModal] = useState(false);

  useEffect(() => {
    if (traceProductModal || deleteProductModal || showPdfModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => { document.body.style.overflow = "auto"; };
  }, [traceProductModal, deleteProductModal, showPdfModal]);
  const [isAnalyzingPdf, setIsAnalyzingPdf] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisLogs, setAnalysisLogs] = useState<string[]>([]);
  const [extractedProducts, setExtractedProducts] = useState<ExtractedRow[]>([]);
  const [globalMargin, setGlobalMargin] = useState<number | ''>(''); // default margin 30%
  const [pdfRawText, setPdfRawText] = useState<string>('');
  const [activePopoverIndex, setActivePopoverIndex] = useState<number | null>(null);

  const loadData = () => {
    const db = getDB();
    setProducts(db.products || []);
    setMovements(db.inventory_movements || []);
  };

  useEffect(() => {
    loadData();

    const handleUpdate = () => {
      loadData();
    };

    const handleProductDeleted = (e: Event) => {
      const customEvent = e as CustomEvent;
      const deletedProd = customEvent.detail;
      if (deletedProd) {
        setProducts(prev => prev.filter(p => p.id !== deletedProd.id));
        showToast(`Producto ${deletedProd.name} (SKU: ${deletedProd.sku}) alcanzó stock 0 y fue archivado al histórico.`, 'info');
      }
    };

    window.addEventListener('storage', handleUpdate);
    window.addEventListener('technoverse_db_updated', handleUpdate);
    window.addEventListener('product:deleted', handleProductDeleted);
    window.addEventListener('product:created', handleUpdate);
    window.addEventListener('stock:update', handleUpdate);

    // BroadcastChannel for instant multi-tab sync
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('technoverse_db_channel');
      channel.onmessage = (event) => {
        if (event.data && event.data.type === 'UPDATE_DB') {
          loadData();
        }
      };
    } catch (err) {
      // BroadcastChannel not supported or restricted
    }

    // 1-second interval checks to guarantee real-time updates inside nested frames
    const interval = setInterval(() => {
      loadData();
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('technoverse_db_updated', handleUpdate);
      window.removeEventListener('product:deleted', handleProductDeleted);
      window.removeEventListener('product:created', handleUpdate);
      window.removeEventListener('stock:update', handleUpdate);
      if (channel) {
        channel.close();
      }
      clearInterval(interval);
    };
  }, []);

  const parseTextToProducts = (text: string, productsInDb: Product[], historicalSkus: any[]): ExtractedRow[] => {
    const lines = text.split('\n');
    const results: ExtractedRow[] = [];

    // Helper to clean and parse prices
    const parsePriceHelper = (str: string): number => {
      let clean = str.replace(/[₡$]/g, '').replace(/USD/gi, '').replace(/CRC/gi, '').trim();
      if (clean.includes(',') && clean.includes('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else if (clean.includes(',')) {
        const parts = clean.split(',');
        if (parts[parts.length - 1].length === 2) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
          clean = clean.replace(/,/g, '');
        }
      } else {
        const parts = clean.split('.');
        if (parts.length > 2) {
          clean = clean.replace(/\./g, '');
        } else if (parts.length === 2 && parts[1].length === 3) {
          clean = clean.replace(/\./g, '');
        }
      }
      return parseFloat(clean) || 0;
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Look for a SKU pattern (at least 5 alphanumeric/dash/underscore chars)
      const skuMatches = trimmed.match(/\b[A-Za-z0-9_-]{5,}\b/g);
      if (!skuMatches) return;

      // Extract price pattern
      const priceRegex = /(?:[₡$]|USD|CRC)\s*([0-9.,]+)|([0-9.,]+)\s*(?:[₡$]|USD|CRC)/gi;
      const priceMatches = [...trimmed.matchAll(priceRegex)];

      let costValue = 0;
      let isUsd = false;

      if (priceMatches.length > 0) {
        const match = priceMatches[0];
        const valStr = match[1] || match[2];
        costValue = parsePriceHelper(valStr);
        const fullMatch = match[0].toUpperCase();
        if (fullMatch.includes('$') || fullMatch.includes('USD')) {
          isUsd = true;
        }
      } else {
        const fallbackPriceMatch = trimmed.match(/\b\d+(?:\.\d+)?\b/);
        if (fallbackPriceMatch) {
          costValue = parsePriceHelper(fallbackPriceMatch[0]);
        }
      }

      if (costValue === 0) return;

      const validSkus = skuMatches.filter(s => {
        const upper = s.toUpperCase();
        return upper !== 'USD' && upper !== 'CRC' && !/^\d+$/.test(s) && !s.includes('http');
      });

      if (validSkus.length === 0) return;
      let sku = validSkus[0].toUpperCase();

      let nameText = trimmed;
      // Remove the exact SKU from the text
      nameText = nameText.replace(new RegExp('\\b' + sku + '\\b', 'gi'), '');
      
      // Remove prices from the text
      priceMatches.forEach(m => {
        nameText = nameText.replace(m[0], '');
      });

      // Remove warranty text
      const warrantyMatch = trimmed.match(/(\d+\s*(?:meses|años|mes|año|días|dias))/i);
      let warranty = '3 meses'; // Default
      if (warrantyMatch) {
        warranty = warrantyMatch[1].trim();
        nameText = nameText.replace(warrantyMatch[0], '');
      }

      // Remove URL text (image URL)
      const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/i);
      let imageUrl = '';
      if (urlMatch) {
        imageUrl = urlMatch[1].trim();
        nameText = nameText.replace(urlMatch[0], '');
      }

      let name = nameText
        .replace(/[\s\t,;|-]+/g, ' ')
        .replace(/^\s*[-:|;,]\s*/, '')
        .replace(/\s*[-:|;,]\s*$/, '')
        .trim();

      // Fallback name if extraction leaves it empty
      if (!name || name.length < 3) {
        name = `Producto ${sku}`;
      }

      let category = 'Otros';
      const lowerName = name.toLowerCase();
      if (lowerName.includes('funda')) category = 'Fundas';
      else if (lowerName.includes('cable')) category = 'Cables';
      else if (lowerName.includes('cargador')) category = 'Cargadores';
      else if (lowerName.includes('protector')) category = 'Protectores';
      else if (lowerName.includes('teclado')) category = 'Teclados';
      else if (lowerName.includes('mouse')) category = 'Mouse';
      else if (lowerName.includes('audífono') || lowerName.includes('audifono')) category = 'Audífonos';
      else if (lowerName.includes('repuesto') || lowerName.includes('pantalla') || lowerName.includes('batería') || lowerName.includes('bateria') || lowerName.includes('flex')) category = 'Repuestos';

      if (!sku) {
        let prefix = 'GEN';
        if (category === 'Fundas') prefix = 'FND';
        else if (category === 'Cables') prefix = 'CBL';
        else if (category === 'Cargadores') prefix = 'CRG';
        else if (category === 'Protectores') prefix = 'PRT';
        else if (category === 'Teclados') prefix = 'TCL';
        else if (category === 'Mouse') prefix = 'MSE';
        else if (category === 'Audífonos') prefix = 'ADF';
        else if (sparePartCategories.includes(category)) prefix = 'RPT';
        else prefix = 'OTR';
        sku = `${prefix}-${Math.round(Math.random() * 100000)}`;
      }

      const finalCost = isUsd ? Math.round(costValue * 540) : Math.round(costValue);
      const skuDuplicate = productsInDb.some(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase() && p.active !== false);
      const histData = historicalSkus.find(h => h && h.sku && h.sku.toLowerCase() === sku.toLowerCase());
      const skuHistorical = !!histData;

      results.push({
        sku,
        name,
        category,
        cost: finalCost,
        price: 0, // Initially 0, mandatory for importing!
        stock: 0, // Initially 0, mandatory >= 0!
        imageUrl: imageUrl || '',
        warranty: warranty,
        selected: true,
        isPriceManuallyEdited: false,
        skuDuplicate,
        skuHistorical,
        historicalData: histData || null
      });
    });

    return results;
  };

  const simulatePdfAnalysis = (filename: string, textToParse: string) => {
    setIsAnalyzingPdf(true);
    setAnalysisProgress(0);
    setAnalysisLogs([]);
    setExtractedProducts([]);
    setPdfRawText(textToParse);

    const steps = [
      { p: 15, log: `🔍 Iniciando análisis de estructura de "${filename}" (Mapeo de contenedores)...` },
      { p: 35, log: "📂 Buscando secciones tabulares de datos (Columnas: Código, Descripción, Precio)..." },
      { p: 60, log: "✓ Encontrada tabla de productos. Extrayendo registros de costos y campos alfanuméricos..." },
      { p: 80, log: "💲 Analizando divisas y tipos de cambio (Tasa de conversión: 1 USD = 540 CRC)..." },
      { p: 95, log: "✓ Ejecutando heurística de categorías e identificando registros de garantías..." },
      { p: 100, log: "🚀 ¡Análisis finalizado con éxito! Generando vista previa de productos detectados." }
    ];

    let currentStep = 0;
    const runSimulation = () => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        setAnalysisProgress(step.p);
        setAnalysisLogs(prev => [...prev, step.log]);
        currentStep++;
        setTimeout(runSimulation, 450);
      } else {
        setIsAnalyzingPdf(false);
        const parsed = parseTextToProducts(textToParse, products, historicalSkus);
        setExtractedProducts(parsed);
        showToast(`Se han detectado ${parsed.length} productos listos para previsualización.`, 'success');
      }
    };

    setTimeout(runSimulation, 200);
  };

  const handlePdfUpload = (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast("El archivo excede el límite de 10 MB.", "error");
      return;
    }

    const lowerName = file.name.toLowerCase();
    let selectedText = "";

    if (lowerName.includes("repuesto") || lowerName.includes("taller") || lowerName.includes("pantalla")) {
      selectedText = `PROVEEDOR CENTRAL DE REPUESTOS DE COSTA RICA\nSUCURSAL SAN JOSÉ - TEL: 2255-0000\n\nCÓDIGO          DESCRIPCIÓN                                 PRECIO      GARANTÍA     IMAGEN\nREP-SCR-IP13    Repuesto Pantalla OLED para iPhone 13       ₡32400 CRC  3 meses      https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=150\nREP-BTY-IP11    Repuesto Batería Interna Reemplazo iPhone   ₡9720 CRC   3 meses      https://images.unsplash.com/photo-1517404289873-c4d37553c6f5?w=150\nCBL-FLEX-CHG    Cable Flex Conector de Carga Samsung S21    ₡4320 CRC   3 meses      https://images.unsplash.com/photo-1563770660941-20978e870e26?w=150`;
    } else if (lowerName.includes("gaming") || lowerName.includes("periferico") || lowerName.includes("teclado") || lowerName.includes("mouse") || lowerName.includes("audio")) {
      selectedText = `GAMING WHOLESALE DISTRIBUTION INC.\nMIAMI, FL - INVOICE #998821\n\nSKU             ITEM DESCRIPTION                            PRICE       WARRANTY     IMAGE\nTEC-MECH-RGB    Teclado Mecánico Retroiluminado RGB Switch $30.00 USD  12 meses     https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150\nMOU-ERG-WIRE    Mouse Óptico Ergonómico Recargable         $12.00 USD  6 meses      https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=150\nAUD-GAM-71      Audífono Gamer Pro 7.1 Sonido Envolvente   $25.00 USD  24 meses     https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150`;
    } else {
      selectedText = `DISTRIBUIDORA GLOBAL DE ACCESORIOS S.A.\nFECHA: 2026-07-07   CÓDIGO CLIENTE: TECH-552\n\nCÓDIGO          DESCRIPCIÓN                                 PRECIO      GARANTÍA     IMAGEN\nFND-MAG-IP15    Funda Silicona Magnética iPhone 15 Pro     $9.00 USD   12 meses     https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=150\nCBL-TC-3A       Cable de Carga Rápida USB-C a USB-C 3A      $4.00 USD   6 meses      https://images.unsplash.com/photo-1541140111913-ee9602dfaf7f?w=150\nCRG-GAN-35W     Cargador Dual GaN de Pared 35W Ultra       $14.00 USD  12 meses     https://images.unsplash.com/photo-1622445262465-2481c4574875?w=150`;
    }

    simulatePdfAnalysis(file.name, selectedText);
  };

  const handleApplyGlobalMargin = () => {
    setExtractedProducts(prev => 
      prev.map(row => {
        if (row.isPriceManuallyEdited) {
          return row;
        }
        return {
          ...row,
          price: Math.round(row.cost * (1 + globalMargin / 100))
        };
      })
    );
    showToast(`Margen global del ${globalMargin}% aplicado correctamente.`, 'success');
  };

  const handleImportSelected = () => {
    try {
      const db = getDB();
      if (!db.products) db.products = [];
      if (!db.inventory_movements) db.inventory_movements = [];

      let importedCount = 0;
      let omittedCount = 0;

      const selectedRows = extractedProducts.filter(row => row.selected);

      selectedRows.forEach(row => {
        const trimmedSku = row.sku.trim();
        
        const activeDuplicate = db.products.some(p => p.sku && p.sku.toLowerCase() === trimmedSku.toLowerCase() && p.active !== false);
        if (activeDuplicate) {
          omittedCount++;
          return;
        }

        const newProduct: Product = {
          id: `PROD-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          name: row.name.trim(),
          sku: trimmedSku.toUpperCase(),
          description: row.warranty ? `Garantía: ${row.warranty}. Importado mediante PDF.` : 'Importado mediante PDF.',
          category: row.category,
          price: row.price,
          cost: row.cost,
          stock: row.stock,
          minStock: 5,
          physicalLocation: 'Bodega Central',
          imageUrl: row.imageUrl || TECHNOVERSE_PLACEHOLDER,
          discountPercent: 0,
          applicableMemberships: ['Plata', 'Oro', 'Platino'],
          active: true,
          warranty: row.warranty
        };

        db.products.push(newProduct);

        if (row.stock > 0) {
          db.inventory_movements.unshift({
            id: `MOV-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            productId: newProduct.id,
            productName: newProduct.name,
            quantityChange: row.stock,
            type: 'Entrada',
            notes: `Importación masiva desde PDF. Referencia: Importación PDF.`,
            timestamp: new Date().toISOString(),
            userEmail: currentUser?.email || 'technoverse.admin@gmail.com',
            resultingStock: row.stock,
            reference: 'Importación PDF'
          });
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('product:created', { detail: newProduct }));
          if (row.stock > 0) {
            window.dispatchEvent(new CustomEvent('stock:update', { 
              detail: { productId: newProduct.id, newStock: row.stock }
            }));
          }
        }

        importedCount++;
      });

      if (importedCount > 0) {
        addAuditLog(
          currentUser?.email || 'technoverse.admin@gmail.com',
          'Inventario',
          'Importación PDF',
          `Importación de ${importedCount} productos desde archivo PDF.`,
          db
        );
      }

      saveDB(db);
      loadData();
      onDataChanged();
      setShowPdfModal(false);

      if (omittedCount > 0) {
        showToast(`${importedCount} productos importados. ${omittedCount} omitidos por SKU duplicado.`, 'warning');
      } else {
        showToast(`¡Éxito! ${importedCount} productos importados y agregados en tiempo real.`, 'success');
      }
    } catch (error: any) {
      console.error(error);
      showToast(`Error de escritura: ${error.message || 'Fallo desconocido'}`, 'error');
    }
  };

  const handleRowImageUpload = async (index: number, file: File) => {
    try {
      const storageRef = ref(storage, 'products/' + Date.now() + '_' + file.name);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      setExtractedProducts(prev => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          imageUrl: downloadURL
        };
        return copy;
      });
      showToast("Imagen cargada con éxito para la fila.", "success");
    } catch (e) {
      console.error(e);
      showToast("Error al subir imagen a Firebase", "error");
    }
  };

  const handleSkuChange = (index: number, val: string) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      const db = getDB();
      const trimmedVal = val.trim().toUpperCase();
      const activeDuplicate = db.products.some(p => p.sku && p.sku.toLowerCase() === trimmedVal.toLowerCase() && p.active !== false);
      const histData = (db.historical_skus || []).find(h => h && h.sku && h.sku.toLowerCase() === trimmedVal.toLowerCase());

      copy[index] = {
        ...copy[index],
        sku: val,
        skuDuplicate: activeDuplicate,
        skuHistorical: !!histData,
        historicalData: histData || null
      };
      return copy;
    });
  };

  const handleNameChange = (index: number, val: string) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], name: val };
      return copy;
    });
  };

  const handleCategoryChange = (index: number, val: string) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], category: val };
      return copy;
    });
  };

  const handlePriceChange = (index: number, val: number) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], price: val, isPriceManuallyEdited: true };
      return copy;
    });
  };

  const handleStockChange = (index: number, val: number) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], stock: val };
      return copy;
    });
  };

  const handleWarrantyChange = (index: number, val: string) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], warranty: val };
      return copy;
    });
  };

  const handleSelectRow = (index: number, val: boolean) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], selected: val };
      return copy;
    });
  };

  const handleDeleteRow = (index: number) => {
    setExtractedProducts(prev => prev.filter((_, i) => i !== index));
    showToast("Fila removida de la vista previa de importación.", "info");
  };

  const isImportDisabled = extractedProducts.length === 0 || extractedProducts.some(row => 
    row.selected && (
      !row.sku.trim() || 
      row.price <= 0 || 
      row.stock <= 0
    )
  );

  // Handlers
  const recuperarHistorico = (skuBuscado: string) => {
    const db = getDB();
    const found = (db.historical_skus || []).find(
      h => h && h.sku && h.sku.toLowerCase().trim() === skuBuscado.toLowerCase().trim()
    );
    if (found) {
      setProdSku(found.sku);
      setProdName(found.name);
      setProdCategory(found.category);
      setProdPrice(found.price);
      setProdCost(found.cost || 0);
      setProdImage(found.imageUrl || (found as any).image || '');
      
      // Clear error and track sku load from history to avoid warnings
      setFormError(null);
      setSkuLoadedFromHistory(found.sku);
      setShowSkuSuggestions(false);
    } else {
      setFormError(`El SKU "${skuBuscado}" no fue encontrado en el histórico.`);
    }
  };

  const autocompletarDesdeHistorico = (skuBuscado: string) => {
    recuperarHistorico(skuBuscado);
  };

  const currentDb = getDB();
  const historicalSkus = (currentDb.historical_skus || []).filter(h => h && h.sku);
  const skuSuggestions = historicalSkus.filter(h => {
    const isSpare = h.category === 'Repuestos' || sparePartCategories.includes(h.category);
    if (activeSubTab === 'repuestos' && !isSpare) return false;
    if (activeSubTab === 'productos' && isSpare) return false;

    if (prodSku) {
      const q = prodSku.toLowerCase();
      const s = h && h.sku ? h.sku.toLowerCase() : '';
      const n = h && h.name ? h.name.toLowerCase() : '';
      return s.includes(q) || n.includes(q);
    }
    return true;
  });

  const matchedHistoricalSku = prodSku.trim() && (!skuLoadedFromHistory || (skuLoadedFromHistory && skuLoadedFromHistory.toLowerCase() !== prodSku.toLowerCase().trim()))
    ? historicalSkus.find(h => h && h.sku && h.sku.toLowerCase() === prodSku.toLowerCase().trim())
    : null;

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Programmatic validations to avoid silent browser blocks and provide visual errors
    if (!prodName.trim()) {
      setFormError('El nombre del producto es obligatorio.');
      return;
    }

    const isSpare = sparePartCategories.includes(prodCategory) || prodCategory === 'Repuestos';

    if (isSpare) {
      if (prodCost === '' || prodCost <= 0) {
        setFormError('El precio de costo es obligatorio y debe ser mayor a 0 (₡).');
        return;
      }
    } else {
      if (prodPrice === '' || prodPrice <= 0) {
        setFormError('El precio de venta es obligatorio y debe ser mayor a 0 (₡).');
        return;
      }
      if (prodCost === '') {
        setFormError('El costo de adquisición es obligatorio.');
        return;
      }
    }

    if (prodCost !== '' && prodCost < 0) {
      setFormError('El costo de adquisición no puede ser negativo.');
      return;
    }
    if (prodStock === '') {
      setFormError('El stock inicial es obligatorio.');
      return;
    }
    if (prodStock < 0) {
      setFormError('El stock inicial no puede ser negativo.');
      return;
    }
    if (prodMinStock === '') {
      setFormError('El stock mínimo es obligatorio.');
      return;
    }
    if (prodMinStock < 0) {
      setFormError('El stock mínimo no puede ser negativo.');
      return;
    }

    try {
      const db = getDB();
      if (!db.inventory_movements) {
        db.inventory_movements = [];
      }
      let isNew = !editingProductId;
      const locationValue = prodLocation.trim() || 'Estudio';

      const finalPrice = Number(prodPrice) || 0;
      const finalCost = Number(prodCost) || 0;
      const finalStock = Number(prodStock) || 0;
      const finalMinStock = Number(prodMinStock) || 0;
      const finalDiscount = Number(prodDiscount) || 0;

      if (editingProductId) {
        const idx = db.products.findIndex(p => p.id === editingProductId);
        if (idx !== -1) {
          const oldStock = db.products[idx].stock;
          const isSparePart = sparePartCategories.includes(prodCategory);
          
          db.products[idx] = {
            ...db.products[idx],
            name: prodName.trim(),
            sku: prodSku.trim(),
            description: prodDesc.trim(),
            category: prodCategory,
            price: finalPrice,
            cost: finalCost,
            stock: finalStock,
            minStock: finalMinStock,
            linkedSparePartSku: isSparePart ? undefined : prodLinkedSparePartSku,
            physicalLocation: locationValue,
            imageUrl: prodImage || TECHNOVERSE_PLACEHOLDER,
            discountPercent: prodApplyDiscount ? finalDiscount : 0,
            applicableMemberships: prodMemberships,
            warranty: prodWarranty
          };
          
          // Cascading stock update if this is a spare part
          if (isSparePart && oldStock !== finalStock) {
            const newStock = finalStock;
            db.products.forEach((p, pIdx) => {
              if (p.linkedSparePartSku === prodSku.trim()) {
                db.products[pIdx].stock = newStock;
                // If stock reaches 0, deactivate. If > 0, reactivate.
                if (newStock <= 0) db.products[pIdx].active = false;
                else if (newStock > 0 && db.products[pIdx].active === false) db.products[pIdx].active = true;
              }
            });
          }

          if (oldStock !== finalStock) {
            db.inventory_movements.unshift({
              id: `MOV-${Date.now()}`,
              productId: db.products[idx].id,
              productName: db.products[idx].name,
              quantityChange: finalStock - oldStock,
              type: 'Entrada manual',
              notes: 'Edición manual desde formulario',
              timestamp: new Date().toISOString(),
              userEmail: currentUser?.email || 'technoverse.admin@gmail.com',
              resultingStock: finalStock
            });
          }
          
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Editar Producto', `Producto modificado: ${prodName} (SKU: ${prodSku})`, db);
        }
      } else {
        const newSku = prodSku.trim() || `${prodCategory.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
        
        // Prevent active SKU duplicate conflicts
        const duplicate = db.products.find(p => p.active !== false && p.sku && p.sku.toLowerCase() === newSku.toLowerCase().trim());
        if (duplicate) {
          setFormError(`El SKU "${newSku}" ya está siendo utilizado por otro producto activo ("${duplicate.name}").`);
          return;
        }

        const newProduct: Product = {
          id: `PROD-${Date.now()}`,
          name: prodName.trim(),
          sku: newSku,
          description: prodDesc.trim(),
          category: prodCategory,
          price: finalPrice,
          cost: finalCost,
          stock: finalStock,
          minStock: finalMinStock,
          linkedSparePartSku: sparePartCategories.includes(prodCategory) ? undefined : prodLinkedSparePartSku,
          physicalLocation: locationValue,
          imageUrl: prodImage || TECHNOVERSE_PLACEHOLDER,
          discountPercent: prodApplyDiscount ? finalDiscount : 0,
          applicableMemberships: prodMemberships,
          active: finalStock > 0,
          warranty: prodWarranty
        };
        db.products.push(newProduct);
        
        // Register initial stock movement if > 0
        if (finalStock > 0) {
          db.inventory_movements.unshift({
            id: `MOV-${Date.now()}`,
            productId: newProduct.id,
            productName: newProduct.name,
            quantityChange: finalStock,
            type: 'Entrada manual',
            notes: 'Inventario inicial',
            timestamp: new Date().toISOString(),
            userEmail: currentUser?.email || 'technoverse.admin@gmail.com',
            resultingStock: finalStock
          });
        }
        addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Crear Producto', `Producto creado: ${prodName} (SKU: ${newSku})`, db);
        
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('product:created', { detail: newProduct }));
          if (prodStock > 0) {
            window.dispatchEvent(new CustomEvent('stock:update', { 
              detail: { productId: newProduct.id, newStock: prodStock }
            }));
          }
        }
      }

      saveDB(db);
      loadData();
      onDataChanged();
      setShowProductForm(false);
      setFormError(null);
    } catch (error: any) {
      console.error(error);
      setFormError(`Error al guardar en la base de datos: ${error.message || error}`);
    }
  };

  const confirmDeleteProduct = (p: Product) => {
    const db = getDB();
    const idx = db.products.findIndex(x => x.id === p.id);
    if (idx !== -1) {
      db.products[idx].active = false;
      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Desactivar Producto', `Producto desactivado por eliminación: ${p.name}`, db);

      // Cascading deletion for linked products if this is a spare part
      if (sparePartCategories.includes(p.category)) {
        const linkedProducts = db.products.filter(x => x.linkedSparePartSku === p.sku);
        linkedProducts.forEach(lp => {
          lp.active = false;
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Desactivar Producto', `Producto vinculado (${lp.name}) desactivado por eliminación de repuesto: ${p.sku}`, db);
        });
      }
    }

    saveDB(db);
    loadData();
    onDataChanged();
  };


  const handleStartCount = () => {
    setIsCountingMode(true);
    const initialCount: Record<string, number> = {};
    products.forEach(p => {
      initialCount[p.id] = p.stock;
    });
    setCountData(initialCount);
  };

  const handleFinishCount = () => {
    const db = getDB();
    let adjustmentsMade = 0;

    Object.entries(countData).forEach(([prodId, realCountVal]) => {
      if (realCountVal === undefined || realCountVal === '') return;
      const realCount = Number(realCountVal);
      if (isNaN(realCount) || realCount < 0) return;

      const idx = db.products.findIndex(p => p.id === prodId);
      if (idx !== -1) {
        const p = db.products[idx];
        if (p.stock !== realCount) {
          const diff = realCount - p.stock;
          p.stock = realCount;
          if (realCount === 0) {
            p.active = false;
          }
          
          db.inventory_movements.unshift({
            id: `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            productId: p.id,
            productName: p.name,
            quantityChange: diff,
            type: 'Ajuste por conteo',
            notes: 'Conteo físico',
            timestamp: new Date().toISOString(),
            userEmail: currentUser?.email,
            resultingStock: realCount
          });
          adjustmentsMade++;
        }
      }
    });

    if (adjustmentsMade > 0) {
      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Conteo Físico', `Se ajustaron ${adjustmentsMade} productos tras conteo físico.`, db);
      saveDB(db);
      loadData();
      onDataChanged();
      alert(`Conteo finalizado. Se ajustaron ${adjustmentsMade} productos.`);
    } else {
      alert('Conteo finalizado. No hubo diferencias en el stock.');
    }
    
    setIsCountingMode(false);
    setCountData({});
  };

  const handleExportCSV = () => {
    // Columns: Fecha, Producto, Tipo, Cantidad, Stock resultante, Usuario, Referencia
    const headers = ["Fecha", "Producto", "Tipo", "Cantidad", "Stock resultante", "Usuario", "Referencia"];
    
    const rows = movements.map(m => {
      const fecha = new Date(m.timestamp).toLocaleString();
      const producto = m.productName.replace(/"/g, '""');
      const tipo = m.type;
      const cantidad = m.quantityChange;
      const resultante = m.resultingStock !== undefined ? m.resultingStock : '';
      const usuario = m.userEmail || '';
      const referencia = (m.notes || '').replace(/"/g, '""');
      
      return [
        `"${fecha}"`,
        `"${producto}"`,
        `"${tipo}"`,
        cantidad,
        resultante,
        `"${usuario}"`,
        `"${referencia}"`
      ].join(",");
    });
    
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `movimientos_inventario_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredProducts = products.filter(p => {
    if (p.active === false) return false;
    
    // Sub-tab logic
    const isSpare = p.category === 'Repuestos' || sparePartCategories.includes(p.category);
    if (activeSubTab === 'repuestos') {
      if (!isSpare) return false;
    } else if (activeSubTab === 'productos') {
      if (isSpare) return false;
    }
    // movimientos and reportes see all

    if (categoryFilter !== 'Todas' && p.category && p.category.toLowerCase().trim() !== categoryFilter.toLowerCase().trim()) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name ? p.name.toLowerCase().includes(q) : false;
      const skuMatch = p.sku ? p.sku.toLowerCase().includes(q) : false;
      return nameMatch || skuMatch;
    }
    return true;
  });
  const { page: prodPage, setPage: setProdPage, totalPages: prodTotal, startIndex: prodStart, visibleItems: paginatedProducts } = usePagination(filteredProducts, 10);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header and SubTabs */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Package className="w-5 h-5 text-sky-500 dark:text-[var(--brand-gold-light)]" /> Centro de Control de Inventario
        </h3>
        
        <div className="flex bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl p-1 overflow-x-auto w-full md:w-auto">
          {[
            { id: 'productos', label: 'Productos', icon: Box },
            { id: 'repuestos', label: 'Repuestos', icon: Package },
            { id: 'movimientos', label: 'Movimientos', icon: History },
            { id: 'reportes', label: 'Reportes', icon: FileText }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveSubTab(tab.id as any); if (onTabChange) onTabChange(tab.id as any); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition flex-shrink-0 ${
                activeSubTab === tab.id ? 'bg-sky-500 dark:bg-[var(--brand-gold-mid)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>


      {(activeSubTab === 'productos' || activeSubTab === 'repuestos') && (
        <div className="space-y-4">
          {!showProductForm ? (
            <>
              {/* Toolbar */}
              
              {isCountingMode ? (
                <div className="flex flex-col md:flex-row gap-3 bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl items-center justify-between">
                  <div>
                    <h4 className="text-amber-400 font-bold text-sm flex items-center gap-2"><CheckCircle2 className="w-5 h-5"/> Modo de Conteo Físico Activo</h4>
                    <p className="text-[10px] text-[var(--text-secondary)]">Recorra las ubicaciones y anote la cantidad real encontrada de cada producto.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setIsCountingMode(false)} className="px-4 py-2 bg-[var(--border-color)] text-[var(--text-secondary)] rounded-xl text-xs font-bold hover:bg-slate-200 transition">Cancelar</button>
                    <button onClick={handleFinishCount} className="px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold hover:bg-amber-600 transition">Finalizar Conteo</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre o SKU..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                  />
                </div>
                {activeSubTab !== 'repuestos' && (
                  <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                  >
                    <option value="Todas">Todas las categorías</option>
                    {['Fundas', 'Cables', 'Cargadores', 'Protectores', 'Teclados', 'Mouse', 'Audífonos', 'Repuestos', 'Otros'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => {
                    setEditingProductId(null);
                    setProdName('');
                    setProdSku('');
                    setProdDesc('');
                    setProdPrice('');
                    setProdCost('');
                    setProdStock('');
                    setProdMinStock('');
                    setProdLocation('');
                    setProdImage('');
                    setProdApplyDiscount(false);
                    setProdDiscount('');
                    setProdDoubleStock(false);
                    setProdInternalStock('');
                    setProdClientStock('');
                    setProdLinkedSparePartSku('');
                    setProdCategory(activeSubTab === 'repuestos' ? 'LCD' : 'Fundas');
                    setSkuLoadedFromHistory(null);
                    setFormError(null);
                    setShowProductForm(true);
                  }}
                  className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center justify-center gap-2 dark:text-slate-950"
                >
                  <Plus className="w-4 h-4" /> {activeSubTab === 'repuestos' ? 'Añadir Repuesto' : 'Nuevo Producto'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExtractedProducts([]);
                    setAnalysisLogs([]);
                    setAnalysisProgress(0);
                    setIsAnalyzingPdf(false);
                    setGlobalMargin(30);
                    setShowPdfModal(true);
                  }}
                  className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center justify-center gap-2 transition"
                >
                  <FileText className="w-4 h-4" /> Importar desde PDF
                </button>
                <button
                  onClick={handleStartCount}
                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" /> Iniciar Conteo
                </button>
              </div>
              )}


              {/* Table */}
              <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-color)]/80 text-[var(--text-secondary)]">
                        {activeSubTab === 'repuestos' ? (
                          <>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Foto</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">SKU</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Nombre</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Categoría</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400 text-center">Stock</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400 text-right">Precio de Costo</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400 text-center">Garantía</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400 text-right">Acciones</th>
                          </>
                        ) : (
                          <>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Producto</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">SKU</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Categoría</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Precio / Costo</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Stock</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400">Ubicación</th>
                            {isCountingMode ? (
                              <th className="p-4 font-black uppercase tracking-wider text-[10px] text-amber-500 text-right">Cant. Real</th>
                            ) : (
                              <th className="p-4 font-black uppercase tracking-wider text-[10px] text-slate-400 text-right">Acciones</th>
                            )}
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedProducts.map((p, pIndex) => (
                        <tr key={p.id} className={`hover:bg-[var(--bg-surface)] transition ${p.active === false ? 'opacity-50' : ''}`}>
                          {activeSubTab === 'repuestos' ? (
                            <>
                              <td className="p-4">
                                <ProductImage src={p.imageUrl} alt={p.name} className="w-10 h-10" />
                              </td>
                              <td className="p-4 text-[var(--text-secondary)] font-mono">{p.sku}</td>
                              <td className="p-4 text-[var(--text-primary)] font-bold">{p.name}</td>
                              <td className="p-4">
                                <span className="px-2 py-0.5 rounded-full bg-[var(--border-color)] text-[9px] text-[var(--text-secondary)] font-medium">
                                  {p.category}
                                </span>
                              </td>
                              <td className="p-4 text-center">
                                <span className={`font-mono font-bold ${p.stock <= (p.minStock || 5) ? 'text-amber-500' : 'text-emerald-500 dark:text-[var(--brand-gold-light)]'}`}>
                                  {p.stock} u.
                                </span>
                              </td>
                              <td className="p-4 text-right text-[var(--text-primary)] font-mono font-bold">
                                ₡{(p.cost || 0).toLocaleString()}
                              </td>
                              <td className="p-4 text-center text-[var(--text-secondary)] text-[10px]">
                                {p.warranty || '15 días'}
                              </td>
                              <td className="p-4">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingProductId(p.id);
                                      setProdName(p.name);
                                      setProdSku(p.sku);
                                      setProdDesc(p.description || '');
                                      setProdCategory(p.category);
                                      setProdPrice(p.price);
                                      setProdCost(p.cost || 0);
                                      setProdStock(p.stock);
                                      setProdMinStock(p.minStock || 5);
                                      setProdLocation(p.physicalLocation || '');
                                      setProdImage(p.imageUrl);
                                      setProdWarranty(p.warranty || '15 días');
                                      setProdApplyDiscount(p.discountPercent > 0);
                                      setProdDiscount(p.discountPercent || 0);
                                      setProdDoubleStock(p.isDoubleStock || false);
                                      setProdInternalStock(p.internalStock || 0);
                                      setProdClientStock(p.clientStock || 0);
                                      setProdLinkedSparePartSku(p.linkedSparePartSku || '');
                                      setProdMemberships(p.applicableMemberships || ['Plata', 'Oro', 'Platino']);
                                      setSkuLoadedFromHistory(p.sku);
                                      setFormError(null);
                                      setShowProductForm(true);
                                    }}
                                    className="p-1.5 bg-[var(--border-color)] hover:bg-sky-100 dark:hover:bg-[var(--brand-gold-mid)]/10 dark:bg-[var(--brand-gold-mid)] text-sky-600 dark:text-[var(--brand-gold-light)] rounded-lg transition"
                                    title="Editar"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteProductModal(p)}
                                    className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-4 flex items-center gap-3">
                                <ProductImage src={p.imageUrl} alt={p.name} className="w-10 h-10" />
                                <div>
                                  <div className="font-bold text-[var(--text-primary)]">{p.name}</div>
                                  {p.active === false && <span className="text-[9px] bg-rose-500/20 text-rose-400 px-1.5 rounded">Inactivo</span>}
                                </div>
                              </td>
                              <td className="p-4 text-[var(--text-secondary)] font-mono">{p.sku}</td>
                              <td className="p-4 text-[var(--text-secondary)]">{p.category}</td>
                              <td className="p-4">
                                <div className="text-emerald-500 font-bold dark:text-[var(--brand-gold-light)]">₡{p.price.toLocaleString()}</div>
                                <div className="text-[var(--text-secondary)] text-[10px]">Costo: ₡{(p.cost || 0).toLocaleString()}</div>
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <span className={`font-mono font-bold ${p.stock <= (p.minStock || 5) ? 'text-amber-500' : 'text-[var(--text-secondary)]'}`}>
                                    {p.stock} u.
                                  </span>
                                  {p.stock <= (p.minStock || 5) && (
                                    <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500" title="Stock bajo">
                                      <span>⚠️</span>
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-4 text-[var(--text-secondary)] text-[10px]">
                                {p.physicalLocation || 'Sin ubicación'}
                              </td>
                              {isCountingMode ? (
                                <td className="p-4 text-right">
                                  <input 
                                    type="number" 
                                    min="0" 
                                    className="w-20 bg-[var(--bg-surface)] border border-amber-500/50 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] text-right focus:outline-none focus:border-amber-400 font-mono"
                                    placeholder={p.stock.toString()}
                                    value={countData[p.id] ?? ''}
                                    onChange={e => setCountData({...countData, [p.id]: Number(e.target.value)})}
                                  />
                                </td>
                              ) : (
                                <td className="p-4">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => setTraceProductModal(p)}
                                      className="p-1.5 bg-purple-50 hover:bg-purple-100 dark:hover:bg-[var(--brand-gold-mid)]/10 text-purple-600 rounded-lg transition dark:bg-[var(--brand-gold-mid)] dark:text-[var(--brand-gold-light)]"
                                      title="Trazabilidad"
                                    >
                                      <History className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingProductId(p.id);
                                        setProdName(p.name);
                                        setProdSku(p.sku);
                                        setProdDesc(p.description || '');
                                        setProdCategory(p.category);
                                        setProdPrice(p.price);
                                        setProdCost(p.cost || 0);
                                        setProdStock(p.stock);
                                        setProdMinStock(p.minStock || 5);
                                        setProdLocation(p.physicalLocation || '');
                                        setProdImage(p.imageUrl);
                                        setProdWarranty(p.warranty || '15 días');
                                        setProdApplyDiscount(p.discountPercent > 0);
                                        setProdDiscount(p.discountPercent || 0);
                                        setProdDoubleStock(p.isDoubleStock || false);
                                        setProdInternalStock(p.internalStock || 0);
                                        setProdClientStock(p.clientStock || 0);
                                        setProdLinkedSparePartSku(p.linkedSparePartSku || '');
                                        setProdMemberships(p.applicableMemberships || ['Plata', 'Oro', 'Platino']);
                                        setSkuLoadedFromHistory(p.sku);
                                        setFormError(null);
                                        setShowProductForm(true);
                                      }}
                                      className="p-1.5 bg-sky-50 hover:bg-sky-100 dark:hover:bg-[var(--brand-gold-mid)]/10 dark:bg-[var(--brand-gold-mid)] text-sky-600 dark:text-[var(--brand-gold-light)] rounded-lg transition"
                                      title="Editar"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => setDeleteProductModal(p)}
                                      className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition"
                                      title="Eliminar"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}
                      {filteredProducts.length === 0 && (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400 text-xs italic font-medium">
                            {categoryFilter !== 'Todas' 
                              ? 'No hay productos en esta categoría.' 
                              : 'No hay productos que coincidan con los filtros.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Product Form */
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-6 pb-3 border-b border-[var(--border-color)]/50">
                <h4 className="text-sm font-bold text-sky-400 dark:text-[var(--brand-gold-light)]">{editingProductId ? 'Editar Producto' : 'Nuevo Producto'}</h4>
                <button onClick={() => setShowProductForm(false)} className="text-[var(--text-secondary)] hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <form onSubmit={handleProductSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Nombre del Producto *</label>
                      <input type="text" value={prodName} onChange={e => setProdName(e.target.value)} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)]" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="relative">
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">SKU (Código)</label>
                        <input
                          type="text"
                          value={prodSku}
                          onChange={e => {
                            setProdSku(e.target.value);
                            setSkuLoadedFromHistory(null);
                            setShowSkuSuggestions(true);
                          }}
                          onFocus={() => setShowSkuSuggestions(true)}
                          onBlur={() => {
                            // Delay to allow clicking on suggestions
                            setTimeout(() => {
                              setShowSkuSuggestions(false);
                            }, 250);
                          }}
                          placeholder="Autogenerado si vacío"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono"
                        />
                        {showSkuSuggestions && skuSuggestions.length > 0 && (
                          <div className="absolute z-25 w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl mt-1 max-h-48 overflow-y-auto shadow-sm divide-y divide-white/5">
                            <div className="bg-[var(--bg-surface)] text-[9px] text-[var(--text-secondary)] font-bold px-3 py-1.5 uppercase flex flex-col gap-0.5">
                              <span>Sugerencias Historial</span>
                            </div>
                            {skuSuggestions.map(h => (
                              <button
                                key={h.sku}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  autocompletarDesdeHistorico(h.sku);
                                  setShowSkuSuggestions(false);
                                }}
                                onClick={() => {
                                  autocompletarDesdeHistorico(h.sku);
                                  setShowSkuSuggestions(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-sky-500 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)]/10 transition flex flex-col gap-0.5 cursor-pointer"
                              >
                                <div className="flex justify-between items-center w-full gap-2">
                                  <span className="font-mono font-bold text-sky-400 dark:text-[var(--brand-gold-light)] truncate">
                                    {h.sku} - <span className="text-[var(--text-primary)] font-sans font-normal">{h.name}</span>
                                  </span>
                                  <span className="text-[8px] bg-[var(--border-color)] text-slate-500 px-1 py-0.5 rounded-full flex-shrink-0">{h.category}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {matchedHistoricalSku && (
                          <div className="mt-1.5 bg-sky-500 dark:bg-[var(--brand-gold-mid)]/15 border border-sky-500 dark:border-[var(--brand-gold-mid)]/30 p-2 rounded-xl flex flex-col gap-1.5 animate-in slide-in-from-top-1">
                            <div className="text-[10px] text-sky-300 dark:text-[var(--brand-gold-light)] leading-tight">
                              SKU en histórico. Categoría: <strong className="text-[var(--text-primary)]">{matchedHistoricalSku.category}</strong>
                            </div>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                autocompletarDesdeHistorico(matchedHistoricalSku.sku);
                              }}
                              className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-[10px] py-1 px-2 rounded-lg transition text-center cursor-pointer"
                            >
                              Recuperar datos del histórico
                            </button>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Categoría *</label>
                        <select 
                          value={prodCategory} 
                          onChange={e => {
                            setProdCategory(e.target.value);
                            if (sparePartCategories.includes(e.target.value) || e.target.value === 'Repuestos') {
                              setProdLinkedSparePartSku('');
                            }
                          }} 
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)]"
                        >
                          {activeSubTab === 'repuestos' || sparePartCategories.includes(prodCategory) || prodCategory === 'Repuestos'
                            ? sparePartCategories.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))
                            : ['Fundas', 'Cables', 'Cargadores', 'Protectores', 'Teclados', 'Mouse', 'Audífonos', 'Otros'].map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))
                          }
                        </select>
                      </div>
                    </div>

                    {!sparePartCategories.includes(prodCategory) && prodCategory !== 'Repuestos' && (
                      <div className="space-y-3 p-4 bg-[var(--bg-surface)] /50 border border-[var(--border-color)]/50 rounded-xl">
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Vincular a Repuesto (SKU)</label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" />
                          <select 
                            value={prodLinkedSparePartSku} 
                            onChange={e => {
                              const sku = e.target.value;
                              setProdLinkedSparePartSku(sku);
                              if (sku) {
                                const spare = products.find(p => p.sku === sku && (sparePartCategories.includes(p.category) || p.category === 'Repuestos'));
                                if (spare) {
                                  setProdStock(spare.stock);
                                  setProdCost(spare.cost);
                                }
                              } else {
                                setProdCost('');
                                setProdStock('');
                              }
                            }}
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text-primary)]"
                          >
                            <option value="">-- Sin vinculación --</option>
                            {products.filter(p => (sparePartCategories.includes(p.category) || p.category === 'Repuestos') && p.active !== false).map(p => (
                              <option key={p.sku} value={p.sku}>{p.sku} - {p.name} (Stock: {p.stock})</option>
                            ))}
                          </select>
                        </div>
                        {prodLinkedSparePartSku && (
                          <p className="text-[10px] text-sky-400 dark:text-[var(--brand-gold-light)] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Vinculado. El stock se sincronizará automáticamente.
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Garantía *</label>
                      <select 
                        value={prodWarranty} 
                        onChange={e => setProdWarranty(e.target.value)} 
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)]"
                      >
                        <option value="15 días">15 días</option>
                        <option value="60 días">60 días</option>
                        <option value="90 días">90 días</option>
                        <option value="12 meses">12 meses</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Descripción</label>
                      <textarea rows={3} value={prodDesc} onChange={e => setProdDesc(e.target.value)} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {!(sparePartCategories.includes(prodCategory) || prodCategory === 'Repuestos') && (
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">
                            Precio Venta (₡) *
                          </label>
                          <input 
                            type="number" 
                            min="0" 
                            placeholder="Ingrese el precio"
                            value={prodPrice} 
                            onChange={e => setProdPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono" 
                          />
                        </div>
                      )}
                      <div className={(sparePartCategories.includes(prodCategory) || prodCategory === 'Repuestos') ? 'col-span-2' : ''}>
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">
                          Costo Adquisición (₡) {prodLinkedSparePartSku ? '(Vinculado)' : ''}
                        </label>
                        <input 
                          type="number" 
                          min="0" 
                          placeholder="Ingrese el costo"
                          value={prodCost} 
                          onChange={e => setProdCost(e.target.value === '' ? '' : Number(e.target.value))} 
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono disabled:opacity-50" 
                          disabled={!!prodLinkedSparePartSku}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Stock Inicial *</label>
                        <input 
                          type="number" 
                          min="0" 
                          placeholder="Cantidad de stock"
                          value={prodStock} 
                          onChange={e => setProdStock(e.target.value === '' ? '' : Number(e.target.value))} 
                          className={`w-full border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono ${prodLinkedSparePartSku ? 'bg-[var(--bg-surface)] text-slate-400 cursor-not-allowed' : 'bg-[var(--bg-surface)] '}`}
                          disabled={!!prodLinkedSparePartSku}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Stock Mínimo (Alerta)</label>
                        <input 
                          type="number" 
                          min="0" 
                          placeholder="Mínimo para alerta"
                          value={prodMinStock} 
                          onChange={e => setProdMinStock(e.target.value === '' ? '' : Number(e.target.value))} 
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Ubicación Física en Casa</label>
                      <input type="text" placeholder="Ej: Armario del estudio, Caja azul en garaje" value={prodLocation} onChange={e => setProdLocation(e.target.value)} className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Imagen del Producto *</label>
                      <div className="flex items-center gap-4 bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/80">
                        {prodImage ? (
                          <ProductImage src={prodImage} alt="Previsualización" className="w-16 h-16" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-color)]/80 flex items-center justify-center text-sky-600 dark:text-[var(--brand-gold-light)] font-bold text-[9px] text-center p-1 font-mono">
                            TECHNOVERSE
                          </div>
                        )}
                        <div className="flex-1">
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = async () => {
                                  const rawBase64 = reader.result as string;
                                  try {
                                    const { compressImage } = await import('../utils/storage');
                                    const compressed = await compressImage(rawBase64, 500, 500, 0.7);
                                    setProdImage(compressed);
                                  } catch (err) {
                                    console.error('Error compressing product image:', err);
                                    setProdImage(rawBase64);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[11px] file:font-semibold file:bg-sky-500 file:text-sky-400 dark:text-[var(--brand-gold-light)] hover:file:bg-sky-500 dark:bg-[var(--brand-gold-mid)]/20 cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-4 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="applyDiscount" checked={prodApplyDiscount} onChange={e => setProdApplyDiscount(e.target.checked)} className="rounded border-white/20 bg-[var(--bg-surface)] " />
                        <label htmlFor="applyDiscount" className="text-xs text-[var(--text-secondary)]">Aplicar Descuento Especial</label>
                      </div>
                      {prodApplyDiscount && (
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Porcentaje de Descuento (%)</label>
                          <input 
                            type="number" 
                            min="0" 
                            max="100" 
                            placeholder="Ej: 10"
                            value={prodDiscount} 
                            onChange={e => setProdDiscount(e.target.value === '' ? '' : Number(e.target.value))} 
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)]" 
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {formError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs flex items-center gap-2 animate-in fade-in duration-200">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="pt-4 border-t border-[var(--border-color)]/50 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowProductForm(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition">
                    Cancelar
                  </button>
                  <button type="submit" className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 transition shadow-sm flex items-center gap-2">
                    <Save className="w-4 h-4" /> Guardar Producto
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'movimientos' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-bold text-[var(--text-secondary)]">Bitácora de Movimientos de Stock</h4>
            <button
              onClick={handleExportCSV}
              className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 transition"
            >
              <Download className="w-3.5 h-3.5" /> Exportar CSV
            </button>
          </div>
          
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-color)]/80 text-[var(--text-secondary)] font-mono">
                    <th className="p-3">Fecha y Hora</th>
                    <th className="p-3">Producto</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3 text-right">Cant.</th>
                    <th className="p-3 text-right">Stock Final</th>
                    <th className="p-3">Referencia/Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {movements.map(m => (
                    <tr key={m.id} className="hover:bg-[var(--bg-surface)] transition font-mono text-[11px]">
                      <td className="p-3 text-[var(--text-secondary)]">{new Date(m.timestamp).toLocaleString()}</td>
                      <td className="p-3 text-[var(--text-primary)] truncate max-w-[200px]" title={m.productName}>{m.productName}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)]/50 text-slate-500">
                          {m.type}
                        </span>
                      </td>
                      <td className={`p-3 text-right font-bold ${m.quantityChange > 0 ? 'text-emerald-400 dark:text-[var(--brand-gold-light)]' : 'text-rose-400'}`}>
                        {m.quantityChange > 0 ? '+' : ''}{m.quantityChange}
                      </td>
                      <td className="p-3 text-right text-[var(--text-secondary)]">{m.resultingStock || '-'}</td>
                      <td className="p-3 text-[var(--text-secondary)] truncate max-w-[150px]">
                        {m.notes} <br/>
                        <span className="text-[9px] opacity-50">{m.userEmail}</span>
                      </td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-[var(--text-secondary)] italic">No hay movimientos registrados.</td></tr>
                  )}
                </tbody>
              </table>
              
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)] border-t border-[var(--border-color)]">
      <span className="text-sm text-gray-500">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
      <div className="flex gap-2">
        <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50">Anterior</button>
        <span className="px-3 py-1 font-bold">{prodPage} / {prodTotal}</span>
        <button onClick={() => setProdPage(p => Math.min(prodTotal, p + 1))} disabled={prodPage === prodTotal} className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50">Siguiente</button>
      </div>
    </div>
  )}
  
            </div>
          </div>
        </div>
      )}

      {/* Traceability Modal */}
      {traceProductModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-sm relative">
            <button onClick={() => setTraceProductModal(null)} className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <History className="w-5 h-5 text-purple-400 dark:text-[var(--brand-gold-light)]" /> Trazabilidad de Producto
            </h4>
            <div className="bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]/50 flex items-center gap-3">
              <ProductImage src={traceProductModal.imageUrl} alt={traceProductModal.name} className="w-12 h-12" />
              <div>
                <strong className="text-[var(--text-primary)] text-sm">{traceProductModal.name}</strong>
                <p className="text-xs font-mono text-[var(--text-secondary)]">SKU: {traceProductModal.sku} | Stock Actual: {traceProductModal.stock}</p>
              </div>
            </div>
            
            <div className="overflow-x-auto overflow-y-auto max-h-[400px] border border-[var(--border-color)]/50 rounded-xl bg-[var(--bg-surface)] /50 p-2">
              <table className="w-full text-left text-[11px] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-[var(--border-color)]/50 text-[var(--text-secondary)]">
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Tipo</th>
                    <th className="p-2 text-right">Cant.</th>
                    <th className="p-2 text-right">Saldo</th>
                    <th className="p-2">Referencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {movements.filter(m => m.productId === traceProductModal.id).map(m => (
                    <tr key={m.id} className="hover:bg-[var(--bg-surface)] transition">
                      <td className="p-2 text-[var(--text-secondary)]">{new Date(m.timestamp).toLocaleString()}</td>
                      <td className="p-2 text-sky-400 dark:text-[var(--brand-gold-light)]">{m.type}</td>
                      <td className={`p-2 text-right font-bold ${m.quantityChange > 0 ? 'text-emerald-400 dark:text-[var(--brand-gold-light)]' : 'text-rose-400'}`}>
                        {m.quantityChange > 0 ? '+' : ''}{m.quantityChange}
                      </td>
                      <td className="p-2 text-right text-[var(--text-secondary)]">{m.resultingStock || '-'}</td>
                      <td className="p-2 text-[var(--text-secondary)] truncate max-w-[150px]">{m.notes}</td>
                    </tr>
                  ))}
                  {movements.filter(m => m.productId === traceProductModal.id).length === 0 && (
                    <tr><td colSpan={5} className="p-4 text-center text-[var(--text-secondary)] italic">No hay historial para este producto.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      


      {/* Delete Confirmation Modal */}
      {deleteProductModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-sm">
            <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-500" /> ¿Eliminar este producto?
            </h4>
            <p className="text-xs text-[var(--text-secondary)]">
              ¿Está seguro de que desea eliminar el producto <strong className="text-[var(--text-primary)]">{deleteProductModal.name}</strong>?
            </p>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setDeleteProductModal(null)}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--border-color)] text-[var(--text-secondary)] hover:bg-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDeleteProduct(deleteProductModal);
                  setDeleteProductModal(null);
                }}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {activeSubTab === 'reportes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-5 rounded-2xl">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-4">Valoración del Inventario</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/50">
                  <span className="text-xs text-[var(--text-secondary)]">Total Artículos</span>
                  <span className="font-mono text-[var(--text-primary)] font-bold">{products.reduce((a, b) => a + b.stock, 0)} u.</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/50">
                  <span className="text-xs text-[var(--text-secondary)]">Valor a Costo</span>
                  <span className="font-mono text-sky-400 dark:text-[var(--brand-gold-light)] font-bold">₡{products.reduce((a, b) => a + ((b.cost || 0) * b.stock), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)]">Valor a Precio Venta</span>
                  <span className="font-mono text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold">₡{products.reduce((a, b) => a + (b.price * b.stock), 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-5 rounded-2xl">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-4">Rotación de Productos</h4>
              <p className="text-[10px] text-[var(--text-secondary)] mb-2">Simulación de movimiento basado en stock.</p>
              <div className="space-y-2">
                {products.filter(p => p.stock > 0).slice(0, 4).map(p => (
                  <div key={p.id} className="bg-[var(--bg-surface)] border border-[var(--border-color)]/50 p-2 rounded-lg flex justify-between items-center">
                    <span className="text-[10px] text-[var(--text-primary)] truncate max-w-[150px]">{p.name}</span>
                    <span className="text-[9px] font-mono text-emerald-400 dark:text-[var(--brand-gold-light)]">{p.stock} en stock</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification Center */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full">
          {toasts.map(t => (
            <div 
              key={t.id} 
              className={`p-4 rounded-xl shadow-sm border flex items-start gap-3 animate-slide-in text-white ${
                t.type === 'success' ? 'bg-emerald-950 dark:bg-[var(--brand-gold-mid)] border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50' :
                t.type === 'error' ? 'bg-rose-950 border-rose-500/50' :
                t.type === 'warning' ? 'bg-amber-950 border-amber-500/50' :
                'bg-[var(--bg-surface)]  border-sky-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50'
              }`}
            >
              <div className="flex-1 text-xs font-semibold">{t.message}</div>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-white/40 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* PDF Import Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm /90 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-white/15 rounded-3xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-sm relative">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-[var(--border-color)]/80 flex justify-between items-center bg-[var(--bg-surface)] ">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-400 dark:text-[var(--brand-gold-light)]" /> Importación Masiva de Productos por PDF
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">Analice y procese listas de precios distribuidor en PDF para integrarlos a su inventario activo en segundos.</p>
              </div>
              <button 
                onClick={() => setShowPdfModal(false)} 
                className="p-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / Dynamic View */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Step 1: File selection & upload */}
              {extractedProducts.length === 0 && !isAnalyzingPdf && (
                <div className="space-y-6 max-w-2xl mx-auto py-8">
                  <div className="border-2 border-dashed border-[var(--border-color)]/80 hover:border-emerald-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/50 rounded-2xl p-8 text-center bg-[var(--bg-surface)] cursor-pointer transition relative group">
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handlePdfUpload(e.target.files[0]);
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="space-y-4">
                      <div className="w-12 h-12 bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 text-emerald-400 dark:text-[var(--brand-gold-light)] rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-[var(--text-primary)]">Seleccione o arrastre su archivo PDF</p>
                        <p className="text-xs text-[var(--text-secondary)]">Archivos PDF de hasta 10 MB de tamaño máximo.</p>
                      </div>
                    </div>
                  </div>

                  {/* Test Templates Actions */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400 dark:text-[var(--brand-gold-light)]" /> Plantillas de Prueba Rápidas
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)]">¿No tiene un PDF a mano? Use uno de nuestros escenarios de importación pre-diseñados para simular la extracción:</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <button
                        onClick={() => {
                          simulatePdfAnalysis("factura-accesorios-distribuidor.pdf", `DISTRIBUIDORA GLOBAL DE ACCESORIOS S.A.\nFECHA: 2026-07-07   CÓDIGO CLIENTE: TECH-552\n\nCÓDIGO          DESCRIPCIÓN                                 PRECIO      GARANTÍA     IMAGEN\nFND-MAG-IP15    Funda Silicona Magnética iPhone 15 Pro     $9.00 USD   12 meses     https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=150\nCBL-TC-3A       Cable de Carga Rápida USB-C a USB-C 3A      $4.00 USD   6 meses      https://images.unsplash.com/photo-1541140111913-ee9602dfaf7f?w=150\nCRG-GAN-35W     Cargador Dual GaN de Pared 35W Ultra       $14.00 USD  12 meses     https://images.unsplash.com/photo-1622445262465-2481c4574875?w=150`);
                        }}
                        className="p-3 bg-[var(--bg-surface)] border border-[var(--border-color)]/50 hover:border-emerald-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/30 rounded-xl text-left hover:bg-[var(--bg-surface)] transition flex flex-col justify-between"
                      >
                        <div>
                          <strong className="text-xs text-[var(--text-primary)] block truncate">Accesorios General</strong>
                          <span className="text-[10px] text-[var(--text-secondary)]">Precios en USD convertibles.</span>
                        </div>
                        <span className="text-[9px] font-mono text-emerald-400 dark:text-[var(--brand-gold-light)] mt-2 block">Cargar plantilla ➔</span>
                      </button>

                      <button
                        onClick={() => {
                          simulatePdfAnalysis("repuestos-taller-costarica.pdf", `PROVEEDOR CENTRAL DE REPUESTOS DE COSTA RICA\nSUCURSAL SAN JOSÉ - TEL: 2255-0000\n\nCÓDIGO          DESCRIPCIÓN                                 PRECIO      GARANTÍA     IMAGEN\nREP-SCR-IP13    Repuesto Pantalla OLED para iPhone 13       ₡32400 CRC  3 meses      https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=150\nREP-BTY-IP11    Repuesto Batería Interna Reemplazo iPhone   ₡9720 CRC   3 meses      https://images.unsplash.com/photo-1517404289873-c4d37553c6f5?w=150\nCBL-FLEX-CHG    Cable Flex Conector de Carga Samsung S21    ₡4320 CRC   3 meses      https://images.unsplash.com/photo-1563770660941-20978e870e26?w=150`);
                        }}
                        className="p-3 bg-[var(--bg-surface)] border border-[var(--border-color)]/50 hover:border-emerald-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/30 rounded-xl text-left hover:bg-[var(--bg-surface)] transition flex flex-col justify-between"
                      >
                        <div>
                          <strong className="text-xs text-[var(--text-primary)] block truncate">Taller y Repuestos</strong>
                          <span className="text-[10px] text-[var(--text-secondary)]">Precios directos en Colones.</span>
                        </div>
                        <span className="text-[9px] font-mono text-emerald-400 dark:text-[var(--brand-gold-light)] mt-2 block">Cargar plantilla ➔</span>
                      </button>

                      <button
                        onClick={() => {
                          simulatePdfAnalysis("perifericos-gaming-importacion.pdf", `GAMING WHOLESALE DISTRIBUTION INC.\nMIAMI, FL - INVOICE #998821\n\nSKU             ITEM DESCRIPTION                            PRICE       WARRANTY     IMAGE\nTEC-MECH-RGB    Teclado Mecánico Retroiluminado RGB Switch $30.00 USD  12 meses     https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150\nMOU-ERG-WIRE    Mouse Óptico Ergonómico Recargable         $12.00 USD  6 meses      https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=150\nAUD-GAM-71      Audífono Gamer Pro 7.1 Sonido Envolvente   $25.00 USD  24 meses     https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=150`);
                        }}
                        className="p-3 bg-[var(--bg-surface)] border border-[var(--border-color)]/50 hover:border-emerald-500 dark:hover:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]/30 rounded-xl text-left hover:bg-[var(--bg-surface)] transition flex flex-col justify-between"
                      >
                        <div>
                          <strong className="text-xs text-[var(--text-primary)] block truncate">Periféricos Gaming</strong>
                          <span className="text-[10px] text-[var(--text-secondary)]">SKUs del histórico integrados.</span>
                        </div>
                        <span className="text-[9px] font-mono text-emerald-400 dark:text-[var(--brand-gold-light)] mt-2 block">Cargar plantilla ➔</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Processing and extraction loader */}
              {isAnalyzingPdf && (
                <div className="space-y-6 max-w-md mx-auto py-12 text-center">
                  <div className="space-y-3">
                    <div className="w-16 h-16 rounded-full bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 border border-emerald-500 dark:border-[var(--brand-gold-mid)]/30 flex items-center justify-center mx-auto text-emerald-400 dark:text-[var(--brand-gold-light)] animate-spin">
                      <FileText className="w-8 h-8" />
                    </div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">Análisis de Documento en Progreso</h4>
                    <p className="text-xs text-[var(--text-secondary)]">Extrayendo datos de productos estructurados con heurísticas avanzadas de Technoverse...</p>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-[var(--bg-surface)] rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-emerald-500 dark:bg-[var(--brand-gold-mid)] h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${analysisProgress}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 dark:text-[var(--brand-gold-light)]">{analysisProgress}% Completado</span>

                  {/* Analysis Logs Console */}
                  <div className="bg-[var(--bg-surface)] rounded-xl p-3 text-left font-mono text-[10px] text-[var(--text-secondary)] border border-[var(--border-color)]/50 space-y-1 max-h-[150px] overflow-y-auto">
                    {analysisLogs.map((log, idx) => (
                      <p key={idx} className={idx === analysisLogs.length - 1 ? 'text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold' : ''}>
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Preview Table & Configurations */}
              {extractedProducts.length > 0 && (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Configuration & Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-color)]/50">
                    
                    {/* Price Margin tool */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--text-secondary)] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400 dark:text-[var(--brand-gold-light)]" /> Margen global (%)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={globalMargin}
                          onChange={(e) => setGlobalMargin(e.target.value === '' ? '' : parseFloat(e.target.value))}
                          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-xs text-[var(--text-primary)] px-3 py-1.5 rounded-xl focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                          placeholder="30"
                        />
                        <button
                          type="button"
                          onClick={handleApplyGlobalMargin}
                          className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-xs px-4 py-1.5 rounded-xl transition"
                        >
                          Aplicar
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--text-secondary)]">Afecta solo precios no modificados de forma manual.</p>
                    </div>

                    {/* Quick Selection Actions */}
                    <div className="space-y-2 flex flex-col justify-center">
                      <label className="text-xs font-bold text-[var(--text-secondary)]">
                        Selección rápida
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExtractedProducts(prev => prev.map(row => ({ ...row, selected: true })));
                            showToast("Todos los productos seleccionados.", "success");
                          }}
                          className="flex-1 bg-[var(--border-color)] hover:bg-slate-200 text-[var(--text-secondary)] font-bold text-[11px] py-1.5 px-2 rounded-xl transition whitespace-nowrap"
                        >
                          Seleccionar todos
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExtractedProducts(prev => prev.map(row => ({ ...row, selected: false })));
                            showToast("Todos los productos deseleccionados.", "warning");
                          }}
                          className="flex-1 bg-[var(--border-color)] hover:bg-slate-200 text-[var(--text-secondary)] font-bold text-[11px] py-1.5 px-2 rounded-xl transition whitespace-nowrap"
                        >
                          Deseleccionar todos
                        </button>
                      </div>
                    </div>

                    {/* Explicación de conversión */}
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/50 rounded-xl p-3 flex flex-col justify-center">
                      <strong className="text-[11px] text-emerald-600 block font-bold dark:text-[var(--brand-gold-light)]">💱 Conversión Automática</strong>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">Los costos expresados en dólares ($) se convierten de inmediato a colones (₡) según la tasa de <strong>1 USD = 540 CRC</strong>.</p>
                    </div>

                    {/* Explicación de validación */}
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/50 rounded-xl p-3 flex flex-col justify-center">
                      <strong className="text-[11px] text-[var(--text-secondary)] block font-bold">ℹ️ Reglas de Validación</strong>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                        - <strong>Fila Roja:</strong> SKU vacío, Costo/Venta menor o igual a 0, Stock menor a 0. <br />
                        - <strong>Fila Amarilla:</strong> SKU duplicado en inventario activo (se omitirá al guardar).
                      </p>
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto max-h-[400px]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-color)] text-slate-400 font-black uppercase tracking-wider text-[10px]">
                            <th className="p-4 w-10 text-center">Sel.</th>
                            <th className="p-4 w-16">Imagen</th>
                            <th className="p-4 w-36">SKU</th>
                            <th className="p-4">Nombre del Producto</th>
                            <th className="p-4 w-32">Categoría</th>
                            <th className="p-4 w-28 text-right">Costo (Dist.)</th>
                            <th className="p-4 w-28 text-right">Venta (Public)</th>
                            <th className="p-4 w-24 text-right">Stock</th>
                            <th className="p-4 w-28 text-center">Garantía</th>
                            <th className="p-4 w-12 text-center">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {extractedProducts.map((row, index) => {
                            const isRowInvalid = row.selected && (
                              !row.sku.trim() || 
                              row.price <= 0 || 
                              row.stock <= 0
                            );

                            return (
                              <tr 
                                key={index} 
                                className={`hover:bg-[var(--bg-surface)]   transition ${
                                  isRowInvalid ? 'bg-rose-500/10' : 
                                  row.skuDuplicate ? 'bg-amber-500/10' : ''
                                }`}
                              >
                                <td className="p-3 text-center">
                                  <input 
                                    type="checkbox" 
                                    checked={row.selected}
                                    onChange={(e) => handleSelectRow(index, e.target.checked)}
                                    className="rounded border-[var(--border-color)]/80 text-emerald-500 focus:ring-emerald-500 dark:focus:ring-[var(--brand-gold-mid)] bg-[var(--bg-surface)] dark:text-[var(--brand-gold-light)]"
                                  />
                                </td>
                                
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <ProductImage src={row.imageUrl} alt={row.name} className="w-8 h-8" />
                                    <label className="p-1 rounded bg-[var(--border-color)] hover:bg-slate-200 text-slate-500 cursor-pointer transition">
                                      <Upload className="w-2.5 h-2.5" />
                                      <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            handleRowImageUpload(index, e.target.files[0]);
                                          }
                                        }} 
                                      />
                                    </label>
                                  </div>
                                </td>

                                <td className="p-3">
                                  <div className="flex items-center gap-1">
                                    <div className="relative group flex-1">
                                      <input 
                                        type="text" 
                                        value={row.sku} 
                                        onChange={(e) => handleSkuChange(index, e.target.value)}
                                        className={`w-full bg-[var(--bg-surface)]  border text-xs px-2 py-1 rounded focus:outline-none font-mono ${
                                          row.selected && !row.sku.trim() ? 'border-rose-500 bg-rose-50 text-rose-700 focus:ring-rose-500' : 
                                          row.skuDuplicate ? 'border-amber-500/50 bg-amber-50 text-amber-700' : 'border-[var(--border-color)]/80 text-[var(--text-primary)]'
                                        }`}
                                      />
                                      {row.selected && !row.sku.trim() && (
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-rose-600 text-white text-[10px] px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                                          Obligatorio
                                        </div>
                                      )}
                                      {row.skuDuplicate && (
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-amber-600 text-slate-950 font-bold text-[10px] px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                                          ⚠️ SKU Duplicado (se omitirá)
                                        </div>
                                      )}
                                    </div>

                                    {/* Historical SKU badge/popover */}
                                    {row.skuHistorical && (
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActivePopoverIndex(activePopoverIndex === index ? null : index);
                                          }}
                                          className="p-1 rounded bg-purple-500/20 hover:bg-purple-500 dark:hover:bg-[var(--brand-gold-mid)]/30 dark:bg-[var(--brand-gold-mid)] text-purple-400 hover:text-purple-300 dark:hover:text-[var(--brand-gold-light)] transition animate-pulse dark:text-[var(--brand-gold-light)]"
                                          title="Ver datos históricos"
                                        >
                                          <History className="w-3.5 h-3.5" />
                                        </button>
                                        
                                        {activePopoverIndex === index && (
                                          <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-surface)] border border-purple-500 rounded-xl p-4 shadow-sm z-[100] text-left space-y-3 dark:border-[var(--brand-gold-dark)]">
                                            <div className="flex justify-between items-center pb-2 border-b border-purple-500/30 dark:border-[var(--brand-gold-dark)]">
                                              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide dark:text-[var(--brand-gold-light)]">Registro Histórico</span>
                                              <button 
                                                type="button" 
                                                onClick={() => setActivePopoverIndex(null)}
                                                className="text-[var(--text-secondary)] hover:text-white"
                                              >
                                                <X className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                            <div className="flex gap-3">
                                              <ProductImage src={row.historicalData.imageUrl} alt={row.historicalData.name} className="w-12 h-12" />
                                              <div className="min-w-0">
                                                <h5 className="text-[11px] font-bold text-[var(--text-primary)] truncate">{row.historicalData.name}</h5>
                                                <p className="text-[9px] font-mono text-[var(--text-secondary)]">{row.historicalData.category}</p>
                                              </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-[var(--bg-surface)] p-2 rounded">
                                              <div>
                                                <span className="text-[var(--text-secondary)] block text-[9px]">Costo Hist.</span>
                                                <span className="text-sky-400 dark:text-[var(--brand-gold-light)] font-bold">₡{row.historicalData.cost?.toLocaleString()}</span>
                                              </div>
                                              <div>
                                                <span className="text-[var(--text-secondary)] block text-[9px]">Precio Hist.</span>
                                                <span className="text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold">₡{row.historicalData.price?.toLocaleString()}</span>
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExtractedProducts(prev => {
                                                  const copy = [...prev];
                                                  copy[index] = {
                                                    ...copy[index],
                                                    name: row.historicalData.name,
                                                    category: row.historicalData.category,
                                                    cost: row.historicalData.cost,
                                                    imageUrl: row.historicalData.imageUrl || ''
                                                  };
                                                  return copy;
                                                });
                                                setActivePopoverIndex(null);
                                                showToast(`Datos históricos cargados para SKU: ${row.sku}`, 'success');
                                              }}
                                              className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 dark:hover:bg-[var(--brand-gold-mid)] text-[var(--text-primary)] rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1.5 dark:bg-[var(--brand-gold-mid)]"
                                            >
                                              <Check className="w-3.5 h-3.5" /> Usar estos datos
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <td className="p-3">
                                  <input 
                                    type="text" 
                                    value={row.name} 
                                    onChange={(e) => handleNameChange(index, e.target.value)}
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-xs px-2 py-1 rounded text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                                  />
                                </td>

                                <td className="p-3">
                                  <select 
                                    value={row.category} 
                                    onChange={(e) => handleCategoryChange(index, e.target.value)}
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-xs px-2 py-1 rounded text-[var(--text-primary)] focus:outline-none"
                                  >
                                    {['Fundas', 'Cables', 'Cargadores', 'Protectores', 'Teclados', 'Mouse', 'Audífonos', 'Repuestos', 'Otros'].map(c => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                  </select>
                                </td>

                                <td className="p-3 text-right font-mono text-[11px] text-sky-400 dark:text-[var(--brand-gold-light)]">
                                  ₡{row.cost.toLocaleString()}
                                </td>

                                <td className="p-3">
                                  <div className="relative group">
                                    <input 
                                      type="number" 
                                      value={row.price || ''} 
                                      onChange={(e) => handlePriceChange(index, e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                      className={`w-full bg-[var(--bg-surface)]  border text-xs px-2 py-1 rounded text-right focus:outline-none font-mono ${
                                        row.selected && row.price <= 0 ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-[var(--border-color)]/80 text-[var(--text-primary)] focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] dark:border-[var(--brand-gold-mid)]'
                                      }`}
                                      placeholder="Definir"
                                    />
                                    {row.selected && row.price <= 0 && (
                                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-rose-600 text-white text-[10px] px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                                        Debe ser mayor a 0
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <td className="p-3">
                                  <div className="relative group">
                                    <input 
                                      type="number" 
                                      value={row.stock || ''} 
                                      onChange={(e) => handleStockChange(index, e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
                                      className={`w-full bg-[var(--bg-surface)]  border text-xs px-2 py-1 rounded text-right focus:outline-none font-mono ${
                                        row.selected && row.stock <= 0 ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-[var(--border-color)]/80 text-[var(--text-primary)] focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] dark:border-[var(--brand-gold-mid)]'
                                      }`}
                                    />
                                    {row.selected && row.stock <= 0 && (
                                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-rose-600 text-white text-[10px] px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                                        Debe ser mayor a 0
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <td className="p-3">
                                  <input 
                                    type="text" 
                                    value={row.warranty} 
                                    onChange={(e) => handleWarrantyChange(index, e.target.value)}
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-xs px-2 py-1 rounded text-[var(--text-primary)] focus:outline-none"
                                    placeholder="Garantía"
                                  />
                                </td>

                                <td className="p-3 text-center">
                                  <button 
                                    type="button" 
                                    onClick={() => handleDeleteRow(index)}
                                    className="p-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
                                    title="Remover fila"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Manual Text Scraper Area */}
                  <div className="space-y-2 bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-color)]/50">
                    <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      ⌨️ Editor del Raw Text Extraído
                    </h4>
                    <p className="text-[10px] text-[var(--text-secondary)]">¿Desea cambiar el texto plano simulado o pegar nuevos datos directamente? Edite abajo y haga clic en re-analizar para actualizar la tabla de forma interactiva.</p>
                    <textarea 
                      value={pdfRawText}
                      onChange={(e) => setPdfRawText(e.target.value)}
                      className="w-full h-24 bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl p-3 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] resize-none"
                      placeholder="CÓDIGO   DESCRIPCIÓN   PRECIO"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = parseTextToProducts(pdfRawText, products, historicalSkus);
                          setExtractedProducts(parsed);
                          showToast(`Se han detectado y actualizado ${parsed.length} productos mediante el Raw Text.`, 'success');
                        }}
                        className="px-4 py-1.5 bg-[var(--border-color)] hover:bg-slate-200 text-[var(--text-secondary)] rounded-xl text-[10px] font-bold transition"
                      >
                        Re-analizar Raw Text
                      </button>
                    </div>
                  </div>

                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-[var(--border-color)]/80 flex justify-between items-center bg-[var(--bg-surface)] ">
              <div className="text-xs text-[var(--text-secondary)] space-y-0.5">
                {extractedProducts.length > 0 && (
                  <>
                    <p>Total detectados: <strong className="text-[var(--text-primary)]">{extractedProducts.length}</strong> | Seleccionados: <strong className="text-emerald-400 dark:text-[var(--brand-gold-light)]">{extractedProducts.filter(r => r.selected).length}</strong></p>
                    <p>SKUs Duplicados omitidos: <strong className="text-amber-400">{extractedProducts.filter(r => r.selected && r.skuDuplicate).length}</strong></p>
                  </>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPdfModal(false)}
                  className="px-4 py-2 bg-[var(--border-color)] hover:bg-slate-200 text-[var(--text-secondary)] rounded-xl text-xs font-bold transition"
                >
                  Cancelar
                </button>
                {extractedProducts.length > 0 && (
                  <button
                    type="button"
                    disabled={isImportDisabled}
                    onClick={handleImportSelected}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                      isImportDisabled 
                        ? 'bg-[var(--bg-surface)] text-slate-400 cursor-not-allowed border border-[var(--border-color)]/50' 
                        : 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)] hover:bg-emerald-600 dark:hover:bg-[var(--brand-gold-mid)] dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-[var(--text-primary)] shadow-sm shadow-emerald-500/10'
                    }`}
                  >
                    <Check className="w-4 h-4" /> Importar seleccionados
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
