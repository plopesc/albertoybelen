# Retirada del piloto de staging

Este procedimiento queda reservado a operaciones de pruebas. Para el
lanzamiento, el piloto permanece en staging y se sigue la
[guía de producción](official-launch.md).

Cada operación remota requiere autorización del propietario. Usar el Worker MVP y D1
existentes, con la release aprobada y el perfil privado descrito en [MVP](staging-mvp.md).

1. **Solo para una retirada de staging autorizada.** Ejecutar `npm run staging:mvp -- <operación> --confirm-staging-admin`
   con `disable-auto-sync`, luego `disable-sync` y finalmente `status` y `slot-status`.
   Confirmar ambos controles apagados y verificar privadamente que `slot-a` es
   el piloto propio y `slot-b` está vacío. Anotar la generación de `slot-a` de `slot-status`.
2. Crear `.local/staging-mvp/slot-removal.json` con permisos 0600 mediante editor
   privado. Campos `slot` (slot-a), `generation` (entero de slot-status),
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
3. Repetir `status` y `slot-status` y comprobar slot-a suprimido, slot-b libre, 0 km, progreso
   parcial y lista de hitos vacía. Ante un fallo o resultado incierto, releer
   estado antes de decidir.
4. **Solo para un ensayo autorizado.** Cuando la primera cuenta de prueba vaya a consentir,
   editar el archivo privado `invitation-request.json` con `type: issue`,
   `slot: slot-a` y su `expectedAthleteId` verificado. Ejecutar `invite` con
   la confirmación habitual. Entregar el contenido del archivo privado de
   resultado mediante canal privado acordado, sin imprimir la URL ni pegarla
   en chat, issues o PRs. Caduca en 1 hora y solo se consume al vincularse.
   El titular autoriza su propia cuenta. Repetir para una segunda cuenta de
   prueba en `slot-b` cuando esté disponible. El total puede seguir parcial.
5. Tras verificar la fecha del perfil de ensayo y al menos un consentimiento, ejecutar
   `enable-sync`, luego `sync` y `status`. Comprobar el total agregado y
   la reconciliación inicial. Si hay cuota agotada o sync fallida, revisar
   el estado y esperar la ventana correspondiente antes de reintentar. Activar
   `enable-auto-sync` con `--confirm-staging-auto-sync` cuando lo apruebe el dueño.
