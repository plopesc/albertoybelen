# OAuth local en DDEV y vault cifrado

Esta PR implementa las rutas y el adaptador de protocolo OAuth de #25 sobre la
máquina de #15 y el repositorio D1 de #23. **La configuración inicial es mock**:
no contacta con Strava, no importa actividades y no programa sincronizaciones.
El modo real requiere otra autorización explícita y configuración privada opt-in.
No se ha usado ni solicitado ninguna credencial real para implementar o probar.

## Preparación de la prueba simulada

Dentro del contenedor Ubuntu/DDEV, desde un checkout de esta rama (Node 24):

```sh
npm ci
npm run oauth:init:mock
npm run oauth:migrate:local
```

`init-mock` crea `.dev.vars` con modo mock y una clave aleatoria de 256 bits, modo
0600. **No imprime la clave y se niega a sobrescribir un archivo existente.** No
copiar secretos reales para esta prueba. La plantilla `.dev.vars.example` tiene
campos vacíos; nunca rellenar ni subir esa plantilla con valores privados.

D1 usa UUID ficticio terminado en 25 y `.local/oauth-d1/`, separado de las fixtures
D1 de #23. Las dos migraciones se aplican únicamente con `--local`. No hay login,
account ID, binding de producción, rutas cloud ni triggers. APP_ENV sigue siendo
local-fixtures. El reto definitivo y `frontend/config/game.json` no se modifican.

## Administración exclusivamente por CLI local

El responsable con acceso al contenedor y archivos locales controla las acciones;
no existe un endpoint HTTP administrativo. Las órdenes entran como JSON por stdin,
no mediante secretos en argumentos/URL. Ejemplos **solo para las cuentas simuladas**:

```sh
printf '%s' '{"action":"issue","slot":"slot-a","expectedAthleteId":101}' | npm run oauth:admin:local
printf '%s' '{"action":"issue","slot":"slot-b","expectedAthleteId":202}' | npm run oauth:admin:local
```

Las invitaciones se guardan una sola vez como archivos privados 0600 bajo
`.local/private-invitations/`, directorio 0700, ignorados por Git. El CLI no imprime
el token. Abrir el archivo correspondiente privadamente en el editor y llevar su
URL al navegador; no pegarla en logs, issues, chats públicos o capturas. El token
está en el fragmento `#...`, no en query. El backend guarda **solo su hash**;
los archivos son la entrega privada del responsable, no el almacén del backend.
Eliminar esos archivos de entrega tras uso/caducidad.

Estos IDs 101/202 son ficticios. En una prueba real futura, el responsable deberá
verificar de forma privada la identidad y cuenta esperada, sin confiar en nombre,
correo, slot o ID aportado por una URL. Su hash no demuestra identidad. No se pide
contraseña de Strava. La posesión de una invitación tampoco autoriza una supresión.

## DDEV HTTPS y proxy

El backend escucha **HTTPS en loopback 8790**. Se mantiene la URL existente:
`https://albertoybelen.ddev.site/oauth/callback`. El snippet
`.ddev/nginx/oauth-local.conf` reenvía `/invite`, `/invite/start`, `/oauth/` y el
GET público `/api/progress`, conservando Host y HTTPS. No toca el frontend.

En el checkout habitual, DDEV carga ese snippet al reiniciar DDEV. Si se trabaja
en un worktree distinto dentro del contenedor, se puede activar temporalmente:

```sh
npm run oauth:proxy:enable
npm run oauth:dev:local
```

El helper solo opera dentro del DDEV existente: copia a `/mnt/ddev_config/nginx/`,
rechaza sobrescribir un snippet diferente, ejecuta `nginx -t` y recarga Nginx. No
crea otro proyecto, no cambia DNS ni expone puertos al exterior. Necesita el sudo
local ya disponible en el contenedor. Para retirarlo después de la prueba:

```sh
# Detener primero oauth:dev:local con Ctrl+C
npm run oauth:proxy:disable
```

No ejecutar el helper disable si se quiere conservar el snippet del checkout
principal: su finalidad es retirar explícitamente esa ruta local. Comprueba que el
contenido coincide antes de quitarla y no borra otros snippets del usuario.

Wrangler crea un certificado autofirmado para su listener de desarrollo. Nginx
acepta ese certificado **solo para el salto a 127.0.0.1**. El certificado HTTPS
externo sigue siendo el de DDEV/mkcert; su CA debe estar confiada en el navegador
anfitrión. No desactivar verificaciones de certificados para Strava ni Internet.
Se usa HTTPS también en el upstream para que Wrangler no reescriba Origin a HTTP:
la aplicación sigue comprobando exactamente el origen HTTPS de DDEV en los POST.
El proxy no hace más permisiva esa comprobación.

Nginx desactiva access/error logs de estas rutas, y el launcher usa nivel error de
Wrangler. La aplicación no registra request.url, bodies, code, state, cookies,
invitaciones ni tokens. No activar trazas del navegador, volcados de cabeceras o
proxy logging durante una autorización real.

## Recorrido simulado

Abrir la invitación privada del slot A. `/invite` crea una cookie de intento
`__Host-...`, Secure/HttpOnly/SameSite=Lax, con sesión anónima aleatoria persistida
solo como hash y caducidad. El script quita inmediatamente el fragmento del
historial y envía la invitación en POST al mismo backend. Solo un token válido y
una sesión emitida por el servidor permiten iniciar el consentimiento.

Aparece el proveedor **simulado**, con botones para cuenta ficticia A/B o cancelar.
Seleccionar A para su invitación y B para la suya. El code vuelve al callback HTTPS,
que valida sesión, state, generación, vencimientos, scopes e identidad esperada;
solo el backend lo canjea. Se consume el enlace y se guardan credenciales cifradas
en la misma transacción. La página final usa una URL limpia, sin code/state/token.

Un callback repetido o concurrente no canjea dos veces el código: reclama primero
un lease privado en D1. La reserva no se reutiliza para repetir un intercambio;
si se pierde una respuesta tras un fallo, esperar la caducidad del intento y abrir
otra vez el enlace para obtener un code/state nuevos. Cancelar o fallar permite
reintento sin quemar el enlace antes de una vinculación exitosa.

Consultar el agregado, por ejemplo desde el contenedor:

```sh
curl https://albertoybelen.ddev.site/api/progress
```

Seguirá marcando progreso parcial/pendiente y cero kilómetros en el entorno nuevo:
**autorizar no importa actividades**. No se muestran slots, atletas, contribuciones
individuales ni estado privado del vault. La sincronización será otra PR.

## Custodia, renovación y ciclo de vida

`auth/token-vault.js` usa Web Crypto AES-256-GCM, nonce aleatorio de 96 bits por
escritura y AAD ligada al namespace OAuth local, slot, generación, versión de
registro y versión de clave. Cambiar/sustituir ese contexto o corromper ciphertext
hace fallar la autenticación. D1 guarda ciphertext/nonce/versiones y metadatos de
reservas, nunca access/refresh tokens legibles ni la clave. El documento canónico
y su tabla `oauth_credentials` se actualizan juntos por el CAS/batch de #23.

El vault deshabilitado de #23 sigue sin fallback en claro. Solo la nueva entrada
OAuth habilita el vault cifrado con configuración explícita; sin clave válida no
empieza el consentimiento ni se vincula parcialmente después del canje. Se
comprueba la clave antes de llamar al proveedor y un fallo de cifrado revierte la
vinculación. Las credenciales solo están disponibles en una API interna, nunca HTTP.

La renovación comienza si el token vence en 60 segundos o menos. Un lease por
versión/generación impide dos refresh concurrentes; la respuesta se cifra con
versión nueva y nonce nuevo. Si se revoca o borra mientras el proveedor responde,
la respuesta tardía no puede recrear credenciales. Un error temporal conserva el
ciphertext anterior y marca stale, con 60 segundos de espera antes de reintentar;
no hay bucle automático. Un token revocado retira el vault y exige nueva invitación.

Operaciones locales del responsable (mismo CLI, sin imprimir credenciales):

```sh
printf '%s' '{"action":"refresh","slot":"slot-a"}' | npm run oauth:admin:local
printf '%s' '{"action":"revoke","slot":"slot-a"}' | npm run oauth:admin:local
# Solo tras verificar expresamente la solicitud de supresión:
printf '%s' '{"action":"delete","slot":"slot-a","confirm":"verified-deletion"}' | npm run oauth:admin:local
```

Revocar retira credenciales e intentos y conserva provisionalmente el agregado
conforme a policy; suprimir retira también datos/contribución y bloquea jobs
antiguos. Ambas operaciones funcionan aunque se haya perdido la clave: no deben
bloquearse las órdenes de privacidad por no poder descifrar. Una purga adicional
verificada puede añadir `purgeMilestones:true`. Nuevas invitaciones/consentimiento
son obligatorios para reconectar; un enlace consumido no se reactiva. Se conservan
las regresiones de #15 sobre órdenes repetidas con reconexión pendiente.

El CLI presupone un responsable autenticado por su acceso al sistema local. No
es un mecanismo de verificación de identidad remoto ni sustituye un canal real
de supresión, política de retención o gestión de copias antes de producción.

## Claves, backup, rotación y pérdida

La clave solo vive en `.dev.vars` ignorado (0600) y en memoria del proceso; no se
incluye en SQL, snapshots, frontend, PNG, fixtures versionadas o logs. El propietario
debe conservar una copia segura fuera de Git y D1, por ejemplo en su custodia
privada cifrada ya disponible. No subir backups de claves a GitHub ni activar un
servicio de pago. No ejecutar comandos que impriman el valor en terminal/CI.

Para rotar, durante una ventana local controlada: crear una clave nueva con CSPRNG
directamente en almacenamiento privado, conservar temporalmente la anterior como
`TOKEN_PREVIOUS_ENCRYPTION_KEY` con su versión, cambiar la versión activa y ejecutar
el CLI `{"action":"rotate","slot":"slot-a"}` (y el otro slot). La operación descifra
con la versión anterior, recifra con nonce/versiones nuevos y no solicita OAuth.
Verificar ambos slots antes de retirar la clave anterior; mantener su backup hasta
terminar la migración de copias. No reemplazar una clave manteniendo la misma versión.

Si se pierde la clave sin backup, el ciphertext no es recuperable. Revocar los
vínculos locales, retirar ese ciphertext y, con autorización del titular, volver
a emitir invitaciones y obtener consentimiento con una clave nueva. No resetear
el reto ni inventar kilómetros para recuperar credenciales. La revocación local
no borra por sí sola la autorización del lado de Strava; el titular puede retirarla
en su configuración de Strava cuando se habilite una prueba real.

## Adaptador Strava y opt-in real futuro

`auth/strava-adapter.js` implementa authorize URL, canje y refresh de acuerdo con
la [documentación oficial de Strava](https://developers.strava.com/docs/authentication/).
Solicita `activity:read_all`, nunca escritura. Valida el ID de atleta del canje y
los scopes de callback; si el proveedor devuelve scope en su respuesta también se
verifica. Strava documenta los scopes concedidos en el callback: no se afirma haber
probado permisos reales ni una introspección adicional con actividades privadas.
No se consulta `/athlete/activities` para esta PR.

**No realizar ahora una autorización real.** Solo después de permiso explícito:
verificar identidad/ID esperado del propietario, permisos vigentes y dominio de
callback; cargar ID/secret y clave en `.dev.vars` privada, establecer modo real y
`ALLOW_REAL_OAUTH=explicit-owner-opt-in`, reiniciar el backend, emitir invitación
privada y autorizar personalmente en el navegador. Si falta ese opt-in el modo real
falla cerrado. Comprobar cookies/HTTPS y retirar el vínculo al terminar la prueba.
No pedir contraseñas ni compartir códigos o tokens con el agente.

Para producción futura, la clave y secretos se configurarían con Workers Secrets
solo tras nueva autorización. Esta PR no los configura ni ejecuta comandos de
secretos, deploy, Cron, `--remote`, staging o producción. `albertoybelen-db` permanece
intacta. No se han usado credenciales reales; presupuesto adicional 0 €.

## Pruebas y límites reales

```sh
npm test
npm run test:d1
# Solo con DDEV HTTPS/proxy, backend mock e invitación A nueva preparados:
npm run test:oauth:browser
```

La prueba de navegador exige modo mock y una invitación sin consumir. Si ya se
usó, revocar el slot y emitir otra antes de repetirla. No modifica el juego ni
`game.json`. Bloquea navegación externa, comprueba cookies, URL limpia, agregado
público y ausencia de code/state/invitación en el segmento nuevo del access log.
Guarda solo capturas de la pantalla final limpia, sin trazas ni secretos.

Las suites cubren cifrado/AAD/nonce/claves/rotación, proveedor HTTP simulado,
concesión/rechazo/scopes/state/cookies/expiración, concurrencia, errores y 429,
revocación/supresión durante peticiones, escrituras atómicas y persistencia D1 local
al recrear el runtime. La integración D1 ejecuta el servicio con el binding real
local; la comprobación de TLS, proxy y navegador se hace en DDEV por separado.
No se ha realizado consentimiento real, pruebas de Safari ni despliegues remotos.
El flujo de navegador DDEV no se ejecuta en GitHub Actions; CI sí ejecuta las
suites Node y D1 local, y conserva las capturas del juego de #12 sin usar secretos.
