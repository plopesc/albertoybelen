# Issue #33: fase A y parada antes de Strava real

**Alcance validado: solo fase A. Fase B pendiente.** Esta guía no contiene comandos
que habiliten red Strava. No ejecutar las instrucciones de activación de otras
guías hasta obtener autorización expresa posterior, separada de esta PR. Aprobar
o fusionar la preparación no concede ese permiso. La issue #33 permanece abierta.

## Ensayo reproducible sin credenciales reales

Dentro del checkout de esta PR en el DDEV **albertoybelen**, Node 24:

```sh
npm ci
npm test
npm run test:d1
npm run test:pilot:local
npm run test:frontend:api
# Puertos 8790 y 8791 libres; no detener servicios ajenos para hacer hueco.
npm run oauth:proxy:enable
npm run frontend:local:proxy:enable
npm run test:pilot:phase-a
npm run frontend:local:proxy:disable
```

La prueba comprueba proyecto/configuración montada y puertos antes de arrancar.
Rechaza otro DDEV o un puerto ocupado sin matar ni reutilizar su proceso. La
reserva de comprobación se libera antes de arrancar; el servidor/Worker también
han de enlazar sus puertos exactos. No es una exclusión contra cambios externos
posteriores a la comprobación: si falla el arranque, detenerse y revisar manualmente.
Los helpers de proxy existentes solo copian contenido conocido; no sobrescriben
snippets diferentes. Retirar únicamente el proxy temporal del frontend, no el
snippet OAuth versionado del checkout principal.

El ensayo usa claves/identidad/actividades inventadas y D1 temporal, con el mismo
servicio, vault y reconciliador fusionados. No carga .dev.vars ni D1 persistentes.
El transporte de Node es una función falsa; toda salida del Worker está interceptada
por Miniflare. El navegador permite solo el origen HTTPS DDEV. Lee la forma de la
URL de autorización pero **no la abre**: construye únicamente el callback falso
hacia DDEV. No usa invitaciones reales ni expone un botón OAuth en el mapa.

Circuito comprobado en una misma base: invitación → sesión/state → callback HTTPS
con proveedor falso → tokens cifrados → actividades ficticias → API → mapa.
Después: retroceso con finish histórico, 429/backoff, refresh sin envío innecesario,
revocación local y borrado. Los servidores y la base temporal se destruyen al terminar.
`artifacts/phase-a/evidence.json` registra solo comprobaciones booleanas y contadores
sintéticos; nunca IDs, claves, URLs privadas, códigos, tokens o registros de actividad.

## Preparación persistente opcional, todavía sin Strava

En un checkout de ensayo propio, no en archivos de otro proyecto:

```sh
npm run pilot:local -- prepare
npm run pilot:local -- migrate
npm run pilot:local -- status
# Opcional: preparar SOLO el visor futuro, sin abrirlo ni iniciar backend.
npm run frontend:local:prepare -- --pilot
```

Prepare rechaza sobrescribir secretos existentes y genera clave local, no credenciales
Strava. Las migraciones tienen remote=false. Se esperan 0 actividades, 0 solicitudes,
ningún consentimiento, partial=true. Check falla de forma segura mientras falten
client ID/secret, clave válida o atleta esperado; no rellenarlos durante fase A.
Los comandos que pueden usar red exigen un flag manual explícito; esta guía no lo
proporciona ni los ejecuta. El CLI exige además el DDEV correcto antes de leer los
secretos de una operación capaz de usar Strava, y comprueba puerto libre al arrancar.

| Separación | Piloto | Fixtures #25/#27 | Ensayo integral fase A |
| --- | --- | --- | --- |
| D1 local ficticia | termina en 000029 | termina en 000025 | temporal, mismo esquema piloto |
| Persistencia | .local/pilot-d1/v3 | .local/oauth-d1/v3 | directorio temporal destruido |
| Secretos | .local/pilot-config/.dev.vars | .dev.vars | memoria, solo valores inventados |
| Config del mapa | local-ddev-owner-pilot, 500 km | local-ddev-api-fixtures, 100 km | local-ddev-phase-a-synthetic, 500 km |

Todos los ensayos empiezan en 2026-11-01 Europe/Madrid. El perfil --pilot rechaza
fixtures (allowFixtures=false) y usa /api/progress del mismo origen. Solo genera
frontend/config/local.json ignorado por Git; no modifica el JSON público ni abre
una URL. El mapa se activará mediante el arranque DDEV explícito cuando corresponda.
El reto definitivo previsto sigue en 500 km desde 2026-11-28. No copiar datasets,
claves, avisos ni premios de prueba a producción. No se usa la D1 remota ni staging.

## Lista de comprobación de fase A

- [x] DDEV esperado y configuración montada coincidentes; puerto ocupado aborta.
- [x] CLI sin configuración completa falla cerrado; ningún fallback sin cifrar.
- [x] Directorio secreto 0700 y archivo 0600; rechaza acceso de otros usuarios y
  enlaces simbólicos. Git ignora los archivos privados y local.json.
- [x] Callback exacto HTTPS /oauth/callback en albertoybelen.ddev.site; sesión
  Secure/HttpOnly/SameSite=Lax, state ligado a sesión, caducidad y consumo único.
- [x] Scope solicitado activity:read_all; no solicita escritura. Scope incompleto,
  identidad inesperada y segundo slot se rechazan en las suites existentes.
- [x] Ciphertext en D1; no se almacenan tokens en claro, títulos o GPS.
- [x] Un slot; API conjunta partial=true sin identificar quién falta; visor de
  500 km refleja el DTO, sin leer distancia simulada ni premios del navegador.
- [x] Paginación doble, límites, rate limit, conservación del último total y premios.
- [x] Actualizar vista solo hace GET local; no llama a Strava ni sincroniza.
- [x] Revocación elimina credenciales y bloquea consultas; borrado retira estado,
  sesiones/invitaciones y premios sin resurrección de tareas antiguas.
- [x] Logs de acceso nuevos sin invitación/state/code; evidencia solo sintética.
- [ ] Cuenta real, cuota efectiva y condiciones de su app: pendientes del propietario.
- [ ] Autorización humana separada y cualquier ejecución de fase B: pendientes.

La auditoría corrigió dos límites de preparación: lectura de secretos solo con
permisos privados también en el directorio, y comprobación del DDEV/puerto antes de
operaciones de piloto. Añadió además el perfil frontend 500 km para evitar usar
accidentalmente el visor de fixtures de 100 km con el piloto. No amplió permisos
OAuth, endpoints, despliegues ni activó un modo de red por defecto.

## Plan exacto propuesto para autorizar después

Este es un plan para revisar; **no se ejecuta en fase A**. Solo cuenta del propietario,
una autorización/canje y una sincronización manual, sin Cron ni reintentos automáticos.

| Acción futura | Destino/forma | Presupuesto máximo |
| --- | --- | --- |
| Consentimiento | Navegación manual del propietario a la autorización web de Strava; redirect exacto a DDEV | Una sesión de consentimiento; la web de Strava puede cargar sus propios recursos |
| Canje backend | POST /oauth/token, grant_type authorization_code, scope aceptado verificado | 1 petición |
| Refresh condicionado | POST /oauth/token, grant_type refresh_token, solo si vence antes de sincronizar | 0–1 petición |
| Reconciliación | GET /api/v3/athlete/activities con after, before, page, per_page=100 | Dos recorridos; hasta 5 páginas cada uno, incluida la vacía: 2–10 peticiones |
| Ver mapa | GET /api/progress del origen DDEV, inicial y actualización manual | Solo lecturas locales, 0 a Strava |
| Estado/revocación/borrado | CLI local y D1 local | 0 a Strava |

Con una actividad válida y una página de datos se prevén 1 canje + 4 lecturas = 5
peticiones backend. El máximo propuesto es **12** (1 canje + 1 refresh condicionado
+ 10 lecturas), de las cuales hasta 11 pertenecen al comando sync. No incluye las
peticiones internas de la web de consentimiento, ajenas al wrapper de la app.
Presupuesto local: 12 intentos/operación, 20 solicitudes/15 minutos y 60/día UTC,
con contador durable compartido entre procesos; máximo 400 filas por recorrido.
No elevar límites para completar un historial mayor. Una página corta no es fin:
continuar hasta vacía, dentro de límites. Sin snapshot completo estable se conserva
el último dato y se detiene la prueba; no se hacen borrados masivos por fallo.

Los headers globales y de lectura se comprueban con margen de seguridad. Un 429
aplica al menos 15 minutos y Retry-After hasta 24 horas; otros fallos al menos 60 s.
Detenerse ante cuota, inconsistencias, redirecciones o respuesta inesperada; no
reintentar por iniciativa del agente ni empezar otra sincronización. Los topes
locales no reservan cuota frente a tráfico de otros usuarios/clientes de la app.

Documentación pública consultada el 2026-11-12:
[cuotas por aplicación y ventanas](https://developers.strava.com/docs/rate-limits/),
[OAuth, scopes y refresh](https://developers.strava.com/docs/authentication/),
[paginación hasta página vacía](https://developers.strava.com/docs/#pagination).
No se abrió el dashboard privado para comprobar la capacidad 10+ o cuota efectiva;
esa confirmación y revisión de condiciones corresponde al propietario antes del piloto.

## Privacidad, limpieza y punto de autorización

Tras una autorización separada, el propietario podrá cargar desde su editor local
STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, PILOT_OWNER_ATHLETE_ID y su clave del vault
en el archivo privado. No enviar valores por chat, GitHub, terminal capturada,
Actions o imágenes. La verificación se limita a cifrado, permisos, contadores y
agregado local; no publicar km reales, IDs, actividades, timestamps privados ni
capturas con datos de su cuenta. No conecta a Alberto ni Belén.

Rollback local, sin llamadas Strava:

```sh
# Detener primero procesos de ensayo propios.
npm run pilot:local -- revoke
printf '%s' '{"confirm":"erase-owner-pilot"}' | npm run pilot:local -- erase
npm run pilot:local -- status
npm run frontend:local:proxy:disable
```

Revoke retira consentimiento/credenciales **locales**; el propietario revoca además
el acceso en los ajustes de su cuenta Strava si desea retirarlo en el proveedor.
Erase borra los datos del ensayo pero conserva los contadores anónimos/cuotas
para evitar que la limpieza reinicie el presupuesto. La clave y valores personales
del archivo privado y su backup deben retirarse por separado desde el equipo local.
No borrar archivos de otro checkout ni el snippet OAuth versionado; no tocar D1
remota, Pages o configuración definitiva. La pérdida de clave requiere limpiar y
nuevo consentimiento posterior, sin almacenamiento sin cifrar.

**PARADA:** entregar resultados de fase A y este plan. La fase B requiere otro
mensaje explícito que autorice OAuth y lectura de actividades de la cuenta propia,
con estos límites, almacenamiento y limpieza. Esta PR y sus mocks no completan
#33 ni conceden esa autorización. El agente se detiene aquí.
