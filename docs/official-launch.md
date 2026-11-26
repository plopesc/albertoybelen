# Presentación del reto en producción

El reto suma 500 km desde el **28/11/2026 a las 00:00 en Madrid**
(27/11 a las 23:00 UTC, inclusive). La presentación comienza con 0 km y las
dos plazas pendientes. El Worker y D1 de staging siguen siendo de pruebas.
Queda sustituido el procedimiento de promoción de staging de #63.

## Inventario de solo lectura a cargo del propietario

Desde una sesión de Wrangler autenticada y el panel de la cuenta correcta:

```sh
npx --no-install wrangler whoami
npx --no-install wrangler d1 list
npx --no-install wrangler d1 info albertoybelen-db
npx --no-install wrangler deployments list --name albertoybelen-api
```

- Confirmar la **cuenta de Cloudflare**, el Worker reservado
  `albertoybelen-api` y su versión activa si existe. Revisar en **Workers &
  Pages → Settings** las rutas, dominio o subdominio `workers.dev`, previews,
  Cron y bindings del Worker. Confirmar el **origen HTTPS exacto** para el GET
  público y para `/oauth/callback`. Si se usa dominio propio, verificar la zona
  y que la ruta no esté asignada a otro Worker. [Rutas de Workers](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
- Confirmar que `albertoybelen-db` existe en esa cuenta, su **UUID real**,
  y si está vacía o contiene el esquema productivo esperado. Comprobar
  que `DB` enlaza exactamente esa base y que su UUID difiere del de staging.
  Una ausencia en el inventario requiere revisar primero permisos/cuenta.
  Si el recurso falta, su creación es una operación posterior y separada
  que requiere aprobación. [Comandos D1](https://developers.cloudflare.com/d1/wrangler-commands/).
- Registrar el ID de cuenta solo en la sesión operativa. El propietario
  confirma los nombres reservados, UUID D1, origen y tipo de ruta para la
  revisión de los valores fijos. Mantener credenciales e IDs de atletas
  fuera de Git, consola, issues y PRs.

## Creación si falta un recurso

Tras autorización separada, crear solo la D1 productiva si falta con
`npx --no-install wrangler d1 create albertoybelen-db` en la cuenta verificada.
Volver al inventario para comprobar el UUID. El Worker se crea al realizar
su primer despliegue autorizado con la configuración productiva.

## Preparar, desplegar y comprobar

1. Tras verificar los recursos y obtener aprobación, fijar `origin`,
   `databaseId` y `routing` en `backend/production-target.js`. Fijar el
   mismo endpoint HTTPS `/api/progress` en la allowlist de
   `frontend/js/http-progress.js` y en `frontend/config/pages-live.json`.
   Ejecutar `npm run production -- check`, `npm run production -- dry-run`
   y las suites locales. Sin los valores revisados, el renderer, el Worker
   y la publicación de Pages fallan cerrado.
2. Con un checkout limpio y sin perfiles de staging cargados, seleccionar
   la cuenta verificada mediante `CLOUDFLARE_ACCOUNT_ID` en la sesión privada
   de Wrangler. Ejecutar localmente
   `npm run production -- render` y revisar el archivo ignorado
   `wrangler.production.generated.json`. El comando crea el archivo de forma
   exclusiva. Para regenerarlo, archivar el anterior y volver a revisar.
   La salida inicial desactiva OAuth y usa una única base, previews
   desactivadas y un Cron UTC de tres horas con sync durable apagada.
3. Con aprobación de escritura, revisar el destino y la lista de migraciones
   pendientes con los comandos siguientes. Aplicar únicamente en la base
   de producción verificada y desplegar el Worker con OAuth desactivado.

   ```sh
   npx --no-install wrangler d1 migrations list albertoybelen-db --remote --config wrangler.production.generated.json
   npx --no-install wrangler d1 migrations apply albertoybelen-db --remote --config wrangler.production.generated.json
   npx --no-install wrangler deploy --config wrangler.production.generated.json
   ```

   Debe aparecer únicamente la migración inicial de producción, pendiente
   o aplicada. Si se encuentra otra historia o esquema, detenerse. Conservar
   la versión desplegada y la referencia de rollback.
4. Verificar `GET /api/progress` en el host productivo con
   `Origin: https://plopesc.github.io`. Esperar CORS exacto sin credenciales,
   `X-Challenge-Start: 2026-11-28`, `X-Challenge-Environment: production`
   y el agregado `source: strava`, 0 km, `partial:true`, `stale:false`,
   `updatedAt:null` e hitos vacíos. Comprobar desde el admin privado que ambas
   plazas están desconectadas si ya se instaló la clave de administración.
   La presentación pública funciona con OAuth cerrado y sin datos de atletas.
5. Con autorización del propietario, cambiar `PAGES_MODE` a `live` en
   `frontend/js/pages-mode.js` y aprobar ese cambio. Después, a partir
   de la medianoche de Madrid y con autorización de publicación,
   ejecutar manualmente **Publicar en Pages** desde `main` con la variable
   `PAGES_TEST_DEPLOY_ENABLED=true`. Verificar la
   [raíz pública](https://plopesc.github.io/albertoybelen/) en móvil e incógnito,
   también con UTM. El visor `?pages-staging=strava` conserva su destino de
   pruebas. El workflow bloquea perfiles incompletos y publicación temprana.

## OAuth después de la presentación

Si la app actual solo admite el host de staging, mantener su callback y usar
una **app de Strava separada** de producción, si el titular elegible puede
registrarla y Strava confirma capacidad para Alberto y Belén. Verificar en
la interfaz el dominio exacto de producción, el callback HTTPS
`/oauth/callback`, la capacidad y las cuotas. Si no se puede provisionar o
autorizar esa app, mantener OAuth de producción cerrado y el reto visible en
cero. [Callback OAuth](https://developers.strava.com/docs/authentication/).
[Capacidad y cuotas](https://developers.strava.com/docs/rate-limits/).

- Generar **nuevas** claves aleatorias de 32 bytes para
  `PRODUCTION_ADMIN_TOKEN` (base64url sin padding) y
  `TOKEN_ENCRYPTION_KEY` (base64 estándar). Guardar el token admin en
  `.local/production/admin-token` con modo 0600, directorio 0700. Instalar
  ambas claves y después `STRAVA_CLIENT_ID` y `STRAVA_CLIENT_SECRET` de la
  nueva app como secretos del Worker productivo. Usar la interfaz de
  Cloudflare o `npx --no-install wrangler secret put <nombre> --config wrangler.production.generated.json`
  con entrada privada. No copiar datos ni secretos del piloto.
- Tras aprobar la apertura OAuth, regenerar la configuración con
  `npm run production -- render --enable-oauth` y desplegar esa versión.
  Verificar el callback antes de entregar cada invitación.
- Usar `npm run production -- admin <operación> --confirm-production-admin`.
  `status` y `slot-status` verifican el agregado y las plazas. Para `invite`,
  escribir privadamente `.local/production/invitation-request.json` (0600)
  con `slot` y `expectedAthleteId` verificado. Guardar y entregar el enlace
  solo por el canal privado convenido. Caduca en una hora, es de un uso y
  cada participante autoriza su propia cuenta. Usar `slot-a` para Alberto
  y `slot-b` para Belén cuando esté disponible.
- Tras el primer consentimiento, ejecutar `enable-sync`, `sync` y `status`.
  Comprobar el progreso parcial con una cuenta y luego completo con dos.
  Activar `enable-auto-sync` tras aprobación y una sync manual correcta.

**Rollback.** Pausar `disable-auto-sync` y `disable-sync`. Si es preciso,
volver a una versión productiva compatible que mantenga el mismo binding y
el mismo contrato de lectura. Para detener el acceso OAuth, volver a la
configuración cerrada, conservando D1 y sus claves. Si falla Pages, retirar
la publicación o recuperar un artefacto conocido que apunte únicamente a
producción. [Rollback de Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
