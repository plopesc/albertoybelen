# Sincronización de actividades exclusivamente local (#27)

Esta entrega conecta OAuth/vault de #25, D1 de #23, el handler de #14 y la política
pura de #13. El transporte devuelve respuestas HTTP sintéticas: **no llama a
Strava**, no activa Cron y no usa ninguna cuenta, secreto ni recurso remoto.
No cambia el frontend a modo real ni la configuración de GitHub Pages.

## Arranque en Ubuntu/DDEV

Trabajar en la rama de esta issue (tras aprobarla, en main), dentro del contenedor
DDEV existente. Desde el host, anteponer `ddev exec` a los comandos npm.
Requiere Node 24 y las dependencias fijadas del repositorio:

```sh
npm ci
# Solo si todavía no existe .dev.vars; nunca sobrescribe una clave existente.
npm run oauth:init:mock
npm run oauth:migrate:local
# En una base de ensayo vacía: dos consentimientos OAuth SIMULADOS, sin importar km.
npm run sync:seed:local
npm run sync:local
npm run sync:verify:local
# Invoca el mismo handler scheduled() que exporta el Worker, solo localmente.
npm run sync:scheduled:local
```

La CLI abre el mismo binding/persistencia que OAuth:
`.local/oauth-d1/v3`, ID local ficticio terminado en `000025`. Reutiliza el helper
privado de apertura; no crea otra implementación del repositorio ni del vault.
Las migraciones existentes bastan: los metadatos y la lease se guardan en el
documento canónico versionado; las actividades mínimas se proyectan en la tabla
`activities` dentro del mismo batch CAS. No se modifica la migración histórica.
La base local de #23, con persistencia diferente, no se mezcla con este ensayo.

`seed` recorre invitación → sesión → callback del servicio OAuth existente con
el proveedor mock. Guarda únicamente hashes y credenciales cifradas; no imprime
códigos, invitaciones, claves o tokens. Rechaza reemplazar cuentas conectadas.
Si ya existen consentimientos mock de los atletas ficticios 101/202, omitir seed.
El transporte solo conoce esas identidades inventadas. No usar datos personales.

El fixture usa inicio **2026-11-01, Europe/Madrid, meta local de 100 km**. Genera
más de 200 actividades, privadas, manuales, Run/Walk/Hike y Ride, límite de
medianoche e IDs coincidentes entre cuentas. Resultado base: **102.50525 km**, dos
historiales reconciliados y `finish`. Las marcas de ejecución usan el reloj actual;
las pruebas de reglas/carreras fijan su referencia local en 2026-11-01.
La futura configuración definitiva (500 km desde 2026-11-28) no se cambia.

## Correcciones, borrados y errores reproducibles

```sh
npm run sync:local                   # Repetición: no duplica kilómetros.
npm run sync:local -- corrected      # 32.35525 km: ediciones y borrados antiguos.
npm run sync:local -- empty          # 0 km; persisten todos los cofres y finish.
npm run sync:scheduled:local         # Vuelve al fixture base, sin Cron.
npm run sync:local -- last-page-error
npm run sync:verify:local            # Conserva la contribución válida; stale=true.
```

`rate-limit` simula un 429. Tras fallar, el slot queda en enfriamiento: 60 segundos
por error normal, al menos 15 minutos para 429 (respeta Retry-After hasta 24 horas).
No hay bucles de reintento automático. Ejecutar otra CLI inmediatamente puede
responder `idle` mientras conserva `stale`; no es una recuperación falsa.
Las pruebas automatizadas avanzan un reloj inyectado, sin esperas largas.
Cada cuenta puede actualizarse independientemente: la que falla conserva sus datos.

`verify` abre un proceso nuevo y lee el agregado persistido. Para comprobar el
HTTP público detrás de DDEV, con fixture base fresco:

```sh
npm run oauth:proxy:enable
npm run oauth:dev:local
# Otra terminal, en la misma rama/worktree:
curl --fail https://albertoybelen.ddev.site/api/progress
npm run test:sync:browser
```

El último comando abre el frontend existente y pide `/api/progress` desde el
navegador móvil; verifica el agregado y la lista exacta de campos públicos, sin
cambiar el modo del mapa. El proxy conserva el origen HTTPS existente y las
protecciones OAuth; consultar [su guía](oauth-local.md) para detenerlo y para el
caso de worktrees. No borrar un snippet versionado del checkout principal para
retirar una prueba temporal. Detener el proceso dev con Ctrl+C al terminar.

## Contrato público y mínimos persistidos

Se mantiene `schemaVersion:1`, `source:"fixture"` y las claves/tipos existentes:
`distanceKm`, `partial`, `stale`, `updatedAt`, `unlockedMilestoneIds`.
No se publica el número de cuentas, identidad, scopes, actividades ni errores del
proveedor. `partial:true` significa que falta consentimiento/scope o backfill;
`stale:true` significa que hubo un fallo y los datos pueden estar desactualizados.
Ambos pueden coexistir. Una autorización no equivale a un backfill completado.

Refinamiento compatible de #27: antes de la primera importación de ambas cuentas,
`updatedAt` puede indicar la fecha más antigua conocida del **subtotal**, siempre
con `partial:true`; sigue siendo null si no se ha sincronizado nada. Al tener un
agregado completo se conserva su última fecha válida durante fallos/reconexiones,
como antes. Los consumidores deben usar partial/stale junto con la fecha. Las
pruebas previas se actualizan para cubrir explícitamente este significado inicial.

La persistencia usa (slot, ID de actividad), metros exactos sin redondear, tipo,
instante UTC, flags manual/privada y metadatos necesarios de sincronización.
Descarta GPS, nombres, descripciones, perfiles y cualquier otro campo de la API.
El instante inclusivo se calcula con `startInstant()` de la política existente;
`after` pide un segundo anterior porque el filtro de la API es exclusivo, y se
filtra después con `>= medianoche Europe/Madrid`. No se filtra por autorización.

## Snapshots, consistencia y concurrencia

Cada sincronización recorre **todo el período** desde el inicio, incluidas
actividades antiguas: así detecta ediciones y ausencias/borrados sin inventar
un evento de borrado del endpoint de listado. No se guarda ninguna página suelta.

Se fija `before` al comenzar cada cuenta y se hacen **dos recorridos completos**
con los mismos límites. Ambos deben producir el mismo conjunto normalizado.
Se exige orden temporal descendente, campos mínimos válidos y página terminal
vacía incluso después de una página corta: Strava permite páginas cortas
intermedias y se siguen consultando hasta la vacía, según su
[contrato de paginación](https://developers.strava.com/docs/#pagination).
Un ID repetido entre páginas, duplicados con valores distintos o un cambio entre
recorridos invalida todo el snapshot. Duplicados idénticos dentro de una página
se cuentan una vez. Solo se comparan los campos necesarios para el juego.

Límites por cuenta: 100 registros/página, 25 páginas por recorrido (incluida la
terminal), 2000 filas recibidas por recorrido, 2 MiB por respuesta, timeout HTTP
5 segundos y plazo de actividad 45 segundos. No se confirma un truncado por límite.
El refresco del vault conserva sus propios límites; no se repite por cada página.

Strava no proporciona aquí un snapshot transaccional. Dos recorridos iguales
reducen inconsistencias observables, pero **no demuestran** que una omisión estable
o un cambio inmediatamente posterior no existan. Un listado incompleto idéntico
en ambos recorridos es indistinguible de un borrado legítimo. La siguiente
reconciliación completa corrige cambios posteriores; los premios permanecen.
Esta limitación de consistencia eventual debe revisarse antes de usar datos reales.

Una lease privada de 120 segundos en D1 impide trabajos simultáneos entre CLI y
Workers. Si un proceso muere, otro puede tomarla tras caducar. Cada solicitud y
commit valida lease, generación y estado conectado; una respuesta tardía de un
trabajo vencido/revocado/suprimido no escribe ni desbloquea premios. El CAS protege
las escrituras contra cambios concurrentes. Cambiar la fecha durante la lectura
invalida el snapshot. Cambiar el objetivo sin aumento real de metros no desbloquea
premios. La supresión expresa puede purgarlos; la revocación OAuth no es supresión.
Un 401/403 de actividades no prueba por sí solo revocación; se conserva el snapshot
con stale. Solo el error inequívoco de refresh del vault aplica su revocación.

## Pruebas y evidencia

```sh
npm test
npm run test:d1
npm run test:sync:local
npm run test:sync:browser  # DDEV HTTPS y fixture base preparados.
npm run capture:visual
```

La suite D1 nueva ejecuta el **scheduled real del Worker en workerd**, con salida
remota bloqueada, OAuth mock cifrado y D1 persistente. Comprueba HTTP, reinicios,
idempotencia, correcciones, supresión por snapshot y permanencia de finish.
Las pruebas unitarias cubren además DST/CET, límites, inconsistencias, páginas
fallidas, 401/403/429/5xx, refresh, pérdida de clave, scopes, carreras, leases,
reconexión y descarte de campos personales. El cliente tiene una prueba con un
servidor HTTP de loopback inyectado. CI incluye todas las suites Node/D1; no necesita
DDEV, secretos ni credenciales. El navegador DDEV se verifica localmente.

## Limpiar ensayo y futura prueba opt-in

Para borrar únicamente el estado de este binding local, incluidas actividades,
consentimientos, credenciales cifradas y premios:

```sh
printf '%s' '{"confirm":"erase-local-fixtures"}' | npm run sync:reset:local
npm run sync:verify:local
```

El reset incrementa generaciones para invalidar tareas antiguas. Detener antes
los procesos de prueba. La clave privada .dev.vars no se borra automáticamente;
conservarla para otros ensayos o retirarla manualmente junto con los enlaces
privados del ensayo, según [la guía OAuth](oauth-local.md). No copiar estado ni
premios a otra base. Nunca borrar ni consultar `albertoybelen-db`.

**Una prueba con la cuenta del propietario requiere autorización separada.** Antes:
archivar/borrar el ensayo sintético, usar una base de ensayo local limpia y una
clave nueva fuera de Git; revisar permisos, datos que se conservarán, revocación,
supresión y copia/recuperación de la clave. No compartir URLs ni logs privados.
Configurar los secretos solo localmente siguiendo la guía OAuth, nunca en comandos
que queden en historial ni en variables públicas de Wrangler. Esta entrega bloquea
el motor de actividades en modo real, incluso si OAuth se habilita expresamente;
no basta cambiar OAUTH_MODE. Habilitar el transporte real y ejecutar la prueba
requiere otro cambio revisado y autorización explícita, sin desplegar por ello.

El endpoint y parámetros se basan en la [referencia oficial](https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities).
Consultar los [límites por aplicación](https://developers.strava.com/docs/rate-limits/)
antes de esa prueba: los recorridos dobles consumen más solicitudes. Con 230 filas,
esta muestra hace 8 lecturas para una cuenta y 4 para la otra (12 en total).
La cadencia futura propuesta es `0 * * * *`, **solo documentada**: no hay triggers
ni Cron activados. No se han validado cuotas, acceso a privados ni paginación contra
Strava real; todo lo afirmado aquí se verifica con fixtures locales.
