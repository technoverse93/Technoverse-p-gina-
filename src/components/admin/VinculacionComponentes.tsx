// =====================================================================
// VINCULACIÓN DE COMPONENTES
// =====================================================================
// Define de qué se compone un producto o servicio: qué repuestos y qué
// insumos consume, y en qué cantidad.
//
// ---------------------------------------------------------------------
// PARA QUÉ SIRVE ESTO EN LA PRÁCTICA
// ---------------------------------------------------------------------
// Cuando llega el momento de cobrar, quien está en el mostrador no
// tiene por qué acordarse de que un "cambio de pantalla iPhone 12" lleva
// una pantalla, un adhesivo y un temperado de regalo. Si el servicio
// está compuesto, la pantalla de Cobros los propone todos de una vez,
// con sus cantidades, y solo hay que confirmar.
//
// ---------------------------------------------------------------------
// POR QUÉ N-a-N Y NO UN CAMPO EN EL PRODUCTO
// ---------------------------------------------------------------------
// El modelo anterior era `linked_spare_part_sku`: UN repuesto por
// producto, referenciado por un texto. Dos límites que dolían:
//
//   · Un servicio real lleva varias piezas. Con un solo campo había que
//     elegir cuál de ellas "contaba", y el costo salía siempre corto.
//   · Al referenciar por SKU —un texto editable— bastaba corregir una
//     errata en el repuesto para dejar el vínculo apuntando a nada, sin
//     que nadie se enterara hasta que el costo salía mal.
//
// La tabla `product_components` referencia por id con llave foránea: un
// vínculo roto ya no es posible, y no hay tope de componentes.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Trash2, Cpu, Boxes } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { CustomSelect } from '../CustomSelect';
import { useToast } from '../ui/Overlays';
import { esInsumo, esRepuesto } from '../../utils/categorias';
import { Btn, Chip, Empty, colones } from './AdminKit';
import type { Product } from '../../types';

interface Vinculo {
  component_id: string;
  component_name: string;
  component_category: string;
  tipo: 'repuesto' | 'insumo';
  quantity: number;
  component_cost: number;
  component_stock: number;
}

interface Props {
  /** Producto o servicio que se está componiendo. */
  productId: string;
  /** Catálogo completo, para ofrecer los candidatos. */
  productos: Product[];
}

export default function VinculacionComponentes({ productId, productos }: Props) {
  const toast = useToast();
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from('v_product_components')
        .select('component_id, component_name, component_category, tipo, quantity, component_cost, component_stock')
        .eq('product_id', productId);
      if (error) throw error;
      setVinculos((data as Vinculo[]) || []);
    } catch {
      // Si la migración todavía no se ha corrido, la vista no existe. Se
      // muestra vacío en vez de un error: la pantalla de inventario debe
      // seguir sirviendo para todo lo demás.
      setVinculos([]);
    } finally {
      setCargando(false);
    }
  }, [productId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Solo repuestos e insumos pueden ser componentes. Un teléfono del
  // catálogo no compone a otro: eso sería una lista de materiales de
  // fabricación, que no es lo que hace este negocio.
  const candidatos = useMemo(() => {
    const yaPuestos = new Set(vinculos.map(v => v.component_id));
    return productos.filter(p =>
      p.id !== productId &&
      !yaPuestos.has(p.id) &&
      (esRepuesto(p.category) || esInsumo(p.category))
    );
  }, [productos, vinculos, productId]);

  const agregar = async () => {
    if (!elegido) return;
    const p = productos.find(x => x.id === elegido);
    if (!p) return;

    setGuardando(true);
    try {
      const { error } = await supabase.from('product_components').insert({
        product_id: productId,
        component_id: p.id,
        quantity: Math.max(1, cantidad),
        tipo: esInsumo(p.category) ? 'insumo' : 'repuesto',
      });
      if (error) throw error;
      setElegido('');
      setCantidad(1);
      await cargar();
      toast.success(`${p.name} vinculado.`);
    } catch (e: any) {
      toast.error(
        e?.message?.includes('product_components')
          ? 'Ese artículo ya está vinculado a este producto.'
          : `No se pudo vincular: ${e?.message || e}`
      );
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (componentId: string, nombre: string) => {
    setGuardando(true);
    try {
      const { error } = await supabase
        .from('product_components')
        .delete()
        .eq('product_id', productId)
        .eq('component_id', componentId);
      if (error) throw error;
      await cargar();
      toast.success(`${nombre} desvinculado.`);
    } catch (e: any) {
      toast.error(`No se pudo desvincular: ${e?.message || e}`);
    } finally {
      setGuardando(false);
    }
  };

  const cambiarCantidad = async (componentId: string, nueva: number) => {
    const valor = Math.max(1, nueva);
    // Se actualiza la pantalla antes de que responda el servidor: escribir
    // una cantidad y ver el número saltar de vuelta al anterior mientras
    // llega la confirmación se siente como que el campo no funciona.
    setVinculos(v => v.map(x => (x.component_id === componentId ? { ...x, quantity: valor } : x)));
    try {
      await supabase
        .from('product_components')
        .update({ quantity: valor })
        .eq('product_id', productId)
        .eq('component_id', componentId);
    } catch {
      void cargar();   // si falló, se recupera el valor real
    }
  };

  const costoTotal = vinculos.reduce((s, v) => s + (v.component_cost || 0) * (v.quantity || 0), 0);

  return (
    <div className="rounded-[10px] border border-[var(--border-color)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          <Link2 className="w-4 h-4" /> Componentes de este producto
        </span>
        {vinculos.length > 0 && <Chip>Costo en materiales {colones(costoTotal)}</Chip>}
      </div>

      <p className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">
        Repuestos e insumos que consume. Al cobrarlo, la pantalla de Cobros los propone todos
        con su cantidad, para no tener que recordarlos uno por uno.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0">
          <CustomSelect
            value={elegido}
            onChange={setElegido}
            options={candidatos.map(p => ({
              value: p.id,
              label: `${esInsumo(p.category) ? '[Insumo]' : '[Repuesto]'} ${p.name} — ${p.stock} en existencia`,
            }))}
          />
        </div>
        <input
          type="number"
          min={1}
          value={cantidad}
          onChange={e => setCantidad(Number(e.target.value))}
          className="tv-input font-mono !w-24"
          aria-label="Cantidad"
          inputMode="numeric"
        />
        <Btn icon={Plus} onClick={agregar} disabled={!elegido || guardando}>Vincular</Btn>
      </div>

      {cargando ? (
        <p className="text-[12px] text-[var(--text-muted)] py-3">Cargando componentes…</p>
      ) : vinculos.length === 0 ? (
        <Empty
          icon={Link2}
          title="Sin componentes"
          text={
            candidatos.length === 0
              ? 'No hay repuestos ni insumos con los que componer. Regístrelos primero en sus pestañas del inventario.'
              : 'Este producto no consume nada del inventario. Si es un servicio con piezas, vincúlelas aquí.'
          }
        />
      ) : (
        <div className="space-y-2">
          {vinculos.map(v => (
            <div
              key={v.component_id}
              className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--border-color)] px-3 py-2.5"
            >
              {v.tipo === 'insumo'
                ? <Boxes className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
                : <Cpu className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />}
              <span className="flex-1 min-w-[130px] text-[13px] font-semibold text-[var(--text-primary)]">
                {v.component_name}
              </span>
              {v.component_stock <= 0 && <Chip tone="alert">Sin existencias</Chip>}
              <input
                type="number"
                min={1}
                value={v.quantity}
                onChange={e => cambiarCantidad(v.component_id, Number(e.target.value))}
                className="tv-input font-mono !w-20"
                aria-label={`Cantidad de ${v.component_name}`}
                inputMode="numeric"
              />
              <span className="text-[12px] text-[var(--text-muted)] font-mono tabular-nums w-24 text-right">
                {colones((v.component_cost || 0) * (v.quantity || 0))}
              </span>
              <button
                type="button"
                className="tv-icon-btn hover:!text-[#E5484D]"
                onClick={() => quitar(v.component_id, v.component_name)}
                disabled={guardando}
                aria-label={`Desvincular ${v.component_name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
