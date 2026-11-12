# Configuración de infraestructura (Node)

`config.json` en la raíz es JSON estricto versionado (`schemaVersion: 1`), con
metadatos **no secretos** para scripts Node. No es la configuración del juego.
El cargador `scripts/lib/infrastructure-config.mjs` rechaza archivos ilegibles,
versiones y claves desconocidas, destinos no autorizados, hosts/puertos alterados,
solapamientos de IDs y perfiles mezclados. No imprime valores rechazados.
La configuración validada queda congelada en memoria.

## Tres capas diferentes

| Capa | Fichero | Uso |
| --- | --- | --- |
| Juego público | `frontend/config/game.json` | Frontend publicado; sigue provisional, sin cambios en esta issue. |
| Metadatos operativos no secretos | `config.json` | Tooling Node, generadores de perfiles y comprobaciones locales. |
| Protección independiente | `scripts/lib/infrastructure-policy.mjs`, guardas de Wrangler/Worker/navegador | Impiden que editar solamente el JSON autorice otro destino. |

Los archivos privados ignorados (`.dev.vars`, `.local/pilot-config/.dev.vars`,
invitaciones, credenciales, cookies y tokens) pertenecen a otra capa: nunca se
copian al JSON ni se leen para comprobar consistencia. Tampoco se incluyen
`STRAVA_CLIENT_ID`, IDs de atletas, claves de cifrado o el ID de cuenta Cloudflare.
`CLOUDFLARE_ACCOUNT_ID` sigue siendo una selección manual en la terminal para
operaciones remotas que requieren autorización separada.

## Campos y consumidores

- `cloudflare.staging`: Worker, D1, UUID autorizado, binding, origen público,
  `appEnv` y `cronEnabled:false`. `staging -- check/dry-run` y las operaciones
  manuales contrastan JSON → allowlist independiente → Wrangler antes de arrancar
  Wrangler. No hay overrides de destino ni de cuenta en el JSON o la CLI.
- `cloudflare.production`: únicamente nombres reservados y
  `configured:false`, `deployEnabled:false`. No tiene UUID ni URL conocidos;
  no hay selector operativo de producción y no se consultan para completarlos.
- `local.ddev`: proyecto, origen HTTPS, callback, host loopback, targets de
  fixtures/OAuth mock/piloto propio y puertos de frontend/proxy staging.
  Contiene solo UUID locales ficticios y rutas relativas de persistencia fijas.
  Los CLI y runtimes Node validan sus Wrangler antes de operaciones locales.
- `local.profiles`: datasets separados para fixtures, piloto y visor staging;
  meta, fecha sintética `2026-11-01`, `Europe/Madrid`, API y permiso de fixtures.
  Los generadores reutilizan estos campos sin escribir el JSON operativo en el
  frontend. El piloto conserva 500 km; fixtures y staging conservan 100 km.
- `public`: ubicación Pages y ruta pública de progreso, contrastadas sin HTTP.

El OAuth mock y el piloto propio comparten **8790 intencionadamente**, como modos
excluyentes; conservan D1 y persistencia diferentes. Fixtures usa 8788, el preview
8791 y el proxy de lectura staging 8792. Ningún script detiene o reemplaza procesos
ajenos para liberar puertos.

Wrangler y Nginx mantienen sus formatos estáticos. El Worker y el navegador no
importan este JSON: conservan guardas independientes, verificadas por las pruebas.
Esto evita acoplar sus runtimes a Node y evita que cambiar el JSON relaje su
seguridad. Los ejemplos Nginx de #36 y el perfil de staging se contrastan con estos
metadatos; la PR #37 ya forma parte de la base de este trabajo.

## Editar y verificar

```sh
npm run config:check
npm test
npm run test:d1
npm run staging -- check
npm run staging -- dry-run
```

Estos comandos son locales; `dry-run` empaqueta en un directorio aislado sin
credenciales ni despliegue. Las pruebas negativas alteran copias temporales y
comprueban que los comandos fallan antes de crear la salida para Wrangler.
`npm test` incluye la comprobación de consistencia, también en CI.

Un cambio de identidad protegida, host, puerto o persistencia exige revisar
explícitamente la allowlist y los archivos estáticos afectados, además del JSON.
Cambiar solo el JSON falla cerrado. Los perfiles se validan por esquema y se
contrastan con los contratos existentes del piloto y del navegador. Los campos
nuevos requieren actualizar el validador y sus pruebas; no se aceptan extensiones
arbitrarias. No añadir propiedades de producción para habilitar operaciones.

Los generadores siguen rechazando sobrescribir `frontend/config/local.json`;
el de staging solo acepta un archivo existente si coincide exactamente. Cambiar
metadatos no reescribe perfiles existentes, D1, recompensas ni secretos. Si un
perfil necesita regeneración, inspeccionarlo y guardarlo manualmente primero.
Esta tarea no cambia ni activa la meta/fecha definitiva previstas para producción
(500 km, 2026-11-28).

## Publicación y comprobación del visor

Pages sigue empaquetando exclusivamente `frontend/`: el JSON raíz y los scripts
Node quedan fuera del artifact. No se modifica el workflow ni el servicio Pages.
La suite comprueba esa frontera y que los módulos del navegador no importen los
metadatos operativos. No mover ni copiar `config.json` dentro de `frontend/`.

Para probar #36 sin ninguna petición al Worker remoto:

```sh
npm run test:frontend:staging
```

Usa servidor y respuestas sintéticas en loopback. La prueba DDEV documentada en
[frontend-staging.md](frontend-staging.md) también usa mocks, con activación
local temporal del proxy. Abrir el visor normal con el proxy real sí realiza GET
al staging: no es necesario para este refactor y no se hizo para validarlo.
