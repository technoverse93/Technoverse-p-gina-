// =====================================================================
// PANEL GENERAL
// =====================================================================
// La primera pantalla del panel. Su trabajo no es enseñar todos los
// datos que existen, sino contestar en cinco segundos: ¿cómo va el
// negocio hoy y hay algo que tenga que atender YA?
//
// ---------------------------------------------------------------------
// QUÉ SE QUITÓ Y POR QUÉ
// ---------------------------------------------------------------------
// · El gráfico de barras hecho a mano con divs ("Actividad reciente de
//   transacciones"). No era un gráfico: la altura de cada barra era el
//   total del pedido dividido entre la suma de TODOS los pedidos, así
//   que con dos ventas se veía enorme y con doscientas se aplanaba a
//   nada. No se podía leer ningún dato de ahí. En su lugar va la lista
//   real de los últimos pedidos, que sí se puede usar.
//
// · Los rótulos decorativos ("Cierre de caja OK", "Flujo optimizado",
//   "Sistema en línea • San José, CR"). Ninguno salía de un dato: eran
//   texto fijo. Un panel que afirma cosas que no ha comprobado enseña a
//   desconfiar de todo lo demás que dice.
//
// · Los seis colores distintos en seis tarjetas contiguas. Ahora el
//   color aparece SOLO cuando algo requiere acción, y por eso se ve.
// =====================================================================

import React, { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import {
  TrendingUp, Users, Wrench, Package, ShieldAlert, ShoppingBag,
  ArrowRight, CircleAlert,
} from 'lucide-react';
import { PageHead, Card, Stat, Chip, Btn, Empty, TableShell, colones } from './AdminKit';
import { useTema } from '../ui/BotonTema';
import { CATEGORIAS_TIENDA } from '../../utils/categorias';
import type { Product, Order, RepairOrder, ClientProfile } from '../../types';

interface Props {
  products: Product[];
  orders: Order[];
  repairs: RepairOrder[];
  clients: ClientProfile[];
  isMounted: boolean;
  /** Salta a otro módulo. Alimenta los botones de "Atención requerida". */
  onNavigate: (tab: string) => void;
}

export default function AdminDashboard({
  products, orders, repairs, clients, isMounted, onNavigate,
}: Props) {
  // Va ARRIBA del todo, antes del `return` del esqueleto: es un hook, y
  // saltárselo en ese render rompería el orden de hooks de React.
  const esOscuro = useTema() === 'oscuro';

  const ventasCompletadas = orders.filter(o => o && o.status === 'Completado');
  const ingresos = ventasCompletadas.reduce((suma, o) => suma + (o.total || 0), 0);
  const reparacionesActivas = repairs.filter(r => r && r.status !== 'Entregada' && r.status !== 'Cancelada').length;
  const esperandoRepuestos = repairs.filter(r => r && r.status === 'Esperando repuestos').length;
  // REGLA SIMPLIFICADA A PROPÓSITO (orden explícita): "última unidad" y
  // nada más. Ni umbral fijo ni `minStock` configurable — cantidad == 1
  // dispara la alerta, cantidad > 1 no dispara nada. Sin configuración
  // que mantener ni que se pueda desalinear entre productos.
  const stockCritico = products.filter(p => p && p.stock === 1).length;
  const unidadesTotales = products.reduce((suma, p) => suma + (p ? (p.stock || 0) : 0), 0);
  const espacioLibre = Math.max(0, 100 - Math.min(100, Math.round((unidadesTotales / 300) * 100)));

  // Ventas de los últimos siete días. Siete y no cinco porque así la
  // comparación cubre una semana completa: con cinco, un lunes se
  // comparaba contra un sábado y parecía una caída del negocio.
  const ventasPorDia = useMemo(() => {
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        name: d.toLocaleDateString('es-CR', { weekday: 'short' }).replace('.', ''),
        fecha: d.toISOString().split('T')[0],
        ventas: 0,
      };
    });
    ventasCompletadas.forEach(o => {
      if (!o?.timestamp) return;
      const dia = dias.find(d => d.fecha === o.timestamp.split('T')[0]);
      if (dia) dia.ventas += o.total || 0;
    });
    return dias;
  }, [orders]);

  const distribucionInventario = useMemo(() => {
    return CATEGORIAS_TIENDA
      .map(cat => ({
        name: cat.length > 11 ? `${cat.slice(0, 10)}…` : cat,
        stock: products.filter(p => p && p.category === cat).reduce((s, p) => s + (p.stock || 0), 0),
      }))
      .filter(d => d.stock > 0);
  }, [products]);

  const ultimosPedidos = useMemo(
    () => [...orders].filter(Boolean).slice(-8).reverse(),
    [orders]
  );

  // Control de ganancias: antes el costo de los repuestos e insumos de
  // cada cobro solo quedaba como texto libre dentro de la bitácora de
  // auditoría (`audit_logs.detail`), así que ningún reporte podía
  // sumarlo — de ahí la queja de que los repuestos "no sumaban" en
  // ganancias. Ahora `cobrarServicio()` guarda `costoRepuestos`,
  // `costoRegalias` y `margenNeto` como columnas propias del pedido (ver
  // facturacion.ts), y aquí simplemente se suman.
  const margenTotal = ventasCompletadas.reduce((s, o) => s + (o.margenNeto ?? (o.total - (o.costoRepuestos || 0) - (o.costoRegalias || 0))), 0);
  const costoRepuestosTotal = ventasCompletadas.reduce((s, o) => s + (o.costoRepuestos || 0), 0);
  const costoRegaliasTotal = ventasCompletadas.reduce((s, o) => s + (o.costoRegalias || 0), 0);

  // Solo lo que exige que alguien haga algo. Si el array queda vacío la
  // tarjeta no se dibuja: un panel de alertas siempre presente y siempre
  // en verde se vuelve invisible a la semana.
  const pendientes = [
    esperandoRepuestos > 0 && {
      texto: `${esperandoRepuestos} ${esperandoRepuestos === 1 ? 'reparación detenida' : 'reparaciones detenidas'} esperando repuestos`,
      accion: 'Abrir taller',
      tab: 'taller',
    },
    stockCritico > 0 && {
      texto: `${stockCritico} ${stockCritico === 1 ? 'artículo tiene' : 'artículos tienen'} última unidad en existencia`,
      accion: 'Ver productos',
      tab: 'inventario_productos',
    },
  ].filter(Boolean) as { texto: string; accion: string; tab: string }[];

  if (!isMounted) return <Esqueleto />;

  // Recharts pinta sus SVG con estilos en línea y no lee variables CSS,
  // así que los colores hay que dárselos ya resueltos.
  //
  // FALLO CORREGIDO: esto estaba fijo a los valores del tema CLARO, con
  // un comentario que decía "único tema, sin rama que mantener" — cierto
  // cuando se escribió, pero el tema oscuro volvió después y nadie
  // regresó aquí. En oscuro la rejilla salía en gris casi blanco y el
  // globo de datos con fondo blanco y letra negra sobre el panel oscuro.
  const ejes = esOscuro ? '#6F7D77' : '#8792A8';
  const rejilla = esOscuro ? '#202724' : '#EEF1F6';
  const globo = {
    background: esOscuro ? '#1A211E' : '#FFFFFF',
    border: `1px solid ${esOscuro ? '#272F2B' : '#E4E8EF'}`,
    borderRadius: '10px',
    color: esOscuro ? '#E6EDE9' : '#0F172A',
    fontSize: '12px',
    fontWeight: 600,
    boxShadow: '0 10px 26px -14px rgba(0,0,0,0.35)',
  };

  return (
    <div className="tv-stack">
      <PageHead
        title="Panel general"
        subtitle="Estado del negocio hoy: ventas, taller, inventario y lo que necesita atención."
        actions={<Chip tone={pendientes.length ? 'alert' : 'ok'}>
          {pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? 'pendiente' : 'pendientes'}` : 'Sin pendientes'}
        </Chip>}
      />

      {pendientes.length > 0 && (
        <Card title="Atención requerida" padded={false}>
          <div>
            {pendientes.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-soft)] last:border-b-0"
              >
                <CircleAlert className="w-4 h-4 flex-shrink-0 text-[var(--tv-danger,#E5484D)]" aria-hidden="true" />
                <span className="text-[13px] text-[var(--text-primary)] flex-1 min-w-0">{p.texto}</span>
                <Btn variant="ghost" onClick={() => onNavigate(p.tab)}>
                  {p.accion} <ArrowRight className="w-3.5 h-3.5" />
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="tv-grid tv-grid-6">
        <Stat
          label="Ingresos"
          value={colones(ingresos)}
          foot={`${ventasCompletadas.length} ${ventasCompletadas.length === 1 ? 'venta completada' : 'ventas completadas'}`}
          icon={TrendingUp}
        />
        <Stat
          label="Clientes"
          value={clients.length}
          foot="Registrados en el CRM"
          icon={Users}
        />
        <Stat
          label="En taller"
          value={reparacionesActivas}
          foot="Reparaciones en curso"
          icon={Wrench}
        />
        <Stat
          label="Sin repuesto"
          value={esperandoRepuestos}
          foot={esperandoRepuestos > 0 ? 'Detenidas, requieren compra' : 'Ninguna detenida'}
          icon={ShieldAlert}
          alert={esperandoRepuestos > 0}
        />
        <Stat
          label="Última unidad"
          value={stockCritico}
          foot={stockCritico > 0 ? 'Con 1 unidad en existencia' : 'Ninguno en última unidad'}
          icon={Package}
          alert={stockCritico > 0}
        />
        <Stat
          label="Bodega libre"
          value={`${espacioLibre}%`}
          foot={`${unidadesTotales.toLocaleString('es-CR')} unidades guardadas`}
          icon={ShoppingBag}
        />
      </div>

      <Card title="Control de ganancias">
        <p className="tv-hint !mt-0 mb-3">
          Suma el costo real de los repuestos e insumos facturados en cada cobro — no solo el ingreso bruto.
        </p>
        <div className="tv-grid tv-grid-3">
          <Stat label="Ingresos" value={colones(ingresos)} foot="Bruto, IVA incluido" icon={TrendingUp} />
          <Stat
            label="Costo de repuestos e insumos"
            value={colones(costoRepuestosTotal)}
            foot={costoRegaliasTotal > 0 ? `+ ${colones(costoRegaliasTotal)} en regalías` : 'Sin regalías entregadas'}
            icon={Wrench}
          />
          <Stat
            label="Margen neto"
            value={colones(margenTotal)}
            foot={ingresos > 0 ? `${((margenTotal / ingresos) * 100).toFixed(1)}% sobre ingresos` : 'Sin ventas todavía'}
            icon={ShieldAlert}
            alert={margenTotal < 0}
          />
        </div>
      </Card>

      <div className="tv-grid tv-grid-2">
        <Card title="Ventas de los últimos 7 días">
          <div style={{ height: 260 }}>
            {ventasCompletadas.length === 0 ? (
              <Empty
                icon={TrendingUp}
                title="Todavía no hay ventas completadas"
                text="En cuanto se cierre el primer pedido, la curva de la semana aparece aquí."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ventasPorDia} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tvVentas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={rejilla} vertical={false} />
                  <XAxis dataKey="name" stroke={ejes} fontSize={11} tickLine={false} axisLine={false} dy={8} />
                  <YAxis
                    stroke={ejes}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                    tickFormatter={(v: number) => (v >= 1000 ? `₡${Math.round(v / 1000)}k` : `₡${v}`)}
                  />
                  <Tooltip
                    contentStyle={globo}
                    formatter={(v: number) => [colones(v), 'Ventas']}
                    cursor={{ stroke: 'var(--accent)', strokeOpacity: 0.3 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ventas"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#tvVentas)"
                    animationDuration={700}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card title="Existencias por categoría">
          <div style={{ height: 260 }}>
            {distribucionInventario.length === 0 ? (
              <Empty
                icon={Package}
                title="Sin existencias registradas"
                text="Agregue productos con stock para ver cómo se reparte el inventario."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribucionInventario} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={rejilla} vertical={false} />
                  <XAxis dataKey="name" stroke={ejes} fontSize={10.5} tickLine={false} axisLine={false} dy={8} interval={0} />
                  <YAxis stroke={ejes} fontSize={11} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                  <Tooltip
                    contentStyle={globo}
                    cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }}
                    formatter={(v: number) => [`${v} unidades`, 'Existencias']}
                  />
                  <Bar dataKey="stock" fill="var(--accent)" radius={[5, 5, 0, 0]} animationDuration={700} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card title="Últimos pedidos" padded={false}>
        {ultimosPedidos.length === 0 ? (
          <Empty
            icon={ShoppingBag}
            title="Aún no hay pedidos"
            text="Los pedidos de la tienda aparecen aquí en cuanto se registran, con su estado y su total."
          />
        ) : (
          <TableShell
            head={<>
              <th>Consecutivo</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'center' }}>Estado</th>
            </>}
          >
            <tbody>
              {ultimosPedidos.map(o => (
                <tr key={o.id}>
                  <td className="font-mono text-[12px] text-[var(--text-secondary)]">{o.id}</td>
                  <td className="font-semibold">{o.customerName}</td>
                  <td className="text-[12px] text-[var(--text-muted)]">
                    {o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-CR') : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }} className="font-semibold tabular-nums">{colones(o.total)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <Chip tone={estadoATono(o.status)}>{o.status}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

function estadoATono(estado: string): 'ok' | 'alert' | 'accent' | undefined {
  if (estado === 'Completado') return 'ok';
  if (estado === 'Devuelto' || estado === 'Cancelado') return 'alert';
  return 'accent';
}

/**
 * Lo que se ve mientras llegan los datos.
 *
 * Reproduce la MISMA retícula del contenido real para que al aparecer
 * los datos nada se mueva de sitio. Un esqueleto con otra forma produce
 * un salto de layout y se percibe como si la pantalla parpadeara.
 */
function Esqueleto() {
  const bloque = 'rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-surface)] animate-pulse';
  return (
    <div className="tv-stack" aria-busy="true" aria-label="Cargando el panel">
      <div className="tv-page-head">
        <div className="space-y-2">
          <div className={`${bloque} h-6 w-48`} />
          <div className={`${bloque} h-3.5 w-72`} />
        </div>
      </div>
      <div className="tv-grid tv-grid-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`${bloque} h-[104px]`} />)}
      </div>
      <div className="tv-grid tv-grid-2">
        <div className={`${bloque} h-[330px]`} />
        <div className={`${bloque} h-[330px]`} />
      </div>
      <div className={`${bloque} h-[260px]`} />
    </div>
  );
}
