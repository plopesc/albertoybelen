# Operador privado y release OAuth cerrada (#42)

Esta entrega solo prepara y prueba código local. No autoriza acceso a Cloudflare,
Strava, secretos reales, migraciones remotas, despliegues, Cron ni merge. El
staging existente sigue en fixtures; ese estado procede de la confirmación del
propietario y no se ha consultado remotamente en esta tarea.

## Estado de la solución

**Implementado y verificado localmente:** Worker operador sin interfaz HTTP,
RPC por service binding, comandos Ed25519 con permisos y antirreplay durable,
envoltura de `runtime.admin`, release cerrada y herramientas locales.

**Activación remota bloqueada:** todavía no existe un canal autorizado desde la
terminal hasta el Worker privado. No se añade un endpoint temporal para sortearlo.
El Node de los tests es el controlador privilegiado de Miniflare, no un cliente
capaz de invocar RPC en Cloudflare remoto. La firma offline y la escritura privada
de respuestas son reutilizables cuando se diseñe ese ingreso.

Un service binding conecta Workers; no crea por sí mismo un túnel desde Ubuntu.
El propietario deberá autorizar y revisar un ingreso privado autenticado (por
ejemplo, una aplicación Zero Trust/Access en dominio propio con identidad de
servicio y acceso a la vinculación interna), o una alternativa con garantías
equivalentes. No se ha configurado ni probado Access ni confirmado que un plan
concreto permita ese recorrido sin coste. **Si no se demuestra coste adicional
0 € y privacidad real, no activar.** Access/CORS no se consideran prueba de
privacidad de un hostname workers.dev alternativo.

## Piezas y destinos

| Pieza | Configuración / capacidad |
| --- | --- |
| Fixture actual / rollback | `wrangler.staging.jsonc`, entry `backend/staging-entry.js`. CLI actual `staging` conserva exclusivamente este modo. |
| Release OAuth pública | `wrangler.staging-oauth.jsonc`, mismo `albertoybelen-api-staging`, entry `backend/staging-release-entry.js`. HTTP OAuth/progreso; nunca admin. |
| Operador propuesto | `wrangler.staging-operator.jsonc`, nombre reservado `albertoybelen-operator-staging`, **no creado**. workers_dev=false, preview_urls=false, sin routes/Cron/observabilidad. |
| Vinculación privada | `STAGING_AUTH_TARGET` → servicio `albertoybelen-api-staging`, entrypoint RPC `StagingOperatorTarget`. |
| D1 | Solo el backend tiene `DB`: `albertoybelen-db-staging`, UUID `c6bde806-cf94-4ff3-8c4f-c08b8de477f6`. El operador no recibe binding D1 ni claves OAuth/AES. |
| Dataset | El de #41: `staging-strava-test-v1`, 500 km, 2026-11-01 Europe/Madrid, tablas `staging_auth_*` de 0003. Sin nueva migración. |

Los dos Workers nuevos rechazan HTTP administrativo incluso si se invocan en
Miniflare con hostname, Origin o método arbitrarios. El operador devuelve 404
siempre desde `fetch`, sin CORS permisivo; la RPC no se selecciona mediante URL.
El target comprueba firmas aunque el comando venga por el gateway privado.
El Worker público solo conserva OAuth y el DTO de progreso agregado de #41.
No publica slots, auditoría, contadores del operador, firmas ni permisos.

## Modelo de amenazas y controles

| Amenaza | Control y límite |
| --- | --- |
| Navegador público, CORS o cabecera Access falsificados | No hay ruta admin; fetch del operador siempre rechaza. No se confía en headers/roles enviados por JSON. |
| Un Worker enlazado intenta elevar permisos | El target también verifica Ed25519, audiencia, destino, dataset, sujeto y política de la clave. Tener el binding no basta. |
| Clave de lectura o de un solo slot | Acciones y slots se autorizan con la política **servidor**. Sync/activar/desactivar requieren permiso global para ambos slots. |
| Replay, doble click o resultado perdido | Nonce aleatorio, TTL corto y reserva CAS antes de ejecutar. El replay no vuelve a entregar una invitación ni a iniciar sync. |
| Estado/rol/claims manipulados | Esquema exacto, firma del payload, sujeto ligado a clave configurada, sin campo actor/role del cliente. |
| Operación larga y carreras | Lease del operador y el lease/generaciones existentes. Desactivación cambia epoch; el snapshot pendiente ya no puede publicarse. |
| Enlaces, IDs, tokens en logs/SQL/artifacts | Invitación solo en memoria/respuesta privada de una ejecución. Auditoría guarda acción, resultado y tiempo; receipts solo hash de nonce, expiración y estado. |
| Clave de firma robada o cuenta Cloudflare comprometida | Fuera del aislamiento de un simple navegador: revocar la clave en la política, desactivar red/operador mediante release autorizada y revisar auditoría. No confiar en CORS ni en una clave robada. |

La firma Ed25519 autentica posesión de la clave de terminal; el sujeto no es un
email ni un ID de atleta. `STAGING_OPERATOR_KEYS` es una política privada de
confianza del backend, con entradas `id`, `subject`, `publicKey` (raw 32 bytes en
base64url), `operations` y `slots`. No contiene claves privadas. No se copia a
`config.json`, frontend o gateway. Solo se admiten hasta cuatro claves y campos
conocidos. Quitar una clave impide inmediatamente nuevos comandos de esa clave;
no cancela por sí solo una operación ya reclamada: usar la desactivación de sync
para cancelar su publicación pendiente.

La firma vincula también versión y keyId; el nonce se deduplica entre claves de
la misma instancia, incluso durante una rotación. El sobre lleva versión, keyId,
payload y signature. El payload contiene
solo audiencia/destino/dataset/sujeto, issuedAt/expiresAt, nonce y operación.
El firmante local usa dos minutos; el servidor permite como máximo cinco, con
30 segundos de tolerancia futura. La firma no cifra el comando: el transporte
privado futuro también deberá usar TLS, identidad de servicio y límites. Los IDs
esperados se entregan solo por ese canal privado, nunca como argumentos shell,
URLs o archivos versionados.

No se usan cookies administrativas: CSRF de navegador no es un mecanismo de
invocación válido. Si se añade un ingreso HTTP en una fase posterior, deberá
mantener esa separación y no aceptar una sesión/cabecera Access sin verificar
firma/claims/audiencia del proveedor y sin controlar rutas alternativas. No
convertir `actor:{authenticated:true}` del cuerpo en un actor de confianza.
El callback OAuth mantiene cookie Secure/HttpOnly/SameSite=Lax, state ligado a
sesión/generación, CSP, no-referrer, expiración y resultado limpio de #41.

## Operaciones y recuperación

- `issue`: slot e identidad esperada privados; emite o reemite mediante la máquina
  existente. Solo se devuelve el enlace una vez, no se persiste en claro. Ante
  pérdida de respuesta, usar **un nonce nuevo** para reemitir e invalidar el enlace
  anterior. No hay una operación para recuperar tokens/enlaces antiguos.
- `status`: progreso y presupuesto agregados, más syncDisabled. No detalla slots,
  atletas, credenciales, auditoría o actividad individual.
- `sync`: una ejecución, sin Cron ni bucle; reutiliza reconciliación, filtros,
  preservación de cofres y límites 24/operación, 40/15 min, 120/día de #41.
- `disable-sync`: operación prioritaria; funciona aunque haya sync activo. Cambia
  epoch y evita que la respuesta pendiente publique datos.
- `enable-sync`: requiere `confirmation=enable-staging-sync`; no evita el lease
  activo. Tras desactivar, esperar a que termine/caduque antes de habilitar otra
  operación. Un epoch antiguo no recupera permiso al habilitar de nuevo.
- `revoke`: requiere `confirmation=revoke-staging-account`; conserva los km según
  la política y borra credenciales. Es prioritaria durante sync.
- `erase`: requiere `confirmation=verified-staging-deletion` y un booleano explícito
  `purgeMilestones`. Esa confirmación significa que el operador **ya verificó** la
  solicitud; no convierte un navegador anónimo en interesado verificado. Cambia
  la generación y evita resurrección desde sync o callback pendientes.
- `rotate`: reutiliza el vault con fence del lease. No devuelve claves ni tokens.

El primer comando válido inicializa sync desactivado. Un replay devuelve solo
`replay`; un conflicto devuelve `busy` sin ejecutar y consume ese nonce, por lo
que el reintento requiere una firma/nonce nuevos. Las reservas son de hasta dos
minutos, siempre acotadas por la caducidad del comando. Tras caída, esperar su
vencimiento y consultar status con un comando nuevo. `disable-sync`, revoke y
erase son prioritarias; status puede consultar durante una operación.
Los receipts se podan al caducar, con tope de 1000 activos; la auditoría retiene
100 eventos sin PII. No son un registro de cumplimiento remoto ni se publican.
Una entrega fallida del resultado no autoriza repetir una mutación con el mismo
nonce. Mantener siempre copia de seguridad de las claves de cifrado por canal
privado; nunca extraer tokens a logs para recuperarlos.

`scripts/lib/staging-operator-client.mjs` firma **offline** con una CryptoKey
privada que permanece en el proceso de confianza. No ofrece un cliente HTTP
remoto. Su escritor de respuestas solo permite un archivo nuevo `response.json`
en `.local/staging-operator` real (sin symlinks), directorio 0700, archivo 0600;
rechaza sobrescrituras y destinos publicados. Consumir/guardar ese archivo por
canal seguro antes de una respuesta nueva. No imprimirlo, subirlo a GitHub ni
meterlo en snapshots. Los tests generan sus claves y respuestas sintéticas en
directorios temporales y los borran.

## Guardas de release y herramientas locales

```sh
npm run config:check
npm run staging:oauth -- check
npm run staging:oauth -- plan
npm run staging:oauth -- dry-run
```

Cada operación contrasta metadata → allowlist independiente → **los tres**
Wrangler (OAuth, operador y fixture rollback). Se comprueban nombres, UUID,
binding, entrypoints, vars exactas, ausencia de cuenta/env/build/rutas/Cron,
operador sin workers.dev y modo cerrado. `config.json` reserva el nombre del
operador con configured=false/deployEnabled=false; no contiene un destino público
nuevo, credenciales ni identidades. Editar únicamente JSON o un Wrangler para
apuntar a producción, añadir un secret o activar un switch falla cerrado.

`dry-run` compila en memoria con esbuild: no arranca Wrangler, no crea un paquete
con valores de env, no inspecciona `.dev.vars`, D1 persistente o secretos DDEV y
no ejecuta red/subprocesos. No admite deploy, migrate, list, secrets, overrides,
`--env`, `--name`, `--config` ni argumentos extra. El CLI fixture sigue igual.
Los tres switches OAuth/red/operador y los reconocimientos de callback/ingreso/
capacidad están **disabled** en la release versionada. Las confirmaciones runtime
son atestaciones manuales del propietario; no provisionan ni prueban servicios
Access/callback/capacidad. Si faltan, la release pública devuelve 503 y la RPC
falla cerrada sin iniciar OAuth/red. No se ha añadido un modo remoto activo.

## Pruebas reproducibles

En Ubuntu/DDEV, Node.js 24 y OpenSSL local, sin abrir el visor remoto:

```sh
npm ci
npm test
npm run test:d1
npm run test:staging:auth
npm run test:staging:operator
npm run test:staging:operator:browser
npm run test:staging:auth:browser
npm run test:frontend:api
npm run test:frontend:staging
npm run config:check
npm run staging -- check
npm run staging -- dry-run
npm run staging:oauth -- check
npm run staging:oauth -- plan
npm run staging:oauth -- dry-run
```

La integración usa tres Workers workerd locales (API, gateway privado y proveedor
Strava falso), RPC real por service bindings y D1 temporal con 0001–0003. Una ruta exclusiva del
arnés simula una exposición accidental del operador para comprobar 404 incluso
con Origin/Access/roles falsificados; no forma parte del Wrangler de release. El
proveedor falso solo responde a token/actividades sintéticas y no tiene salida
externa. Se verifica reinicio, antirreplay durable, rollback/datos fixture y
release cerrada sin inicializar datasets ni pedir nada al proveedor.
El navegador usa el proxy TLS/CONNECT cerrado de #41, incluido el 303 nativo,
sin DNS ni forwarding externo. Nunca se abre un hostname remoto directamente.
Los artifacts contienen solo captura/manifest sintéticos en
`artifacts/staging-operator/`, sin comandos, firmas o enlaces privados. No hay
cambios visuales de producto: se conserva la página de conexión de #41.

## Runbook remoto futuro — ninguna acción autorizada ahora

1. **Revisar y aprobar esta PR.** Confirmar target, modelo privado, tests, rollback
   y coste 0 €. No interpretar CI verde como permiso de crear servicios o desplegar.
2. **Resolver el ingreso de terminal.** Diseñar e implementar bajo otra autorización
   el adaptador privado para alcanzar el gateway, autenticación real del operador,
   política de servicio mínima y límites. Confirmar condiciones/cuotas del plan.
   El Worker propuesto debe mantener workers.dev/previews/rutas públicas apagados;
   no basta con poner Access delante de un hostname dejando otro accesible.
   Si no se puede garantizar gratis, permanecer bloqueado. No cambiar la app DDEV.
3. **Confirmar app/callback/capacidad Strava.** Reutilizar el procedimiento de
   [#41](staging-strava.md): app separada si sus políticas lo permiten, callback
   propuesto exacto del staging y capacidad autorizada para dos atletas. Su
   admisión por Strava sigue sin verificarse. No crear apps ni consentimientos
   como parte de esta PR; sin confirmación no activar readiness ni OAuth.
4. **Claves nuevas y permisos.** Generar privadamente una clave Ed25519 para la
   terminal y registrar únicamente su pública/política en el backend; no copiar
   claves del piloto. Autorizar separadamente los nuevos Workers Secrets OAuth/AES
   y versiones de #41. La clave de firma privada nunca entra en Workers. El
   gateway solo necesita la vinculación a `StagingOperatorTarget`, no DB/secrets.
   Seleccionar manualmente cuenta Cloudflare, nunca desde `config.json`.
5. **Backup antes de 0003/cambio de release.** Con autorización explícita, exportar
   exclusivamente `albertoybelen-db-staging` (UUID indicado arriba) desde la cuenta
   comprobada a almacenamiento privado fuera de artifacts/Git, directorio 0700,
   archivo 0600 y checksum. No usar una selección de base arbitraria ni imprimir
   el SQL: puede contener datos privados/cifrados. Verificar esquema y legibilidad
   del backup local, custodiar las claves y acordar una prueba de restauración sin
   sobreescribir remoto. El CLI de esta PR **no implementa export remoto**; revisar
   la invocación protegida del propietario antes de autorizarla. No ejecutar esta
   exportación para probar esta PR.
6. **Migración 0003.** Tras backup válido, autorizar aparte listado/aplicación con
   el CLI staging existente y cuenta manual. Solo 0003 es nueva respecto al estado
   remoto confirmado; validar listado real antes de aplicar, sin asumirlo. No
   borrar tablas existentes ni introducir 0004: los controles usan JSON de 0003.
   Los comandos siguientes son únicamente referencia, comentados para no ejecutar:

   ```sh
   # AUTORIZACIÓN REMOTA SEPARADA Y CUENTA VERIFICADA:
   # npm run staging -- list --confirm-staging
   # npm run staging -- migrate --confirm-staging
   ```

7. **Release manual protegida.** Autorizar en una fase posterior el comando remoto
   guardado para estas configs y comprobar de nuevo allowlist/cuenta/modo. El CLI
   OAuth actual lo rechaza y no debe saltarse con Wrangler directo. Desplegar
   primero configs cerradas puede producir 503 en lugar de fixtures: debe ser un
   cambio consciente con ventana y rollback aprobados. No activar observabilidad
   de URLs/cookies/firmas ni Cron. La release activa requiere otra revisión para
   aceptar switches explícitos, claves válidas, readiness verificadas e ingreso
   real; no habilitarla editando solo `config.json`.
8. **Prueba real posterior, autorizada por participante.** Desde la terminal privada,
   firmar status, emitir enlace a fichero privado, confirmar el consentimiento de
   una cuenta de prueba, consultar progreso agregado y habilitar una ejecución
   manual de sync. Probar disable-sync y anti-replay sin exponer respuestas. Solo
   después de esa fase y consentimiento específico conectar ambos slots. No
   conectar Pages ni el visor fixture #36 a este modo por esta issue.
9. **Emergencia y rollback.** Si el ingreso sigue disponible, firmar disable-sync;
   deshabilitar red/operador con release autorizada si no lo está. Mantener claves
   AES para recuperación. Bajo permiso explícito de despliegue, volver al fixture
   validado por `staging -- check`; el comando actual sigue siendo fixture:

   ```sh
   # SOLO CON AUTORIZACIÓN DE ROLLBACK Y CUENTA VERIFICADA:
   # npm run staging -- deploy --confirm-staging
   ```

   Las tablas originales no se han modificado, por lo que volver al entry fixture
   no necesita DROP/importación. Verificar el DTO fixture mediante GET solo si se
   autoriza acceso remoto. No confundir ocultar OAuth con revocar consentimiento
   o suprimir datos. Gestionar esos procesos por el canal privado verificado.
   Restaurar un backup D1 completo es otra operación destructiva que requiere
   autorización separada; no se automatiza ni se hace para rollback del entry.

No se ha realizado ninguna de estas acciones remotas ni se garantiza que el plan
actual incluya todos sus componentes. Siguen bloqueados el ingreso real, callback/
capacidad, claves y activación/despliegue, con autorizaciones independientes.
