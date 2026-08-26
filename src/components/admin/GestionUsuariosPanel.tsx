import React, { useEffect, useState } from 'react';
import { ShieldAlert, KeyRound, Hash, RefreshCw } from 'lucide-react';
import { PageHead, Card, Btn, Chip, TableShell, Empty } from './AdminKit';
import { useToast, useConfirm } from '../ui/Overlays';
import { resolverModulo } from './adminNav';
import type { User } from '../../types';
import {
  esAdminSupremo, listarAdmins, restablecerPinDeAdmin, enviarRestablecimientoContrasena,
  type AdminDueno,
} from '../../utils/securityPin';

interface Props {
  currentUser: User | null;
}

/**
 * Panel de Gestión Supremo: administración de cuentas Dueño (contraseña
 * y PIN de seguridad de otras cuentas administradoras).
 *
 * DEFENSA EN PROFUNDIDAD: AdminPanel.tsx solo renderiza este componente
 * si `esAdminSupremo(currentUser?.email)` ya dio true, y AdminShell.tsx
 * ni siquiera muestra la entrada de menú para llegar aquí a otra cuenta.
 * Pero el filtro real —el que no se puede saltar cambiando el
 * `activeTab` a mano— vive en el servidor: `admin_list_duenos()`,
 * `admin_reset_security_pin()` y la restricción agregada a
 * `admin-force-password-reset` verifican de nuevo, cada una por su
 * cuenta, que quien llama es exactamente el administrador supremo. Este
 * componente vuelve a comprobarlo aquí solo para no renderizar nada útil
 * si de alguna forma se montara sin permiso — no es la barrera de
 * verdad.
 */
export default function GestionUsuariosPanel({ currentUser }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [admins, setAdmins] = useState<AdminDueno[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    try {
      setAdmins(await listarAdmins());
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cargar la lista de administradores.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargar(); }, []);

  if (!esAdminSupremo(currentUser?.email)) {
    return (
      <Empty icon={ShieldAlert} title="No autorizado" text="Este panel solo está disponible para el administrador supremo." />
    );
  }

  const resetearContrasena = async (admin: AdminDueno) => {
    const ok = await confirm({
      title: 'Restablecer contraseña',
      message: `Se enviará un correo de restablecimiento de contraseña a ${admin.name || admin.email} (${admin.email}).`,
      confirmText: 'Enviar correo',
    });
    if (!ok) return;
    setOcupado(admin.id + ':contrasena');
    try {
      const resultado = await enviarRestablecimientoContrasena(admin.email);
      if (resultado.ok) toast.success(resultado.mensaje);
      else toast.error(resultado.mensaje);
    } finally {
      setOcupado(null);
    }
  };

  const resetearPin = async (admin: AdminDueno) => {
    const ok = await confirm({
      title: 'Restablecer PIN de seguridad',
      message: `${admin.name || admin.email} deberá crear un nuevo token de seguridad de 4 dígitos en su próximo ingreso. ¿Continuar?`,
      confirmText: 'Restablecer PIN',
    });
    if (!ok) return;
    setOcupado(admin.id + ':pin');
    try {
      const resultado = await restablecerPinDeAdmin(admin.id);
      if (resultado.ok) { toast.success(resultado.mensaje); void cargar(); }
      else toast.error(resultado.mensaje);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="tv-stack" id="view-gestion_usuarios">
      <PageHead
        title="Gestión de usuarios"
        subtitle={resolverModulo('gestion_usuarios').descripcion}
        actions={<Btn icon={RefreshCw} onClick={cargar} disabled={cargando}>{cargando ? 'Cargando…' : 'Actualizar'}</Btn>}
      />

      <Card title="Cuentas administradoras" padded={admins.length === 0}>
        {admins.length === 0 ? (
          <Empty icon={ShieldAlert} title={cargando ? 'Cargando…' : 'Sin cuentas administradoras'} />
        ) : (
          <TableShell head={<>
            <th>Cuenta</th>
            <th>PIN de seguridad</th>
            <th className="text-right">Acciones</th>
          </>}>
            <tbody>
              {admins.map(admin => (
                <tr key={admin.id}>
                  <td>
                    {/* Nombre y correo son texto libre: sin recorte, un correo
                        corporativo largo ensanchaba la columna y empujaba los
                        botones de acción fuera de la tabla. */}
                    <div className="font-semibold text-[var(--text-primary)] tv-break">{admin.name || 'Sin nombre'}</div>
                    <div className="text-[12px] text-[var(--text-muted)] tv-break">{admin.email}</div>
                    {esAdminSupremo(admin.email) && <Chip tone="accent">Admin supremo</Chip>}
                  </td>
                  <td>
                    <Chip tone={admin.tienePin ? 'ok' : 'alert'}>{admin.tienePin ? 'Configurado' : 'Sin configurar'}</Chip>
                  </td>
                  <td>
                    <div className="tv-row justify-end">
                      <Btn
                        icon={KeyRound}
                        disabled={ocupado === admin.id + ':contrasena'}
                        onClick={() => resetearContrasena(admin)}
                      >
                        Restablecer contraseña
                      </Btn>
                      <Btn
                        icon={Hash}
                        disabled={!admin.tienePin || ocupado === admin.id + ':pin'}
                        onClick={() => resetearPin(admin)}
                      >
                        Restablecer PIN
                      </Btn>
                    </div>
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
