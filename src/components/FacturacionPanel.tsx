// =====================================================================
// MÓDULO DE FACTURACIÓN — pantalla de cobro
// =====================================================================
// Panel INDEPENDIENTE del taller. El taller registra el trabajo; aquí se
// cobra. Son dos actos distintos, los hacen personas distintas y en
// momentos distintos, y mezclarlos es lo que hacía que un diagnóstico
// técnico llevara campos de precio dentro.
//
// ---------------------------------------------------------------------
// QUÉ PIDE Y POR QUÉ ESE ORDEN
// ---------------------------------------------------------------------
// Cédula, correo, teléfono, monto y garantía. Están en ese orden porque
// es el orden en que se consiguen los datos frente al cliente: primero
// se identifica, después se le pregunta cómo recibir el comprobante, y
// solo al final se habla de dinero.
//
// ---------------------------------------------------------------------
// LO QUE EL CLIENTE **NO** VE
// ---------------------------------------------------------------------
// El margen, el costo de los repuestos y el costo de la regalía son
// internos: se muestran en pantalla para quien cobra y no viajan al
// comprobante. En la factura, la regalía aparece como "Descuento 100%"
// con costo ₡0, que es exactamente lo que el cliente recibió.
// =====================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Receipt, Gift, Wrench, Plus, Trash2, CheckCircle, Download, AlertTriangle, Link2, Mail, ShoppingBag,
} from 'lucide-react';
import { PageHead, Card, Btn, Field, Chip, Stat, Empty, colones } from './admin/AdminKit';
import { CustomSelect } from './CustomSelect';
import { useToast, useConfirm } from './ui/Overlays';
import { getDB, refreshProductsFromSupabase } from '../utils/storage';
import { validateCedula } from '../utils/invoicePdf';
import type { IdentificacionTipo } from '../utils/invoicePdf';
import {
  MEDIOS_DE_COBRO, OPCIONES_GARANTIA, calcularMargen, cobrarServicio, componentesDe,
  reenviarComprobantePorCorreo, enviarFacturaDePrueba,
} from '../utils/facturacion';
import type { MedioCobro, InsumoConsumido, ResultadoCobro } from '../utils/facturacion';
import { esRepuesto, esInsumo } from '../utils/categorias';
import { isNative } from '../mobile/platform';
import { guardarComprobanteNativo, descargarComprobanteWeb } from '../mobile/pdfDownload';
import type { Product, User } from '../types';

interface Props {
  currentUser: User | null;
  /** Se llama tras un cobro para que el panel recargue stock y pedidos. */
  onDataChanged: () => void;
}

const TIPOS_IDENTIFICACION = [
  { value: '01', label: 'Cédula Física' },
  { value: '03', label: 'DIMEX' },
  { value: '02', label: 'Cédula Jurídica' },
  { value: '04', label: 'NITE' },
];

/**
 * Traduce la garantía guardada en el producto (texto: "1 mes", "3 meses",
 * "12 meses") al valor que espera el desplegable de Facturación ('1'/'3'/
 * '12'). Se busca por dígitos y no por igualdad exacta a propósito: un
 * producto creado antes de la estandarización puede traer todavía texto
 * legado ("15 días", "60 días"), y aun así hay que poder auto-rellenar
 * algo razonable en vez de dejar el campo vacío. Ante cualquier duda cae
 * a '3', el mismo valor por defecto que ya usa `normalizarGarantia` en
 * facturacion.ts.
 */
function garantiaDesdeProducto(warranty?: string): string {
  const texto = (warranty || '').toLowerCase();
  if (/\b12\b/.test(texto)) return '12';
  if (/\b1\b/.test(texto)) return '1';
  if (/\b3\b/.test(texto)) return '3';
  return '3';
}

export default function FacturacionPanel({ currentUser, onDataChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();

  const [productos, setProductos] = useState<Product[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [ultimoCobro, setUltimoCobro] = useState<ResultadoCobro | null>(null);
  const [descargandoPdf, setDescargandoPdf] = useState(false);
  const [reenviandoCorreo, setReenviandoCorreo] = useState(false);

  // ---- Datos del cliente -------------------------------------------------
  const [nombre, setNombre] = useState('');
  const [idTipo, setIdTipo] = useState<IdentificacionTipo>('01');
  const [idValor, setIdValor] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('');

  // ---- Datos del cobro ---------------------------------------------------
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState<number | ''>('');
  const [garantia, setGarantia] = useState('3');
  const [medio, setMedio] = useState<MedioCobro>('SINPE');
  // Modo Sandbox: prueba el envío de correo con un PDF real, sin tocar
  // inventario, ventas ni el control de ganancias. Ver enviarFacturaDePrueba().
  const [modoPrueba, setModoPrueba] = useState(false);

  // ---- Motor de cobro bifurcado: Venta de Inventario vs Reparación ------
  // "Reparación" es el flujo por defecto porque es exactamente el
  // formulario que ya existía (servicio libre + monto + garantía manual):
  // no cambia nada para quien ya lo usaba así. "Venta" es el flujo nuevo,
  // pensado para despachar un producto del catálogo sin escribir nada.
  const [modoCobro, setModoCobro] = useState<'venta' | 'reparacion'>('reparacion');
  const [productoVentaId, setProductoVentaId] = useState('');
  const [productoVentaCantidad, setProductoVentaCantidad] = useState(1);

  // ---- Insumos -----------------------------------------------------------
  const [repuestos, setRepuestos] = useState<InsumoConsumido[]>([]);
  const [insumos, setInsumos] = useState<InsumoConsumido[]>([]);
  const [repuestoElegido, setRepuestoElegido] = useState('');
  const [insumoElegido, setInsumoElegido] = useState('');

  // ---- Servicio del catálogo (vinculación N-a-N) --------------------------
  // HALLAZGO DE AUDITORÍA CORREGIDO: la tabla product_components, su vista y
  // componentesDe() ya existían —se construyeron para esto mismo— pero
  // ninguna pantalla los llamaba. Cobrar seguía siendo enteramente manual:
  // se escribía la descripción a mano y se agregaban repuestos/insumos uno
  // por uno, sin que el sistema recordara qué llevaba cada servicio.
  const [servicioElegido, setServicioElegido] = useState('');
  const [cargandoComponentes, setCargandoComponentes] = useState(false);

  // ---------------------------------------------------------------------
  // CARGA DEL INVENTARIO
  // ---------------------------------------------------------------------
  // FALLO CORREGIDO: esto leía `getDB()` UNA sola vez, al montarse, y no
  // volvía a mirar. Pero el inventario llega de Supabase de forma
  // asíncrona: si se abre Cobros antes de que termine de cargar —lo normal
  // en un teléfono con datos móviles, o al entrar directo a /admin/cobros—
  // la lista quedaba vacía y AHÍ SE QUEDABA.
  //
  // El efecto era desconcertante: los desplegables de Repuestos e Insumos
  // aparecían sin opciones, así que no había forma de añadir el temperado
  // ni de marcarlo como regalía, y la factura salía con la línea del
  // servicio y nada más. Parecía que la regalía no funcionaba, cuando lo
  // que fallaba era que nunca se llegaba a seleccionar.
  //
  // Ahora se escucha `technoverse_db_updated`, el mismo evento que ya usan
  // Inventario y el panel: en cuanto el inventario llega o cambia, los
  // selectores se rellenan solos.
  useEffect(() => {
    const releer = () => setProductos((getDB().products || []).filter(Boolean));
    releer();
    window.addEventListener('technoverse_db_updated', releer);
    return () => window.removeEventListener('technoverse_db_updated', releer);
  }, []);

  const conStock = productos.filter(p => (p.stock || 0) > 0);
  const opcionesRepuesto = conStock.filter(p => esRepuesto(p.category));
  // Insumos: su propia familia del inventario (temperados, micas, cables
  // de taller). Cualquiera de ellos puede marcarse como regalía.
  const opcionesInsumo = conStock.filter(p => esInsumo(p.category));
  // Servicios del catálogo: todo lo que NO sea repuesto ni insumo. No se
  // filtra por existencia: un servicio no se descuenta de su propio stock,
  // solo sirve como llave para traer lo que tenga vinculado.
  const opcionesServicio = productos.filter(p => !esRepuesto(p.category) && !esInsumo(p.category));
  // Modo Venta de Inventario: mismo universo que "servicio del catálogo"
  // (ni repuesto ni insumo — son la tienda pública), pero CON existencia:
  // esto sí descuenta su propia unidad, así que sin stock no se puede elegir.
  const opcionesProductoVenta = conStock.filter(p => !esRepuesto(p.category) && !esInsumo(p.category));
  const productoVenta = opcionesProductoVenta.find(p => p.id === productoVentaId) || null;

  // Al elegir el producto en Modo Venta, la garantía se rellena sola desde
  // la que trae configurada el producto — el vendedor no la toca. Cambiar
  // de producto vuelve a auto-rellenar; cambiar de modo no toca nada.
  useEffect(() => {
    if (modoCobro === 'venta' && productoVenta) {
      setGarantia(garantiaDesdeProducto(productoVenta.warranty));
    }
  }, [modoCobro, productoVenta?.id, productoVenta?.warranty]);

  // En Modo Venta, el "producto principal" se comporta como un repuesto
  // más para efectos de stock y de margen (descuenta su propia unidad y
  // su costo real entra al cálculo de ganancia) — pero NO se guarda en
  // `repuestos`: esa lista sigue siendo solo lo que el vendedor agregó a
  // mano, para que la sección "Repuestos usados" no se llene sola y
  // confunda. Se mezcla recién aquí, al calcular y al cobrar.
  const repuestosEfectivos = useMemo(() => {
    if (modoCobro === 'venta' && productoVenta) {
      const principal: InsumoConsumido = {
        productId: productoVenta.id,
        productName: productoVenta.name,
        quantity: productoVentaCantidad,
        costoUnitario: productoVenta.cost || 0,
        precioUnitario: productoVenta.price || 0,
      };
      return [principal, ...repuestos];
    }
    return repuestos;
  }, [modoCobro, productoVenta, productoVentaCantidad, repuestos]);

  // Lo que de verdad se cobra: en Venta es precio × cantidad del producto
  // elegido (nadie lo escribe); en Reparación es el monto que se tipeó.
  const montoEfectivo = modoCobro === 'venta' && productoVenta
    ? (productoVenta.price || 0) * productoVentaCantidad
    : Number(monto) || 0;

  // La descripción que sale impresa: el nombre exacto del producto en
  // Venta, o el texto libre del trabajo en Reparación.
  const descripcionEfectiva = modoCobro === 'venta' && productoVenta
    ? productoVenta.name
    : descripcion;

  const margen = useMemo(
    () => calcularMargen(montoEfectivo, repuestosEfectivos, insumos),
    [montoEfectivo, repuestosEfectivos, insumos]
  );

  const agregarInsumo = (
    productId: string,
    lista: InsumoConsumido[],
    fijar: (v: InsumoConsumido[]) => void
  ) => {
    if (!productId) return;
    const p = productos.find(x => x.id === productId);
    if (!p) return;
    if (lista.some(i => i.productId === productId)) {
      toast.warning('Ese artículo ya está en la lista. Cambie la cantidad en su fila.');
      return;
    }
    fijar([
      ...lista,
      { productId: p.id, productName: p.name, quantity: 1, costoUnitario: p.cost || 0, precioUnitario: p.price || 0 },
    ]);
  };

  /**
   * Trae los repuestos e insumos vinculados al servicio elegido y los
   * mezcla con lo que ya esté en las listas.
   *
   * "Mezcla" y no "reemplaza" a propósito: quien cobra puede haber
   * agregado ya algo a mano antes de acordarse de elegir el servicio, y
   * reemplazar borraría ese trabajo. Un componente que ya estuviera en la
   * lista —por vinculación o agregado a mano— no se duplica; se detecta
   * por productId y se deja como estaba.
   *
   * Si el servicio no tiene nada vinculado, se avisa: un botón que no
   * hace nada visible se lee como un error del sistema.
   */
  const cargarComponentesDelServicio = async () => {
    if (!servicioElegido) return;
    const producto = productos.find(p => p.id === servicioElegido);
    setCargandoComponentes(true);
    try {
      const traidos = await componentesDe(servicioElegido);
      if (traidos.length === 0) {
        toast.warning(
          producto
            ? `${producto.name} no tiene repuestos ni insumos vinculados. Puede agregarlos a mano abajo, o vincularlos en Inventario para la próxima vez.`
            : 'Ese servicio no tiene nada vinculado.'
        );
        return;
      }

      const yaEnRepuestos = new Set(repuestos.map(r => r.productId));
      const yaEnInsumos = new Set(insumos.map(i => i.productId));

      const nuevosRepuestos = traidos.filter(c => {
        const p = productos.find(x => x.id === c.productId);
        return p && esRepuesto(p.category) && !yaEnRepuestos.has(c.productId);
      });
      const nuevosInsumos = traidos.filter(c => {
        const p = productos.find(x => x.id === c.productId);
        return p && esInsumo(p.category) && !yaEnInsumos.has(c.productId);
      });

      if (nuevosRepuestos.length) setRepuestos(r => [...r, ...nuevosRepuestos]);
      if (nuevosInsumos.length) setInsumos(i => [...i, ...nuevosInsumos]);
      if (!descripcion.trim() && producto) setDescripcion(producto.name);

      const total = nuevosRepuestos.length + nuevosInsumos.length;
      const yaEstaban = traidos.length - total;
      toast.success(
        total > 0
          ? `Se agregaron ${total} artículo(s) vinculado(s) a ${producto?.name || 'el servicio'}.` +
            (yaEstaban > 0 ? ` (${yaEstaban} ya estaban en la lista.)` : '')
          : 'Los artículos vinculados ya estaban todos en la lista.'
      );
    } finally {
      setCargandoComponentes(false);
    }
  };

  const cambiarCantidad = (
    productId: string,
    cantidad: number,
    lista: InsumoConsumido[],
    fijar: (v: InsumoConsumido[]) => void
  ) => {
    const p = productos.find(x => x.id === productId);
    const tope = p?.stock ?? 0;
    if (cantidad > tope) {
      toast.warning(`Solo hay ${tope} unidades de ${p?.name} en existencia.`);
      cantidad = tope;
    }
    fijar(lista.map(i => (i.productId === productId ? { ...i, quantity: Math.max(1, cantidad) } : i)));
  };

  /** Igual que `cambiarCantidad`, pero para el producto principal de Modo Venta. */
  const cambiarCantidadProductoVenta = (cantidad: number) => {
    const tope = productoVenta?.stock ?? 0;
    if (cantidad > tope) {
      toast.warning(`Solo hay ${tope} unidades de ${productoVenta?.name} en existencia.`);
      cantidad = tope;
    }
    setProductoVentaCantidad(Math.max(1, cantidad));
  };

  const limpiar = () => {
    setNombre(''); setIdValor(''); setCorreo(''); setTelefono('');
    setDescripcion(''); setMonto(''); setGarantia('3'); setMedio('SINPE');
    setRepuestos([]); setInsumos([]);
    setRepuestoElegido(''); setInsumoElegido('');
    setServicioElegido(''); setModoPrueba(false);
    // El modo (Venta/Reparación) NO se reinicia a propósito: quien cobra
    // suele encadenar varias operaciones del mismo tipo seguidas, y
    // obligarlo a re-elegir el modo en cada una sería fricción sin motivo.
    setProductoVentaId(''); setProductoVentaCantidad(1);
  };

  /** Comprueba TODO antes de tocar el inventario o quemar un consecutivo. */
  const validar = (): string | null => {
    if (!nombre.trim()) return 'Escriba el nombre del cliente.';
    const errorCedula = validateCedula(idTipo, idValor);
    if (errorCedula) return errorCedula;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) return 'El correo no tiene un formato válido.';
    if (!telefono.replace(/\D/g, '')) return 'Escriba el teléfono del cliente.';
    if (modoCobro === 'venta') {
      if (!productoVenta) return 'Seleccione el producto que se está vendiendo.';
    } else {
      if (!descripcion.trim()) return 'Describa el servicio que se está cobrando.';
      if (!monto || Number(monto) <= 0) return 'El monto a cobrar debe ser mayor que cero.';
    }
    // Los insumos que NO son regalía salen desglosados en la factura a su
    // precio normal, tomado del monto total (ver construirLineasFactura).
    // Si suman más que el monto, la línea principal se quedaría en ₡0 o
    // negativa — hay que subir el monto o quitar/regalar algún insumo
    // ANTES de quemar el consecutivo fiscal, no después.
    const totalInsumosCobrados = insumos
      .filter(i => !i.esRegalia)
      .reduce((s, i) => s + i.precioUnitario * i.quantity, 0);
    if (totalInsumosCobrados > montoEfectivo) {
      return `Los insumos desglosados suman ${colones(totalInsumosCobrados)}, más que el monto total (${colones(montoEfectivo)}). ${modoCobro === 'venta' ? 'Suba la cantidad del producto o marque' : 'Suba el monto o marque'} el insumo como regalía.`;
    }
    return null;
  };

  const procesarCobro = async () => {
    const error = validar();
    if (error) { toast.warning(error); return; }

    // El aviso de "sin material" solo tiene sentido en Reparación: en
    // Venta el producto elegido YA ES el material (siempre descuenta su
    // propia unidad), y en modo Sandbox nunca se toca el inventario, así
    // que preguntar por eso aquí solo confundiría.
    if (!modoPrueba && modoCobro === 'reparacion' && repuestos.length === 0 && insumos.length === 0) {
      const confirmarSinMaterial = await confirm({
        title: 'Sin repuestos ni insumos en este cobro',
        message: 'No agregó ningún repuesto ni insumo a la lista. Si el trabajo usó material del inventario, ciérrelo y agréguelo antes de cobrar — una vez emitida la factura no se puede sumar. Si de verdad fue solo mano de obra o diagnóstico, continúe.',
        confirmText: 'No usó material, continuar',
      });
      if (!confirmarSinMaterial) return;
    }

    const seguir = modoPrueba
      ? await confirm({
          title: 'Enviar factura de prueba (Sandbox)',
          message: `Se enviará un correo de PRUEBA a ${correo.trim()} con un PDF de ejemplo, para validar que el envío por correo funciona.\n\nNO descuenta inventario, NO registra una venta y NO suma al control de ganancias — no consume número fiscal.`,
          confirmText: 'Enviar prueba',
        })
      : await confirm({
          title: 'Confirmar el cobro',
          message: `${[
            `Cliente: ${nombre.trim()}`,
            `Monto: ${colones(montoEfectivo)} por ${medio === 'SINPE' ? 'SINPE Móvil' : 'Efectivo'}`,
            insumos.some(i => i.esRegalia)
              ? `Incluye ${insumos.filter(i => i.esRegalia).length} artículo(s) de regalía`
              : null,
            `Se enviará el comprobante a ${correo.trim()}`,
          ].filter(Boolean).join('\n')}\n\nEsta acción descuenta el inventario y emite un comprobante con número fiscal. No se puede deshacer.`,
          confirmText: 'Cobrar',
        });
    if (!seguir) return;

    setCobrando(true);
    setUltimoCobro(null);
    try {
      const datosCobro = {
        clienteNombre: nombre,
        clienteIdTipo: idTipo,
        clienteId: idValor,
        clienteEmail: correo,
        clienteTelefono: telefono,
        descripcionServicio: descripcionEfectiva,
        montoTotal: montoEfectivo,
        garantiaMeses: Number(garantia),
        medioCobro: medio,
        repuestos: repuestosEfectivos,
        insumos,
        adminEmail: currentUser?.email || 'admin',
      };
      const resultado = modoPrueba
        ? await enviarFacturaDePrueba(datosCobro)
        : await cobrarServicio(datosCobro);

      setUltimoCobro(resultado);
      if (resultado.ok) {
        toast.success(resultado.mensaje);
        limpiar();
      } else {
        // 12 segundos: si el cobro entró y el comprobante no, el mensaje
        // trae el número de pedido y hay que poder anotarlo.
        toast.error(resultado.mensaje, resultado.requiereReemision ? 14000 : 8000);
      }
      onDataChanged();
      // `adjust_stock` ya descontó el inventario en Supabase, pero eso pasa
      // por fuera de `saveDB()`: la copia local (`getDB()`) solo se entera
      // cuando llega el evento de Realtime, unos cientos de ms después. Sin
      // este refresco explícito, el stock que se ve aquí mismo tras cobrar
      // podía parecer "sin descontar" aunque en la base ya estuviera bien.
      await refreshProductsFromSupabase();
      setProductos((getDB().products || []).filter(Boolean));
    } finally {
      setCobrando(false);
    }
  };

  /**
   * En la APK, un `<a target="_blank">` a la URL de Supabase lo resuelve
   * Android, no la app: abre el navegador y saca al cajero de la pantalla
   * de cobro. `guardarComprobanteNativo` prueba, en cascada, guardarlo
   * directo en el dispositivo, compartirlo/abrirlo con la hoja nativa de
   * Android, y como último recurso el navegador del sistema — así
   * funciona sin importar si esta instalación ya trae el plugin nativo
   * o no. En la web se fuerza la descarga real del archivo en vez de
   * abrir una pestaña con el visor de PDF del navegador.
   */
  const descargarComprobante = async () => {
    if (!ultimoCobro?.pdfUrl) return;
    setDescargandoPdf(true);
    try {
      const nombreArchivo = `Factura-${ultimoCobro.consecutivo || ultimoCobro.pedidoId}.pdf`;
      const resultado = isNative()
        ? await guardarComprobanteNativo(ultimoCobro.pdfUrl, nombreArchivo)
        : await descargarComprobanteWeb(ultimoCobro.pdfUrl, nombreArchivo);
      if (resultado.ok) {
        if (resultado.mensaje) toast.success(resultado.mensaje);
      } else {
        toast.error(resultado.mensaje);
      }
    } finally {
      setDescargandoPdf(false);
    }
  };

  const reenviarCorreo = async () => {
    if (!ultimoCobro?.invoiceId) return;
    setReenviandoCorreo(true);
    try {
      const resultado = await reenviarComprobantePorCorreo(ultimoCobro.invoiceId);
      if (resultado.ok) toast.success(resultado.mensaje);
      else toast.error(resultado.mensaje);
    } finally {
      setReenviandoCorreo(false);
    }
  };

  return (
    <div className="tv-stack" id="view-facturacion-cobro">
      <PageHead
        title="Cobro de servicios"
        subtitle="Cobra un trabajo terminado, descuenta los insumos del inventario y envía el comprobante al cliente."
        actions={<>
          <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer select-none px-3 py-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-surface)]">
            <input
              type="checkbox"
              checked={modoPrueba}
              onChange={e => setModoPrueba(e.target.checked)}
              className="w-4 h-4 accent-amber-500 cursor-pointer"
            />
            <span className={modoPrueba ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-secondary)]'}>
              Factura de prueba (Sandbox)
            </span>
          </label>
          <Chip tone="accent">SINPE Móvil y Efectivo</Chip>
        </>}
      />

      {/* Selector principal del motor de cobro bifurcado. La elección
          decide qué pide el resto del formulario: en Venta, el producto
          elegido rellena nombre/precio/garantía solo; en Reparación, se
          escribe el trabajo a mano — es el formulario que ya existía. */}
      <div className="tv-row" role="tablist" aria-label="Tipo de cobro">
        <button
          type="button"
          role="tab"
          aria-selected={modoCobro === 'venta'}
          className="tv-btn flex-1"
          data-variant={modoCobro === 'venta' ? 'primary' : 'default'}
          onClick={() => setModoCobro('venta')}
        >
          <ShoppingBag className="w-4 h-4" />
          Modo Venta de Inventario
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={modoCobro === 'reparacion'}
          className="tv-btn flex-1"
          data-variant={modoCobro === 'reparacion' ? 'primary' : 'default'}
          onClick={() => setModoCobro('reparacion')}
        >
          <Wrench className="w-4 h-4" />
          Modo Reparación
        </button>
      </div>

      {modoPrueba && (
        <Card className="!border-amber-500/50 !bg-amber-400/10">
          <p className="text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-300">
            <strong>Modo Sandbox activo.</strong> Al enviar, se manda un correo real de prueba (para validar SMTP)
            con un PDF de ejemplo — pero NO se descuenta inventario, NO se registra la venta y NO cuenta para
            el control de ganancias. No consume número fiscal.
          </p>
        </Card>
      )}

      {ultimoCobro && (
        <Card title={ultimoCobro.ok ? 'Último cobro' : 'Atención'}>
          <div className="flex items-start gap-3">
            {ultimoCobro.ok
              ? <CheckCircle className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
              : <AlertTriangle className="w-5 h-5 flex-shrink-0 text-[#E5484D]" />}
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">{ultimoCobro.mensaje}</p>
              {(ultimoCobro.pdfUrl || ultimoCobro.invoiceId) && (
                <div className="flex flex-wrap gap-2">
                  {ultimoCobro.pdfUrl && (
                    <button type="button" onClick={descargarComprobante} disabled={descargandoPdf} className="tv-btn inline-flex disabled:opacity-60">
                      <Download className="w-4 h-4" />
                      {descargandoPdf ? 'Preparando…' : isNative() ? 'Guardar el comprobante en el dispositivo' : 'Descargar el comprobante'}
                    </button>
                  )}
                  {ultimoCobro.invoiceId && (
                    <button type="button" onClick={reenviarCorreo} disabled={reenviandoCorreo} className="tv-btn inline-flex disabled:opacity-60">
                      <Mail className="w-4 h-4" />
                      {reenviandoCorreo ? 'Enviando…' : 'Reenviar comprobante por correo'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="tv-grid tv-grid-2">
        <Card title="Cliente">
          <div className="tv-stack">
            <Field label="Nombre completo">
              <input className="tv-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellidos" />
            </Field>
            <div className="tv-grid tv-grid-2">
              <Field label="Tipo de identificación">
                <CustomSelect
                  value={idTipo}
                  onChange={v => setIdTipo(v as IdentificacionTipo)}
                  options={TIPOS_IDENTIFICACION}
                />
              </Field>
              <Field label="Número de identificación">
                <input
                  className="tv-input font-mono"
                  value={idValor}
                  onChange={e => setIdValor(e.target.value)}
                  placeholder="Solo dígitos"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Field label="Correo electrónico" hint="Aquí llega el comprobante en PDF.">
              <input className="tv-input font-mono" type="email" value={correo} onChange={e => setCorreo(e.target.value)} placeholder="cliente@correo.com" />
            </Field>
            <Field label="Teléfono">
              <input className="tv-input font-mono" type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="8888 8888" inputMode="tel" />
            </Field>
          </div>
        </Card>

        <Card title={modoCobro === 'venta' ? 'Cobro — Venta de inventario' : 'Cobro — Reparación'}>
          <div className="tv-stack">
            {modoCobro === 'venta' ? (
              <>
                <Field
                  label="Producto"
                  hint="Nombre, precio y garantía se rellenan solos desde el inventario — no se escribe nada a mano."
                >
                  <CustomSelect
                    value={productoVentaId}
                    onChange={v => { setProductoVentaId(v); setProductoVentaCantidad(1); }}
                    searchable
                    searchPlaceholder="Buscar por nombre o SKU..."
                    options={opcionesProductoVenta.map(p => ({
                      value: p.id,
                      label: `${p.name} — ${p.stock} en existencia (${colones(p.price || 0)})`,
                      searchText: p.sku,
                    }))}
                  />
                </Field>

                {productoVenta ? (
                  <div className="rounded-[10px] border border-[var(--border-color)] p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[var(--text-primary)] truncate">{productoVenta.name}</p>
                        <p className="text-[11px] text-[var(--text-muted)] font-mono">SKU {productoVenta.sku}</p>
                      </div>
                      <Chip tone="accent">{OPCIONES_GARANTIA.find(g => g.value === garantia)?.label || `${garantia} meses`}</Chip>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Precio unitario</span>
                        <span className="text-[15px] font-mono font-bold text-[var(--text-primary)]">{colones(productoVenta.price || 0)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Cantidad</span>
                        <input
                          type="number"
                          min={1}
                          value={productoVentaCantidad}
                          onChange={e => cambiarCantidadProductoVenta(Number(e.target.value))}
                          className="tv-input font-mono !w-20"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Total</span>
                        <span className="text-[15px] font-mono font-bold text-[var(--accent)]">{colones(montoEfectivo)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] leading-relaxed text-[var(--text-muted)] rounded-[10px] border border-[var(--border-color)] px-3 py-2.5">
                    Seleccione un producto para rellenar el resto del cobro.
                  </p>
                )}
              </>
            ) : (
              <>
                {opcionesServicio.length > 0 && (
                  <Field
                    label="Servicio del catálogo (opcional)"
                    hint="Si el servicio tiene repuestos o insumos vinculados desde Inventario, se agregan solos abajo."
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex-1 min-w-0">
                        <CustomSelect
                          value={servicioElegido}
                          onChange={setServicioElegido}
                          options={opcionesServicio.map(p => ({ value: p.id, label: p.name }))}
                        />
                      </div>
                      <Btn
                        icon={Link2}
                        onClick={cargarComponentesDelServicio}
                        disabled={!servicioElegido || cargandoComponentes}
                      >
                        {cargandoComponentes ? 'Cargando…' : 'Traer vinculados'}
                      </Btn>
                    </div>
                  </Field>
                )}
                <Field label="Descripción del trabajo" hint="Es lo que sale impreso como detalle en el comprobante.">
                  <textarea
                    className="tv-input"
                    rows={2}
                    value={descripcion}
                    onChange={e => setDescripcion(e.target.value)}
                    placeholder="Cambio de pantalla y limpieza"
                  />
                </Field>
                <div className="tv-grid tv-grid-2">
                  <Field label="Monto total" hint="IVA incluido, tal como lo paga el cliente.">
                    <input
                      className="tv-input font-mono"
                      type="number"
                      min={0}
                      value={monto}
                      onChange={e => setMonto(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field
                    label="Garantía"
                    hint="Solo estos tres plazos. Es lo que sale impreso y lo que el cliente puede reclamar."
                  >
                    <CustomSelect value={garantia} onChange={setGarantia} options={OPCIONES_GARANTIA} />
                  </Field>
                </div>
              </>
            )}
            <Field label="Método de pago" hint="La tarjeta está deshabilitada: no hay procesador de pagos contratado.">
              <div className="tv-row">
                {MEDIOS_DE_COBRO.map(m => (
                  <button
                    key={m.valor}
                    type="button"
                    className="tv-btn"
                    data-variant={medio === m.valor ? 'primary' : 'default'}
                    onClick={() => setMedio(m.valor)}
                  >
                    {m.etiqueta}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>
      </div>

      <ListaDeInsumos
        titulo="Repuestos usados"
        descripcion={modoCobro === 'venta'
          ? 'Repuestos adicionales que se agregan a la venta (aparte del producto principal de arriba). Se descuentan del inventario y bajan el margen; no salen desglosados en la factura.'
          : 'Se descuentan del inventario y bajan el margen. No salen desglosados en la factura: van dentro del precio del trabajo.'}
        icono={Wrench}
        botonAgregar="+ Añadir Repuesto"
        opciones={opcionesRepuesto}
        elegido={repuestoElegido}
        alElegir={setRepuestoElegido}
        lista={repuestos}
        alAgregar={() => { agregarInsumo(repuestoElegido, repuestos, setRepuestos); setRepuestoElegido(''); }}
        alCambiarCantidad={(id, c) => cambiarCantidad(id, c, repuestos, setRepuestos)}
        alQuitar={id => setRepuestos(repuestos.filter(i => i.productId !== id))}
        vacio="Sin repuestos adicionales en este cobro."
      />

      <ListaDeInsumos
        titulo="Insumos"
        descripcion="Temperados, micas, cables y demás material del taller. Si NO se marca como regalía, sale desglosado en la factura a su precio normal (se resta del monto total). Marcado como regalía, se descuenta igual del inventario y cuenta como gasto, pero en la factura sale a ₡0."
        icono={Gift}
        botonAgregar="+ Añadir Insumo"
        facturaEnDetalle
        opciones={opcionesInsumo}
        elegido={insumoElegido}
        alElegir={setInsumoElegido}
        lista={insumos}
        alAgregar={() => { agregarInsumo(insumoElegido, insumos, setInsumos); setInsumoElegido(''); }}
        alCambiarCantidad={(id, c) => cambiarCantidad(id, c, insumos, setInsumos)}
        alQuitar={id => setInsumos(insumos.filter(i => i.productId !== id))}
        alMarcarRegalia={(id, valor) =>
          setInsumos(insumos.map(i => (i.productId === id ? { ...i, esRegalia: valor } : i)))}
        vacio="Sin insumos en este cobro."
      />

      <Card title="Resultado interno de la operación">
        <p className="tv-hint !mt-0 mb-3">
          {modoPrueba
            ? 'Vista previa de cómo se vería el cobro. En modo Sandbox estos números NO se guardan ni afectan el control de ganancias.'
            : 'Este bloque es solo para uso interno: no aparece en la factura ni en ningún documento que reciba el cliente.'}
        </p>
        <div className="tv-grid tv-grid-6">
          <Stat label="Se cobra" value={colones(margen.ingreso)} foot="IVA incluido" />
          <Stat
            label={modoCobro === 'venta' ? 'Costo de mercancía' : 'Costo del trabajo'}
            value={colones(margen.costoRepuestos)}
            foot={`${repuestosEfectivos.length} repuesto(s)/producto(s) + ${insumos.filter(i => !i.esRegalia).length} insumo(s)`}
          />
          <Stat
            label="Costo regalía"
            value={colones(margen.costoRegalias)}
            foot={`${insumos.filter(i => i.esRegalia).length} artículo(s) obsequiado(s)`}
          />
          <Stat
            label="Margen neto"
            value={colones(margen.margenNeto)}
            foot={margen.ingreso > 0 ? `${margen.margenPorcentaje.toFixed(1)}% del cobro` : 'Sin monto todavía'}
            alert={margen.ingreso > 0 && margen.margenNeto < 0}
          />
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={limpiar} disabled={cobrando}>Limpiar formulario</Btn>
        <Btn variant="primary" icon={modoPrueba ? Mail : Receipt} onClick={procesarCobro} disabled={cobrando}>
          {cobrando ? 'Procesando…' : modoPrueba ? 'Enviar correo de prueba' : 'Cobrar y enviar comprobante'}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// LISTA DE INSUMOS
// ---------------------------------------------------------------------
// La misma pieza para repuestos y para regalías: se comportan igual
// —salen del inventario y cuestan dinero— y solo cambian de nombre y de
// tratamiento contable. Duplicarla habría garantizado que un día una de
// las dos dejara de validar el stock.

function ListaDeInsumos({
  titulo, descripcion, icono: Icono, opciones, elegido, alElegir,
  lista, alAgregar, alCambiarCantidad, alQuitar, alMarcarRegalia, vacio,
  facturaEnDetalle, botonAgregar = 'Agregar',
}: {
  titulo: string;
  descripcion: string;
  icono: any;
  /** Texto del botón de agregar — "+ Añadir Repuesto" / "+ Añadir Insumo". */
  botonAgregar?: string;
  opciones: Product[];
  elegido: string;
  alElegir: (v: string) => void;
  lista: InsumoConsumido[];
  alAgregar: () => void;
  alCambiarCantidad: (productId: string, cantidad: number) => void;
  alQuitar: (productId: string) => void;
  /**
   * Solo lo reciben los insumos. Cuando falta, la casilla de regalía no
   * se dibuja — un repuesto no se regala: se instala dentro del trabajo
   * y su costo ya va en el precio del servicio.
   */
  alMarcarRegalia?: (productId: string, valor: boolean) => void;
  vacio: string;
  /**
   * Cuando es true (solo Insumos), lo que NO es regalía sale desglosado
   * en la factura a `precioUnitario` — la columna de la derecha muestra
   * ESE precio, que es lo que el cliente ve impreso. Los repuestos nunca
   * se desglosan, así que siguen mostrando `costoUnitario`, el dato
   * interno de cuánto cuesta la pieza.
   */
  facturaEnDetalle?: boolean;
}) {
  const total = lista.reduce((s, i) => s + i.costoUnitario * i.quantity, 0);
  const regaladas = lista.filter(i => i.esRegalia).length;

  return (
    <Card
      title={titulo}
      actions={lista.length > 0 ? (
        <>
          {regaladas > 0 && <Chip tone="accent">{regaladas} de regalía</Chip>}
          <Chip>Costo interno {colones(total)}</Chip>
        </>
      ) : undefined}
    >
      <p className="tv-hint !mt-0 mb-3">{descripcion}</p>

      {/* Un desplegable vacío no explica nada: quien lo abre y no ve
          opciones no sabe si el sistema falla o si le falta registrar algo.
          Se dice cuál de las dos cosas es. */}
      {opciones.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)] rounded-[10px] border border-[var(--border-color)] px-3 py-2.5 mb-4">
          No hay artículos disponibles para esta lista. Puede ser que todavía no se hayan
          registrado en el inventario, que estén en cero, o que el inventario aún se esté
          cargando — en ese caso aparecerán solos en un momento.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="flex-1 min-w-0">
            <CustomSelect
              value={elegido}
              onChange={alElegir}
              searchable
              searchPlaceholder="Buscar por nombre o SKU..."
              options={opciones.map(p => ({
                value: p.id,
                label: facturaEnDetalle
                  ? `${p.name} — ${p.stock} en existencia (precio ${colones(p.price || 0)})`
                  : `${p.name} — ${p.stock} en existencia (costo ${colones(p.cost || 0)})`,
                searchText: p.sku,
              }))}
            />
          </div>
          <Btn icon={Plus} onClick={alAgregar} disabled={!elegido}>{botonAgregar}</Btn>
        </div>
      )}

      {lista.length === 0 ? (
        <Empty icon={Icono} title="Nada agregado" text={vacio} />
      ) : (
        <div className="space-y-2">
          {lista.map(i => (
            <div
              key={i.productId}
              className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--border-color)] px-3 py-2.5"
            >
              <span className="flex-1 min-w-[140px] text-[13px] font-semibold text-[var(--text-primary)]">
                {i.productName}
              </span>
              <input
                type="number"
                min={1}
                value={i.quantity}
                onChange={e => alCambiarCantidad(i.productId, Number(e.target.value))}
                className="tv-input font-mono !w-20"
                inputMode="numeric"
              />
              {alMarcarRegalia && (
                <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!i.esRegalia}
                    onChange={e => alMarcarRegalia(i.productId, e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  />
                  <span className={i.esRegalia ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                    Regalía
                  </span>
                </label>
              )}
              <span className="text-[12px] font-mono tabular-nums w-28 text-right">
                {i.esRegalia ? (
                  <span className="text-[var(--accent)]">
                    Factura ₡0
                  </span>
                ) : facturaEnDetalle ? (
                  <span className="text-[var(--text-secondary)]" title="Precio que sale desglosado en la factura">
                    {colones(i.precioUnitario * i.quantity)}
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">{colones(i.costoUnitario * i.quantity)}</span>
                )}
              </span>
              <button
                type="button"
                className="tv-icon-btn hover:!text-[#E5484D]"
                onClick={() => alQuitar(i.productId)}
                aria-label={`Quitar ${i.productName}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
