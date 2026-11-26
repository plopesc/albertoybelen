# Primera cuenta Strava en staging: un Worker y D1 (#50)

Esta PR prepara el flujo; **no ejecutó secretos, deploy, OAuth, sync ni consultas
remotas**. El propietario confirmó en #50 callback domain de staging, capacidad
10 y migraciones 0001/0002/0003 aplicadas (`pending: []`). No se vuelve a migrar ni
se exige otro backup. Es información del propietario, no una verificación remota
de esta entrega.

Se reutilizan OAuth, AES-GCM, tablas `staging_auth_*`, reglas de kilómetros y sync.
No requiere Worker operador, Ed25519, Access, dominio nuevo, certificados nuevos,
túnel ni servicios de pago. El Worker existente incorporará un Cron UTC cada tres
horas, con un interruptor durable que permanece apagado hasta activación admin.
Los archivos de operador anteriores se conservan inactivos; sus planes cerrados
(`staging:oauth`) no son el camino de esta guía.

## Procedimiento del propietario después de revisar/mergear la PR

Los pasos locales no autorizan los remotos. Ejecutar cada secreto, deploy y
operación real solo cuando el propietario decida hacerlo. Desde DDEV, Node 24,
Wrangler ya autenticado y una copia actualizada de `main`:

1. **Comprobaciones locales, sin red de proveedores:**

   ```sh
   npm ci
   npm run config:check
   npm run staging:mvp -- check
   npm run staging:mvp -- dry-run
   npm test
   npm run test:staging:mvp
   npm run test:staging:mvp:browser
   ```

   `dry-run` usa esbuild en memoria, no Wrangler ni secretos. La configuración
   versionada está cerrada. Estas pruebas usan datos sintéticos y D1 temporal.
2. **Seleccionar la cuenta Cloudflare manualmente** en `CLOUDFLARE_ACCOUNT_ID`
   exportada en esta misma terminal DDEV. No pegar su valor ni credenciales en
   chat/Git/argumentos. Todos los comandos contrastan metadata y allowlist con:
   Worker `albertoybelen-api-staging`, D1 `albertoybelen-db-staging`, binding `DB`,
   UUID `c6bde806-cf94-4ff3-8c4f-c08b8de477f6`. Si no son esos destinos, parar.
3. **Preparar archivos locales privados nuevos:**

   ```sh
   npm run staging:mvp -- prepare
   ```

   Crea `.local/staging-mvp/` 0700 y archivos 0600, gitignored, sin sobrescribir:
   `admin-token` (32 bytes aleatorios, base64url), `aes-key` (clave AES nueva),
   `strava-client-id`, `strava-client-secret` e `invitation-request.json`.
   Editar los dos archivos Strava vacíos con un editor privado, usando la **app
   existente**. No copiar/importar `.local/pilot-config`, tokens o D1 del piloto.
   Si staging ya tuviera cuentas/ciphertext, parar y conservar su clave AES; no
   sustituirla con otra nueva. En `invitation-request.json`, poner el ID de la propia cuenta Strava como número
   entero y `slot-a`. No compartir ese archivo. No repetir `prepare` para rotar AES.
4. **Configurar los cinco Workers Secrets, uno a uno, con autorización real:**

   ```sh
   npm run staging:mvp -- secret STRAVA_CLIENT_ID --confirm-staging-secret
   npm run staging:mvp -- secret STRAVA_CLIENT_SECRET --confirm-staging-secret
   npm run staging:mvp -- secret TOKEN_ENCRYPTION_KEY --confirm-staging-secret
   npm run staging:mvp -- secret TOKEN_ENCRYPTION_KEY_VERSION --confirm-staging-secret
   npm run staging:mvp -- secret STAGING_ADMIN_TOKEN --confirm-staging-secret
   ```

   Lee solo los archivos anteriores; la versión inicial es `v1`. Valores por stdin
   a Wrangler, nunca argumentos ni stdout. Su configuración/CWD son temporales
   privados, sin descubrir `.dev.vars` del piloto. No publicar archivos, logs ni
   capturas del editor. El Worker existente sigue fixture hasta el siguiente paso.
5. **Sustituir únicamente el Worker staging, con autorización de deploy:**

   ```sh
   npm run staging:mvp -- deploy --confirm-staging-oauth
   npm run staging:mvp -- status --confirm-staging-admin
   ```

   El deploy genera la configuración activa del mismo Worker/D1 e instala el único
   Cron `0 */3 * * *` (ocho veces al día, UTC). Esto no lo habilita: el estado
   privado de D1 empieza con `autoSyncEnabled: false`, y ni el deploy ni
   `enable-sync` lo cambian. Los cinco Workers Secrets, la base D1 y sus datos
   existentes se conservan; no hay comandos de secreto ni migraciones en este paso.
   No usa el deploy fixture. Runtime exige switches coherentes, los cinco secretos
   y el historial exacto 0001–0003 antes de inicializar el dataset.
   Si algo falta: 503/cerrado; no migra, repara ni cae a fixtures automáticamente.
   `status` es una operación administrativa HTTPS autenticada; también requiere
   consentimiento. Sin cuenta conectada es normal ver 0 km y `partial: true`.
6. **Emitir invitación y autorizar la cuenta propia:**

   ```sh
   npm run staging:mvp -- invite --confirm-staging-admin
   ```

   Devuelve solo el nombre de un archivo nuevo `invitation-slot-a-<id>.url` 0600.
   Abrirlo en un editor privado y copiar su URL al navegador, sin pegarla en chats,
   historial shell, logs ni capturas. El fragmento se borra al cargar la página;
   consentir `activity:read_all` en la app existente. Callback fijo:
   `https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/oauth/callback`.
   OAuth verifica la cuenta esperada y rechaza otra identidad o atleta duplicado.
   La invitación caduca en una hora y es de un solo uso. Para reemitir, ejecutar
   otra vez `invite`: invalida el intento anterior; no imprime/guarda URLs en D1.
   Para la segunda cuenta, cambiar el archivo privado a `slot-b` y su ID autorizado.
7. **Activar el permiso de sync manual y ejecutar una sola operación:**

   ```sh
   npm run staging:mvp -- enable-sync --confirm-staging-admin
   npm run staging:mvp -- sync --confirm-staging-admin
   npm run staging:mvp -- status --confirm-staging-admin
   ```

   No programa nada. Cada `sync` es una ejecución acotada con paginación/cuotas
   existentes; no hay reintentos automáticos. Una sola cuenta mantiene `partial`
   aunque sus kilómetros ya estén cargados. `stale` puede coexistir con `partial`;
   ante errores se conserva el último dato válido. Reto **de staging**: 500 km,
   inicio inclusivo 2026-11-01 Europe/Madrid; Run/Walk/Hike no manuales. No modifica
   la configuración definitiva prevista ni transfiere premios de pruebas.
8. **Activar por separado la sincronización automática, solo con autorización
   específica posterior:**

   ```sh
   npm run staging:mvp -- enable-auto-sync --confirm-staging-admin --confirm-staging-auto-sync
   npm run staging:mvp -- status --confirm-staging-admin
   ```

   `status` muestra por separado `syncDisabled`, `autoSyncEnabled` y
   `lastAutomaticSync` (hora UTC y resultado acotado, sin PII). El permiso auto
   no habilita el sync manual por sí mismo: ambos interruptores deben permitirlo.
   Cada evento utiliza el lease D1 del motor actual, presupuesto compartido de
   staging, máximo de cinco páginas y 400 registros por cuenta; cuotas 24 por
   operación, 40 por 15 minutos y 120 al día incluyen tokens y páginas. A ocho
   ciclos diarios, el presupuesto diario puede posponer un ciclo si se alcanza;
   nunca se sobrepasa. Una cuenta conectada mantiene progreso parcial.
   Desactivar auto da prioridad al comando, incrementa su fence y evita publicar
   resultados tardíos; el GET de Pages nunca sincroniza.
9. **Ver el mapa con origen veraz y sin tocar el piloto o Pages:**

   ```sh
   npm run frontend:staging:prepare -- --strava
   npm run frontend:staging:enable
   npm run frontend:staging:proxy
   ```

   El último comando permanece en primer plano; no hace HTTP hasta recibir un GET.
   Abrir `https://albertoybelen.ddev.site/frontend/?staging-api=strava` y pulsar
   «Actualizar vista». Ver **STAGING · STRAVA**, suma conjunta y posible progreso
   parcial. El proxy reutiliza 8792 y solo GET al `/api/progress` público fijo;
   no reenvía cookies, Authorization ni parámetros. Este modo rechaza fixtures y
   piloto; el modo anterior `?staging-api=1` sigue admitiendo solo fixtures.
   El enable reconoce el snippet anterior exacto; rechaza archivos personalizados
   sin sobrescribirlos. No cambia `/api/progress` del piloto ni arranca DDEV OAuth.
10. **Detener sync y volver al fixture cuando se decida:**

   ```sh
   npm run staging:mvp -- disable-auto-sync --confirm-staging-admin
   npm run staging:mvp -- disable-sync --confirm-staging-admin
   npm run staging -- deploy --confirm-staging
   ```

   Los comandos desactivan automática y manual, respectivamente; ambos invalidan
   trabajos en curso mediante fences y no borran tokens/histórico. El tercero es el rollback **manual del Worker**, siempre
   fixture-only. Volver al mapa `?staging-api=1`. D1 y los secretos se conservan;
   rollback no restaura ni borra datos. Producción permanece fuera de los destinos.

## Administración: límites y revocación

`POST /admin/staging` es **público a nivel de red**, no una red privada. Requiere un
Workers Secret independiente de 256 bits por `Authorization: Bearer`, comparación
constante de longitud fija, HTTPS/origen exacto, cuerpo JSON de hasta 2048 bytes,
operaciones cerradas, nonce y caducidad de dos minutos. Rechaza Origin/cookies y
metadatos de navegación; no ofrece CORS. El CLI Node puede enviar Sec-Fetch-Mode
sin Origin: no se interpreta como un navegador autenticado.

Hay límite inicial de 60 solicitudes/minuto por instancia (no es protección global
contra DDoS), cuotas autenticadas durables de 20/minuto y 200/día, receipts de replay
y lease/fence D1 reutilizados del operador. Status y cuotas no contienen atletas,
URLs o tokens. HTTPS y proteger el secreto siguen siendo imprescindibles; un
poseedor del Bearer puede emitir nuevas operaciones. No hay IP allowlist/Access
ni garantía de disponibilidad ante abuso.

Para **revocar la credencial admin para solicitudes nuevas tras actualizar el Worker**, el
propietario puede ejecutar, con autorización de escritura independiente:

```sh
npm run staging:mvp -- secret-delete STAGING_ADMIN_TOKEN --confirm-staging-secret
```

Eso cierra la release (también su lectura pública); un trabajo ya admitido no se
cancela por borrar un secreto. Preferir `disable-sync` antes. Para **girar admin**,
sin tocar AES ni las cuentas, generar un token local nuevo de forma privada:

```sh
npm run staging:mvp -- rotate-admin --confirm-local-key-rotation
npm run staging:mvp -- secret STAGING_ADMIN_TOKEN --confirm-staging-secret
```

Tras actualizar el Secret, clientes antiguos fallan. No usar esa receta para AES:
los ciphertext existentes necesitan su clave; consultar el procedimiento de vault
antes de cualquier rotación. Revocar OAuth en Strava es una acción distinta; no
borra datos automáticamente. El piloto permanece aparcado e intacto en disco;
autorizar de nuevo la misma app/cuenta puede afectar tokens anteriores en Strava,
por lo que no debe reactivarse el piloto en paralelo.

No publicar invitaciones, secretos, IDs o respuestas privadas. La salida resumida
del CLI y `/api/progress` solo incluyen agregado y estados; nunca aportaciones por
participante. No activar GitHub Pages ni modificar `frontend/config/game.json`.

Para el relevo del piloto, consulta el [procedimiento de retirada e invitaciones](pilot-handover.md).
