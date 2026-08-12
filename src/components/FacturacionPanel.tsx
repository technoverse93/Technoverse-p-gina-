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
  Receipt, Gift, Wrench, Plus, Trash2, CheckCircle, Download, AlertTriangle,
} from 'lucide-react';
import { PageHead, Card, Btn, Field, Chip, Stat, Empty, colones } from './admin/AdminKit';
import { CustomSelect } from './CustomSelect';
import { useToast, useConfirm } from './ui/Overlays';
import { getDB } from '../utils/storage';
import { validateCedula } from '../utils/invoicePdf';
import type { IdentificacionTipo } from '../utils/invoicePdf';
import {
  MEDIOS_DE_COBRO, calcularMargen, cobrarServicio,
} from '../utils/facturacion';
import type { MedioCobro, InsumoConsumido, ResultadoCobro } from '../utils/facturacion';
import { esRepuesto } from '../utils/categorias';
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

const GARANTIAS = [
  { value: '3', label: '3 meses (mínimo de ley)' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '0', label: 'Sin garantía' },
];

export default function FacturacionPanel({ currentUser, onDataChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();

  const [productos, setProductos] = useState<Product[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [ultimoCobro, setUltimoCobro] = useState<ResultadoCobro | null>(null);

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

  // ---- Insumos -----------------------------------------------------------
  const [repuestos, setRepuestos] = useState<InsumoConsumido[]>([]);
  const [regalias, setRegalias] = useState<InsumoConsumido[]>([]);
  const [repuestoElegido, setRepuestoElegido] = useState('');
  const [regaliaElegida, setRegaliaElegida] = useState('');

  useEffect(() => {
    const db = getDB();
    setProductos((db.products || []).filter(Boolean));
  }, []);

  const margen = useMemo(
    () => calcularMargen(Number(monto) || 0, repuestos, regalias),
    [monto, repuestos, regalias]
  );

  const conStock = productos.filter(p => (p.stock || 0) > 0);
  const opcionesRepuesto = conStock.filter(p => esRepuesto(p.category));
  // Para la regalía sirve cualquier artículo con existencias: lo habitual es
  // un temperado o una funda, que no son repuestos de taller.
  const opcionesRegalia = conStock;

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
      { productId: p.id, productName: p.name, quantity: 1, costoUnitario: p.cost || 0 },
    ]);
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

  const limpiar = () => {
    setNombre(''); setIdValor(''); setCorreo(''); setTelefono('');
    setDescripcion(''); setMonto(''); setGarantia('3'); setMedio('SINPE');
    setRepuestos([]); setRegalias([]);
    setRepuestoElegido(''); setRegaliaElegida('');
  };

  /** Comprueba TODO antes de tocar el inventario o quemar un consecutivo. */
  const validar = (): string | null => {
    if (!nombre.trim()) return 'Escriba el nombre del cliente.';
    const errorCedula = validateCedula(idTipo, idValor);
    if (errorCedula) return errorCedula;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) return 'El correo no tiene un formato válido.';
    if (!telefono.replace(/\D/g, '')) return 'Escriba el teléfono del cliente.';
    if (!descripcion.trim()) return 'Describa el servicio que se está cobrando.';
    if (!monto || Number(monto) <= 0) return 'El monto a cobrar debe ser mayor que cero.';
    return null;
  };

  const procesarCobro = async () => {
    const error = validar();
    if (error) { toast.warning(error); return; }

    const resumen = [
      `Cliente: ${nombre.trim()}`,
      `Monto: ${colones(Number(monto))} por ${medio === 'SINPE' ? 'SINPE Móvil' : 'Efectivo'}`,
      regalias.length > 0 ? `Incluye ${regalias.length} artículo(s) de regalía` : null,
      `Se enviará el comprobante a ${correo.trim()}`,
    ].filter(Boolean).join('\n');

    const seguir = await confirm({
      title: 'Confirmar el cobro',
      message: `${resumen}\n\nEsta acción descuenta el inventario y emite un comprobante con número fiscal. No se puede deshacer.`,
      confirmText: 'Cobrar',
    });
    if (!seguir) return;

    setCobrando(true);
    setUltimoCobro(null);
    try {
      const resultado = await cobrarServicio({
        clienteNombre: nombre,
        clienteIdTipo: idTipo,
        clienteId: idValor,
        clienteEmail: correo,
        clienteTelefono: telefono,
        descripcionServicio: descripcion,
        montoTotal: Number(monto),
        garantiaMeses: Number(garantia),
        medioCobro: medio,
        repuestos,
        regalias,
        adminEmail: currentUser?.email || 'admin',
      });

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
      setProductos((getDB().products || []).filter(Boolean));
    } finally {
      setCobrando(false);
    }
  };

  return (
    <div className="tv-stack" id="view-facturacion-cobro">
      <PageHead
        title="Cobro de servicios"
        subtitle="Cobra un trabajo terminado, descuenta los insumos del inventario y envía el comprobante al cliente."
        actions={<Chip tone="accent">SINPE Móvil y Efectivo</Chip>}
      />

      {ultimoCobro && (
        <Card title={ultimoCobro.ok ? 'Último cobro' : 'Atención'}>
          <div className="flex items-start gap-3">
            {ultimoCobro.ok
              ? <CheckCircle className="w-5 h-5 flex-shrink-0 text-[var(--ok)]" />
              : <AlertTriangle className="w-5 h-5 flex-shrink-0 text-[#E5484D]" />}
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">{ultimoCobro.mensaje}</p>
              {ultimoCobro.pdfUrl && (
                <a href={ultimoCobro.pdfUrl} target="_blank" rel="noopener noreferrer" className="tv-btn inline-flex">
                  <Download className="w-4 h-4" /> Descargar el comprobante
                </a>
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

        <Card title="Cobro">
          <div className="tv-stack">
            <Field label="Servicio prestado" hint="Es lo que sale impreso como detalle en el comprobante.">
              <textarea
                className="tv-input"
                rows={2}
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Cambio de pantalla iPhone 12"
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
              <Field label="Garantía">
                <CustomSelect value={garantia} onChange={setGarantia} options={GARANTIAS} />
              </Field>
            </div>
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
        descripcion="Se descuentan del inventario y bajan el margen. No salen desglosados en la factura: van dentro del precio del servicio."
        icono={Wrench}
        opciones={opcionesRepuesto}
        elegido={repuestoElegido}
        alElegir={setRepuestoElegido}
        lista={repuestos}
        alAgregar={() => { agregarInsumo(repuestoElegido, repuestos, setRepuestos); setRepuestoElegido(''); }}
        alCambiarCantidad={(id, c) => cambiarCantidad(id, c, repuestos, setRepuestos)}
        alQuitar={id => setRepuestos(repuestos.filter(i => i.productId !== id))}
        vacio="Sin repuestos. Si el trabajo no consumió piezas, deje esta lista vacía."
      />

      <ListaDeInsumos
        titulo="Regalía por primera compra"
        descripcion="Sale del inventario y se contabiliza como gasto interno, pero en la factura aparece como Descuento 100% con costo ₡0."
        icono={Gift}
        opciones={opcionesRegalia}
        elegido={regaliaElegida}
        alElegir={setRegaliaElegida}
        lista={regalias}
        alAgregar={() => { agregarInsumo(regaliaElegida, regalias, setRegalias); setRegaliaElegida(''); }}
        alCambiarCantidad={(id, c) => cambiarCantidad(id, c, regalias, setRegalias)}
        alQuitar={id => setRegalias(regalias.filter(i => i.productId !== id))}
        vacio="Sin regalía en este cobro."
      />

      <Card title="Resultado interno de la operación">
        <p className="tv-hint !mt-0 mb-3">
          Este bloque es solo para uso interno: no aparece en la factura ni en ningún documento que reciba el cliente.
        </p>
        <div className="tv-grid tv-grid-6">
          <Stat label="Se cobra" value={colones(margen.ingreso)} foot="IVA incluido" />
          <Stat label="Costo repuestos" value={colones(margen.costoRepuestos)} foot={`${repuestos.length} artículo(s)`} />
          <Stat label="Costo regalía" value={colones(margen.costoRegalias)} foot={`${regalias.length} artículo(s)`} />
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
        <Btn variant="primary" icon={Receipt} onClick={procesarCobro} disabled={cobrando}>
          {cobrando ? 'Procesando…' : 'Cobrar y enviar comprobante'}
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
  lista, alAgregar, alCambiarCantidad, alQuitar, vacio,
}: {
  titulo: string;
  descripcion: string;
  icono: any;
  opciones: Product[];
  elegido: string;
  alElegir: (v: string) => void;
  lista: InsumoConsumido[];
  alAgregar: () => void;
  alCambiarCantidad: (productId: string, cantidad: number) => void;
  alQuitar: (productId: string) => void;
  vacio: string;
}) {
  const total = lista.reduce((s, i) => s + i.costoUnitario * i.quantity, 0);

  return (
    <Card
      title={titulo}
      actions={lista.length > 0 ? <Chip>Costo interno {colones(total)}</Chip> : undefined}
    >
      <p className="tv-hint !mt-0 mb-3">{descripcion}</p>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <CustomSelect
            value={elegido}
            onChange={alElegir}
            options={opciones.map(p => ({
              value: p.id,
              label: `${p.name} — ${p.stock} en existencia (costo ${colones(p.cost || 0)})`,
            }))}
          />
        </div>
        <Btn icon={Plus} onClick={alAgregar} disabled={!elegido}>Agregar</Btn>
      </div>

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
              <span className="text-[12px] text-[var(--text-muted)] font-mono tabular-nums w-24 text-right">
                {colones(i.costoUnitario * i.quantity)}
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
