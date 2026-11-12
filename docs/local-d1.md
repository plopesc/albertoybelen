# D1 exclusivamente local (Ubuntu/DDEV)

Esta PR añade persistencia de **fixtures** al Worker de #14. No usa MariaDB ni
PostgreSQL de DDEV, no conecta el frontend, no añade OAuth real y no configura
Cron. No hay cuentas, credenciales, actividades ni fotografías personales.
La referencia local es 2026-11-01/Europe/Madrid y 100 km ficticios. Los parámetros
previstos del reto real (500 km desde 2026-11-28) no cambian `game.json` ni se
importan desde este estado de pruebas.

## Crear y arrancar un entorno limpio

Desde la raíz de un checkout de esta rama, dentro del contenedor DDEV existente:

```sh
# Desde Ubuntu anfitrión, anteponer ddev exec a cada comando.
npm ci
npm run d1:migrate:local
npm run d1:dev:local
```

En otra terminal del **mismo contenedor**:

```sh
curl -i http://127.0.0.1:8788/api/progress
# Invocación manual de prueba de scheduled(), NO un Cron activo:
curl 'http://127.0.0.1:8788/__scheduled?cron=local-test'
curl -i http://127.0.0.1:8788/api/progress
```

El primer GET de un estado nuevo devuelve cero y `partial:true`. La invocación
sintética carga 4.00075 km conjuntos; repetirla no duplica metros. No se necesita
login, cuenta Cloudflare ni secreto. Se sirve solo en loopback, puerto 8788 para
no colisionar con el prototipo en memoria de 8787. El origen HTTPS DDEV existente
no cambia; no se expone otro puerto en el router ni existe un callback OAuth.
No confundir una URL dentro del contenedor con acceso desde el navegador anfitrión.

Wrangler **4.160.1**, Miniflare **5.20261110.1-beta** (misma versión que utiliza
Wrangler) y esbuild **0.28.2** son herramientas de desarrollo fijadas por lockfile.
DDEV ya configura Node 24; para estas comprobaciones se recomienda esa versión.
La suite SQLite usa `node:sqlite` (disponible en versiones recientes de Node 22/24).
El frontend continúa sin dependencias de runtime. En Miniflare se usa su adaptador
V4 de opciones y el `resourcePersistencePath` V5 explícito: la compatibilidad de
opciones antigua por sí sola no conserva archivos tras reiniciar el runtime.

`wrangler.local.jsonc` solo tiene `DB` con nombre de fixtures y UUID ficticio,
`remote:false`, métricas desactivadas, sin account ID, rutas, entornos remotos ni
triggers. `scripts/d1-local.mjs` acepta únicamente migrate/dev, fuerza `--local`,
rechaza argumentos adicionales y retira credenciales Cloudflare del subproceso.
Nunca sustituir ese UUID por el de producción ni usar estos comandos con flags
remotos. No se incluye ningún script de deploy/login/creación de recursos.

## Persistencia, reinicio y reset

El estado de Wrangler se guarda exclusivamente bajo `.local/d1/`, relativo a este
checkout. Logs, SQLite, journals, WAL, `.wrangler/`, `.dev.vars*` y `.env*` están
ignorados por Git. En un worktree distinto se usa otro directorio, sin importar
progreso de otros entornos. No copiar estos archivos a staging o producción.

Detener el proceso con Ctrl+C y volver a `npm run d1:dev:local` conserva datos,
metadatos y premios. Migrar otra vez no vuelve a aplicar una migración registrada.
**No sembrar/resetear automáticamente al arrancar ni al hacer GET.**

Para descartar expresamente **todo el entorno ficticio**, detener primero el
servidor y ejecutar:

```sh
npm run d1:reset:local -- local-fixtures
npm run d1:migrate:local
npm run d1:dev:local
```

El reset físico elimina únicamente la ruta fija `.local/d1/` de este checkout;
requiere la confirmación literal, no acepta una ruta ni un identificador remoto.
Las fixtures deben volver a importarse manualmente si se quieren repetir.
Para reset lógico sin eliminar el esquema, el adaptador interno ofrece
`resetForTests('local-fixtures')`: vacía dominio, proyecciones y recompensas de prueba,
incrementa generaciones y conserva la revisión para rechazar jobs anteriores.
Ningún reset está expuesto como endpoint HTTP. Un reset de pruebas no equivale
a una solicitud de supresión real ni promete borrado físico de páginas o backups.

## Modelo y migraciones

`backend/d1/migrations/0001_local_game.sql` crea:

- `game_state`: documento canónico versionado de dominio (política, auth de
  fixtures y metadatos mínimos), acotado al namespace `local-fixtures`.
- `participants`: dos slots, generación, permisos, conexión, reconciliación y
  frescura, sin nombres ni IDs reales.
- `activities`: clave compuesta slot+actividad, UTC, metros y campos mínimos de
  elegibilidad. Nunca se guardan nombre de actividad, rutas GPS ni perfiles.
- `rewards`: IDs históricos, incluido `finish`, sin fecha de consecución.
- `invitations` y `oauth_attempts`: hashes, slot, generación, caducidad y consumo;
  referencias y unicidad impiden intentos huérfanos o secretos en esas columnas.
- `transaction_guard`: control de versión SQL que aborta una escritura obsoleta.

Las tablas relacionales son **proyecciones del documento canónico**, reconstruidas
solo por el repositorio en la misma transacción. No editar tablas ni JSON de forma
independiente: se rompería su coherencia. El documento permite reutilizar los
reductores existentes sin introducir otro motor de reglas. No es un historial de
eventos; los datos suprimidos se retiran tanto de él como de sus proyecciones.
Las migraciones ya aceptadas deben mantenerse inmutables; las siguientes tendrán
otro número. La aplicación de versiones la registra Wrangler en `d1_migrations`.

## Repositorio y contrato del Worker

`createD1Repository(DB)` recibe el binding, sin conocer cuentas Cloudflare. El
Worker acepta `repository` por inyección; si no se proporciona conserva el contrato
en memoria de #14. La entrada D1 exige `APP_ENV=local-fixtures`. La respuesta pública
mantiene schemaVersion/source, distancia conjunta, partial/stale, updatedAt e IDs
históricos; no publica slots, actividades ni aportaciones. Un fallo de lectura
se responde con 503 genérico, sin SQL ni datos privados.

`applyEvents()` reconcilia snapshots completos o incrementales con la política
actual. Inserciones repetidas, ediciones y tombstones no duplican metros; las
correcciones y borrados pueden reducirlos sin perder premios. `setGoal()` valida
el objetivo y conserva distancia e historial, sin desbloquear premios por sí solo.
`markFailures()` conserva el último dato válido y su fecha, marcando stale; partial
sigue siendo independiente. Un error a mitad de un lote no publica medio snapshot.

Cada mutación lee una revisión y calcula el nuevo dominio. Un único `DB.batch()`
verifica esa revisión mediante CHECK antes de escribir snapshot y proyecciones.
Un conflicto aborta todo; se relee y reevalúa hasta tres veces, sin bucles agresivos.
Los errores de integridad no se ocultan como éxitos. Esta implementación reconstruye
proyecciones y es deliberadamente pequeña para fixtures: antes de producción será
necesario validar límites/tamaño de lotes y optimizar escrituras con datos de volumen.
No se ha probado concurrencia distribuida ni rendimiento contra D1 remoto.

## Invitaciones, supresión y credenciales

`transitionAuth()` aplica el reductor de #15 y sus efectos de política **dentro de
la misma escritura CAS**. `actor`, verified, permisos y requestVerified representan
verificación interna confiable de tests; no se aceptan del visitante ni existe
una ruta pública para ejecutarlos. Sigue pendiente implementar autenticación real,
verificación de identidad y OAuth en otra issue.

Una supresión verificada elimina aportación, metadatos e intentos, purga los hashes
de cuenta correspondientes y aumenta generación. Los jobs retrasados no pueden
reimportar datos; el otro slot continúa independiente. Revocar permiso conserva
provisionalmente el agregado y requiere consentimiento nuevo. Se mantienen premios
salvo purga adicional verificada exigida por privacidad. Una nueva vinculación tras
supresión empieza vacía y con generación nueva, sin recuperar snapshots antiguos.

`credentialVault` rechaza almacenar o leer tokens. No hay columnas de secretos ni
cifrado ficticio: la interfaz debe sustituirse por un vault revisado que cifre en
backend con clave externa a D1/Git antes de habilitar credenciales. Los hashes de
invitación no son tokens OAuth. Logs, copias, retención y borrado físico requieren
política y validación separadas antes de tratar datos personales.

## Pruebas y límites de verificación

```sh
npm test
npm run test:d1
node --check backend/d1/repository.js
git diff --check
git check-ignore .local/d1/example.sqlite .wrangler/state .dev.vars
```

La suite Node usa SQLite real con interfaz D1 inyectada para migraciones, FK/CHECK,
composición, CAS, rollback, dos escritores, persistencia en archivo, reset,
correcciones/borrados, cambio de objetivo, premios, privacidad e invitaciones.
La suite adicional usa **workerd/Miniflare y D1 local real**, sin mocks SQL: prueba
binding, migración desde cero, batch/CAS, HTTP, scheduled y reinicio del runtime
con estado persistente; bloquea fetch saliente. La CI ejecuta ambas suites.
No se modifican frontend ni configuración pública, por lo que no hay capturas
visuales nuevas. Las pruebas existentes del juego continúan en `npm test`.

Fuentes del contrato D1 consultadas: [desarrollo local](https://developers.cloudflare.com/d1/best-practices/local-development/),
[migraciones](https://developers.cloudflare.com/d1/reference/migrations/) y
[transacciones batch](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## Staging y producción: únicamente planificación

`albertoybelen-db` de producción está reservada e intacta. Staging no existe en esta
configuración y necesita aprobación separada. Antes de cualquier validación remota:
revisar esquema, límites, controles de acceso, cifrado y retención; preparar otra
configuración y otros bindings, fixtures aisladas y plan de limpieza para staging;
obtener autorización para cada recurso/migración/despliegue. Producción se inicializa
con el reto definitivo y estado limpio, nunca restaurando kilómetros o premios de
pruebas. Esta PR no activa recursos, Cron, OAuth, facturación ni servicios de pago.
