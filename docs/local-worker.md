# API y scheduled locales (#14)

Prototipo en memoria para Ubuntu/DDEV. Importa las reglas puras de #13, sin
copiarlas. No consulta Strava, no ejecuta OAuth ni utiliza Wrangler, D1, Cron,
secretos o recursos remotos. No conecta el frontend. Reiniciar el proceso borra
su estado; ningún dato de prueba se traslada al reto definitivo.

## Ejecutar y probar

```sh
npm test
node backend/local-server.js
```

En otra terminal del mismo entorno:

```sh
curl -i http://127.0.0.1:8787/api/progress
curl -i -H 'Origin: https://albertoybelen.ddev.site' http://127.0.0.1:8787/api/progress
```

El servidor escucha solo loopback y aplica una invocación sintética de scheduled
al arrancar; NO instala ningún programador. Desde DDEV se ejecuta dentro del
contenedor: el origen existente HTTPS no se cambia ni se asume que enruta esta
API. La futura integración requerirá un proxy DDEV autorizado; no se añaden
servidores accesibles públicamente ni rutas OAuth. El comando curl se ejecuta
en ese mismo contenedor, no contra Cloudflare.

El fixture usa inicio 2026-11-01 Europe/Madrid, dos slots inventados y 4.00075 km.
El objetivo de ensayo es interno, no se devuelve por API ni modifica game.json.
Producción prevista: 500 km desde 2026-11-28 Europe/Madrid, con estado independiente.

## HTTP

`GET /api/progress` devuelve exclusivamente:

```json
{"schemaVersion":1,"source":"fixture","distanceKm":4.00075,"partial":false,"stale":false,"updatedAt":"2026-11-02T12:00:00Z","unlockedMilestoneIds":[]}
```

`distanceKm` puede disminuir. El porcentaje, objetivo y renderizado siguen siendo
responsabilidad del frontend futuro. `partial` y `stale` son booleanos independientes:
una cuenta sin autorización y otra con fallo temporal puede producir ambos true.
La fecha es la última sincronización correcta conservadora del agregado, null
mientras falte la reconciliación inicial completa de alguna cuenta. Estar
conectadas ambas no declara el total completo: partial permanece true hasta
snapshots completos válidos de las dos. Una página complete:false no termina
el backfill. No haber importado todavía no inventa un error: stale sigue siendo
independiente y se activa por fallo temporal o revocación. Reconectar o cambiar
scopes requiere otra reconciliación completa, conservando mientras tanto los km
y las fechas internas previas. No se publican slots, IDs de cuenta/actividad, subtotales ni errores
internos. Premios históricos sobreviven a correcciones salvo supresión exigida.

Todas las respuestas usan `Cache-Control:no-store` y `Vary:Origin`. Lista exacta
predeterminada: `https://plopesc.github.io`, `https://albertoybelen.ddev.site`,
`http://localhost:8787`, `http://127.0.0.1:8787`. No se acepta `null`, subdominios
parecidos, puertos arbitrarios ni wildcard. No se habilitan credenciales. OPTIONS
solo permite GET sin headers personalizados; otros métodos devuelven 405, rutas
inexistentes 404 y orígenes no permitidos 403. CORS NO es autenticación: el GET
agregado es deliberadamente público. Sin Origin (curl) puede leerlo.

## Actualización local y contrato para #15

`createWorker({initialState,loadFixture,allowedOrigins})` devuelve `fetch`,
`scheduled(event,env,context)` y `applyLocalEvent(update)`. Los dos últimos serializan
mutaciones en una cola por instancia. `scheduled` retorna una promesa y la pasa a
`context.waitUntil` si existe. Por defecto usa snapshots ficticios de ambos slots;
repetirlos no duplica km. Para fixtures alternativos, `loadFixture` devuelve hasta
100 eventos del contrato de `policy/distance-policy.js`. No realiza fetch de red.

Una página parcial no equivale a reconciliación completa: solo `complete:true`
puede reemplazar el snapshot de una cuenta. Los errores por cuenta se expresan
como eventos error; conservan su estado válido y permiten actualizar la otra.
Si el loader entero falla o el lote es inválido, se conserva lo ya validado y se
marca stale en las cuentas conectadas, retornando un error genérico sin identidad.
No hay bucle de reintentos. La cola local no demuestra atomicidad distribuida:
Worker desplegado necesitará transacciones duraderas y control de versiones.

`applyLocalEvent` es un método de pruebas, NO una ruta HTTP administrativa. #15
podrá inyectar eventos desde su máquina pura autorizada en pruebas. Revocar aumenta
la generación y detiene la cuenta, conserva el agregado y marca partial+stale.
Los eventos antiguos no se aplican. Reconectar con generación vigente y snapshot
completo corrige desde la fecha inicial. Borrar requiere autorización verificada
simulada, elimina aportación y bloquea cualquier job pendiente aun con generación
actual mientras esté suprimido. Solo un consentimiento nuevo explícito y verificado
(connected con newConsent:true, verified:true y generación vigente) inicia un
estado limpio y aumenta otra vez la generación. Los jobs anteriores siguen
bloqueados; no se recuperan snapshots borrados. El backend real deberá autenticar esa orden: aceptar verified del público
sería inseguro. No existe ruta pública de borrado ni callback real en este Worker.

## Plan futuro inactivo

La expresión horaria propuesta es `0 * * * *` en UTC. Es documentación: no hay
archivo de triggers activo, despliegue ni sincronización en Internet. Cuando se
apruebe, Cloudflare ejecutará la tarea sin Ubuntu encendido. Antes: verificar cuotas
vigentes Free, acotar páginas y peticiones por cuenta, respetar Retry-After/429,
backoff exponencial con jitter y presupuesto máximo; cancelar tareas de cuentas
revocadas/suprimidas. Errores conservan el snapshot y la última fecha correcta.

Futuro D1 persistirá identidades internas, generaciones, snapshots, agregados,
logros y sincronización atómicamente. No se implementa D1 aquí ni se consulta la
base reservada `albertoybelen-db`. Staging `albertoybelen-db-staging` no existe
como entorno de esta tarea y necesita autorización separada. Backups/cachés y
retención deberán respetar barreras de supresión antes de restaurar datos.
Recompensas pueden purgarse si la obligación de borrado lo exige.

La PR depende de #13 y se revisa contra su rama. Tras aprobar/fusionar #13,
retargetear a main y rebasar; no volver a copiar ni atribuir su implementación a
#14. CI acepta PRs contra main y ramas codex para que esta pila ejecute los mismos
checks. No cambia el workflow de Pages ni activa despliegues.
