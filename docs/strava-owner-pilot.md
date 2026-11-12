# Piloto Strava del propietario: preparación local (#29)

Esta PR **prepara** el piloto. No autoriza a ejecutarlo con Strava real. La prueba
real exige un mensaje específico y posterior del propietario **tras revisar y
fusionar la PR**. No es una invitación para conectar a Alberto o Belén. No se han
abierto URLs OAuth reales, usado credenciales reales ni descargado actividades.

El mapa y GitHub Pages conservan su configuración. El reto definitivo previsto
sigue siendo 500 km desde 2026-11-28, Europe/Madrid. El piloto aislado usa 500 km
**desde 2026-11-01**, por lo que puede importar actividades previas al consentimiento.
Run/Walk/Hike, manuales excluidas, privadas con activity:read_all y medianoche
inclusiva se evalúan con la misma política de #13/#27.

## Preparación permitida ahora (sin red Strava)

En Ubuntu/DDEV, trabajar en la rama de la PR (o main después de su aprobación).
Desde el host, anteponer `ddev exec` a los comandos npm. Node 24:

```sh
npm ci
npm run pilot:local -- prepare
npm run pilot:local -- migrate
npm run pilot:local -- status
npm test
npm run test:d1
npm run test:pilot:local
```

`prepare` crea una clave nueva y un archivo **vacío de credenciales Strava** en
`.local/pilot-config/.dev.vars` (600, directorio 700). Rechaza sobrescribirlo.
`migrate` usa únicamente las migraciones existentes sobre D1 local; no conecta
Strava. `status` lee contadores y el agregado, sin IDs ni contribuciones individuales.
`check` valida los archivos locales sin peticiones; falla mientras falten valores.

| Entorno | Binding local | Persistencia |
| --- | --- | --- |
| Fixtures OAuth/sync #25/#27 | ID ficticio terminado en 000025 | .local/oauth-d1/v3 |
| Piloto propietario | ID ficticio terminado en 000029 | .local/pilot-d1/v3 |

Se reutilizan el repositorio D1, sus migraciones y documento canónico; la separación
se realiza **por base y directorio**, sin copiar estado. El ID interno del documento
sigue siendo local-fixtures por compatibilidad del esquema, pero ninguna actividad,
clave, invitación o premio se traslada de los fixtures al piloto. No se crea staging
ni se consulta `albertoybelen-db`. No usar `--remote` ni el dashboard de Cloudflare.

La configuración versionada `wrangler.pilot.local.jsonc` está deshabilitada y no
tiene triggers, rutas remotas, publicación ni scheduled(). El helper genera una
configuración privada con rutas locales absolutas para que Wrangler descubra
**solo** el .dev.vars del piloto, no los secretos de los mocks. Las métricas de
Wrangler están apagadas y su salida/log privado se descarta; no compartir logs.
No arrancar otro backend en 8790 al mismo tiempo: el piloto ocupa temporalmente
el mismo upstream HTTPS de DDEV que OAuth, manteniendo su origen existente.

## Punto de parada: autorización humana obligatoria

**Detenerse aquí.** No rellenar credenciales por iniciativa del agente, no abrir
el enlace privado ni la URL de autorización y no ejecutar los comandos de la
siguiente sección hasta recibir la autorización posterior para esta prueba.

La persona responsable debe revisar antes:

- Cuenta propia exclusivamente, capacidad real de su app y condiciones vigentes
  de Strava; la capacidad no habilita conectar a más personas en este piloto.
- Callback domain `albertoybelen.ddev.site` y redirect exacto
  `https://albertoybelen.ddev.site/oauth/callback`, HTTPS/origen DDEV ya existentes.
- Scope único solicitado `activity:read_all` (Strava puede devolver también read).
  No se solicita escritura. Las privadas se importarán si cumplen las reglas.
- Base local del piloto vacía, clave propia nueva, backup privado fuera de Git y
  método de recuperación/rotación del vault. Sin copiar fixtures ni premios.
- Presupuesto de llamadas y usos de la aplicación por otros clientes/usuarios;
  los límites locales no pueden reservar cuota frente a tráfico ajeno.
- Datos guardados (ID compuesto privado, fecha UTC, metros, tipo y flags), sin GPS,
  títulos ni perfiles. Revisar términos antes de publicar agregados reales.
- Cómo revocar y borrar el ensayo, y que ni frontend ni Pages usarán estos datos.

El propietario introduce los valores **en su editor local**, en el archivo privado
anterior, nunca en chat, GitHub, comandos con valores, capturas o Actions:

- STRAVA_CLIENT_ID y STRAVA_CLIENT_SECRET de su app existente.
- PILOT_OWNER_ATHLETE_ID de su propia cuenta, verificado por él; no se consulta
  automáticamente `/athlete` para descubrirlo ni se admite un segundo slot.
- La clave generada TOKEN_ENCRYPTION_KEY y versión; no sustituir la clave si ya
  existen credenciales cifradas que se necesiten recuperar.

La plantilla versionada `.dev.vars.pilot.example` queda siempre vacía. El helper
solo admite esas variables y las versiones de claves; no permite guardar un flag
PILOT_ENABLED en el archivo privado. El permiso se concede al comando/proceso
con el flag explícito siguiente y desaparece al terminarlo. La ausencia del flag,
configuración incompleta o clave inválida bloquea URL de autorización, tokens y sync;
no hay tokens sin cifrar ni fallback a fixtures.

## Ejecución futura, solo después de autorizar

Estos comandos **no se han ejecutado contra Strava real**:

```sh
npm run pilot:local -- check
npm run oauth:proxy:enable
# Terminal A: no importa actividades al arrancar y no abre navegador.
npm run pilot:local -- dev --authorize-owner-pilot
# Terminal B: emite solo la invitación del propietario, sin abrirla ni imprimirla.
npm run pilot:local -- issue --authorize-owner-pilot
```

El propietario abre manualmente el archivo privado
`.local/pilot-config/invitation.url` en su navegador local y completa consentimiento
con su cuenta. No compartir ese enlace ni la URL de Strava (incluye state).
El callback usa sesión Secure/HttpOnly/SameSite=Lax, estado con hash, caducidad y
consumo único. Rechaza otra identidad y scopes insuficientes. Redirige a
`/oauth/result` sin code/state, con no-store y no-referrer. Los endpoints privados
del proxy no registran acceso/error; no habilitar tracing, HAR o captura de red.
No hay botón OAuth público, administración web ni endpoint público para importar.

```sh
# Una sincronización explícita: dos recorridos completos, nunca Cron/auto-sync.
npm run pilot:local -- sync --authorize-owner-pilot
npm run pilot:local -- status
curl --fail https://albertoybelen.ddev.site/api/progress
# Solo si hace falta comprobar/renovar credenciales próximas a caducar:
npm run pilot:local -- refresh --authorize-owner-pilot
```

El agregado tiene schemaVersion 1, **source=strava-pilot**, kilómetros conjuntos,
partial/stale, última fecha válida y premios. Un solo slot está conectado:
**partial=true**, sin decir cuál. El consentimiento solo no importa km. Si no hay
actividad válida desde el inicio, 0 km es un resultado válido después de reconciliar.
No inventar una actividad manual para forzar un resultado: se excluye por política.
La vista del mapa sigue simulada; este piloto se verifica únicamente por la API local.

`status` privado añade número total de registros importados, peticiones, respuestas
por código, errores de transporte, presupuesto y últimas cuotas numéricas recibidas.
No incluye IDs, tokens, nombres, actividades ni errores originales. Los registros
pueden incluir deportes/manuales sin aporte; el contador no equivale a actividades
válidas. No subir resultados con datos reales ni capturas al repositorio.

## Presupuesto y fallos

El wrapper de transporte es compartido por canje, refresh y actividades. Solo
admite HTTPS www.strava.com, POST /oauth/token y GET /api/v3/athlete/activities con
parámetros conocidos. En workerd se usa redirect manual y se rechaza cualquier
3xx/desvío; nunca se siguen redirecciones con credenciales adjuntas.

| Límite local conservador | Valor |
| --- | --- |
| Por comando/proceso o petición del Worker | 12 intentos de envío |
| Ventana local móvil de 15 minutos | 20 solicitudes |
| Día UTC | 60 solicitudes |
| Cada recorrido por cuenta | 5 páginas, incluida la vacía; 400 filas |
| Motor de sincronización | 2 recorridos iguales; HTTP 5 s; plazo 45 s |

400 filas requieren hasta 10 llamadas de actividades (dos veces 4 páginas + vacía),
más un posible refresh: hasta 11 en una sincronización. El consentimiento/canje
consume cuota aparte. Páginas cortas intermedias siguen hasta la vacía. Rebasar
cualquier límite no confirma un snapshot truncado: conserva el último dato con stale.
No ampliar límites ni reintentar en bucle para completar un backfill mayor.

Los contadores se reservan mediante CAS **antes de enviar**, persisten entre CLI y
Workers y contabilizan también fallos de transporte. Se revisan ambas familias
X-RateLimit y X-ReadRateLimit, intervalos de 15 minutos y día. Con margen restante
<=5 en intervalo o <=20 en día, se detiene hasta la ventana siguiente (15 minutos
conservadores o medianoche UTC). Headers malformados/incompletos presentes detienen
15 minutos; si ambos faltan, como puede pasar en OAuth, siguen los topes locales.
El estado muestra las últimas cuotas reportadas, no una garantía de disponibilidad.

429 aplica al menos 15 minutos y Retry-After, relativo o fecha HTTP, hasta 24 horas.
Los demás fallos aplican al menos 60 segundos. Una nueva CLI no evita el cooldown;
no hay retry automático. Una revocación inequívoca del refresh aplica el ciclo de
vida existente; un 401/403 de actividades conserva el dato, sin inferir supresión.
Los scopes, lock, generaciones, CAS, reconciliación completa y premios históricos
siguen pasando por #25/#27. Borrados o respuestas tardías no resucitan datos.

La [documentación de cuotas](https://developers.strava.com/docs/rate-limits/)
publica límites globales y de lectura por aplicación, con ventanas de 15 minutos
y día UTC; la capacidad/plan puede cambiarlos. Confirmar límites efectivos en la
app y los headers, sin asumir que 10+ atletas equivale a cuota ilimitada. Consultar
[OAuth](https://developers.strava.com/docs/authentication/),
[paginación](https://developers.strava.com/docs/#pagination) y términos vigentes
antes de autorizar. Las dos lecturas iguales no garantizan snapshot transaccional;
se conserva la limitación de consistencia eventual documentada en #27.

## Revocar, recuperar y limpiar

Detener el proceso dev y cualquier sync antes de limpiar. Los comandos siguientes
son locales y no requieren activación de red ni la clave para revocar/borrar:

```sh
npm run pilot:local -- revoke
printf '%s' '{"confirm":"erase-owner-pilot"}' | npm run pilot:local -- erase
npm run pilot:local -- status
```

`revoke` cancela el consentimiento local, borra credenciales y bloquea nuevas
consultas; no llama al endpoint de deautorización de Strava. El propietario debe
revocar también el acceso en los ajustes de su cuenta si quiere retirarlo en el
proveedor. `erase` borra actividades, credenciales, invitaciones, sesiones y premios
del ensayo e incrementa generaciones. Retiene **solo contadores anónimos/cuotas**
para que borrar datos no reinicie el presupuesto. El enlace privado se elimina.

Después, retirar manualmente .dev.vars y su backup privado si se quiere destruir
la clave y los valores personales; no se borran automáticamente. No quitar un
snippet versionado del checkout principal para retirar un backend temporal.
Nunca borrar recursos remotos. Para otro ensayo, preparar base/clave limpia; no
trasladar premios de prueba. La pérdida de clave impide recuperar tokens: revocar,
limpiar y consentir de nuevo, sin intentar almacenamiento sin cifrar.
Para rotación, añadir clave anterior y nueva versión distintas en el archivo privado
y ejecutar `npm run pilot:local -- rotate`; el proceso no envía peticiones. Conservar
backup externo hasta verificar la relectura y después retirar la clave vieja.

## Verificación sin acceso real

```sh
npm test
npm run test:d1
npm run test:pilot:local
# Solo DDEV, puerto 8790 libre y snippet del proxy disponible:
npm run oauth:proxy:enable
npm run test:pilot:browser
```

La suite utiliza SQLite/D1 locales y un interceptor o servidor HTTP de loopback.
Verifica forma de URLs/callback, canje/refresh, paginación doble, scopes, estados
HTTP, presupuesto, contadores durables, revocación/supresión y ausencia de datos
privados públicos. La prueba D1 usa workerd para la API y el servicio con binding
real para el flujo; el navegador DDEV comprueba además el **callback en workerd**.
Su salida externa está reemplazada por el interceptor sintético de Miniflare.
No carga archivos privados y no navega a la URL de Strava: simula el callback
únicamente en DDEV, guarda en una base temporal y la destruye al terminar.
CI no recibe secretos y no ejecuta el piloto real ni requiere DDEV.

Ni las pruebas ni la preparación demuestran acceso real, términos aprobados,
cuota disponible o kilómetros reales importados: esa evidencia corresponde a la
prueba manual posterior, autorizada por separado.
