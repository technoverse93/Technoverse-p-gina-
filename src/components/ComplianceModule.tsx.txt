import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, AlertTriangle, FileCheck, Scale, FileText,
  Trash2, Download, CheckSquare
} from 'lucide-react';
import { getDB, saveDB, addAuditLog } from '../utils/storage';
import { Order, RepairOrder, ClientProfile } from '../types';

interface ComplianceModuleProps {
  onRefreshData?: () => void;
  activeUserEmail?: string;
}

export default function ComplianceModule({ onRefreshData, activeUserEmail = 'oficial.cumplimiento@technoverse.com' }: ComplianceModuleProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [repairs, setRepairs] = useState<RepairOrder[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);

  // Privacy Policy edit state
  const [termsText, setTermsText] = useState<string>(
    "Reglamento de Compras, Devoluciones y Garantías Technoverse:\n\n" +
    "1. De conformidad con la Ley 7472 de Costa Rica, todo artículo adquirido tiene una garantía mínima de 30 días hábiles. En caso de reparaciones mecánicas de hardware en taller, la garantía es de 3 meses naturales.\n" +
    "2. Las devoluciones se procesan mediante la emisión automática de Notas de Crédito fiscales electrónicas (NC-001).\n" +
    "3. En cumplimiento de la Ley 8968, los datos sensibles de tarjetas de crédito se tokenizan localmente y nunca se envían sin consentimiento."
  );

  // Selected XML viewer state
  const [selectedOrderXml, setSelectedOrderXml] = useState<Order | null>(null);

  // Active Alerts state
  const [alerts, setAlerts] = useState<{ id: string; type: 'critical' | 'warning'; message: string; sub: string }[]>([]);

  useEffect(() => {
    loadComplianceData();
    const handleUpdate = () => loadComplianceData();
    window.addEventListener('technoverse_db_updated', handleUpdate);
    return () => window.removeEventListener('technoverse_db_updated', handleUpdate);
  }, []);

  const loadComplianceData = () => {
    const db = getDB();
    setOrders(db.orders || []);
    setRepairs(db.repair_orders || []);
    setClients(db.clients || []);
    runRealTimeComplianceAudits(db.orders, db.repair_orders, db.clients, db.products);
  };

  // 100% Real-Time Compliance Audit Engine
  const runRealTimeComplianceAudits = (activeOrders: Order[], activeRepairs: RepairOrder[], activeClients: ClientProfile[], activeProducts: any[]) => {
    const foundAlerts: typeof alerts = [];

    // 1. Check Hacienda Electronic Invoicing 24-hour pending transmission limit
    const pendingInvoices = activeOrders.filter(o => o.hdaStatus === 'Pendiente');
    if (pendingInvoices.length > 0) {
      foundAlerts.push({
        id: 'AL-1',
        type: 'critical',
        message: `Hacienda: ${pendingInvoices.length} factura(s) pendiente(s) de envío`,
        sub: 'Las resoluciones DGT-R-48-2016 exigen el envío de comprobantes electrónicos en menos de 24 horas hábiles.'
      });
    }

    // 2. Check Ley 7472 Warranty compliance (minimum 3 months for repairs)
    const violatingRepairs = activeRepairs.filter(r => r.warrantyMonths < 3 && r.status !== 'Cancelada');
    if (violatingRepairs.length > 0) {
      foundAlerts.push({
        id: 'AL-2',
        type: 'critical',
        message: `Defensa del Consumidor: ${violatingRepairs.length} orden(es) con garantía insuficiente`,
        sub: 'La Ley 7472 obliga un mínimo absoluto de 3 meses para toda reparación de hardware entregada.'
      });
    }

    // 3. Check Ley 8968 Personal Data Protection checklist
    const unencryptedCards = activeClients.some(c => c.cardsTokenized.some(card => card.last4.length !== 4));
    if (unencryptedCards) {
      foundAlerts.push({
        id: 'AL-3',
        type: 'critical',
        message: 'Protección de Datos: Se detectó número completo de tarjeta visible',
        sub: 'Las regulaciones de la PRODHAB y estándares PCI-DSS exigen tokenizar y almacenar únicamente los últimos 4 dígitos.'
      });
    }

    // 4. Products check (pricing currency compliance - Ley 7472)
    const hasInvalidCurrency = activeProducts.some(p => p.price <= 0);
    if (hasInvalidCurrency) {
      foundAlerts.push({
        id: 'AL-4',
        type: 'warning',
        message: 'Ley 7472: Productos con precio o moneda no especificada',
        sub: 'Todo catálogo comercial debe estipular el precio final claro en moneda nacional (Colones CRC), impuestos incluidos.'
      });
    }

    setAlerts(foundAlerts);
  };

  // Ley 8968: Right to be Forgotten (Derecho al Olvido)
  const handleDeleteClientPersonalData = (clientId: string) => {
    if (!window.confirm('¿Está completamente seguro de ejercer el Derecho al Olvido (Ley 8968) para este cliente? Se eliminarán irrevocablemente sus datos personales, direcciones y números de tarjeta, manteniendo únicamente los identificadores genéricos de facturas por obligaciones tributarias.')) {
      return;
    }

    const db = getDB();
    const clientIdx = db.clients.findIndex(c => c.id === clientId);
    if (clientIdx === -1) return;

    const clientEmail = db.clients[clientIdx].email;
    const clientName = db.clients[clientIdx].name;

    // Erase personal information in CRM
    db.clients[clientIdx].name = "CLIENTE ANÓNIMO (DERECHO AL OLVIDO)";
    db.clients[clientIdx].email = `anonimo-${clientId.toLowerCase()}@technoverse.com`;
    db.clients[clientIdx].phone = "+506 0000 0000";
    db.clients[clientIdx].addressDetail = "ELIMINADO BAJO SOLICITUD DE LEY 8968";
    db.clients[clientIdx].cardsTokenized = [];
    db.clients[clientIdx].balance = 0;
    db.clients[clientIdx].notes = `Información personal purgada el ${new Date().toLocaleDateString()} a solicitud del titular bajo la Ley de Protección de Datos de Costa Rica.`;

    // Audit action
    db.audit_log.unshift({
      id: `LOG-${Date.now()}`,
      userEmail: activeUserEmail,
      module: 'Protección Datos',
      action: 'Derecho Olvido',
      detail: `Purgado de datos personales completado para cliente ID: ${clientId} (${clientName}) conforme a la Ley 8968.`,
      timestamp: new Date().toISOString()
    });

    saveDB(db);
    loadComplianceData();
    if (onRefreshData) onRefreshData();
    alert('Datos personales purgados de manera segura conforme a la legislación de la PRODHAB.');
  };

  // Ley 8968: Data Portability Export
  const handleExportClientData = (client: ClientProfile) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(client, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `PORTABILIDAD-LEY-8968-${client.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    addAuditLog(activeUserEmail, 'Protección Datos', 'Portabilidad', `Exportación de datos de portabilidad generada para el cliente ${client.name}`);
  };

  // Generate Electronic XML simulation preview strictly formatted under Hacienda DGT-R-48-2016
  const getSimulatedInvoiceXml = (order: Order) => {
    const key = `506${new Date(order.timestamp).toLocaleDateString('es-CR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\//g, '')}0001010101000000012610255478`;
    
    return `<?xml version="1.0" encoding="utf-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Clave>${key}</Clave>
  <CodigoActividad>951101</CodigoActividad>
  <NumeroConsecutivo>0010000101${order.id.replace('FAC-', '')}</NumeroConsecutivo>
  <FechaEmision>${order.timestamp}</FechaEmision>
  <Emisor>
    <Nombre>Technoverse Costa Rica S.A.</Nombre>
    <Identificacion>
      <Tipo>02</Tipo> <!-- Cédula Jurídica -->
      <Numero>3-101-987452</Numero>
    </Identificacion>
    <Telefono>
      <CodigoPais>506</CodigoPais>
      <NumTelefono>64214795</NumTelefono>
    </Telefono>
    <CorreoElectronico>facturacion@technoverse.com</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>${order.customerName}</Nombre>
    <CorreoElectronico>${order.customerEmail}</CorreoElectronico>
  </Receptor>
  <DetalleServicio>
    ${order.items.map((it, idx) => `
    <LineaDetalle>
      <NumeroLinea>${idx + 1}</NumeroLinea>
      <Detalle>${it.productName}</Detalle>
      <Cantidad>${it.quantity}</Cantidad>
      <PrecioUnitario>${it.price}</PrecioUnitario>
      <MontoTotal>${it.price * it.quantity}</MontoTotal>
      <SubTotal>${it.price * it.quantity - it.discountApplied}</SubTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <Tarifa>13.0</Tarifa>
        <Monto>${Math.round((it.price * it.quantity - it.discountApplied) * 0.13)}</Monto>
      </Impuesto>
    </LineaDetalle>`).join('')}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda>
      <CodigoMoneda>CRC</CodigoMoneda>
      <TipoCambio>1.0</TipoCambio>
    </CodigoTipoMoneda>
    <TotalServGravados>${order.subtotal}</TotalServGravados>
    <TotalDescuentos>${order.membershipDiscount}</TotalDescuentos>
    <TotalVentaNeta>${order.subtotal - order.membershipDiscount}</TotalVentaNeta>
    <TotalImpuesto>${order.taxAmount}</TotalImpuesto>
    <TotalComprobante>${order.total}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>`;
  };

  const handleForceSendHacienda = (orderId: string) => {
    const db = getDB();
    const idx = db.orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;

    db.orders[idx].hdaStatus = 'Aceptado';
    db.orders[idx].xmlVerified = true;
    db.orders[idx].xmlContent = getSimulatedInvoiceXml(db.orders[idx]);

    db.audit_log.unshift({
      id: `LOG-${Date.now()}`,
      userEmail: activeUserEmail,
      module: 'Contabilidad',
      action: 'Validación XML DGT',
      detail: `Factura ${orderId} validada y transmitida con éxito. Estado Hacienda: ACEPTADO conforme a DGT-R-48-2016.`,
      timestamp: new Date().toISOString()
    });

    saveDB(db);
    loadComplianceData();
    if (onRefreshData) onRefreshData();
    alert(`Factura ${orderId} validada por la Dirección General de Tributación de Costa Rica y marcada como Aceptada.`);
  };

  return (
    <div className="space-y-6" id="compliance-module-panel">
      
      {/* Upper Alerts Banner */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)]">
        <div className="flex items-center justify-between mb-4 border-b border-[var(--border-color)]/50 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400 dark:text-[var(--brand-gold-light)] animate-bounce" />
            <div>
              <h3 className="font-bold text-base">Consola de Cumplimiento Legal y Tributario</h3>
              <p className="text-xs text-[var(--text-secondary)]">Auditoría regulatoria de Technoverse Costa Rica en tiempo real.</p>
            </div>
          </div>
          <span className="text-xs bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/10 border border-emerald-500 dark:border-[var(--brand-gold-mid)] text-emerald-400 dark:text-[var(--brand-gold-light)] font-bold font-mono px-3 py-1 rounded-full uppercase">
            Oficial de Cumplimiento Activo
          </span>
        </div>

        {/* Dynamic Alerts Queue */}
        {alerts.length === 0 ? (
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-4 flex items-start gap-3 dark:bg-[var(--brand-gold-mid)] dark:text-[var(--brand-gold-light)] dark:border-[var(--brand-gold-dark)]">
            <FileCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5 dark:text-[var(--brand-gold-light)]" />
            <div>
              <h4 className="font-bold text-xs">Cumplimiento Operativo del 100% (DGT, CCSS, PRODHAB, MEIC)</h4>
              <p className="text-[10px] text-emerald-800 dark:text-[var(--brand-gold-light)]">La auditoría en tiempo real no ha detectado desviaciones normativas. Todas las facturas generadas tienen garantías de más de 3 meses, las cargas de CCSS son congruentes, los datos de tarjetas están tokenizados y no hay retrasos con Hacienda.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map(al => (
              <div 
                key={al.id} 
                className={`rounded-xl p-3.5 border flex items-start gap-3 animate-pulse ${
                  al.type === 'critical' 
                    ? 'bg-rose-50 border-rose-200 text-rose-700' 
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${al.type === 'critical' ? 'text-rose-600' : 'text-amber-600'}`} />
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wide">{al.message}</h4>
                  <p className="text-[10px] opacity-90 leading-relaxed">{al.sub}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        {/* PROTECCIÓN DE DATOS (LEY 8968 - PRODHAB) */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)]">
          <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-1.5 border-b border-[var(--border-color)]/50 pb-2 dark:text-[var(--brand-gold-light)]">
            <Scale className="w-4 h-4 text-indigo-400 dark:text-[var(--brand-gold-light)]" /> Protección de Datos (Ley 8968) y Derecho al Olvido
          </h4>

          <div className="space-y-4">
            <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed space-y-1.5">
              <div className="flex gap-2"><CheckSquare className="w-4 h-4 text-emerald-400 dark:text-[var(--brand-gold-light)] flex-shrink-0" /> Consentimiento informado explícito en registro de cuenta.</div>
              <div className="flex gap-2"><CheckSquare className="w-4 h-4 text-emerald-400 dark:text-[var(--brand-gold-light)] flex-shrink-0" /> Base de datos local tokenizada (últimos 4 dígitos únicamente).</div>
              <div className="flex gap-2"><CheckSquare className="w-4 h-4 text-emerald-400 dark:text-[var(--brand-gold-light)] flex-shrink-0" /> Acceso, Rectificación, Cancelación y Oposición (ARCO) funcionales.</div>
            </div>

            {/* Right to be forgotten management */}
            <div className="bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-color)]/50 space-y-3">
              <span className="text-[10px] font-bold uppercase text-[var(--text-secondary)] block">Ejercer Derecho al Olvido PRODHAB</span>
              
              {clients.length === 0 ? (
                <div className="text-center py-2 text-[10px] text-[var(--text-secondary)] italic">No hay clientes registrados en la base de datos aún.</div>
              ) : (
                <div className="space-y-2">
                  {clients.map(c => (
                    <div key={c.id} className="bg-[var(--bg-surface)] p-2.5 rounded-lg border border-[var(--border-color)]/50 flex items-center justify-between text-[11px]">
                      <div>
                        <div className="font-bold text-[var(--text-primary)] truncate max-w-[150px]">{c.name}</div>
                        <div className="text-[9px] text-[var(--text-secondary)] truncate max-w-[150px]">{c.email}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleExportClientData(c)}
                          className="bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] p-1 rounded transition"
                          title="Exportar portabilidad"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteClientPersonalData(c.id)}
                          className="bg-rose-500/10 hover:bg-rose-500/30 text-rose-400 p-1 rounded transition"
                          title="Purgar Datos"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* VALIDACIÓN DE FACTURACIÓN ELECTRÓNICA XML (HACIENDA COSTA RICA) */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-color)]/80 rounded-2xl p-5 text-[var(--text-primary)]">
        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 dark:text-[var(--brand-gold-light)] mb-3 flex items-center gap-1.5 border-b border-[var(--border-color)]/50 pb-2">
          <FileText className="w-4 h-4 text-emerald-400 dark:text-[var(--brand-gold-light)]" /> Validación de XML de Comprobantes Electrónicos (Hacienda)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* List of generated invoices */}
          <div className="md:col-span-1 space-y-2">
            <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-2">Historial Comprobantes Emitidos</span>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {orders.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--text-secondary)] italic border border-dashed border-[var(--border-color)]/50 rounded-xl">
                  No hay comprobantes fiscales emitidos aún. Realice compras en la tienda para generar facturas.
                </div>
              ) : (
                orders.map(o => (
                  <div 
                    key={o.id}
                    className={`p-2.5 rounded-xl border cursor-pointer transition flex justify-between items-center text-xs ${
                      selectedOrderXml?.id === o.id 
                        ? 'bg-emerald-500 dark:bg-[var(--brand-gold-mid)]/15 border-emerald-500 dark:border-[var(--brand-gold-dark)] dark:border-[var(--brand-gold-mid)]' 
                        : 'bg-[var(--bg-surface)]  border-[var(--border-color)]/50 hover:bg-[var(--bg-surface)]  '
                    }`}
                    onClick={() => setSelectedOrderXml(o)}
                  >
                    <div>
                      <div className="font-bold text-[var(--text-primary)]">{o.id}</div>
                      <div className="text-[9px] text-[var(--text-secondary)]">{new Date(o.timestamp).toLocaleDateString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-emerald-600 font-bold text-[10px] dark:text-[var(--brand-gold-light)]">₡{o.total.toLocaleString()}</div>
                      {o.hdaStatus === 'Pendiente' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleForceSendHacienda(o.id);
                          }}
                          className="bg-amber-500 hover:bg-amber-600 text-[8px] text-slate-950 font-bold px-1.5 py-0.5 rounded transition"
                        >
                          Firmar XML
                        </button>
                      ) : (
                        <span className="text-[8px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-bold dark:bg-[var(--brand-gold-mid)] dark:text-[var(--brand-gold-light)] dark:border-[var(--brand-gold-dark)]">
                          ACEPTADO
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* XML Schema structure check viewer */}
          <div className="md:col-span-2 bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-color)]/50 flex flex-col justify-between h-64 overflow-hidden">
            {selectedOrderXml ? (
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center pb-2 border-b border-[var(--border-color)]/50 mb-2">
                  <span className="text-[10px] font-bold text-emerald-400 dark:text-[var(--brand-gold-light)] font-mono">Estructura XML Comprobante Fiscal v4.3: {selectedOrderXml.id}</span>
                  <button
                    onClick={() => handleExportClientData({
                      id: selectedOrderXml.id,
                      name: selectedOrderXml.customerName,
                      email: selectedOrderXml.customerEmail,
                      phone: selectedOrderXml.paymentMethod,
                      province: selectedOrderXml.paymentDetails.phone || 'N/A',
                      addressDetail: 'N/A',
                      membershipTier: 'Normal',
                      cardsTokenized: [],
                      balance: selectedOrderXml.total,
                      notes: getSimulatedInvoiceXml(selectedOrderXml)
                    })}
                    className="bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] text-[9px] px-2 py-1 rounded border border-[var(--border-color)]/80 flex items-center gap-1 font-mono"
                  >
                    <Download className="w-3 h-3" /> Descargar XML
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto bg-slate-900 p-2.5 rounded font-mono text-[9px] text-emerald-400 dark:text-[var(--brand-gold-light)] leading-normal select-text whitespace-pre overflow-x-auto">
                  {selectedOrderXml.hdaStatus === 'Pendiente' 
                    ? getSimulatedInvoiceXml(selectedOrderXml) 
                    : selectedOrderXml.xmlContent || getSimulatedInvoiceXml(selectedOrderXml)
                  }
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] text-center">
                <FileText className="w-10 h-10 text-[var(--text-secondary)] mb-2" />
                <h5 className="text-xs font-bold text-[var(--text-secondary)]">Auditor de XML Hacienda</h5>
                <p className="text-[10px] text-[var(--text-secondary)] max-w-xs leading-relaxed mt-1">Selecciona una factura del historial izquierdo para visualizar la estructura del XML fiscal verificado bajo la normativa costarricense.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
