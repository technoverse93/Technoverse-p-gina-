import React, { useState, useEffect, useMemo } from 'react';
import { Product, InventoryMovement, MarketingRequest } from '../types';
import { getDB, saveDB, addAuditLog, compressImage } from '../utils/storage';
import { supabase } from '../supabaseClient';
import VinculacionComponentes from './admin/VinculacionComponentes';
import { CATEGORIAS_INSUMO, esInsumo, CATEGORIAS_TIENDA, CATEGORIAS_REPUESTO, coincideCategoria } from '../utils/categorias';
import { CustomSelect } from './CustomSelect';
import { useToast } from './ui/Overlays';
import { 
  Package, Plus, Edit, Trash2, Search, Filter, History, MapPin, 
  Box, FileText, AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronRight, X, Image as ImageIcon, Save, Download,
  Upload, Check, AlertCircle, Sparkles, Send, Boxes
} from 'lucide-react';

// CAABYS genérico ("Otros servicios n.c.p."), respaldo mientras se clasifica
// cada producto con su código real de 13 dígitos del catálogo de Hacienda.
export const DEFAULT_CAABYS = '8399000000000';

// Stock inicial que trae cada fila del importador de listas de precios. Una
// lista de proveedor no dice cuántas unidades hay físicamente, así que 0
// sería lo exacto — pero en la práctica el negocio siempre pide una cantidad
// aproximada de partida en vez de arrancar todo en cero. Sigue siendo
// editable por fila antes de importar.
const STOCK_INICIAL_IMPORTACION = 10;

// Aviso de stock bajo con el que arranca cada producto importado. Con el
// disparador `archivar_producto_agotado()` (Supabase) desactivando y
// archivando cualquier producto que llegue a 0, un aviso de 1 avisa con
// margen suficiente para reabastecer antes de que el trigger lo retire.
const STOCK_MINIMO_AVISO_IMPORTACION = 1;

const TECHNOVERSE_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUwIDE1MCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTUwIiBmaWxsPSIjZjhmOWZhIi8+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzBmMTcyYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmF0LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iIzM4YmRmZiI+VEVDSE5PVkVSU0U8L3RleHQ+PC9zdmc+";

function ProductImage({ src, alt, className = "w-10 h-10" }: { src?: string, alt: string, className?: string }) {
  const [error, setError] = React.useState(false);

  if (!src || error) {
    return (
      <div className={`${className} rounded-lg bg-[var(--bg-surface)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)]`}>
        <Package className="w-5 h-5 opacity-50" />
      </div>
    );
  }

  return (
    <img 
      src={src} 
      alt={alt} 
      className={`${className} product-thumb rounded-lg object-contain p-0.5 border border-[var(--border-color)]/80`}
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
  /** La línea traía "agotado"/"(agotado)": el proveedor no tiene existencias.
   *  Se detecta y se deja SIN seleccionar por defecto — no tiene sentido
   *  registrar en el catálogo algo que no se puede comprar todavía. */
  agotado: boolean;
}

interface InventarioControlProps {
  currentUser: any;
  onDataChanged: () => void;
  defaultSubTab?: 'productos' | 'movimientos' | 'reportes' | 'repuestos' | 'insumos';
  onTabChange?: (tab: 'productos' | 'movimientos' | 'reportes' | 'repuestos' | 'insumos') => void;
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
  const toast = useToast();
  const [activeSubTab, setActiveSubTab] = useState<'productos' | 'movimientos' | 'reportes' | 'repuestos' | 'insumos'>(defaultSubTab);

  useEffect(() => {
    setActiveSubTab(defaultSubTab);
  }, [defaultSubTab]);

  // Database
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [marketingRequests, setMarketingRequests] = useState<MarketingRequest[]>([]);
  const [igImageDraft, setIgImageDraft] = useState<Record<string, string>>({});

  // Product Form State
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodCategory, setProdCategory] = useState<string>('Accesorios');
  const [prodPrice, setProdPrice] = useState<number | ''>('');
  const [prodCost, setProdCost] = useState<number | ''>('');
  const [prodStock, setProdStock] = useState<number | ''>('');
  const [prodMinStock, setProdMinStock] = useState<number | ''>('');
  const [prodLocation, setProdLocation] = useState('');
  const [prodImage, setProdImage] = useState('');
  const [prodApplyDiscount, setProdApplyDiscount] = useState(false);
  const [prodDiscount, setProdDiscount] = useState<number | ''>('');

  // Publicación promocional en Instagram al guardar el producto.
  const [prodCreateIgPost, setProdCreateIgPost] = useState(false);
  const [igScheduleMode, setIgScheduleMode] = useState<'manana' | 'tarde' | 'personalizado'>('manana');
  const [igScheduleDate, setIgScheduleDate] = useState('');
  const [igScheduleTime, setIgScheduleTime] = useState('');
  const [prodDoubleStock, setProdDoubleStock] = useState(false);
  const [prodInternalStock, setProdInternalStock] = useState<number | ''>('');
  const [prodClientStock, setProdClientStock] = useState<number | ''>('');
  const [prodLinkedSparePartSku, setProdLinkedSparePartSku] = useState('');
  // Solo se usa con insumos: los deja aparecer en el catálogo público.
  const [prodVisibleEnTienda, setProdVisibleEnTienda] = useState(false);
  const [prodWarranty, setProdWarranty] = useState('15 días');
  // CAABYS (Catálogo de Bienes y Servicios de Hacienda): código de 13 dígitos
  // requerido por línea en la Factura/Tiquete Electrónico v4.3. '8399000000000'
  // ("Otros servicios n.c.p.") es el respaldo genérico mientras se clasifica
  // cada producto real; coincide con el DEFAULT de la columna en Supabase.
  const [prodCaabys, setProdCaabys] = useState('');
  const [showSkuSuggestions, setShowSkuSuggestions] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Candado contra envíos dobles: un segundo toque en "Guardar Producto"
  // mientras el primero todavía viaja a Supabase volvía a ejecutar todo el
  // handler y, en la rama de "SKU existente", sumaba el stock una vez más.
  const [savingProduct, setSavingProduct] = useState(false);
  // Diagnóstico visible de la imagen elegida: evita adivinar si un PNG perdió
  // la transparencia por culpa de la app o porque el archivo nunca la tuvo.
  const [prodImageHasAlpha, setProdImageHasAlpha] = useState<boolean | null>(null);
  const [removingBg, setRemovingBg] = useState(false);

  // El indicador de transparencia se deriva SIEMPRE de la imagen actual, así
  // no queda desactualizado al editar otro producto o al limpiar el formulario.
  useEffect(() => {
    let cancelado = false;
    if (!prodImage) {
      setProdImageHasAlpha(null);
      return;
    }
    import('../utils/storage')
      .then(({ imageHasTransparency }) => imageHasTransparency(prodImage))
      .then((tiene) => { if (!cancelado) setProdImageHasAlpha(tiene); })
      .catch(() => { if (!cancelado) setProdImageHasAlpha(null); });
    return () => { cancelado = true; };
  }, [prodImage]);
  const [skuLoadedFromHistory, setSkuLoadedFromHistory] = useState<string | null>(null);
  const [skuAutoGenerated, setSkuAutoGenerated] = useState(true);
  const [skuSeed, setSkuSeed] = useState(() => Math.floor(1000 + Math.random() * 9000));

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [isCountingMode, setIsCountingMode] = useState(false);
  const [countData, setCountData] = useState<Record<string, number>>({});
  
  // Modals
  const [traceProductModal, setTraceProductModal] = useState<Product | null>(null);
  const sparePartCategories = CATEGORIAS_REPUESTO;
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
  const [extractedProducts, setExtractedProducts] = useState<ExtractedRow[]>([]);
  const [globalMargin, setGlobalMargin] = useState<number | ''>(''); // default margin 30%
  // Categoría aplicada a TODO el lote importado. Una lista de precios de
  // proveedor casi siempre es de una sola familia (pantallas, por ejemplo),
  // así que adivinar la categoría línea por línea —como hacía la versión
  // anterior con palabras clave en el nombre— fallaba justo en los casos
  // reales: "Honor X6B Con marco ₡8 000" no tiene ninguna palabra que
  // delate que es un repuesto. Se elige una vez para todo el lote y queda
  // editable fila por fila igual que la categoría de un producto normal.
  const [globalCategory, setGlobalCategory] = useState<string>('LCD');
  const [pdfReadProgress, setPdfReadProgress] = useState<string>('');
  const [pdfRawText, setPdfRawText] = useState<string>('');
  const [activePopoverIndex, setActivePopoverIndex] = useState<number | null>(null);

  const loadData = () => {
    const db = getDB();
    setProducts(db.products || []);
    setMovements(db.inventory_movements || []);
    setMarketingRequests(db.marketing_requests || []);
  };

  /** "Mañana"/"Tarde" son horarios fijos (9 a.m. / 3 p.m.) del día siguiente;
   *  si esa hora ya pasó hoy, igual apunta a mañana para no programar en el
   *  pasado. "Personalizado" usa la fecha/hora exactas que eligió el admin. */
  function calcularFechaProgramada(modo: 'manana' | 'tarde' | 'personalizado', fecha: string, hora: string): string {
    if (modo === 'personalizado' && fecha) {
      const d = new Date(`${fecha}T${hora || '09:00'}:00`);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const base = new Date();
    base.setDate(base.getDate() + 1);
    base.setHours(modo === 'tarde' ? 15 : 9, 0, 0, 0);
    return base.toISOString();
  }

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

  /**
   * Convierte texto plano (extraído de un PDF real o pegado a mano) en
   * filas de importación de "Nombre + Precio", que es como en realidad
   * vienen las listas de precios de un proveedor — SIN código de SKU
   * propio (ese lo inventa el sistema, igual que al dar de alta un
   * producto a mano) y con el precio en cualquier formato costarricense
   * habitual: "₡85 000" (miles con espacio), "₡8.500", "₡8,500" o "$9.00".
   *
   * FALLO CORREGIDO (probado con una lista real de un distribuidor): la
   * versión anterior exigía encontrar un "código" de al menos 5 caracteres
   * en la línea antes de intentar leer nada, y su regex de precio no
   * reconocía los miles separados por ESPACIO. Contra una lista real
   * —renglones como "A01 ₡8 000" o "Honor X6B Con marco ₡10 000", sin
   * ningún código— casi todas las líneas se descartaban en silencio o el
   * precio se leía mal ("₡85 000" se entendía como 85, no como 85000).
   */
  const parseTextToProducts = (
    text: string,
    productsInDb: Product[],
    historicalSkus: any[],
    defaultCategory: string
  ): ExtractedRow[] => {
    const lines = text.split('\n');
    const results: ExtractedRow[] = [];

    // Limpia un monto ya aislado del símbolo de moneda. Los miles pueden
    // venir separados por espacio, coma o punto; el decimal (si lo hay)
    // siempre son exactamente 2 dígitos pegados al final ("9.00", "8,50").
    const parsePriceHelper = (str: string): number => {
      let clean = str.trim();
      const decimalMatch = clean.match(/[.,](\d{2})$/);
      let decimales = '';
      if (decimalMatch) {
        decimales = '.' + decimalMatch[1];
        clean = clean.slice(0, decimalMatch.index);
      }
      clean = clean.replace(/[.,\s]/g, '');
      return parseFloat(clean + decimales) || 0;
    };

    // Símbolo/código de moneda + monto, en cualquiera de los dos órdenes en
    // que un proveedor suele escribirlo.
    const priceRegex = /(?:[₡$]|CRC|USD)\s*(\d[\d.,\s]*\d|\d)|(\d[\d.,\s]*\d|\d)\s*(?:CRC|USD)\b/i;

    let seed = Math.floor(1000 + Math.random() * 9000);

    lines.forEach((line) => {
      // Varios espacios seguidos (columnas de una tabla mal copiadas) se
      // colapsan a uno: si no, "Honor   X6B   ₡8000" deja espacios dobles
      // sueltos en el nombre final.
      const trimmed = line.replace(/\s+/g, ' ').trim();
      if (!trimmed) return;

      const match = trimmed.match(priceRegex);
      if (!match) return; // sin precio reconocible: no es una línea de artículo (encabezado, título, etc.)

      const valStr = match[1] || match[2];
      const costValue = parsePriceHelper(valStr);
      if (costValue <= 0) return;

      const esUsd = /\$|USD/i.test(match[0]);
      const finalCost = esUsd ? Math.round(costValue * 540) : Math.round(costValue);

      // El nombre es todo lo que queda de la línea al quitarle el precio.
      let nameText = trimmed.replace(match[0], '');

      // Garantía: "1 mes de garantía", "30 dias naturales de garantia", etc.
      // Se extrae a su propio campo — dejarla dentro del nombre duplicaría
      // la información y ensuciaría el catálogo.
      const warrantyMatch = nameText.match(/(\d+\s*(?:meses|años|mes|año|días|dias)(?:\s+de\s+garant[ií]a)?)/i);
      let warranty = '3 meses';
      if (warrantyMatch) {
        warranty = warrantyMatch[1].replace(/\s+de\s+garant[ií]a/i, '').trim();
        nameText = nameText.replace(warrantyMatch[0], '');
      }

      // "Agotado"/"(Agotado)": el proveedor no tiene existencias de ese
      // modelo ahora mismo. Se detecta para no importarlo seleccionado por
      // defecto, y se limpia del nombre.
      const agotado = /agotado/i.test(nameText);
      nameText = nameText.replace(/[([]?\s*agotado\s*[)\]]?/gi, '');

      // URL de imagen, si el proveedor la incluye en la misma línea.
      const urlMatch = nameText.match(/(https?:\/\/[^\s]+)/i);
      let imageUrl = '';
      if (urlMatch) {
        imageUrl = urlMatch[1].trim();
        nameText = nameText.replace(urlMatch[0], '');
      }

      const name = nameText
        .replace(/[\s\t,;|-]+/g, ' ')
        .replace(/^\s*[-:|;,]\s*/, '')
        .replace(/\s*[-:|;,]\s*$/, '')
        .trim();

      // Sin nombre reconocible, la línea es basura (número de página,
      // encabezado suelto, etc.) y no un artículo real: se descarta.
      if (!name || name.length < 2) return;

      const category = defaultCategory;

      // El SKU del proveedor no sirve de nada aquí (no es el código interno
      // de Technoverse), así que se genera con la misma fórmula que usa el
      // alta manual. `seed` sube en cada fila, así que dos variantes con
      // nombres parecidos ("A01" / "A01 con marco") nunca chocan entre sí
      // dentro del mismo lote.
      const sku = buildAutoSku(name, category, seed);
      seed += 1;

      const skuDuplicate = productsInDb.some(p => p && p.sku && p.sku.toLowerCase() === sku.toLowerCase() && p.active !== false);
      const histData = historicalSkus.find(h => h && h.sku && h.sku.toLowerCase() === sku.toLowerCase());

      results.push({
        sku,
        name,
        category,
        cost: finalCost,
        price: 0, // Precio de venta: se define aquí (o con el margen global), nunca se adivina.
        // Aproximación pedida para este importador: 10 unidades por repuesto
        // en vez de partir de 0. Sigue siendo editable fila por fila (y
        // opcional: no es obligatorio corregirlo para poder importar) — es
        // solo un punto de partida razonable mientras se hace el conteo real.
        stock: STOCK_INICIAL_IMPORTACION,
        imageUrl,
        warranty,
        selected: !agotado,
        isPriceManuallyEdited: false,
        skuDuplicate,
        skuHistorical: !!histData,
        historicalData: histData || null,
        agotado,
      });
    });

    return results;
  };

  /**
   * Lee el texto real del archivo (PDF o texto plano) y lo pasa por el
   * parser. Antes esto era pura fachada: `handlePdfUpload` ignoraba el
   * archivo subido y elegía uno de tres textos de muestra según el NOMBRE
   * del archivo — nunca leyó un PDF de verdad. Se reemplaza por extracción
   * real (`extractTextFromFile`, pdf.js para PDF / FileReader para .txt).
   */
  const analizarArchivo = async (textoExtraido: string) => {
    setIsAnalyzingPdf(false);
    setPdfRawText(textoExtraido);
    if (!textoExtraido.trim()) {
      showToast(
        'No se pudo leer texto de ese archivo. Si es un PDF escaneado (una foto de la lista, sin texto real detrás), pruebe con la lista en formato de texto plano, o péguela a mano abajo.',
        'error'
      );
      setExtractedProducts([]);
      return;
    }
    const parsed = parseTextToProducts(textoExtraido, products, historicalSkus, globalCategory);
    setExtractedProducts(parsed);
    if (parsed.length === 0) {
      showToast('No se detectó ningún artículo con precio en el archivo. Puede pegar o corregir el texto a mano en el editor de abajo.', 'warning');
    } else {
      const agotados = parsed.filter(r => r.agotado).length;
      showToast(
        `Se detectaron ${parsed.length} artículo(s) listos para revisar.` +
        (agotados > 0 ? ` ${agotados} marcados "agotado" quedaron sin seleccionar.` : ''),
        'success'
      );
    }
  };

  const handlePdfUpload = async (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast("El archivo excede el límite de 10 MB.", "error");
      return;
    }

    setExtractedProducts([]);
    setPdfRawText('');
    setIsAnalyzingPdf(true);
    setPdfReadProgress('Leyendo el archivo…');
    try {
      const { extractTextFromFile } = await import('../utils/pdfText');
      const texto = await extractTextFromFile(file);
      await analizarArchivo(texto);
    } catch (e: any) {
      setIsAnalyzingPdf(false);
      showToast(`No se pudo leer el archivo: ${e?.message || e}`, 'error');
    } finally {
      setPdfReadProgress('');
    }
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
        
        const activeDuplicate = db.products.some(p => p && p.sku && p.sku.toLowerCase() === trimmedSku.toLowerCase() && p.active !== false);
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
          minStock: STOCK_MINIMO_AVISO_IMPORTACION,
          physicalLocation: 'Bodega Central',
          imageUrl: row.imageUrl || TECHNOVERSE_PLACEHOLDER,
          discountPercent: 0,
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
      const rawBase64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(rawBase64, 600, 600, 0.75);
      setExtractedProducts(prev => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          imageUrl: compressed
        };
        return copy;
      });
      showToast("Imagen cargada con éxito para la fila.", "success");
    } catch (e) {
      console.error(e);
      showToast("Error al procesar la imagen", "error");
    }
  };

  const handleSkuChange = (index: number, val: string) => {
    setExtractedProducts(prev => {
      const copy = [...prev];
      const db = getDB();
      const trimmedVal = val.trim().toUpperCase();
      const activeDuplicate = db.products.some(p => p && p.sku && p.sku.toLowerCase() === trimmedVal.toLowerCase() && p.active !== false);
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

  // El stock NO es obligatorio: una lista de precios registra el CATÁLOGO
  // (qué existe y a qué costo), no una entrega física. Exigir stock > 0 en
  // cada fila obligaría a escribir una cantidad a mano en potencialmente
  // cientos de filas antes de poder importar nada — exactamente lo que
  // este importador existe para evitar. El stock real se cuenta y se carga
  // aparte, cuando el pedido físico llega.
  const isImportDisabled = extractedProducts.length === 0 || extractedProducts.some(row =>
    row.selected && (
      !row.sku.trim() ||
      row.price <= 0 ||
      row.stock < 0
    )
  );

  // Handlers
  const buildAutoSku = (name: string, category: string, seed: number) => {
    const catCode = (category || 'GEN').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase() || 'GEN';
    const nameCode = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w.substring(0, 4).toUpperCase())
      .join('');
    return nameCode ? `${catCode}-${nameCode}-${seed}` : '';
  };

  // Autorrellenado reactivo del SKU: solo para productos nuevos y solo
  // mientras el usuario no haya escrito su propio SKU a mano.
  useEffect(() => {
    if (editingProductId) return;
    if (!skuAutoGenerated) return;
    setProdSku(buildAutoSku(prodName, prodCategory, skuSeed));
  }, [prodName, prodCategory, editingProductId, skuAutoGenerated, skuSeed]);

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
      setSkuAutoGenerated(false);
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
    if (!h) return false;
    const isSpare = h.category === 'Repuestos' || sparePartCategories.includes(h.category);
    const isInsumo = esInsumo(h.category);
    if (activeSubTab === 'repuestos' && !isSpare) return false;
    if (activeSubTab === 'insumos' && !isInsumo) return false;
    if (activeSubTab === 'productos' && (isSpare || isInsumo)) return false;

    if (prodSku) {
      const q = prodSku.toLowerCase();
      const s = h && h.sku ? h.sku.toLowerCase() : '';
      const n = h && h.name ? h.name.toLowerCase() : '';
      return s.includes(q) || n.includes(q);
    }
    return true;
  });

  // Al editar un producto existente NO se ofrece "recuperar del histórico":
  // su propio SKU ahora vive en el catálogo (el autorrelleno lo conserva) y
  // mostrar el aviso sobre el mismo producto que se edita sería confuso.
  const matchedHistoricalSku = !editingProductId && prodSku.trim() && (!skuLoadedFromHistory || (skuLoadedFromHistory && skuLoadedFromHistory.toLowerCase() !== prodSku.toLowerCase().trim()))
    ? historicalSkus.find(h => h && h.sku && h.sku.toLowerCase() === prodSku.toLowerCase().trim())
    : null;

  // Registra/actualiza un producto en el catálogo histórico (fuente del
  // autorrelleno por SKU). Es un UPSERT: si el SKU ya está, refresca sus
  // datos; si no, lo agrega. NUNCA borra. Así el autorrelleno conserva de
  // forma permanente todo lo que se ha agregado, y deja de "encogerse".
  const upsertHistoricalSku = (db: any, p: any) => {
    if (!p || !p.sku) return;
    if (!db.historical_skus) db.historical_skus = [];
    const entry = {
      sku: p.sku,
      name: p.name || '',
      category: p.category || '',
      price: p.price || 0,
      cost: p.cost || 0,
      imageUrl: p.imageUrl || ''
    };
    const hIdx = db.historical_skus.findIndex(
      (h: any) => h && h.sku && h.sku.toLowerCase() === String(p.sku).toLowerCase()
    );
    if (hIdx === -1) db.historical_skus.push(entry);
    else db.historical_skus[hIdx] = { ...db.historical_skus[hIdx], ...entry };
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingProduct) return;
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

    setSavingProduct(true);
    try {
      const db = getDB();
      if (!db.inventory_movements) {
        db.inventory_movements = [];
      }
      let isNew = !editingProductId;
      const locationValue = prodLocation.trim() || 'Estudio';
      // Referencia al producto guardado (edición o creación), para poder
      // encolar la solicitud de Instagram con su id/nombre/precio reales.
      let savedProduct: Product | null = null;

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
            visibleEnTienda: esInsumo(prodCategory) ? prodVisibleEnTienda : false,
            physicalLocation: locationValue,
            imageUrl: prodImage || TECHNOVERSE_PLACEHOLDER,
            discountPercent: prodApplyDiscount ? finalDiscount : 0,
            warranty: prodWarranty,
            caabys: prodCaabys.trim() || DEFAULT_CAABYS
          };
          
          // Cascading stock update if this is a spare part
          if (isSparePart && oldStock !== finalStock) {
            const newStock = finalStock;
            db.products.forEach((p, pIdx) => {
              if (!p) return;
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
          
          upsertHistoricalSku(db, db.products[idx]);
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Editar Producto', `Producto modificado: ${prodName} (SKU: ${prodSku})`, db);
          savedProduct = db.products[idx];
        }
      } else {
        const newSku = prodSku.trim() || `${prodCategory.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // DIAGNÓSTICO del fallo al Guardar un SKU autorrellenado: el flujo de
        // creación (a) si el SKU pertenecía a un producto ACTIVO, cortaba con
        // un error "SKU ya utilizado" y NO guardaba nada; y (b) en cualquier
        // caso, insertar una fila nueva con un SKU repetido viola la
        // restricción UNIQUE de Supabase → excepción de duplicidad.
        //
        // SOLUCIÓN: si el SKU YA EXISTE (activo o inactivo) no se inserta una
        // fila nueva — se ACTUALIZA la fila existente (mismo product_id, un
        // UPDATE, no un INSERT) y se SUMA el stock ingresado como entrada de
        // inventario. Solo cuando el SKU no existe se crea un registro nuevo.
        const existing = db.products.find(p => p && p.sku && p.sku.toLowerCase() === newSku.toLowerCase().trim());

        let newProduct: Product;
        const addedStock = finalStock;
        let movementNote = 'Inventario inicial';

        if (existing) {
          // FLUJO B — SKU existente: actualizar datos + incrementar stock.
          const idx = db.products.findIndex(p => p.id === existing.id);
          const resultingStock = (existing.stock || 0) + addedStock;
          newProduct = {
            ...existing,
            name: prodName.trim(),
            description: prodDesc.trim(),
            category: prodCategory,
            price: finalPrice,
            cost: finalCost,
            stock: resultingStock,
            minStock: finalMinStock,
            linkedSparePartSku: sparePartCategories.includes(prodCategory) ? undefined : prodLinkedSparePartSku,
            visibleEnTienda: esInsumo(prodCategory) ? prodVisibleEnTienda : false,
            physicalLocation: locationValue,
            imageUrl: prodImage || existing.imageUrl || TECHNOVERSE_PLACEHOLDER,
            discountPercent: prodApplyDiscount ? finalDiscount : 0,
            active: resultingStock > 0,
            warranty: prodWarranty,
            caabys: prodCaabys.trim() || DEFAULT_CAABYS
          };
          db.products[idx] = newProduct;
          movementNote = existing.active === false
            ? 'Reintegro de producto desde catálogo (SKU existente)'
            : 'Ingreso de inventario a producto existente (SKU en catálogo)';
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Ingreso Inventario', `Stock actualizado (+${addedStock}) para ${prodName} (SKU: ${newSku}). Total: ${resultingStock}`, db);
        } else {
          // FLUJO A — producto totalmente nuevo.
          newProduct = {
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
            visibleEnTienda: esInsumo(prodCategory) ? prodVisibleEnTienda : false,
            physicalLocation: locationValue,
            imageUrl: prodImage || TECHNOVERSE_PLACEHOLDER,
            discountPercent: prodApplyDiscount ? finalDiscount : 0,
            active: finalStock > 0,
            warranty: prodWarranty,
            caabys: prodCaabys.trim() || DEFAULT_CAABYS
          };
          db.products.push(newProduct);
          addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Crear Producto', `Producto creado: ${prodName} (SKU: ${newSku})`, db);
        }

        // Movimiento de stock (entrada) si se ingresaron unidades.
        if (addedStock > 0) {
          db.inventory_movements.unshift({
            id: `MOV-${Date.now()}`,
            productId: newProduct.id,
            productName: newProduct.name,
            quantityChange: addedStock,
            type: 'Entrada manual',
            notes: movementNote,
            timestamp: new Date().toISOString(),
            userEmail: currentUser?.email || 'technoverse.admin@gmail.com',
            resultingStock: newProduct.stock
          });
        }

        // Catálogo histórico (autorrelleno por SKU): upsert, nunca borra.
        upsertHistoricalSku(db, newProduct);

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('product:created', { detail: newProduct }));
          if (newProduct.stock > 0) {
            window.dispatchEvent(new CustomEvent('stock:update', {
              detail: { productId: newProduct.id, newStock: newProduct.stock }
            }));
          }
        }
        savedProduct = newProduct;
      }

      // Solicitud de publicación en Instagram: se encola con el producto ya
      // guardado, para que quede con su id/nombre/precio reales.
      if (prodCreateIgPost && savedProduct) {
        if (!db.marketing_requests) db.marketing_requests = [];
        const scheduledAt = calcularFechaProgramada(igScheduleMode, igScheduleDate, igScheduleTime);
        const prodRef = savedProduct as Product;
        db.marketing_requests.unshift({
          id: `MKT-${Date.now()}`,
          productId: prodRef.id,
          productName: prodRef.name,
          productSku: prodRef.sku,
          price: prodRef.price,
          status: 'pendiente_imagen',
          scheduledAt,
          createdBy: currentUser?.email || 'technoverse.admin@gmail.com',
          createdAt: new Date().toISOString()
        });
      }

      await saveDB(db);
      loadData();
      onDataChanged();
      setShowProductForm(false);
      setFormError(null);
      setProdCreateIgPost(false);
      setIgScheduleMode('manana');
      setIgScheduleDate('');
      setIgScheduleTime('');
    } catch (error: any) {
      console.error(error);
      setFormError(`Error al guardar en la base de datos: ${error.message || error}`);
    } finally {
      setSavingProduct(false);
    }
  };

  const confirmDeleteProduct = async (p: Product) => {
    // ---------------------------------------------------------------------
    // HALLAZGO DE AUDITORÍA CORREGIDO (prioridad Media)
    // ---------------------------------------------------------------------
    // Esta función tenía dos problemas, los dos por mezclar el modelo VIEJO
    // de vínculo único (linkedSparePartSku, un texto) con el modelo NUEVO de
    // vinculación N-a-N (product_components, con llave foránea):
    //
    //   1. Borrar un repuesto/insumo BORRABA TAMBIÉN, en cascada y sin
    //      aviso, cualquier producto cuyo linkedSparePartSku coincidiera con
    //      su SKU. Con la vinculación N-a-N, un producto puede depender de
    //      MUCHOS componentes; borrar uno de ellos no debería nunca destruir
    //      el producto completo. Esa parte se retira: ahora, si un producto
    //      quedó apuntando a un SKU que ya no existe, simplemente se le
    //      limpia esa referencia — el producto sobrevive.
    //
    //   2. Si el artículo SÍ estaba vinculado vía product_components (el
    //      modelo nuevo), la base rechaza el borrado —la llave foránea es
    //      ON DELETE RESTRICT a propósito— pero el error que llegaba a
    //      pantalla era el texto crudo de Postgres. Ahora se consulta ANTES
    //      de intentar borrar, y si hay dependientes se avisa con sus
    //      nombres, sin siquiera llegar a golpear la base.
    const { data: dependientes } = await supabase
      .from('v_product_components')
      .select('product_name')
      .eq('component_id', p.id);

    if (dependientes && dependientes.length > 0) {
      const nombres = Array.from(new Set(dependientes.map((d: any) => d.product_name))).join(', ');
      toast.error(
        `No se puede eliminar "${p.name}": está vinculado como componente de ${nombres}. ` +
        `Quite el vínculo desde la ficha de ese producto (sección "Componentes de este producto") y vuelva a intentarlo.`,
        10000
      );
      return;
    }

    const db = getDB();
    const idx = db.products.findIndex(x => x && x.id === p.id);
    if (idx !== -1) {
      // Se conserva en el catálogo histórico (autorrelleno por SKU) antes de
      // eliminar, para poder re-agregarlo luego. Upsert: nunca se pierde.
      upsertHistoricalSku(db, p);

      // El vínculo viejo se LIMPIA, no se propaga: un producto que apuntaba
      // por SKU a este repuesto/insumo pierde la referencia, pero sigue
      // existiendo. Antes se le hacía hard delete, que podía destruir un
      // producto en venta activa por eliminar una pieza de repuesto.
      if (sparePartCategories.includes(p.category)) {
        db.products.forEach(x => {
          if (x && x.linkedSparePartSku === p.sku) {
            x.linkedSparePartSku = undefined;
            addAuditLog(
              currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Desvincular Producto',
              `"${x.name}" quedó sin vínculo: su repuesto "${p.sku}" fue eliminado.`, db
            );
          }
        });
      }

      db.products = db.products.filter(x => x && x.id !== p.id);
      addAuditLog(currentUser?.email || 'technoverse.admin@gmail.com', 'Inventario', 'Eliminar Producto', `Producto eliminado permanentemente (Hard Delete): ${p.name}`, db);
    }
    try {
      await saveDB(db);
    } catch (err: any) {
      // Red de seguridad: si algo distinto a product_components también
      // referenciara este producto, el mensaje sigue siendo legible en vez
      // de mostrar el texto crudo del motor de base de datos.
      const esRestriccion = /foreign key|llave for.nea|violat.*constraint/i.test(String(err?.message || ''));
      toast.error(
        esRestriccion
          ? `No se pudo eliminar "${p.name}": todavía está referenciado en otra parte del sistema.`
          : 'No se pudo eliminar el producto en la base de datos. Detalle: ' + (err?.message || err)
      );
      return;
    }
    loadData();
    onDataChanged();
  };


  const handleStartCount = () => {
    setIsCountingMode(true);
    const initialCount: Record<string, number> = {};
    products.forEach(p => {
    if (!p) return;
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
          // Solo para que la UI lo refleje sin esperar el viaje de ida y
          // vuelta a Supabase: quien de verdad hace cumplir "si llega a 0,
          // se elimina" —sin importar si fue este conteo, una venta en la
          // tienda o un cobro de taller— es el disparador
          // `archivar_producto_agotado()` en la base, que además archiva
          // la ficha en historical_skus para poder recuperarla rápido.
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
      toast.success(`Conteo finalizado. Se ajustaron ${adjustmentsMade} productos.`);
    } else {
      toast.info('Conteo finalizado. No hubo diferencias en el stock.');
    }
    
    setIsCountingMode(false);
    setCountData({});
  };

  const handleExportCSV = () => {
    // Columns: Fecha, Producto, Tipo, Cantidad, Stock resultante, Usuario, Referencia
    const headers = ["Fecha", "Producto", "Tipo", "Cantidad", "Stock resultante", "Usuario", "Referencia"];
    
    const rows = movements.map(m => { 
if (!m) return null;
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

  // useMemo: evita recorrer toda la lista de productos en cada render (buscar,
  // paginar, escribir un conteo) — clave para la fluidez en equipos como el
  // Galaxy A12. Además endurece el filtro para rechazar registros corruptos
  // (nulos, sin id o sin sku), inactivos y sin stock, de modo que ningún
  // producto fantasma/huérfano se cuele en la vista — incluido el Conteo
  // Físico: solo carga inventario actual existente (stock > 0); lo faltante
  // o nuevo se agrega manualmente vía auto-rellenado de SKU, no apareciendo
  // aquí por sí solo.
  const filteredProducts = useMemo(() => products.filter(p => {
    // Guarda de integridad: sin objeto, sin id o sin sku = fila huérfana/basura.
    if (!p || !p.id || !p.sku) return false;
    if (p.active === false) return false;
    if (Number(p.stock) <= 0) return false;

    // Sub-tab logic
    const isSpare = p.category === 'Repuestos' || sparePartCategories.includes(p.category);
    // Los insumos son una familia aparte: no son repuestos ni catálogo.
    // Sin esta separación aparecerían mezclados con los productos de la
    // tienda, que es justo lo que la pestaña nueva viene a evitar.
    const isInsumo = esInsumo(p.category);
    if (activeSubTab === 'repuestos') {
      if (!isSpare) return false;
    } else if (activeSubTab === 'insumos') {
      if (!isInsumo) return false;
    } else if (activeSubTab === 'productos') {
      if (isSpare || isInsumo) return false;
    }
    // movimientos and reportes see all

    // Se compara con la misma regla que usa la tienda: así un producto viejo
    // guardado como "Fundas" sigue apareciendo al filtrar por "Estuches", sin
    // tener que tocar nada en la base de datos.
    if (categoryFilter !== 'Todas' && p.category && !coincideCategoria(p.category, categoryFilter)) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name ? p.name.toLowerCase().includes(q) : false;
      const skuMatch = p.sku ? p.sku.toLowerCase().includes(q) : false;
      return nameMatch || skuMatch;
    }
    return true;
  }), [products, activeSubTab, categoryFilter, searchQuery]);
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
            { id: 'insumos', label: 'Insumos', icon: Boxes },
            { id: 'movimientos', label: 'Movimientos', icon: History },
            { id: 'reportes', label: 'Reportes', icon: FileText }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveSubTab(tab.id as any); if (onTabChange) onTabChange(tab.id as any); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition flex-shrink-0 ${
                activeSubTab === tab.id ? 'bg-sky-500 dark:bg-[var(--brand-gold-mid)] text-white dark:text-slate-950 shadow-sm' : 'text-[var(--text-secondary)] hover:text-sky-500 dark:hover:text-[var(--brand-gold-light)]'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {(activeSubTab === 'productos' || activeSubTab === 'repuestos' || activeSubTab === 'insumos') && marketingRequests.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[var(--accent)]" /> Publicaciones de Instagram
            </h4>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">{marketingRequests.length} solicitud(es)</span>
          </div>

          <div className="space-y-2">
            {marketingRequests.map(req => {
              const badge: Record<MarketingRequest['status'], { label: string; cls: string }> = {
                pendiente_imagen: { label: 'Falta imagen', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
                programado: { label: 'Programado', cls: 'bg-[var(--gold-soft)] text-[var(--brand-gold-dark)] border-[var(--gold-line)]' },
                publicado: { label: 'Publicado', cls: 'bg-[var(--ok-soft)] text-[var(--ok)] border-transparent' },
                error: { label: 'Error al publicar', cls: 'bg-rose-500/15 text-rose-500 border-rose-500/30' },
              };
              const b = badge[req.status];
              const fecha = new Date(req.scheduledAt).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });

              return (
                <div key={req.id} className="border border-[var(--border-color)]/60 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{req.productName}</p>
                      <p className="text-[10px] font-mono text-[var(--text-muted)]">₡{req.price.toLocaleString()} · Programado para {fecha}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${b.cls}`}>{b.label}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const db = getDB();
                          db.marketing_requests = (db.marketing_requests || []).filter(r => r.id !== req.id);
                          try { await saveDB(db); loadData(); } catch (err: any) { toast.error('No se pudo quitar: ' + (err?.message || err)); }
                        }}
                        className="text-[var(--text-muted)] hover:text-rose-500 transition"
                        title="Quitar de la cola"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {req.status === 'pendiente_imagen' && (
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="Pegar URL pública de la imagen ya generada…"
                        value={igImageDraft[req.id] || ''}
                        onChange={e => setIgImageDraft(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-color)]/80 rounded-lg px-3 py-1.5 text-[11px] text-[var(--text-primary)]"
                      />
                      <button
                        type="button"
                        disabled={!igImageDraft[req.id]?.trim()}
                        onClick={async () => {
                          const url = (igImageDraft[req.id] || '').trim();
                          if (!url) return;
                          const db = getDB();
                          const idx = (db.marketing_requests || []).findIndex(r => r.id === req.id);
                          if (idx === -1) return;
                          db.marketing_requests[idx] = { ...db.marketing_requests[idx], imageUrl: url, status: 'programado' };
                          try {
                            await saveDB(db);
                            loadData();
                            setIgImageDraft(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                            toast.success('Publicación programada. Se publicará sola en la fecha elegida.');
                          } catch (err: any) {
                            toast.error('No se pudo programar: ' + (err?.message || err));
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--accent)] text-[var(--accent-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Programar
                      </button>
                    </div>
                  )}

                  {req.status === 'error' && req.errorDetail && (
                    <p className="text-[10px] text-rose-500">{req.errorDetail}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(activeSubTab === 'productos' || activeSubTab === 'repuestos' || activeSubTab === 'insumos') && (
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
                  <div className="md:w-56 flex-shrink-0">
                    <CustomSelect
                      value={categoryFilter}
                      onChange={setCategoryFilter}
                      className="text-xs py-2"
                      options={[
                        { value: 'Todas', label: 'Todas las categorías' },
                        // Mismas categorías que la tienda. Los repuestos no van
                        // aquí: esta pestaña ya los excluye por su cuenta.
                        ...CATEGORIAS_TIENDA.map(c => ({ value: c, label: c }))
                      ]}
                    />
                  </div>
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
                    setProdVisibleEnTienda(false);
                    setProdCaabys('');
                    setProdCategory(
                      activeSubTab === 'repuestos' ? 'LCD'
                        : activeSubTab === 'insumos' ? 'Temperado'
                        : 'Accesorios'
                    );
                    setSkuLoadedFromHistory(null);
                    setSkuAutoGenerated(true);
                    setSkuSeed(Math.floor(1000 + Math.random() * 9000));
                    setFormError(null);
                    setShowProductForm(true);
                  }}
                  className="bg-sky-500 hover:bg-sky-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center justify-center gap-2 dark:text-slate-950"
                >
                  <Plus className="w-4 h-4" /> {
                    activeSubTab === 'repuestos' ? 'Añadir Repuesto'
                      : activeSubTab === 'insumos' ? 'Añadir Insumo'
                      : 'Nuevo Producto'
                  }
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExtractedProducts([]);
                    setPdfRawText('');
                    setIsAnalyzingPdf(false);
                    setGlobalMargin(30);
                    setGlobalCategory(activeSubTab === 'repuestos' ? 'LCD' : activeSubTab === 'insumos' ? 'Temperado' : 'Accesorios');
                    setShowPdfModal(true);
                  }}
                  className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center justify-center gap-2 transition"
                >
                  <FileText className="w-4 h-4" /> Importar lista de precios
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
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Foto</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">SKU</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Nombre</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Categoría</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)] text-center">Stock</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)] text-right">Precio de Costo</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)] text-center">Garantía</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)] text-right">Acciones</th>
                          </>
                        ) : (
                          <>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Producto</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">SKU</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Categoría</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Precio / Costo</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Stock</th>
                            <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Ubicación</th>
                            {isCountingMode ? (
                              <th className="p-4 font-black uppercase tracking-wider text-[10px] text-amber-500 text-right">Cant. Real</th>
                            ) : (
                              <th className="p-4 font-black uppercase tracking-wider text-[10px] text-[var(--text-muted)] text-right">Acciones</th>
                            )}
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedProducts.map((p, pIndex) => (
                        <tr key={p.id || `prod-${pIndex}`} className={`hover:bg-[var(--bg-surface)] transition ${p.active === false ? 'opacity-50' : ''}`}>
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
                                      setProdCaabys(p.caabys || '');
                                      setProdApplyDiscount(p.discountPercent > 0);
                                      setProdDiscount(p.discountPercent || 0);
                                      setProdDoubleStock(p.isDoubleStock || false);
                                      setProdInternalStock(p.internalStock || 0);
                                      setProdClientStock(p.clientStock || 0);
                                      setProdLinkedSparePartSku(p.linkedSparePartSku || '');
                                      setProdVisibleEnTienda(p.visibleEnTienda === true);
                                      setSkuLoadedFromHistory(p.sku);
                                      setSkuAutoGenerated(false);
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
                                <div className="text-emerald-500 font-bold dark:text-[var(--brand-gold-light)]">₡{(p.price || 0).toLocaleString()}</div>
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
                                    placeholder={String(p.stock ?? 0)}
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
                                      setProdVisibleEnTienda(p.visibleEnTienda === true);
                                        setSkuLoadedFromHistory(p.sku);
                                        setSkuAutoGenerated(false);
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
                        <tr key="empty-products-row">
                          <td colSpan={8} className="p-8 text-center text-[var(--text-muted)] text-xs italic font-medium">
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
                            setSkuAutoGenerated(false);
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
                                  <span className="text-[8px] bg-[var(--border-color)] text-[var(--text-muted)] px-1 py-0.5 rounded-full flex-shrink-0">{h.category}</span>
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
                        <CustomSelect
                          value={prodCategory}
                          onChange={(val) => {
                            setProdCategory(val);
                            if (sparePartCategories.includes(val) || val === 'Repuestos') {
                              setProdLinkedSparePartSku('');
                    setProdVisibleEnTienda(false);
                            }
                          }}
                          className="text-xs py-2"
                          options={
                            (activeSubTab === 'repuestos' || sparePartCategories.includes(prodCategory) || prodCategory === 'Repuestos'
                              ? sparePartCategories
                              // Insumos: su propia lista, distinta de la de la tienda a
                              // propósito. Ver el comentario de CATEGORIAS_INSUMO en
                              // categorias.ts — si un insumo se llamara "Estuche", la
                              // traducción de categorías lo mandaría al catálogo público.
                              : activeSubTab === 'insumos' || esInsumo(prodCategory)
                              ? CATEGORIAS_INSUMO
                              // HOMOLOGADO con la tienda: esta es la MISMA lista que ve el
                              // cliente en el catálogo (src/utils/categorias.ts). Antes había
                              // aquí una lista propia — Fundas, Cables, Otros… — que la tienda
                              // no sabía mostrar, y los productos guardados como "Otros"
                              // desaparecían al filtrar por categoría.
                              : [...CATEGORIAS_TIENDA]
                            ).map(c => ({ value: c, label: c }))
                          }
                        />
                      </div>
                    </div>

                    {!sparePartCategories.includes(prodCategory) && prodCategory !== 'Repuestos' && (
                      <div className="space-y-3 p-4 bg-[var(--bg-surface)] /50 border border-[var(--border-color)]/50 rounded-xl">
                        <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Vincular a Repuesto (SKU)</label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 z-[1] w-3.5 h-3.5 text-[var(--text-secondary)] pointer-events-none" />
                          <CustomSelect
                            value={prodLinkedSparePartSku}
                            onChange={(sku) => {
                              setProdLinkedSparePartSku(sku);
                              if (sku) {
                                const spare = products.find(p => p && p.sku === sku && (sparePartCategories.includes(p.category) || p.category === 'Repuestos'));
                                if (spare) {
                                  setProdStock(spare.stock);
                                  setProdCost(spare.cost);
                                }
                              } else {
                                setProdCost('');
                                setProdStock('');
                              }
                            }}
                            placeholder="-- Sin vinculación --"
                            className="pl-9 text-xs py-2"
                            options={[
                              { value: '', label: '-- Sin vinculación --' },
                              ...products.filter(p => p && (sparePartCategories.includes(p.category) || p.category === 'Repuestos') && p.active !== false).map(p => ({ value: p.sku, label: `${p.sku} - ${p.name} (Stock: ${p.stock})` }))
                            ]}
                          />
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
                      <CustomSelect
                        value={prodWarranty}
                        onChange={setProdWarranty}
                        className="text-xs py-2"
                        options={['15 días', '60 días', '90 días', '12 meses'].map(w => ({ value: w, label: w }))}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">
                        CAABYS (13 dígitos, catálogo Hacienda)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={13}
                        value={prodCaabys}
                        onChange={e => setProdCaabys(e.target.value.replace(/\D/g, '').slice(0, 13))}
                        placeholder={DEFAULT_CAABYS + ' (genérico si se deja vacío)'}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-sky-500 dark:focus:border-[var(--brand-gold-mid)]"
                      />
                      <p className="text-[9px] text-[var(--text-muted)] mt-1">
                        Requerido por línea en comprobantes electrónicos v4.3. Sin clasificar aún, se usa el genérico "Otros servicios n.c.p.".
                      </p>
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
                          className={`w-full border border-[var(--border-color)]/80 rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] font-mono ${prodLinkedSparePartSku ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] cursor-not-allowed' : 'bg-[var(--bg-surface)] '}`}
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

                          {/* Diagnóstico de transparencia.
                              Muchas descargas de bancos de imágenes traen el
                              damero gris DIBUJADO en los píxeles: el archivo es
                              opaco y ninguna clase de CSS puede recuperar un
                              alfa que nunca existió. Mostrarlo aquí evita tener
                              que adivinar si el problema es la app o el archivo. */}
                          {prodImage && prodImageHasAlpha !== null && (
                            <div className="mt-2 space-y-1.5">
                              {prodImageHasAlpha ? (
                                <p className="text-[10px] font-semibold text-emerald-500 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                                  Transparencia detectada: se guardará como PNG sin fondo.
                                </p>
                              ) : (
                                <>
                                  <p className="text-[10px] text-amber-500 flex items-start gap-1">
                                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
                                    <span>
                                      Esta imagen no tiene transparencia: el fondo forma parte
                                      del archivo. Si ves un damero gris, descargaste la vista
                                      previa en vez del PNG real.
                                    </span>
                                  </p>
                                  <button
                                    type="button"
                                    disabled={removingBg}
                                    onClick={async () => {
                                      setRemovingBg(true);
                                      try {
                                        const { removeFlatBackground, imageHasTransparency } = await import('../utils/storage');
                                        const limpia = await removeFlatBackground(prodImage);
                                        const quedoAlfa = await imageHasTransparency(limpia);
                                        if (quedoAlfa) {
                                          setProdImage(limpia);
                                          toast.success('Fondo eliminado. La imagen quedó con transparencia real.');
                                        } else {
                                          toast.warning('No se pudo separar el fondo de esta imagen: el borde no tiene un color uniforme. Probá con el PNG original.');
                                        }
                                      } catch (err: any) {
                                        toast.error('No se pudo procesar la imagen: ' + (err?.message || err));
                                      } finally {
                                        setRemovingBg(false);
                                      }
                                    }}
                                    className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-[var(--bg-sunken)] border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent)] transition disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {removingBg ? 'Procesando…' : 'Quitar fondo y hacerlo transparente'}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
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

                    {/* Publicación promocional en Instagram.
                        La GENERACIÓN de la pieza gráfica todavía requiere a
                        Claude (Canva no tiene una API que la app pueda llamar
                        sola), así que esta casilla deja la solicitud en cola
                        con estado "pendiente_imagen" — alguien del equipo la
                        completa subiendo la imagen. Lo que SÍ queda 100%
                        automático es la PUBLICACIÓN: el cron de Supabase
                        dispara sola la publicación en la fecha/hora elegida,
                        sin que nadie tenga que volver a tocar nada. */}
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-4 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="createIgPost" checked={prodCreateIgPost} onChange={e => setProdCreateIgPost(e.target.checked)} className="rounded border-white/20 bg-[var(--bg-surface)]" />
                        <label htmlFor="createIgPost" className="text-xs text-[var(--text-secondary)]">¿Crear imagen y publicación promocional para Instagram?</label>
                      </div>
                      {prodCreateIgPost && (
                        <div className="space-y-3 pl-1">
                          <div>
                            <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1.5">¿Cuándo publicar?</label>
                            <div className="flex gap-2 flex-wrap">
                              {([
                                ['manana', 'Mañana (9:00 a.m.)'],
                                ['tarde', 'Tarde (3:00 p.m.)'],
                                ['personalizado', 'Fecha y hora específica'],
                              ] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => setIgScheduleMode(value)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                                    igScheduleMode === value
                                      ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]'
                                      : 'bg-[var(--bg-sunken)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {igScheduleMode === 'personalizado' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Fecha</label>
                                <input
                                  type="date"
                                  value={igScheduleDate}
                                  min={new Date().toISOString().slice(0, 10)}
                                  onChange={e => setIgScheduleDate(e.target.value)}
                                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] uppercase font-bold text-[var(--text-secondary)] mb-1">Hora</label>
                                <input
                                  type="time"
                                  value={igScheduleTime}
                                  onChange={e => setIgScheduleTime(e.target.value)}
                                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-xl px-3 py-2 text-xs text-[var(--text-primary)]"
                                />
                              </div>
                            </div>
                          )}

                          <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] border border-dashed border-[var(--border-color)] rounded-lg px-3 py-2">
                            Al guardar, esta solicitud queda en la cola de <strong className="text-[var(--text-primary)]">Publicaciones de Instagram</strong> (abajo en Inventario). La generación de la imagen se completa con el equipo; la publicación en la fecha elegida es automática.
                          </p>
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

                {/* VINCULACIÓN N-a-N — solo al EDITAR.
                    Al crear todavía no existe el id del producto, y sin id no
                    hay a qué colgar los componentes. Se guarda primero y se
                    compone después, que además es el orden natural: nadie
                    sabe de qué se compone un servicio antes de haberlo
                    creado. */}
                {/* VISIBILIDAD EN LA TIENDA — solo para insumos.
                    Un temperado o un estuche pueden venderse igual que
                    cualquier producto, pero la mayoría del material de taller
                    no. Por eso se decide uno por uno y por defecto está
                    oculto: publicar por descuido un insumo a precio de costo
                    se descubre tarde y mal. Los repuestos no tienen esta
                    opción — no se venden nunca. */}
                {esInsumo(prodCategory) && (
                  <div className="pt-4 border-t border-[var(--border-color)]/50">
                    <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-[var(--border-color)] p-3.5">
                      <input
                        type="checkbox"
                        checked={prodVisibleEnTienda}
                        onChange={e => setProdVisibleEnTienda(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-[var(--accent)] cursor-pointer flex-shrink-0"
                      />
                      <span>
                        <span className="block text-xs font-bold text-[var(--text-primary)]">
                          Mostrar en la tienda pública
                        </span>
                        <span className="block mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                          {prodVisibleEnTienda
                            ? 'Los clientes lo verán en el catálogo y podrán comprarlo al precio de venta. Revise que ese precio sea el correcto, no el de costo.'
                            : 'Oculto. Solo se usa dentro del taller y para regalías; no aparece en el catálogo.'}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {editingProductId && (
                  <div className="pt-4 border-t border-[var(--border-color)]/50">
                    <VinculacionComponentes productId={editingProductId} productos={products} />
                  </div>
                )}

                <div className="pt-4 border-t border-[var(--border-color)]/50 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowProductForm(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingProduct}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 transition shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" /> {savingProduct ? 'Guardando…' : 'Guardar Producto'}
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
                  {movements.filter(Boolean).map((m, mIdx) => (
                    <tr key={m.id || `mov-${mIdx}`} className="hover:bg-[var(--bg-surface)] transition font-mono text-[11px]">
                      <td className="p-3 text-[var(--text-secondary)]">{new Date(m.timestamp).toLocaleString()}</td>
                      <td className="p-3 text-[var(--text-primary)] truncate max-w-[200px]" title={m.productName}>{m.productName}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-color)]/50 text-[var(--text-muted)]">
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
                    <tr key="empty-movements-row"><td colSpan={6} className="p-8 text-center text-[var(--text-secondary)] italic">No hay movimientos registrados.</td></tr>
                  )}
                </tbody>
              </table>
              
  {prodTotal > 1 && (
    <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)] border-t border-[var(--border-color)]">
      <span className="text-sm text-[var(--text-muted)]">Mostrando {prodStart + 1} a {Math.min(prodStart + 10, filteredProducts.length)} de {filteredProducts.length}</span>
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
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
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
                  {movements.filter(m => m && m.productId === traceProductModal.id).map((m, mIdx) => (
                    <tr key={m.id || `trace-${mIdx}`} className="hover:bg-[var(--bg-surface)] transition">
                      <td className="p-2 text-[var(--text-secondary)]">{new Date(m.timestamp).toLocaleString()}</td>
                      <td className="p-2 text-sky-400 dark:text-[var(--brand-gold-light)]">{m.type}</td>
                      <td className={`p-2 text-right font-bold ${m.quantityChange > 0 ? 'text-emerald-400 dark:text-[var(--brand-gold-light)]' : 'text-rose-400'}`}>
                        {m.quantityChange > 0 ? '+' : ''}{m.quantityChange}
                      </td>
                      <td className="p-2 text-right text-[var(--text-secondary)]">{m.resultingStock || '-'}</td>
                      <td className="p-2 text-[var(--text-secondary)] truncate max-w-[150px]">{m.notes}</td>
                    </tr>
                  ))}
                  {movements.filter(m => m && m.productId === traceProductModal.id).length === 0 && (
                    <tr key="empty-trace-row"><td colSpan={5} className="p-4 text-center text-[var(--text-secondary)] italic">No hay historial para este producto.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      


      {/* Delete Confirmation Modal */}
      {deleteProductModal && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
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
                  <span className="font-mono text-[var(--text-primary)] font-bold">{products.reduce((a, b) => a + (b ? (b.stock || 0) : 0), 0)} u.</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/50">
                  <span className="text-xs text-[var(--text-secondary)]">Valor a Costo</span>
                  <span className="font-mono text-sky-400 dark:text-[var(--brand-gold-light)] font-bold">₡{products.reduce((a, b) => a + (b ? ((b.cost || 0) * (b.stock || 0)) : 0), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)]">Valor a Precio Venta</span>
                  <span className="font-mono text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold">₡{products.reduce((a, b) => a + (b ? ((b.price || 0) * (b.stock || 0)) : 0), 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 p-5 rounded-2xl">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-4">Rotación de Productos</h4>
              <p className="text-[10px] text-[var(--text-secondary)] mb-2">Simulación de movimiento basado en stock.</p>
              <div className="space-y-2">
                {products.filter(p => p && p.stock !== undefined && p.stock !== null && p.stock > 0).slice(0, 4).map(p => (
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
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-white/15 rounded-3xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-sm relative">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-[var(--border-color)]/80 flex justify-between items-center bg-[var(--bg-surface)] ">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-400 dark:text-[var(--brand-gold-light)]" /> Importador de Listas de Precios
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">Suba la lista de precios de un proveedor (PDF o texto plano) para registrar sus artículos en el inventario, sin escribirlos uno por uno.</p>
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
                      accept=".pdf,.txt"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handlePdfUpload(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="space-y-4">
                      <div className="w-12 h-12 bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 text-emerald-400 dark:text-[var(--brand-gold-light)] rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-[var(--text-primary)]">Seleccione o arrastre la lista de precios</p>
                        <p className="text-xs text-[var(--text-secondary)]">PDF o texto plano (.txt), hasta 10 MB.</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/50 rounded-xl p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Funciona mejor cuando cada artículo va en su propia línea con el precio marcado
                    (₡ o $), como suelen venir estas listas — por ejemplo: <br />
                    <code className="font-mono text-[10px] text-[var(--text-primary)]">Honor X6B Con marco 1 mes de garantía ₡10 000</code>
                    <br />
                    Si el PDF es una foto escaneada (sin texto real detrás), no se puede leer así:
                    copie el texto a mano en el editor de más abajo.
                  </div>
                </div>
              )}

              {/* Step 2: Lectura y análisis en curso */}
              {isAnalyzingPdf && (
                <div className="space-y-4 max-w-md mx-auto py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 border border-emerald-500 dark:border-[var(--brand-gold-mid)]/30 flex items-center justify-center mx-auto text-emerald-400 dark:text-[var(--brand-gold-light)] animate-spin">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">Leyendo el archivo…</h4>
                  <p className="text-xs text-[var(--text-secondary)]">{pdfReadProgress || 'Extrayendo el texto para analizarlo.'}</p>
                </div>
              )}

              {/* Step 3: Preview Table & Configurations */}
              {extractedProducts.length > 0 && (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Configuration & Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-color)]/50">

                    {/* Categoría para todo el lote */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--text-secondary)]">
                        Categoría del lote
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <CustomSelect
                            value={globalCategory}
                            onChange={setGlobalCategory}
                            className="text-xs py-1.5"
                            options={[...CATEGORIAS_REPUESTO, ...CATEGORIAS_TIENDA].map(c => ({ value: c, label: c }))}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setExtractedProducts(prev => prev.map(row => ({ ...row, category: globalCategory })));
                            showToast(`Categoría "${globalCategory}" aplicada a todas las filas.`, 'success');
                          }}
                          className="bg-emerald-500 hover:bg-emerald-600 dark:bg-[var(--brand-gold-mid)] dark:hover:bg-[var(--brand-gold-dark)] text-slate-950 font-bold text-xs px-4 py-1.5 rounded-xl transition"
                        >
                          Aplicar
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--text-secondary)]">Una lista de proveedor casi siempre es de una sola familia; edite fila por fila si no.</p>
                    </div>

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
                          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-color)] text-[var(--text-muted)] font-black uppercase tracking-wider text-[10px]">
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
                              row.stock < 0
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
                                    <label className="p-1 rounded bg-[var(--border-color)] hover:bg-slate-200 text-[var(--text-muted)] cursor-pointer transition">
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
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={row.name}
                                      onChange={(e) => handleNameChange(index, e.target.value)}
                                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)]/80 text-xs px-2 py-1 rounded text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)]"
                                    />
                                    {row.agotado && (
                                      <span
                                        className="flex-shrink-0 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 text-[9px] font-bold uppercase tracking-wide"
                                        title="La lista marcaba este artículo como agotado en el proveedor: se dejó sin seleccionar."
                                      >
                                        Agotado
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="p-3">
                                  <CustomSelect
                                    value={row.category}
                                    onChange={(val) => handleCategoryChange(index, val)}
                                    className="text-xs py-1"
                                    // FALLO CORREGIDO: aquí se ofrecía el literal
                                    // "Repuestos", que NO es ninguna de las
                                    // categorías que `esRepuesto()` reconoce
                                    // (categorias.ts): 'LCD', 'Batería', 'Flex', etc.
                                    // Un producto importado con categoría
                                    // "Repuestos" pasaba el filtro visual de esta
                                    // pantalla, pero no aparecía en el selector de
                                    // repuestos de Cobros ni se excluía del catálogo
                                    // público — quedaba huérfano. Se ofrecen las
                                    // categorías reales de taller en su lugar.
                                    options={[...CATEGORIAS_REPUESTO, ...CATEGORIAS_TIENDA].map(c => ({ value: c, label: c }))}
                                  />
                                </td>

                                <td className="p-3 text-right font-mono text-[11px] text-sky-400 dark:text-[var(--brand-gold-light)]">
                                  ₡{(row.cost || 0).toLocaleString()}
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
                                        row.selected && row.stock < 0 ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-[var(--border-color)]/80 text-[var(--text-primary)] focus:border-emerald-500 dark:focus:border-[var(--brand-gold-mid)] dark:border-[var(--brand-gold-mid)]'
                                      }`}
                                      placeholder="0"
                                    />
                                    {row.selected && row.stock < 0 && (
                                      <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-rose-600 text-white text-[10px] px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none whitespace-nowrap z-50">
                                        No puede ser negativo
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
                      ⌨️ Editor del texto extraído
                    </h4>
                    <p className="text-[10px] text-[var(--text-secondary)]">Este es el texto real que se leyó del archivo. Corríjalo o pegue otro directamente y haga clic en re-analizar para actualizar la tabla.</p>
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
                          const parsed = parseTextToProducts(pdfRawText, products, historicalSkus, globalCategory);
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
                        ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] cursor-not-allowed border border-[var(--border-color)]/50' 
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
