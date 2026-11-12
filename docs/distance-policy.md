# Reglas de kilómetros del reto compartido

Esta especificación y su modelo puro usan exclusivamente fixtures inventadas. No
consultan Strava, no ejecutan OAuth ni crean recursos/D1. El frontend y su JSON
no cambian. Las decisiones confirmadas posteriores de #13 prevalecen sobre sus
preguntas y notas históricas anteriores.

## Reglas confirmadas

| Aspecto | Regla |
| --- | --- |
| Participantes | Dos slots internos, consentimiento y permisos independientes. El recorrido público es conjunto. |
| Deportes | Solo `Run`, `Walk`, `Hike`, comparación exacta. `sport_type` prevalece; solo si es nulo/ausente se usa el heredado `type`. |
| Manuales | Excluir `manual === true`, incluso con deporte admitido. |
| Privadas | Admitidas exclusivamente con `activity:read_all` concedido por esa cuenta. Sin escritura. No inventar lo inaccesible. |
| Inicio | Instante de inicio de actividad igual o posterior a medianoche de `startDate` en Europe/Madrid, inclusive. |
| Cruce de medianoche | Empezar antes excluye TODA la actividad aunque termine después. No prorratear ni usar finalización. |
| Distancia | Metros finitos no negativos; sumar antes de dividir entre 1000. Sin redondeo por actividad. |
| Identidad | Clave compuesta de slot interno + ID estable de actividad. IDs coincidentes de dos slots son distintos. |
| Edición | Reemplazar la aportación previa; admite reducción, deporte cambiado, manual o cambio de fecha. |
| Eliminación | Descontar toda su aportación. Un tombstone y un snapshot completo reconciliado pueden representar el borrado. |
| Importación | Mismas reglas: cuenta la fecha de inicio de la actividad, no cuándo se importó o autorizó. |
| Premios | Los logros históricos permanecen al bajar km, salvo una supresión que exija purgarlos. |

La fecha de pruebas es **2026-11-01, Europe/Madrid**: medianoche equivale a
`2026-10-31T23:00:00Z`. Para CEST, `2026-07-01 00:00` equivale a
`2026-06-30T22:00:00Z`. Las pruebas incluyen las fechas de cambio CET/CEST y UTC;
la zona del ordenador no decide la elegibilidad. `start_date` necesita zona u
UTC explícitos: `start_date_local` sin offset no permite comparar instantes.

La previsión definitiva es **500 km desde 2026-11-28, Europe/Madrid** (límite UTC
`2026-11-27T23:00:00Z`). No se traslada esa configuración al JSON ni se usa como
inicio de los fixtures. Producción necesitará estado propio vacío y recomputar
sus actividades: nunca importar km ni premios de ensayo.

## Calidad de datos y propuestas técnicas

El modelo conservador exige `manual:false` para contabilizar una actividad y
`private:false` o permiso privado explícito. Campos desconocidos no se suponen
públicos/no manuales. Distancia negativa, no finita o timestamp ambiguo produce
error: el lote no se aplica parcialmente. El adaptador futuro deberá normalizar
campos y distinguir un dato inaccesible de una respuesta completa. Esto es una
regla técnica de validación, no una nueva restricción a los deportes acordados.

Los IDs se normalizan a string. En un lote con el mismo ID repetido, la última
ocurrencia es la versión final; repetir el lote produce idéntico estado. El
adaptador futuro debe entregar las versiones en orden coherente y validar su
revisión/cursor: el motor puro no puede deducir qué copia de red es más reciente.
Los snapshots internos solo conservan ID sintético y metros validados, sin
nombres, trazados, fotos ni detalles de actividad. Las sumas usan Number en metros;
solo la presentación futura redondeará. No se truncan kilómetros antes de decidir
umbrales. Un total que desborde Number se rechaza.

## Sincronización, permisos y errores

- Un slot conectado puede contribuir aunque el otro no lo esté. El público ve
  `partial:true` sin saber cuál falta. Sin `activity:read_all` también se declara
  conexión incompleta: no se pretende haber contado actividades privadas.
  Conectar ambas cuentas no significa haber importado su historial: cada slot
  empieza con `initialReconciled:false`. Solo un snapshot completo y válido
  (`complete:true`) termina ese backfill. Antes, el agregado sigue siendo partial,
  incluso si hay páginas incrementales válidas o ambas cuentas tienen permisos.
  La ausencia de importación no inventa un fallo temporal: stale sigue siendo
  una dimensión independiente, y ambos indicadores pueden ser true.
- Al conectar el segundo, reconciliar desde la fecha de inicio del reto, no desde
  su consentimiento. Repetir el backfill no duplica actividades.
- Un lote completo exitoso reemplaza atómicamente el snapshot de ese slot; ausencias
  significan borrados solo si la extracción fue completa, con todas sus páginas.
  Un lote incremental hace upsert y aplica tombstones explícitos, sin borrar por
  ausencia. Una página aislada NO debe marcarse como completa.
- Fallos de red/429 no vacían ni sustituyen snapshots. Se conserva el último total
  válido y `stale:true`. El otro slot puede continuar actualizándose. `partial`
  y `stale` son indicadores independientes y pueden coexistir.
- Cada slot conserva su última sincronización correcta. `updatedAt` público es
  la más antigua de ambas cuentas reconciliadas, nunca un instante inventado en un
  fallo. La integración local #27 amplía la semántica de la fecha inicial: si
  aún no están ambos historiales reconciliados, devuelve la fecha más antigua
  conocida del subtotal disponible, o null si no hay ninguna. `partial:true`
  sigue indicando que ese dato no es el conjunto completo; una autorización
  sin importar actividades no proporciona fecha. No cambia el esquema ni los tipos.
  Después se conserva lastCompleteUpdatedAt ante revocación, reconexión o cambios
  de permisos mientras el nuevo backfill está pendiente; partial/stale describen
  ese pendiente sin perder la última fecha válida. La supresión la limpia porque
  el agregado previo incluía datos de la cuenta borrada. El detalle de error/slot solo pertenece al backend privado futuro.
- Revocar OAuth detiene consultas y elimina credenciales en el adaptador futuro;
  en el modelo deshabilita el slot y aumenta su generación. Conserva provisionalmente
  sus metros dentro del agregado y marca `partial`, sin presentarlos como actuales.
  La revocación marca también `stale` hasta una reconciliación correcta; una falta
  inicial de autorización marca solo `partial`, salvo fallo temporal concurrente.
- Reconectar requiere consentimiento nuevo y la generación actual. Un snapshot
  completo desde el inicio puede corregir/eliminar metros. La reconexión reinicia
  initialReconciled a false, conservando metros y marcas internas previas; una
  página incremental no basta para declarar completo el historial recuperado.
  Cambiar los scopes concedidos también exige reconciliación completa; repetir
  el mismo evento connected con idénticos scopes no invalida un snapshot válido. Ningún premio se pierde
  por esta reconciliación ordinaria.

## Revocación y supresión son distintas

Una supresión exige legitimidad verificada y autorización del titular; poseer
una invitación no demuestra identidad. El prototipo acepta `verified:true` como
fixture de una decisión de autenticación externa, NO como autenticación real ni
como parámetro público confiable. No existen endpoints de borrado en #13.

La supresión vacía actividades y aportaciones, scopes y fechas del slot, lo
inhabilita y aumenta su generación. La orden repetida es idempotente. Trabajos
con generación anterior, callbacks y cachés no pueden reinsertar su contenido;
incluso un evento success con generación actual se rechaza mientras el slot esté
suprimido. No se guarda un subtotal de la cuenta borrada. La otra sigue funcionando.

El tombstone de control usa un slot no personal y una generación: no conserva ID
externo ni token. Si su mera existencia requiriera supresión, el backend deberá
usar una barrera de generación a nivel de reto que no pueda revivir la cuenta.
Un nuevo consentimiento después de borrar requiere un flujo explícito autorizado
y estado limpio: connected con generación vigente, verified:true y newConsent:true
representa esa decisión interna ficticia. Vacía cualquier resto y aumenta otra vez
la generación; solo trabajos creados después de esa nueva autorización pueden
sincronizar. Nunca se recuperan automáticamente snapshots borrados. Ninguno de
esos flags constituye autenticación de una petición HTTP pública.
Retención, backups, caches y canal seguro de atención deben especificarse antes
 de producción; una copia antigua nunca debe anular esa barrera.

Los IDs de premios se conservan como hechos conjuntos solo si es lícito. Si están
sujetos a supresión, `purgeMilestones:true` purga el historial: la supresión tiene
prioridad sobre la promesa ordinaria de permanencia. La decisión necesita análisis
antes de datos reales; las pruebas sintéticas cubren ambas salvedades.

## Progreso actual frente a logros

40 % → corrección a 38 % conserva `milestone-40`; recuperar 40 % no agrega el ID
otra vez. El backend futuro persiste el conjunto por juego y de forma atómica
para que dos clientes reciban los mismos IDs. Las copias públicas no mutan el
estado interno. No se implementa D1 en esta issue.

Cambiar 500→700 km conserva los metros y `finish` histórico; se recalcula el
porcentaje visual y posición desde la nueva meta, acotando al 100 %. Editar la
configuración no ejecuta sincronización ni desbloquea por sí solo. Solo un aumento
efectivo del total descubre IDs alcanzados aún no registrados, incluso si el
porcentaje ya estaba limitado al 100 %. Cambiar porcentajes mantiene los IDs;
retirar uno no elimina su historial. Un ID nuevo no hereda el logro de otro.

## Contrato puro reutilizable por #14 y #15

`policy/distance-policy.js` exporta:

- `startInstant(startDate, timeZone)` → epoch de medianoche, sin dependencia de TZ.
- `eligibleMeters(activity, config, scopes)` → metros elegibles o error de validación.
- `createDistanceState(config)` → estado interno con dos slots sin conectar.
- `applyParticipantSync(state, event)` → copia nueva; nunca muta la entrada.
- `publicProgress(state)` → exclusivamente `{distanceKm,partial,stale,updatedAt,
  unlockedMilestoneIds}`. Sin IDs personales, aportaciones por slot o actividades.

Eventos siempre incluyen `participantId` y `generation` capturada al crear el
trabajo. `connected` recibe scopes verificados por el adaptador de consentimiento;
`success` recibe `activities`, `syncedAt` y `complete`; `error` conserva snapshot;
`revoked` cancela la generación; `deleted` exige `verified` y admite purga de premios.
Los estados de enlace y autenticación pertenecen al futuro adaptador, no al público.
El contrato HTTP de #14 envolverá este DTO con schemaVersion/source y no debe
serializar `state.participants` ni errores internos.

## Pruebas reproducibles

```sh
npm test
TZ=UTC node --test tests/distance-policy.test.js
TZ=Pacific/Honolulu node --test tests/distance-policy.test.js
node --check policy/distance-policy.js
git diff --check
```

`tests/fixtures/distance-policy.js` contiene solo IDs inventados, sin cuentas,
tokens ni datos personales. Se cubren los límites inclusivos, CET/CEST, deportes,
permisos, dos slots, deduplicación, decimales, correcciones/borrados, idempotencia,
backfill, errores temporales, reconexión, barreras de supresión y premios históricos.
No son pruebas de Strava real, autenticación, SQL, concurrencia distribuida o D1.
No hay decisiones funcionales imprescindibles pendientes para estos fixtures;
retención legal y explotación real siguen fuera del alcance y requieren aprobación.
