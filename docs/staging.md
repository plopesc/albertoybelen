# Staging independiente: preparación y operación manual desde Ubuntu

Esta PR prepara archivos y comandos. **No se han ejecutado migraciones remotas,
consultas a recursos remotos ni despliegues.** El ID de D1 procede del propietario;
no se ha comprobado su existencia, estado ni permisos en Cloudflare.

| Destino permitido | Valor |
| --- | --- |
| Configuración fuente | wrangler.staging.jsonc |
| Worker | albertoybelen-api-staging |
| D1 | albertoybelen-db-staging |
| Database ID | c6bde806-cf94-4ff3-8c4f-c08b8de477f6 |
| Binding | DB |
| Migraciones reutilizadas | 0001_local_game.sql, 0002_oauth_vault.sql y 0003_staging_auth_test.sql (aditiva; no aplicada remotamente en esta PR) |

Producción `albertoybelen-api` / `albertoybelen-db` no es un destino válido de estos
comandos. Los archivos Wrangler locales y sus bases/piloto permanecen independientes.
No se cambia el frontend de GitHub Pages ni su origen de API.

## Comprobaciones locales, sin despliegue

Ubuntu con Node 24, npm y checkout de la PR. No hacen falta cuenta Cloudflare,
credenciales Strava ni secretos para estas comprobaciones:

```sh
npm ci
npm run staging -- check
npm test
npm run test:d1
npm run staging -- dry-run
```

El dry-run compila con la versión de Wrangler fijada en package-lock.json y no
sube el Worker ni aplica SQL. Su mensaje «Total Upload» es el tamaño del bundle
calculado por Wrangler; debe terminar con «--dry-run: exiting now».
La suite D1 aplica el SQL solo a Miniflare/SQLite temporal con salida remota
bloqueada y comprueba el API y la persistencia al reiniciar.

El helper valida **todos** los campos de la configuración contra una allowlist
independiente: nombre/ID/binding exactos, entrypoint, variables, rutas y ausencia de
Cron. Un cambio de destino, binding adicional, env, dominio, comando de build,
secreto o trigger aborta antes de invocar Wrangler. No acepta flags adicionales,
--env, --name, --config alternativo, SQL arbitrario ni un nombre D1 por argumento.
Un cambio legítimo futuro de configuración requiere revisar también el guard/test.

Se genera una copia equivalente con rutas absolutas en `.local/staging-cli/`,
directorio privado 0700 e ignorado por Git. El .dev.vars vacío aislado impide
cargar el del proyecto/piloto; se rechazan archivos .env/.dev.vars adicionales o
valores en ese archivo. El entorno elimina variables Strava/vault/piloto y
selectores de entorno Cloudflare/Wrangler. En dry-run elimina además credenciales
y cuenta Cloudflare. El log de diagnóstico es temporal, privado y se retira al
terminar; no se conserva un log de credenciales. No guardar secretos en esa carpeta.

## Migraciones y deploy manuales, únicamente cuando se autoricen

**Los comandos de esta sección son instrucciones futuras, no ejecutadas en la PR.**
Una persona debe revisar la PR y el destino antes de usar operaciones remotas.
No hay workflow de despliegue, auto-merge ni activación de Cron.

El procedimiento vigente para 0003 es [backup D1 y migración protegida](staging-d1-backup.md).
Incluye confirmaciones separadas para lectura, export y escritura, carpeta privada,
checksum y restauración local antes de migrar. Las comprobaciones locales son:

```sh
npm run staging -- d1-check
npm run staging -- d1-plan
```

El listado remoto usa un SELECT fijo de solo lectura, sin inicializar historial.
La escritura requiere `migrate BACKUP_ID_24_HEX --confirm-staging`, evidencia válida
y que solo 0003 esté pendiente. **La forma antigua sin ID ya no funciona.** No hay
SQL/target/output arbitrarios, import remoto, retry ni reparación automática.
`staging -- deploy --confirm-staging` permanece fixture-only y exige autorización
separada. Todos los subprocessos reutilizan un único runner guardado, con carpetas
nuevas privadas dentro de `.local/staging-cli/`; el export captura stdout/stderr y
retira el log temporal sin exponer la URL firmada de descarga. Las credenciales y
cuenta Cloudflare solo se aportan manualmente en la etapa remota autorizada.

## Comportamiento del Worker preparado

`backend/staging-entry.js` delega fetch al backend D1 existente; la única adaptación
es el marcador de entorno `staging-fixtures`. Reutiliza contrato, cálculo, CORS,
repositorio y migraciones. Es **staging sintético**, source=fixture, sin OAuth ni
uso de tokens. No exporta scheduled y la lista crons es explícitamente vacía;
el deploy futuro no programa trabajos. La configuración tampoco contiene rutas
personalizadas que puedan interceptar el dominio de producción.

workers_dev=true significa que **un futuro deploy manual autorizado hará accesible
la API sintética en el subdominio de staging workers.dev** mostrado por Wrangler.
preview_urls=false evita URLs de versión. No se configura un dominio público
custom ni se altera la Page. No publicar datos reales en esta base/endpoint.

Tras migrar, el primer GET /api/progress inicializa el documento canónico si falta.
Se esperan 0 km, partial=true y source=fixture en una base vacía. No hay endpoint
público de importación, reset o sincronización; /invite y /oauth/callback no están
expuestos. El esquema incluye tablas OAuth por compatibilidad, pero staging no
lee credenciales ni activa el piloto. No se copian filas de pruebas locales ni
secrets a esta D1. El namespace interno histórico local-fixtures se conserva por
compatibilidad SQL; el aislamiento se realiza mediante la base staging distinta.

Cuando el operador obtenga la URL **exacta de staging** tras su deploy autorizado,
puede consultar manualmente GET /api/progress y confirmar contrato agregado, caché
no-store y ausencia de detalles por persona. No inventar ni usar aquí la URL de
producción. Ese smoke test remoto no se ha realizado como parte de esta PR.

## Fallos y límites

Una migración o publicación fallida exige revisar solo staging; no cambiar el
binding a producción, no borrar tablas ni reintentar con otros nombres. Consultar
el historial con el comando list protegido. Rollback de un Worker no revierte
el esquema D1: cualquier corrección de datos/esquema debe revisarse por separado.
Este trabajo no crea recursos, no activa servicios de pago y no valida cuotas,
credenciales ni facturación remotas. Revisar permisos/costes de la cuenta antes
de ejecutar las instrucciones futuras.

Referencia oficial: [configuración de Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)
y [migraciones D1](https://developers.cloudflare.com/workers/wrangler/commands/d1/#migrations-apply).
La política de Cron vacío está en la configuración; los tests verifican también
que el entrypoint no tiene handler programado. CI ejecuta únicamente validaciones
y D1 locales, nunca los comandos remotos de esta guía.

## Metadatos compartidos y barrera independiente

Los identificadores no secretos viven en el `config.json` raíz; consulta [su esquema y seguridad](infrastructure-configuration.md). `staging -- check`, `dry-run` y cada operación manual validan tanto ese JSON como Wrangler contra `scripts/lib/infrastructure-policy.mjs`, una allowlist independiente. Alterar solo el JSON no autoriza otro destino. Producción sigue reservada, incompleta y deshabilitada. `npm run config:check` también contrasta DDEV, los targets locales y el visor staging de #36, sin llamadas remotas.

## Propuesta OAuth de dos cuentas (#40)

El modo desplegable por este CLI sigue siendo fixtures. La [modalidad OAuth de prueba](staging-strava.md) tiene entry separado y migración 0003 aditiva para tablas `staging_auth_*`; su configuración de ensayo es solo local y está deshabilitada. `staging:auth:plan` imprime una propuesta no operativa. El CLI actual rechaza un entry/vars OAuth; activar esa modalidad requiere otra revisión y autorización, además del canal privado del operador y callback/capacidad confirmados.

## Release OAuth preparada, no operativa (#42)

`npm run staging:oauth -- check` y sus variantes `plan`/`dry-run` validan aparte la [release y el operador privados](staging-operator.md), cerrados por defecto. Este CLI `staging` continúa fijado a fixtures, incluido deploy/rollback. No se añaden comandos remotos OAuth ni se altera el Worker desplegado.
