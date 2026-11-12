# Staging OAuth y sincronización: preparación local (#40)

Esta fase entrega código y ensayos sintéticos. **No autoriza ninguna operación
remota, conexión real, secreto remoto, migración remota, despliegue ni Cron.**
El Worker desplegado sigue siendo el de fixtures; este documento no afirma que
la nueva modalidad haya sido desplegada o conectada.

## Arquitectura y separación

| Componente | Decisión |
| --- | --- |
| Worker futuro | Mismo destino autorizado `albertoybelen-api-staging`; entry alternativo `backend/staging-auth-entry.js`. |
| D1 autorizada futura | `albertoybelen-db-staging`, UUID `c6bde806-cf94-4ff3-8c4f-c08b8de477f6`, binding `DB`. No consultada ni modificada en esta tarea. |
| Entorno alternativo | `APP_ENV=staging-strava-test`; OAuth y red deshabilitados por defecto. |
| Dataset de prueba | `staging-strava-test-v1`, 500 km, inicio inclusivo 2026-11-01, Europe/Madrid. No es producción. |
| Persistencia | Tablas nuevas `staging_auth_*`, incluidas las proyecciones, CAS, sesiones, credenciales y cofres. No se reutilizan ni vacían las tablas de fixtures. |
| Configuración local | `wrangler.staging-auth.local.jsonc`, UUID ficticio terminado en 0040, loopback 8793, sin workers.dev, Cron ni observabilidad. Los tests usan puertos aleatorios y D1 temporal. |
| Producción | Reservada e incompleta; no es un target operativo. No se altera `game.json` ni Pages. |

Se reutilizan `createOAuthService`, la máquina de invitaciones, el vault AES-GCM,
el router OAuth, el repositorio D1, el motor de sincronización y el transporte
con límites del piloto. Las extensiones conservan sus valores por defecto para
DDEV: namespace de tablas fijo adicional, dominio AAD diferente para el cifrado,
etiqueta de página opcional y presupuesto separado `stagingBudget`.

La migración **0003_staging_auth_test.sql** es aditiva y compatible con 0001/0002.
El nuevo entry falla cerrado si falta; no vuelve a las tablas antiguas. El modo
fixture continúa usando su entry y tablas originales. Las pruebas aplican 0001/0002,
guardan datos de fixtures, añaden 0003 y verifican que esos datos no cambian tras
OAuth/sync/supresión del nuevo dataset. No se aplicó 0003 remotamente.

`config.json` añade solo metadatos locales no secretos y ambos interruptores en
false. La allowlist independiente y las guardas del Worker siguen contrastándose
con `npm run config:check`. `wrangler.staging.jsonc` y su validación operacional
siguen fijados al entry de **fixtures**. El CLI staging rechaza el nuevo entry.

```sh
npm run staging:auth:plan
```

Imprime una propuesta **de diseño**, derivada del staging autorizado, con config
cerrada, callback y aprobaciones pendientes. No crea un fichero desplegable,
no ejecuta Wrangler y no admite argumentos ni overrides. No es autorización ni
herramienta de despliegue. La configuración local tampoco es una config remota.

## Callback: condición previa real

La [documentación de autenticación de Strava](https://developers.strava.com/docs/authentication/)
exige que el redirect URI pertenezca al callback domain de la app. La app actual
está configurada para `albertoybelen.ddev.site`, según confirmó el propietario.
Por tanto, **no sirve sin cambios** para el callback de staging propuesto:

`https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/oauth/callback`

Ese hostname es conocido; **su admisión como callback por una app concreta no se
ha verificado**. No se presupone una lista de dominios ni se hace un relay por
DDEV. Recomendación: el propietario evalúa una **app separada de staging**, si las
políticas vigentes lo permiten, con el callback domain exacto
`albertoybelen-api-staging.autumn-dream-2a39.workers.dev` (sin esquema ni ruta).
No usar el sufijo compartido `workers.dev` como dominio autorizado.
Si el proveedor no lo acepta, detener la activación y revisar un dominio propio
con una nueva autorización de infraestructura; no improvisar redirects abiertos.
No se creó ni modificó ninguna app.

La [documentación de límites de Strava](https://developers.strava.com/docs/rate-limits/)
indica que las apps nuevas empiezan con capacidad para un atleta. El propietario
debe confirmar una capacidad autorizada de **al menos dos** y las condiciones
vigentes para ampliarla. No asumir que una app nueva admite a ambos ni que la
ampliación está aprobada. Si implica coste o condiciones no aceptadas, parar.
Estas consultas se hicieron solo sobre documentación pública, sin sesión ni API
real; no sobre el dashboard del propietario.

## Invitaciones y administración privada

El Worker solo despacha `/invite`, `/invite/start`, `/oauth/callback`,
`/oauth/result` y `GET/OPTIONS /api/progress`. No hay admin, emisión por GET,
endpoint de sincronización, mock de proveedor público ni handler `scheduled`.

`runtime.admin` es una capacidad de código para un adaptador **de confianza**,
no una API HTTP. Sus métodos exigen un actor autenticado con rol owner; esa
identidad nunca se acepta desde un cuerpo HTTP. El ensayo la invoca directamente
en el proceso local. No hay aún un emisor remoto operativo.

Para una fase remota, diseñar/revisar antes un canal del operador que autentique
al propietario fuera del Worker público (por ejemplo, un control privado protegido
por Access y credencial de servicio, con POST y control CSRF). Solo el adaptador
verificado podrá construir el actor. No convertir `actor:{authenticated:true}`
recibido por JSON en autorización. Esto requiere nueva implementación/autorización;
no se ofrece una ruta admin provisional ni un secreto estático en query strings.
El canal deberá emitir enlaces una sola vez hacia un fichero/terminal privado,
sin logs ni historial del shell y sin exponer IDs. No insertar tokens o enlaces
sin hash directamente mediante SQL.

Cada invitación:

- Se vincula a uno de dos slots internos y a la identidad esperada confirmada por
  el propietario de forma privada. Los nombres Alberto/Belén no van en el DTO.
- Usa 256 bits aleatorios; solo guarda hash, caduca en una hora y se consume una
  vez. Otra emisión invalida intentos anteriores; no permite asignar el mismo
  atleta a dos slots. Los IDs esperados no se guardan en claro.
- Lleva el token en el fragmento del enlace, eliminado por el script antes de
  enviarlo por POST JSON al mismo origen. No ponerlo en ruta/query ni logs.
- Vincula state a cookie de sesión, generación y caducidad (10 minutos); reclama
  el intercambio con CAS y rechaza sesiones ajenas, parámetros duplicados,
  expiración y replay. Solo acepta `activity:read_all` y el alcance adicional
  estándar `read`; un rechazo permite recuperar el enlace mientras sea válido.

El callback remoto exige el origen HTTPS exacto, incluido puerto normal, sin
confiar en X-Forwarded-Proto. No admite redirect URI proporcionado por el usuario.
Las cookies son `__Host-`, Secure, HttpOnly, SameSite=Lax. Las páginas usan CSP con
nonce, frame deny, no-store y no-referrer. El resultado usa un 303 a una ruta fija
y una cookie efímera que se consume; código/state no aparecen en la página final.

**Exposición:** una URL workers.dev es pública y descubrible; CORS no autentica.
`/invite` sin enlace puede mostrar instrucciones, nunca lista de participantes.
El callback contiene código/state por exigencia del protocolo: no habilitar logs
de URL, request bodies, cookies, tails ni snapshots de estas rutas en la fase
real. El código no los registra; antes de activar, revisar también observabilidad,
edge logs y cualquier proxy del entorno remoto. No se ha auditado ese entorno.

## Secretos y cifrado

| Nombre | Tratamiento futuro, sin valores en Git |
| --- | --- |
| `STRAVA_CLIENT_ID` | Variable del Worker/aplicación de staging; tampoco en `config.json`. |
| `STRAVA_CLIENT_SECRET` | Workers Secret nuevo de la app de staging. |
| `TOKEN_ENCRYPTION_KEY` | Workers Secret con clave AES-GCM de 32 bytes en base64, generada privadamente para staging. |
| `TOKEN_ENCRYPTION_KEY_VERSION` | Versión activa no secreta, por ejemplo v1. |
| `TOKEN_PREVIOUS_ENCRYPTION_KEY` | Workers Secret anterior durante una rotación supervisada. |
| `TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION` | Versión anterior distinta de la activa. |

No copiar `.dev.vars`, claves, tokens ni IDs del piloto DDEV. No pedir a Codex
valores ni pasarlos por argumentos, `echo`, capturas o mensajes. El propietario
los introduce por prompt seguro de Workers Secrets solo tras autorización
específica y comprobación del destino. La cuenta Cloudflare se selecciona
manualmente con `CLOUDFLARE_ACCOUNT_ID`, sin versionarla ni tratarla como permiso.

Los tokens y el ID de atleta asociado quedan dentro del envelope cifrado AES-GCM
en D1, por participante, generación, versión y clave. El AAD añade el dataset
staging para rechazar envelopes del piloto aunque alguien reutilizase una clave
por error. La clave nunca se guarda en D1. `rotate` vuelve a cifrar con una
versión nueva; conservar temporalmente la clave anterior hasta verificar ambos
slots, reinicio y rollback. Perder todas las claves exige nuevo consentimiento;
no hay recuperación en claro ni copia automática desde DDEV.

La revocación elimina las credenciales y detiene trabajos antiguos conservando
kilómetros/historial según la política existente. La supresión exige verificación
expresa y puede purgar cofres si así se confirma. Cambia la generación para que
ni callback ni sync pendiente puedan resucitar datos. Un 401/403 aislado no se
interpreta como revocación; `invalid_grant` confirmado sí. Fallos temporales
conservan el último snapshot.

## Sincronización y presupuesto para dos atletas

Se mantiene Run/Walk/Hike, exclusión de actividades manuales, inicio inclusivo
Europe/Madrid, IDs compuestos participante+actividad y dos recorridos completos
idénticos antes de confirmar cada snapshot. Correcciones/borrados antiguos
pueden bajar kilómetros; cofres y final permanecen salvo supresión acordada.
Conexión parcial y datos obsoletos son estados independientes y pueden coexistir.

El DTO público sigue teniendo solo schemaVersion, source, distanceKm, partial,
stale, updatedAt y unlockedMilestoneIds. Usa `source=strava`; origen de staging
y páginas OAuth lo etiquetan como ensayo. CORS restringido **al propio origen de
staging**, sin credenciales; no se habilita Pages ni DDEV para leer este modo.
El visor #36 sigue exigiendo `source=fixture` y rechazará este modo: no se relaja
su protección ni se le muestran datos reales por esta issue.

Límites conservadores del ensayo, compartidos en D1 entre instancias y solicitudes
OAuth/activity: **24 por operación, 40 por ventana de 15 minutos, 120 por día UTC**,
5 páginas por recorrido y 400 registros por cuenta. Se respetan los headers de
cuota general y de lectura, con margen de 5/20 solicitudes. 429 aplica al menos
15 minutos de backoff (o Retry-After mayor, acotado a un día), persistente y sin
bucles; errores de red aplican enfriamiento. No se guardan payloads privados en
métricas, solo contadores/estados/cuotas anónimos.

Para p páginas por recorrido (incluida la página vacía final), un ciclo de dos
cuentas cuesta hasta **4p + 2 refresh**: con p=5 son 22 solicitudes. Con poco
historial son normalmente 8 más hasta 2 refresh. El presupuesto diario permite
unos cinco ciclos máximos, menos las autorizaciones/errores; **no permite prometer
24 reconciliaciones completas al día**. La capacidad y cuotas reales son por app
y pueden ser inferiores o compartirse con otros usos; comprobarlas antes de
activar. Un backfill que no cabe se rechaza y conserva el dato anterior, marcado
obsoleto, en vez de confirmar una suma incompleta.

No hay Cron ni sincronización por GET. Una futura cadencia horaria necesitará
autorización y reevaluación de presupuesto/coste. Mientras tanto, solo el operador
privado podrá solicitar una ejecución puntual, con leases CAS y generaciones.

## Ensayo reproducible exclusivamente local

Desde Ubuntu/DDEV, con Node.js 24, dependencias fijadas y OpenSSL para el TLS
sintético del navegador:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:d1
npm run config:check
npm run staging -- check
npm run staging -- dry-run
npm run staging:auth:plan
npm run test:staging:auth
npm run test:staging:auth:browser
npm run test:frontend:staging
```

No ejecutar `staging -- list/migrate/deploy` ni el smoke remoto durante este
ensayo. `dry-run` solo empaqueta localmente el entry **fixture** sin credenciales.
El bundle OAuth se prueba en workerd con outboundService simulado. El helper de
SQLite ejecuta las mismas migraciones en memoria; la suite D1 usa persistencia
temporal, reinicia workerd y la borra al terminar. Ninguna suite abre D1 del
usuario ni lee `.dev.vars`.

El navegador se ejecuta detrás de un proxy CONNECT en loopback: solo permite los
dos hostnames de prueba y termina TLS localmente, **sin DNS/forwarding externo**.
Las redirecciones HTTP nativas también pasan por ese proxy. El resolver de Chrome
rechaza cualquier otro nombre. Los outbound del Worker son una función falsa.
Se genera una clave TLS desechable que se borra con el directorio temporal, no
una credencial del usuario. Las pruebas negativas comprueban el rechazo de otros
hosts/puertos. Capturas y manifiesto sintéticos quedan en `artifacts/staging-auth/`
y en el artifact de Actions; las capturas adjuntas no muestran IDs, enlaces ni
credenciales. La marca de cero peticiones del manifiesto corresponde a ese
ensayo aislado, no a una verificación del entorno remoto.

## Runbook de activación futura: detenerse en cada puerta

1. **Revisión humana de esta PR.** Confirmar alcance, tests y reglas del dataset.
   No fusionar ni activar desde Codex. El estado remoto se conoce solo por las
   confirmaciones anteriores del propietario; no se verificó su configuración.
   Véase la incidencia del ensayo inicial más abajo.
2. **App y consentimiento.** Autorizar por separado al propietario a evaluar la
   app de staging, callback exacto y capacidad de dos atletas, con coste adicional
   0 €. Mantener la app DDEV intacta. Confirmar los consentimientos y la identidad
   de cada participante por canal privado. Si el dominio/capacidad no se acepta,
   no avanzar.
3. **Operador remoto y release guardada.** Revisar e implementar el canal privado
   descrito arriba y una configuración/comando de release que contraste el mismo
   Worker/DB/UUID/binding con la allowlist independiente. La propuesta de
   `staging:auth:plan` proporciona el diff concreto (entry y variables); no es una
   release habilitada. El CLI actual rechaza ese diff deliberadamente. Una nueva
   autorización/PR deberá habilitar el cambio explícito de modalidad: no saltar
   las guardas con `--name`, `--env`, `--config` arbitrarios o Wrangler directo.
4. **Secretos nuevos.** Pedir autorización específica para introducirlos
   manualmente, comprobar la cuenta/destino en terminal privada y no exponer
   valores. Verificar estrategia de copia de seguridad y rotación, nunca claves
   del piloto. No habilitar la red todavía.
5. **Migración aditiva.** Autorizar explícitamente la aplicación remota de 0003
   en la D1 staging ya conocida, tras revisar copia de seguridad y listado de
   migraciones con el propietario. Los comandos guardados existentes son
   `npm run staging -- list --confirm-staging` y
   `npm run staging -- migrate --confirm-staging`; **no se ejecutaron aquí**.
   No cambiar binding ni seleccionar otra base. No borrar tablas antiguas.
6. **Despliegue manual aprobado.** Con la release de (3), comprobar target y
   bundle local, revisar ausencia de Cron/logs y hacer el despliegue manual solo
   con nueva autorización. El comando operativo actual `staging -- deploy`
   únicamente despliega fixtures: no sirve para activar OAuth. El primer estado
   OAuth debe conservar red deshabilitada; 503 es la respuesta segura si faltan
   controles/clave/migración. No atribuir el éxito del check a un deploy real.
7. **Activación puntual.** Solo tras aprobar callback, capacidad y operador,
   activar los controles `STAGING_AUTH_ENABLED=owner-authorized-staging-test` y
   `STAGING_NETWORK_ENABLED=owner-authorized-staging-network` mediante la release
   revisada. Autorizar primero una cuenta de prueba y un sync manual; después,
   con consentimiento específico, ambos participantes. Emitir cada invitación
   desde el operador privado, no desde una URL pública. Verificar scopes,
   resultado limpio, tokens cifrados y cuotas sin volcarlos a logs.
8. **API pública.** Con autorización para el GET remoto, consultar únicamente
   `/api/progress` sin cookies ni IDs. Confirmar claves del DTO, no-store, suma
   conjunta, partial/stale y CORS. No inspeccionar actividades o credenciales
   como evidencia pública. No conectar el frontend público por esta fase.
9. **Desactivación/rollback.** Ante error, detener el operador/sync y deshabilitar
   la red. Restaurar manualmente la release de fixtures validada por
   `npm run staging -- check`, con autorización de despliegue y la cuenta
   seleccionada. La migración aditiva puede quedarse; no es necesario un DROP
   para volver a fixtures. Sus tablas originales siguen intactas. Ocultar el
   nuevo entry no revoca por sí solo el consentimiento ni suprime D1: gestionar
   revocación/supresión verificadas por el canal privado y eliminar secrets solo
   tras decidir retención/recuperación. No borrar claves si quedan datos que
   deban poder recuperarse. No transferir estado ni cofres a producción.

Ningún paso remoto de este runbook se ha ejecutado. Los bloqueos de activación
(callback/capacidad, operador privado y release guardada) son intencionales;
las pruebas locales y la revisión de esta PR no los sustituyen.

## Incidencia del primer arnés de navegador

Una primera ejecución usaba intercepción de Playwright por ruta. Se detectó que
la redirección HTTP 303 podía escapar a ese mecanismo e intentar un GET al
`/oauth/result` remoto. Ese ensayo se detuvo; no se puede certificar cero
peticiones en esa primera ejecución. No se usaron credenciales reales ni se
ejecutaron operaciones de modificación remota. El arnés fue reemplazado por el
proxy TLS/CONNECT exclusivamente local descrito arriba, con pruebas negativas
de destino. Las capturas y el manifiesto entregados proceden del ensayo corregido.

## Operador y release de #42

La [preparación del operador privado](staging-operator.md) añade RPC por service binding y comandos firmados, sin rutas HTTP de administración, más `wrangler.staging-oauth.jsonc` y `wrangler.staging-operator.jsonc` cerrados. Reutiliza este backend/dataset y 0003; no requiere otra migración. Sus herramientas solo hacen check/plan/dry-run locales. El ingreso real desde terminal y la activación siguen bloqueados: las pruebas de Miniflare no constituyen un canal remoto. La propuesta inicial `staging:auth:plan` se conserva como antecedente; el plan actualizado es `staging:oauth -- plan`.
