# Presentación del reto de Alberto y Belén

El reto suma 500 km desde el **28/11/2026 a las 00:00 de Madrid**
(27/11 a las 23:00 UTC, límite inclusivo). La presentación del día 28 empieza
con 0 km y las dos cuentas pendientes. El OAuth se hará después.

Reutilizar el Worker MVP y su D1 de staging es la ruta corta. Conserva el callback,
las claves y el Cron, y comparte cuotas y ciclo operativo con esa infraestructura.
El propietario debe autorizar expresamente su uso como servicio live. Separar
producción requeriría otro Worker/DB, callback compatible, claves y una
transición revisada. El nombre interno actual se conserva. La página diagnóstica
`?pages-staging=strava` está identificada como prueba y solo acepta el contrato
anterior a la promoción. Tras promover el dataset, ese visor queda sin datos.

1. Obtener las autorizaciones del propietario para el Worker, la retirada de
   datos, la promoción y Pages. Preparar la release de las dos PRs y empaquetar
   localmente con `npm run staging:mvp -- dry-run`. Tras aprobar el cambio
   remoto, desactivar auto-sync y sync manual con el CLI MVP actual. Actualizar
   el Worker con el [procedimiento MVP](staging-mvp.md), conservando DB, secretos,
   callback y Cron existentes. Repetir `status` y confirmar los dos controles.
2. Retirar el piloto con la supresión verificada de #62. Confirmar 0 km,
   progreso parcial, hitos vacíos y las dos plazas sin cuenta. No emitir
   invitaciones durante estos pasos.
3. Ejecutar `npm run staging:mvp -- promote-challenge --confirm-staging-admin --confirm-official-2026-11-28`.
   El comando está limitado al dataset fijo y exige ambos controles apagados y
   ninguna cuenta, actividad, invitación vigente registrada ni credencial.
   Actualiza la fecha, limpia hitos de ensayo y cambia el fence de sync en
   una transacción. Las reconciliaciones posteriores leen desde la fecha nueva.
   Ante un resultado incierto, consultar estado y la respuesta pública antes de
   decidir cualquier reintento.
4. Antes de lanzar, comprobar `GET /api/progress` en el origen aprobado del Worker
   con `Origin: https://plopesc.github.io`. Debe responder con
   `X-Challenge-Start: 2026-11-28`, `source: strava`, 0 km, progreso parcial,
   fecha de actualización nula y lista de hitos vacía. Verificar que solo se
   publica información agregada. No abrir Pages si falta esa cabecera o hay
   datos de prueba. El frontend también exige la cabecera a partir de la apertura.
5. A partir de la medianoche de Madrid y con autorización de publicación,
   ejecutar manualmente el workflow de Pages desde `main`, con la variable
   de habilitación ya aprobada. Abrir la [página pública](https://plopesc.github.io/albertoybelen/)
   en móvil e incógnito, y comprobar 500 km de objetivo, 0 km, fecha y estado
   de conexión pendiente. Repetir con un enlace UTM.
6. Después de la presentación, seguir el relevo de #62 para que cada persona
   autorice su cuenta cuando esté disponible. Verificar con sync manual el
   progreso parcial con una cuenta y la reconciliación agregada con dos.
   Reactivar la sincronización automática solo con aprobación.

**Rollback.** Si Pages falla, retirar la publicación o volver al último
artefacto estático compatible con el contrato oficial. Si falla la
sincronización, pausar ambos controles, mantener D1 y corregir con una versión
del Worker que reconozca la fecha oficial. No restaurar el documento del piloto,
rebajar la fecha, reimportar credenciales ni borrar cuentas legítimas.
