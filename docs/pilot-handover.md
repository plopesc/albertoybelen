# Retirada del piloto e invitaciones después de la presentación

Cada operación remota requiere autorización del propietario. Usar el Worker MVP y D1
existentes, con la release aprobada y el perfil privado descrito en [MVP](staging-mvp.md).

1. **Antes de publicar.** Ejecutar `npm run staging:mvp -- <operación> --confirm-staging-admin`
   con `disable-auto-sync`, luego `disable-sync` y finalmente `status`.
   Confirmar ambos controles apagados y verificar privadamente que `slot-a` es
   el piloto propio y `slot-b` está vacío. Anotar la generación de `slot-a`.
2. Crear `.local/staging-mvp/slot-removal.json` con permisos 0600 mediante editor
   privado. Campos `slot` (slot-a), `generation` (entero de status),
   `expectedAthleteId` (entero de la cuenta piloto verificada por su titular)
   y `purgeMilestones` (true). Ejecutar
   `npm run staging:mvp -- erase-slot --confirm-staging-admin --confirm-verified-deletion`.
   Esta supresión retira credenciales y aportes del piloto y limpia los hitos de
   ensayo. La orden se rechaza si cambió la cuenta o generación, hay sync habilitada
   o la otra plaza tiene una vinculación, invitación pendiente registrada o actividad.
   La purga de hitos está limitada al reto de ensayo.
   Si solo se quiere desconectar conservando la distancia, usar `revoke-slot` con
   `--confirm-revocation` y omitir `purgeMilestones`. Para un borrado posterior,
   releer la generación. El titular puede retirar también el permiso de la app
   desde su propia sesión de Strava.
3. Repetir `status` y comprobar slot-a suprimido, slot-b libre, 0 km, progreso
   parcial y lista de hitos vacía. Ante un fallo o resultado incierto, releer
   estado antes de decidir. Aplicar el procedimiento del reto oficial (#63)
   y comprobar la página de presentación con las dos plazas pendientes.
4. **Después de presentar la web.** Cuando Alberto esté listo para consentir,
   editar el archivo privado `invitation-request.json` con `type: issue`,
   `slot: slot-a` y su `expectedAthleteId` verificado. Ejecutar `invite` con
   la confirmación habitual. Entregar el contenido del archivo privado de
   resultado mediante canal privado acordado, sin imprimir la URL ni pegarla
   en chat, issues o PRs. Caduca en 1 hora y solo se consume al vincularse.
   Alberto autoriza su cuenta personalmente. Repetir para Belén en `slot-b`
   cuando facilite su ID y esté disponible. El total puede seguir parcial.
5. Tras verificar la fecha oficial y al menos un consentimiento, ejecutar
   `enable-sync`, luego `sync` y `status`. Comprobar el total agregado y
   la reconciliación inicial. Si hay cuota agotada o sync fallida, revisar
   el estado y esperar la ventana correspondiente antes de reintentar. Activar
   `enable-auto-sync` con `--confirm-staging-auto-sync` cuando lo apruebe el dueño.
