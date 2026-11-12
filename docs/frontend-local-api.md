# Mapa con API y D1 locales (#31)

El modo real consume únicamente GET `/api/progress`: no abre OAuth, no sincroniza
Strava ni crea Cron. En este ensayo usa **fixtures persistidos en D1 local** y los
identifica en el HUD como «DATOS DE PRUEBA · D1 LOCAL» y «MODO REAL · PRUEBAS».
El JSON público `frontend/config/game.json` continúa en simulación, sin cambios de
fecha, objetivo o imágenes. No se publica ni se despliega nada.

## Arranque reproducible en DDEV

Dentro del checkout/rama de esta PR, en Ubuntu/DDEV y Node 24. Desde el host se
puede entrar con `ddev ssh` y ejecutar allí los comandos. No usar los del piloto
Strava ni introducir credenciales reales:

```sh
npm ci
npm run frontend:local:prepare
# Solo si todavía no existe .dev.vars; rechaza sobrescribir una clave existente.
npm run oauth:init:mock
npm run oauth:migrate:local
# Solo en base vacía; si ya existen consentimientos mock, omitir seed.
npm run sync:seed:local
npm run sync:local
npm run oauth:proxy:enable
npm run oauth:dev:local
```

Esto reutiliza la configuración mock de #25/#27, binding ficticio terminado en
000025 y `.local/oauth-d1`. La fecha es **2026-11-01, Europe/Madrid, meta 100 km**;
el fixture base aporta 102.50525 km. No copia premios ni datos a otra base.
La configuración definitiva prevista (500 km, 2026-11-28) queda fuera de este ensayo.
La base del piloto del propietario y `albertoybelen-db` no se usan.

Abrir **https://albertoybelen.ddev.site/frontend/?local-api=1**.
`frontend:local:prepare` crea `frontend/config/local.json`, ignorado por Git, con
ID de dataset `local-ddev-api-fixtures`, modo real, configuración del ensayo y
`api: {"url":"/api/progress","allowFixtures":true}`. Nunca lo sobrescribe.
No contiene secretos. Sin `?local-api=1`, se carga únicamente el JSON público y
el juego sigue simulado. Ese parámetro solo funciona en el origen HTTPS exacto
DDEV; GitHub Pages u otro origen lo rechazan antes de pedir el archivo local.

Si DDEV sirve otro checkout mientras se revisa un worktree, en otra terminal:

```sh
npm run frontend:local:proxy:enable
npm run frontend:local:serve
```

El servidor estático muestra solo el frontend del worktree en loopback 8791.
El proxy temporal reenvía `/frontend/` desde el mismo origen DDEV; la API sigue
en el backend HTTPS 8790. Solo modifica el snippet temporal ignorado del DDEV
existente, verifica su contenido, hace nginx -t y recarga. No crea otro proyecto,
no cambia DNS ni publica puertos. Necesita el sudo local del contenedor.
No arrancar dos servidores en el mismo puerto.

## Ver cambios sin tocar Strava

En otra terminal del mismo checkout, con los procesos anteriores en marcha:

```sh
npm run sync:local -- corrected   # 32.35525 km, conserva cofres anteriores.
npm run sync:verify:local
# Pulsar «Actualizar vista» en el juego.
npm run sync:local -- empty       # 0 km, conserva finish y cofres.
# Pulsar «Actualizar vista» de nuevo.
```

Actualizar la vista hace solo una lectura GET de D1, no estas sincronizaciones.
No hay polling ni llamadas con pestañas inactivas. El frontend no envía cookies
OAuth, credenciales ni parámetros privados; usa fetch con credentials omit y
cache no-store. La API permite GET/CORS ya existentes; al usar el mismo origen
DDEV no es necesario ampliar su allowlist. El endpoint es absoluto desde la raíz,
no se convierte en `/frontend/api/progress` ni `/albertoybelen/api/progress`.
Los módulos/configuración/imagenes siguen usando sus rutas relativas, compatibles
con el subdirectorio de Pages.

Los ensayos de errores/una cuenta/stale se pueden repetir con la suite de
navegador siguiente. Los fallos normales del sincronizador tienen cooldown: un
segundo sync inmediato no evita el backoff. Consultar la guía de #27.

## Estados y contrato

El adaptador valida schemaVersion 1 y únicamente los campos públicos conocidos:
source, distanceKm finito/no negativo, partial/stale booleanos, updatedAt válido
o null cuando el agregado es parcial, e IDs de premios únicos, bien formados
y con un límite global de 256, independiente del catálogo visible. Los IDs
históricos retirados no invalidan el progreso: se conservan en el DTO/backend
y la presentación filtra únicamente los hitos configurados. Al restaurar un ID
en el catálogo, su premio histórico vuelve a ser accesible sin recalcularlo.
No admite campos de atleta, actividades, scopes o tokens. El HUD nunca muestra
el cuerpo/error original de una respuesta. Fuentes admitidas: fixture, strava-pilot,
strava. Los fixtures exigen permiso explícito y origen local; se etiquetan como
pruebas, nunca como Strava real. No se acepta cambiar de fuente silenciosamente
entre refrescos de una misma página.

La URL debe ser del mismo origen, HTTPS (HTTP solo en loopback para tests), ruta
exacta /api/progress, sin usuario, contraseña, query ni fragmento. No se aceptan
URLs arbitrarias de terceros ni secretos en configuración. Una futura API externa
requerirá una ampliación revisada; esta issue no la configura.

- Cargando: sin inventar distancia inicial; marcador/progreso pendientes.
- Primera respuesta inválida o API caída: números «—», sin usar simulación previa.
- Parcial: conexión o carga pendiente, sin identificar cuál cuenta falta.
- Stale: actualización pendiente; se representa el total válido devuelto por API.
- Error tras un éxito: conserva **en memoria** el último snapshot, premios y fecha,
  con aviso de que puede estar desactualizado. No lo convierte en dato fresco.
- Completo/actualizado: describe integridad/frescura de datos, independiente del
  porcentaje del reto. El marcador y porcentaje se acotan a 100 %, no la distancia.

Cada lectura tiene timeout de 8 segundos y límite de respuesta de 64 KiB. Un
refresh posterior cancela el anterior; respuestas antiguas o de una página
abandonada no pisan las nuevas. El timeout también vence si un mock ignora abort.
No hay caché de kilómetros en localStorage; tras recargar con API caída no aparece
el dato de una simulación ni una copia persistida que parezca actual.
La fecha mostrada es «Última actualización conocida», nunca fecha de consecución.

## Premios y notificaciones

**D1/API es la fuente de verdad de los premios.** El navegador usa exactamente sus
IDs, incluso cuando los km bajan. No calcula desbloqueos por porcentaje ni une
historiales simulados. Si una supresión autorizada retira IDs en el backend, la
siguiente respuesta válida también los retira del mapa y cierra un modal afectado.
Una respuesta inválida no modifica ese último estado válido.

Se reutilizan diálogos y contenido de #9/#16: los avisos muestran cofre cerrado;
solo Ver imagen abre la imagen; el mapa abre directamente recuerdos desbloqueados.
El final histórico conserva el estado permanente y el botón Abrir regalo final.
Cambiar la meta sin un aumento real observado no provoca celebraciones.

El navegador guarda **solo IDs de avisos ya vistos**, con prefijo api-notices,
separados por ID de juego/dataset y endpoint. No guarda distancia ni un historial
que pueda desbloquear premios. Es estado de presentación local, no un acuse
global en D1. Las pestañas del mismo origen pueden leer los avisos vistos de las
otras; entre navegadores/clientes no se sincronizan. Una nueva instalación usa
su primer snapshot como historial y no celebra premios antiguos. Un navegador
con visitas anteriores puede mostrar avisos intermedios pendientes, como #9.
El final no se anuncia ni se celebra automáticamente al cargar/recargar.

Durante una sesión, un finish que aparece por primera vez en API solo puede
celebrarse si se observa aumento de distancia y cruce del 100 %. Recuperar 100 %,
repetir una respuesta o cambiar la meta no lo repite. Esto no pretende reclamar
una notificación global exactamente una vez entre todos los clientes: la API
pública es de solo lectura. Abrir un final ya histórico sigue disponible incluso
si los avisos locales están bloqueados, corruptos o borrados.
No reutilizar IDs de dataset de pruebas para un futuro reto/piloto real.

## Pruebas y capturas

```sh
npm test
npm run test:d1
npm run test:frontend:api
npm run capture:visual
# DDEV, puertos 8790/8791 libres y proxy existente:
npm run oauth:proxy:enable
npm run frontend:local:proxy:enable
npm run test:frontend:ddev
npm run frontend:local:proxy:disable
```

La suite HTTP levanta servidor de loopback con frontend en `/albertoybelen/` y API
simulada, sin dependencias de runtime. Produce 16 capturas móvil/escritorio de
carga, sin datos, parcial, completo, stale, caída con dato previo, corrección y
regalo histórico. Verifica timeout, JSON/campos corruptos, origen, teclado, 320 px,
exceso del 100 %, final nuevo/histórico, cambio de meta, recarga y segundo cliente.
Los unitarios cubren también respuestas fuera de orden, cancelación, ausencia de
fallback a simulación y avisos compartidos entre pestañas.
Actions ejecuta la suite y adjunta artifacts junto con las capturas simuladas ya
existentes; CI no usa DDEV, secretos, Strava ni Cloudflare remoto.

La prueba DDEV sirve estos archivos del worktree y el Worker original con D1
real **local temporal**, migraciones existentes y salida remota prohibida.
Comprueba 36.125 → 105 → 20 km con una cuenta, lectura desde el frontend HTTPS,
cofre final persistente tras retroceso/recarga y conservación al caer la API.
No sustituye la API por una ruta de Playwright: las peticiones pasan por Nginx,
Worker y D1. Sus dos capturas son ddev-mobile-partial/history en artifacts/frontend-ddev.
Elimina su base/servidores temporales al terminar. No altera el ensayo persistente
normal ni la base del piloto.

Las capturas de esta PR son sintéticas, sin personas ni datos reales. Los tests
no demuestran funcionamiento con la cuenta Strava del propietario; sigue pendiente
una autorización específica para ese piloto.

## Limpieza

Detener los procesos frontend/backend con Ctrl+C y retirar solo el proxy temporal
frontend si se habilitó. No borrar el snippet OAuth versionado del checkout principal:

```sh
npm run frontend:local:proxy:disable
printf '%s' '{"confirm":"erase-local-fixtures"}' | npm run sync:reset:local
npm run sync:verify:local
```

Tras reset, Actualizar vista refleja los premios retirados por el backend. El modo
simulación conserva sus propios controles/datos; su botón Reiniciar no modifica D1.
Retirar manualmente frontend/config/local.json si se quiere repetir su preparación;
no copiarlo al build público. Los archivos privados de mocks continúan ignorados.
No tocar la base remota, activar el piloto real ni desplegar como parte de estos pasos.
