# Visor DDEV → staging Cloudflare: GET público y datos ficticios (#36)

El visor reutiliza mapa, adaptador HTTP, premios y diálogos existentes. Staging es
**exclusivamente ficticio**. El perfil se identifica en título, cabecera, HUD y
footer; 0 km con partial=true describe un conjunto de pruebas sin carga completa,
no el progreso real de dos atletas. No usa el piloto, tokens ni D1 locales.

Destino remoto fijado por el propietario:
`https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/api/progress`.
Esta PR no consulta su disponibilidad en tests ni modifica Worker, binding, D1,
secrets, Cron, migraciones, configuración de #35 o GitHub Pages.

## Preparar y abrir desde Ubuntu+DDEV

Ejecutar en el checkout de esta PR dentro del DDEV albertoybelen (Node 24). Desde
el host se puede entrar con ddev ssh. No se necesitan credenciales de ninguna API.

```sh
npm ci
npm run frontend:staging:prepare
# Terminal A, mismo checkout:
npm run frontend:staging:proxy
# Terminal B, tras confirmar que A arrancó correctamente:
npm run frontend:staging:enable
```

Abrir **https://albertoybelen.ddev.site/frontend/?staging-api=1**.
El navegador debe estar viendo los archivos de esta PR. Si DDEV sirve otro checkout,
puede usarse el preview de worktrees ya existente (frontend:local:serve/proxy:enable)
solo si su puerto está libre y no pertenece a otro proceso; no sustituir un preview
ajeno. El visor staging no requiere ni arranca ese preview por sí mismo.

El perfil generado es `frontend/config/staging.local.json` (ignorado por Git), con
ID **local-ddev-cloudflare-staging**, meta de ensayo **100 km**, inicio
**2026-11-01 Europe/Madrid**, modo real y permiso explícito de fixtures. Esa meta/fecha
corresponde al backend sintético existente, sin cambiar el reto definitivo previsto
(500 km desde 2026-11-28) ni el JSON público actual.
Preparar es idempotente si el archivo coincide; si está editado o es un enlace,
se detiene sin sobrescribirlo. Nunca toca `frontend/config/local.json` del piloto
ni de fixtures. Para cambiar un perfil staging editado, revisarlo localmente y
retirar solo ese archivo antes de regenerar; no borrar local.json para ello.

`?staging-api=1` se acepta solo en DDEV HTTPS y no puede combinarse con local-api,
repetirse ni usarse desde Pages. Sin parámetro se mantiene el juego público simulado.
La URL del navegador sigue siendo del mismo origen: GET `/api/staging/progress`.
El adaptador no admite que la configuración apunte directamente a URLs arbitrarias.

## Qué hace la conexión

1. Nginx reenvía **solo** la ruta exacta `/api/staging/progress` al proxy local
   en **127.0.0.1:8792**, cambiando internamente la ruta a `/api/progress`.
2. El proxy solo acepta GET de esa ruta sin query/body. Construye una petición
   nueva al endpoint HTTPS fijo de la tabla anterior: no reenvía Host, Cookie,
   Authorization, Origin, X-Forwarded-For ni otros headers del cliente; solo Accept
   application/json. No hay argumento, parámetro o variable para elegir otro upstream.
3. Fetch usa verificación TLS normal, credentials omit, redirect error, no-store,
   timeout de 6 segundos y límite de respuesta de 64 KiB. Se rechaza desactivar la
   verificación TLS mediante NODE_TLS_REJECT_UNAUTHORIZED=0. Redirecciones, JSON
   corrupto, campos privados y fuentes distintas de fixture fallan de forma genérica.
4. Se valida el mismo contrato público y se devuelve JSON normalizado con no-store,
   sin copiar headers como Set-Cookie, Location o Refresh. Un cliente que cancela
   aborta también la lectura upstream; no hay retry ni polling.

**Preparar, arrancar el proxy y activar el snippet no hacen peticiones HTTP a
Cloudflare.** La primera carga del visor y cada Actualizar vista sí producen una
consulta GET hacia Cloudflare cuando se usa el proxy normal. Al cerrarse el visor
no hay trabajo programado. El comando de prueba usa siempre un upstream mock.
Se consulta un endpoint ya existente; no se realizan operaciones de infraestructura,
sincronización, OAuth o escritura mediante Wrangler. No se despliega nada.

El proxy solo escucha en loopback y usa un puerto diferente de 8790 (piloto/backend
local) y 8791 (preview frontend). Rechaza puerto ocupado sin detener el servicio;
si ocurre, identificarlo y detener solo procesos propios antes de continuar. No
activar la ruta para apuntar a un servicio desconocido que ocupe ese puerto.
No habilitar tokens ni Cloudflare auth para este visor.

El snippet temporal `staging-read-local.conf` es independiente del OAuth local:
no cambia `/api/progress`, `/oauth/`, `/invite` ni sus puertos. Activación y retirada
son idempotentes y verifican el DDEV y el contenido exacto; no sobrescriben un
snippet diferente. Nginx rechaza métodos distintos de GET y queries antes de
reenviar, y no pasa headers ni cuerpo del cliente. El helper necesita el sudo
local ya disponible y ejecuta nginx -t antes de recargar, sin cambios remotos.

## Estados y premios

Carga inicial sin datos, 0 km parcial, completo, stale y errores reutilizan el HUD
actual. La etiqueta **DATOS FICTICIOS · STAGING CLOUDFLARE** aparece también si no
hay conexión. Un fallo del proxy/staging conserva el último snapshot recibido en
memoria, con aviso; tras recargar sin API muestra «—», sin restaurar km simulados.
Actualizar vista lee únicamente datos guardados. No identifica cuál cuenta falta.

Los IDs desbloqueados vienen de la API: correcciones de km no revocan un premio
histórico. Se mantiene el final accesible por botón, sin repetir celebraciones en
la carga inicial, recarga, cambio de meta o nuevo navegador. Los avisos vistos son
locales al dataset/endpoint staging, separados de simulación, fixtures locales y
piloto. Si el backend retira premios por supresión, el visor refleja la retirada;
no infiere premios por porcentaje ni los reconstruye desde localStorage.
El porcentaje/marcador se limita a 100 %, sin ocultar km excedidos.

## Consultas manuales, opt-in

Con proxy y ruta activos, consultar el JSON mediante DDEV hace **un GET remoto**:

```sh
curl --fail https://albertoybelen.ddev.site/api/staging/progress
```

También se puede consultar el endpoint directamente, de forma explícita y sin
seguir redirecciones ni enviar tokens (no ejecutado en esta implementación):

```sh
curl --fail --max-time 6 --proto '=https' --header 'Accept: application/json' \
  'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/api/progress'
```

Smoke **opcional** directo al endpoint fijo, sin token y con la misma validación:

```sh
npm run frontend:staging:smoke -- --read-staging
```

No admite URLs por argumento. Sin ese flag falla antes de enviar. Solo muestra
que schema/source fixture son válidos, sin volcar datos del upstream. No es
necesario para CI y **no se ha ejecutado como parte de la implementación**.
La disponibilidad/certificado actuales del Worker quedan por comprobar por el
propietario cuando decida probar el visor remoto; no se hacen afirmaciones de
conectividad real basadas en mocks. Los GET consumen la cuota del endpoint ya
existente; no se crean recursos ni se cambia el plan para ello.

## Pruebas sintéticas y capturas

```sh
npm test
npm run test:d1
npm run test:frontend:api
npm run test:frontend:staging
npm run staging -- check
# DDEV, puerto 8792 libre; prueba siempre con upstream falso:
npm run frontend:staging:enable
npm run test:frontend:staging:ddev
npm run frontend:staging:disable
```

La suite staging reutiliza las pruebas de interfaz existentes en una subruta tipo
Pages y añade 0 km, 20/40/60/80 %, etiqueta staging y perfil aislado. Incluye parcial,
completo, stale, caída, JSON/campos inválidos, timeout, retroceso, premios archivados,
100 %, final histórico, recarga, segundo navegador y teclado/responsividad 320 px.
Produce **18 capturas** móvil/escritorio en artifacts/frontend-staging; Actions las
adjunta con las capturas de simulación/API local, sin depender de Cloudflare.
Los unitarios comprueban respuestas fuera de orden, métodos/rutas, cabeceras,
redirecciones, origen fijo, límite de payload, cancelación, timeout, perfil
idempotente sin sobrescritura y smoke desactivado.

La prueba DDEV intercepta solo los archivos del frontend del worktree. **La ruta
API no se sustituye en Playwright:** pasa por Nginx y el proxy Node real en 8792,
cuyo fetch upstream está inyectado con un mock. Comprueba 0 → 40 → 105 → 20 km,
backend como fuente de premios, recarga y fallo posterior. Nunca pide /api/progress
local, no abre puertos del piloto ni lee archivos privados. Genera 3 capturas
sintéticas en artifacts/staging-ddev. Los servidores de prueba se cierran al terminar;
el snippet se retira con el comando disable. No se requiere ejecutar despliegue ni
dry-run de infraestructura para estos cambios de frontend/integración de lectura.

## Limpieza y cambio de entorno

```sh
# Detener únicamente el proceso frontend:staging:proxy de Terminal A con Ctrl+C.
npm run frontend:staging:disable
```

No restaura/baja otros servidores porque no los cambia. Para simulación, abrir
/frontend/ sin parámetros. Para fixtures/piloto locales, abrir el arranque anterior
?local-api=1 con su backend/configuración propios, sin staging-api. Eso no autoriza
activar el piloto real. Si se habilitó un preview frontend propio solo para esta
revisión, detenerlo y retirar su proxy según la guía existente.
El perfil staging puede conservarse para otra visita o retirarse manualmente;
ningún comando de limpieza borra local.json, tokens o D1. No se ejecuta reset
remoto, migración, deploy ni cambios en Pages para salir del visor.

## Configuración compartida (#38)

El proxy deriva el destino fijo y el puerto de `config.json`, validado contra la allowlist independiente antes de escuchar o hacer HTTP. El generador deriva el mismo perfil y mantiene su protección frente a sobrescrituras. Las guardas de navegador y las plantillas Nginx siguen independientes y se contrastan con `npm run config:check`; véase [la guía de infraestructura](infrastructure-configuration.md).
