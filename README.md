# Alberto y Belén · Kilómetro Arcade

Prototipo estático, en español y orientado a móvil, con estética arcade de 16 bits.
Un indicador recorre un mundo SVG vertical al sumar kilómetros simulados.
La interfaz toma el verde bosque (`#24342c`, `#254636`) y dorado ocre (`#c58f4d`)
de la [invitación de Alberto y Belén](https://www.fixdate.io/invitacion/BodaAlberto-Belen).
Los textos pequeños usan un dorado más claro para mantener su legibilidad.
La invitación solo es referencia de estilo: el juego no descarga sus recursos.
Sin frameworks, paquetes de runtime,
servicios externos, Strava, OAuth ni Cloudflare. No requiere compilación.

## Ejecutar localmente

Desde la raíz, con Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory frontend
```

Abrir <http://127.0.0.1:8000>. Se necesita un navegador moderno con módulos ES,
SVG y `localStorage`. Abrir `index.html` con `file://` no es compatible.
También se puede abrir `/frontend/` con el servidor DDEV existente.

Con DDEV, desde la raíz del proyecto en tu máquina:

```sh
ddev start
ddev launch /frontend/
```

La dirección del proyecto es <https://albertoybelen.ddev.site/frontend/>.

## Usar el prototipo

- Empieza con 0 km (o la distancia válida guardada) y la meta de `frontend/config/game.json`.
- Título, meta, fecha inclusiva, zona horaria y modo se configuran únicamente en
  ese JSON. Consulta [campos, ejemplos y migración](docs/configuration.md). La
  fecha `2027-01-01` incluida es de ejemplo, no la fecha definitiva del reto.
- En móvil se muestra primero el mapa y debajo el HUD con kilómetros, objetivo,
  porcentaje y restantes. **Ir a los controles** salta directamente a la simulación.
- **Explorar mapa** lleva al recorrido completo. La salida está abajo y la meta
  arriba: desplázate por bosque, río, cañón y montaña desde el primer día.
- El paisaje aparece directamente, sin cabecera. La leyenda inferior reutiliza
  los símbolos del mapa para posición, hito bloqueado/desbloqueado y meta.
- Los hitos del 20/40/60/80 % muestran un cofre animado y una imagen al
  alcanzarlos aumentando kilómetros. Clic, toque, Enter o Espacio permiten reabrir
  los desbloqueados directamente; los bloqueados no abren. El aviso de un hito
  nuevo espera a **Ver imagen** y no vuelve a mostrarse en visitas posteriores.
  Los avisos de otros hitos aún no mostrados quedan pendientes para otra visita.
  Son imágenes provisionales públicas, sin personas.
- Las posiciones de los hitos se calculan sobre el mismo trazado que el indicador.
  Los cinco tramos del 20 % tienen igual longitud siguiendo el camino; su altura
  visible varía según las curvas. El historial conserva los hitos ganados aunque
  retroceda el progreso o cambie la meta. Al volver solo se anuncian logros
  pendientes de aviso; cargar no crea desbloqueos por el porcentaje actual.
- La meta al 100 % tiene un arco y un regalo decorativo con perspectiva, papel
  verde con brocado y lazo dorado. Se conserva su consecución histórica aunque
  suba la meta. El premio provisional se puede abrir de nuevo desde su botón;
  el contenido definitivo queda para otra fase.
- La salida y el arco de meta usan madera con vetas, tela, piedra y sombras,
  dibujadas en SVG para integrarse con el paisaje de 16 bits.
- El indicador de avance usa la ilustración aportada en `frontend/assets/icono.jpeg`,
  ajustada a un círculo con borde claro; la leyenda comparte el mismo símbolo.
- Suma +1, +5 o +10 km para mover el personaje por el camino.
- La meta se cambia editando `game.goalKm` en el JSON y recargando; no hay
  formulario público. El objetivo antiguo del navegador nunca prevalece sobre ella.
- Al llegar o superar la meta, el marcador permanece al final y el progreso
  se limita al 100 %. Los kilómetros acumulados se conservan.
- **Reiniciar kilómetros** vuelve a la salida y limpia los hitos simulados para
  repetir los cofres; conserva la configuración del JSON.
- Los kilómetros y los IDs de hitos desbloqueados se guardan en este navegador;
  el objetivo siempre se vuelve a leer del JSON.
  Si el almacenamiento está bloqueado o lleno, el juego continúa en memoria y
  muestra un aviso. Un estado dañado recupera cero kilómetros con el objetivo del JSON.
- Los controles funcionan con Tab, Mayús+Tab, Enter y Espacio según su control
  nativo. El foco es visible y los cambios se anuncian a lectores de pantalla.
  La preferencia de movimiento reducido desactiva la animación del marcador.
- En modo `real` se informa de que todavía no hay proveedor: no se muestran
  kilómetros simulados como reales ni controles de simulación. Un JSON ausente o
  inválido muestra un error visible y no activa otro modo silenciosamente.

## Pruebas automáticas

Node.js 24 (versión de DDEV y CI); sin instalación de dependencias para `npm test`:

```sh
npm test
git diff --check
```

Desde tu máquina, dentro del proyecto DDEV, usa `ddev exec npm test` para
ejecutar las mismas pruebas en el contenedor.

Las pruebas usan `node:test` y cubren cálculos, validación del JSON versionado,
fechas existentes y zonas horarias, precedencia del objetivo, migración v1/v2,
historial permanente, avisos vistos y pendientes, migración de hitos v1/v2,
cola de cofres y mapeo de imágenes por ID,
selección real/simulado, persistencia y almacenamiento bloqueado/corrupto. No
requieren instalación de dependencias.

Con el servidor en marcha, se puede repetir la prueba de navegador usando el
`playwright-cli` y Chromium ya disponibles en este entorno (herramientas de
desarrollo opcionales, no son dependencias de la aplicación):

```sh
playwright-cli -s=adventure open http://127.0.0.1:8000 --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=adventure run-code --filename=tests/browser-smoke.js
playwright-cli -s=adventure run-code --filename=tests/browser-milestones.js
playwright-cli -s=adventure close
```

La prueba reinicia el estado local e intercepta temporalmente el JSON para
comprobar título, meta, fecha/zona, modos, errores HTTP/red/JSON, migración y
hitos configurables. La segunda prueba verifica cofres, imágenes, teclado/táctil,
avisos pendientes al volver, apertura manual de imágenes, retroceso 40→38→40,
cambios de objetivo y recompensa final histórica.
Conserva las comprobaciones de posición sobre el SVG,
teclado, movimiento reducido y tamaños 320/390/768/1280. No modifica el archivo.
La [guía de configuración](docs/configuration.md) incluye comandos para repetirla
bajo `/albertoybelen/` sin desplegar.

Comprobaciones manuales con el servidor local:

1. Editar solo `frontend/config/game.json` para cambiar título, objetivo, fecha o
   zona y recargar. Deben cambiar los valores mostrados y conservarse la distancia.
2. Sumar 1, 5 y 10 km: deben aparecer 16 km. Ajustar en JSON el objetivo a 16:
   el marcador llega a la meta; al sumar 10 más conserva 26 km y limita al 100 %.
3. Reiniciar vuelve a cero con el objetivo del JSON. Un estado v1 válido migra su
   distancia e ignora su objetivo anterior; v2 solo guarda distancia y versión.
4. Probar `mode: "real"`: aviso de no disponible, distancias `—`, sin marcador ni
   controles. Volver a `simulation` recupera la distancia simulada que había.
5. Una fecha imposible, modo desconocido, objetivo cero, JSON mal formado o archivo
   ausente debe mostrar un error y mantener la partida sin iniciar.
6. Probar teclado, móvil y movimiento reducido; recorrer todo el mapa y sus hitos
   futuros. Cambiar `milestones` en JSON actualiza las posiciones sin borrar el historial.
   Reabrir los hitos conseguidos con clic, toque, Enter o Espacio; los bloqueados
   no abren. Subir o bajar la meta no abre cofres ni quita recompensas históricas.
7. Bloquear `localStorage` o dañar v2: se puede continuar en memoria o recuperar a
   cero sin reutilizar objetivos guardados ni resucitar el estado antiguo.

Capturas de referencia del rediseño: [escritorio](docs/screenshots/issue-4-desktop.png)
y [móvil](docs/screenshots/issue-4-mobile.png), además del
[detalle de la meta al 100 %](docs/screenshots/issue-4-goal.png). Son imágenes del prototipo local,
con datos simulados y la ilustración aportada para el indicador.

Integración de configuración: [simulación móvil](docs/screenshots/issue-6-mobile.png),
[escritorio](docs/screenshots/issue-6-desktop.png),
[modo real no disponible](docs/screenshots/issue-6-real.png) y
[error de configuración](docs/screenshots/issue-6-error.png).

Cofres e historial de la issue #9: [móvil](docs/screenshots/issue-9-mobile.png),
[escritorio](docs/screenshots/issue-9-desktop.png),
[aviso de un nuevo hito](docs/screenshots/issue-9-new-milestone.png),
[imagen desbloqueada](docs/screenshots/issue-9-chest-open.png) y
[hito 40 % conservado al retroceder a 38 %](docs/screenshots/issue-9-history.png).
La [guía de hitos](docs/milestones.md) explica cómo sustituir imágenes y conservar
sus identidades al editar la configuración.

## Celebración y regalo final

La [guía del regalo final](docs/final-reward.md) explica su contenido provisional,
el estado histórico y cómo verificarlo. Con el servidor local y el navegador
de pruebas abiertos según los comandos anteriores:

```sh
playwright-cli -s=adventure run-code --filename=tests/browser-finale.js
```

La celebración se ejecuta solo ante el primer desbloqueo; recargas, retrocesos y
cambios de meta conservan el acceso al regalo sin repetir la celebración.

## Organización

```text
frontend/index.html       HUD arcade, recorrido e hitos SVG
frontend/assets/          Fondo original de 16 bits y prompt de generación
frontend/css/style.css    Diseño responsive, foco y movimiento reducido
frontend/config/game.json Configuración pública editable
frontend/js/config.js     Carga relativa y validación sin DOM
frontend/js/progress.js   Cálculos puros con validación, sin DOM ni persistencia
frontend/js/game.js       Contrato DistanceProvider y proveedor simulado local
frontend/js/milestone-history.js Historial versionado separado del progreso
frontend/js/milestones.js Cola de revelaciones por ID estable
frontend/js/milestone-photos.js Rutas de imágenes desde la configuración
frontend/js/milestone-dialog.js Modal, animación, teclado y foco
frontend/js/app.js        Eventos, hitos y posición con getPointAtLength
tests/                   Pruebas de cálculos y proveedor con node:test
.github/                 Plantilla de PR y workflow de CI
CONTRIBUTING.md           Flujo de Issues, ramas, pruebas y revisión
```

`app.js` consume el contrato `DistanceProvider` documentado en `game.js`:
`getState()`, `addDistance(km)`, `reset()` e `isPersistent()`. El objetivo es
inmutable dentro del proveedor y procede de la configuración validada.
Los métodos devuelven copias de `{ distanceKm, goalKm }` y rechazan valores no
válidos antes de modificar el estado. El proveedor simulado guarda la distancia;
el adaptador `milestone-history.js` guarda los IDs históricos por juego de forma
independiente. El selector devuelve ausencia de proveedor para `real`;
una futura fuente remota necesitará un adaptador y gestión asíncrona. Ni los
cálculos ni la geometría dependen del origen de datos.

## Visor local de staging, solo lectura

La [guía del visor staging](docs/frontend-staging.md) permite abrir el mapa en
DDEV con el endpoint público de staging. Tiene perfil, dataset, ruta y proxy propios,
sin tocar local.json del piloto ni el JSON público de Pages:

```sh
npm run frontend:staging:prepare
npm run frontend:staging:proxy   # Terminal A; no consulta staging hasta recibir GET.
# Terminal B:
npm run frontend:staging:enable
# Abrir https://albertoybelen.ddev.site/frontend/?staging-api=1
```

La apertura y Actualizar vista hacen GET mediante el proxy a la URL staging
fijada; no ejecutan sincronizaciones, OAuth ni operaciones Cloudflare. Muestra
«DATOS FICTICIOS · STAGING CLOUDFLARE». Las pruebas normales usan mocks:
`npm run test:frontend:staging`. La guía incluye limpieza y smoke remoto opt-in.

## Configuración de staging (sin ejecutar acciones remotas)

La [guía de staging](docs/staging.md) prepara Worker `albertoybelen-api-staging`
y D1 `albertoybelen-db-staging` con el binding `DB` en una configuración Wrangler
independiente. Reutiliza backend y migraciones; expone únicamente progreso sintético,
sin OAuth ni Cron. Comprobaciones locales:

```sh
npm run staging -- check
npm run staging -- dry-run
```

La guía incluye migraciones y despliegue manual futuros desde Ubuntu. Los comandos
protegidos rechazan destinos distintos, overrides, rutas y Cron, y requieren cuenta
seleccionada y confirmación explícita para operaciones remotas. Esta preparación
no migra ni despliega recursos, no usa Strava real y no modifica producción o Pages.

## Fase A: auditoría de OAuth a mapa sin Strava real

El [runbook de #33](docs/phase-a-runbook.md) valida en el mismo D1 temporal el
circuito OAuth falso → cifrado → actividades ficticias → API → mapa DDEV.

```sh
npm run oauth:proxy:enable
npm run frontend:local:proxy:enable
npm run test:pilot:phase-a
npm run frontend:local:proxy:disable
```

Requiere el DDEV existente y puertos 8790/8791 libres; rechaza otro proyecto o un
puerto ocupado. Solo usa valores sintéticos, no lee secretos privados ni abre
Strava. La guía presenta presupuesto y rollback para una autorización posterior.
**La fase B y la issue completa siguen pendientes; los mocks no las completan.**

## Ver el mapa con API y D1 locales

La [guía del frontend local](docs/frontend-local-api.md) muestra el juego en modo
real **de pruebas**, alimentado por GET /api/progress y fixtures persistidos en D1.
El JSON público conserva simulación. Desde el checkout de la PR dentro de DDEV:

```sh
npm run frontend:local:prepare
# Preparar/iniciar el backend mock según la guía y abrir:
# https://albertoybelen.ddev.site/frontend/?local-api=1
npm run test:frontend:api
```

La configuración local es ignorada por Git y solo se activa explícitamente en
DDEV HTTPS. Los fixtures se identifican en pantalla. Actualizar vista consulta
únicamente el agregado guardado; no abre OAuth ni sincroniza Strava. La guía
incluye preview de worktrees, pruebas DDEV con D1, capturas y limpieza.

## Preparación del piloto del propietario (sin conexión real)

La [guía del piloto Strava](docs/strava-owner-pilot.md) prepara un ensayo aislado
en DDEV con D1 local y solo la cuenta del propietario. Permanece apagado; cada
acción capaz de usar Strava exige activación local explícita **tras autorización
humana posterior a la revisión y merge de la PR**. Preparar no abre OAuth ni importa:

```sh
npm run pilot:local -- prepare
npm run pilot:local -- migrate
npm run pilot:local -- status
npm run test:pilot:local
```

El ensayo tiene su propia base, clave y archivo de secretos ignorado. Reutiliza
OAuth y reconciliación existentes, limita peticiones de forma durable y mantiene
el otro slot desconectado (`partial:true`). La guía incluye el punto de parada,
comandos futuros de consentimiento/sync manual, cuotas, recuperación y borrado.
Las pruebas usan interceptores y HTTP de loopback, sin cuentas ni llamadas reales.
No cambia la configuración definitiva del mapa ni habilita Cron o infraestructura remota.

## Sincronización de actividades en D1 local

La [guía de sincronización](docs/activity-sync-local.md) conecta OAuth cifrado y
D1 existentes con respuestas HTTP **simuladas**, sin llamadas reales a Strava.
Dentro del DDEV existente, en una base local de ensayo:

```sh
npm ci
npm run oauth:init:mock        # Solo si aún no existe .dev.vars.
npm run oauth:migrate:local
npm run sync:seed:local       # Dos consentimientos ficticios; rechaza reemplazar cuentas.
npm run sync:local
npm run sync:verify:local
npm run sync:scheduled:local  # Simula el handler; no activa Cron.
npm test
npm run test:d1
npm run test:sync:local
```

La guía incluye correcciones, borrados, errores, pruebas de navegador HTTPS,
reinicios, limpieza del ensayo y límites de consistencia. Se mantiene el agregado
público sin desglose, `partial` y `stale` independientes y cofres históricos.
El transporte real de actividades permanece bloqueado, incluso si se habilitara
OAuth real por separado. No cambia el modo del mapa ni la configuración definitiva.

## OAuth local y tokens cifrados

La [guía OAuth DDEV](docs/oauth-local.md) explica la prueba **simulada**, invitaciones
privadas, proxy HTTPS, vault, renovación, revocación y recuperación de claves.

```sh
npm ci
npm run oauth:init:mock
npm run oauth:migrate:local
npm run oauth:proxy:enable
npm run oauth:dev:local
```

El helper de proxy se usa dentro del contenedor existente para worktrees; en el
checkout principal el snippet se carga con DDEV. La guía detalla cómo emitir las
invitaciones por CLI y retirarlo después. No se importan actividades ni se utiliza
Strava real. Esa prueba necesita una autorización posterior y opt-in explícito.

## Persistencia D1 exclusivamente local

La [guía D1 local](docs/local-d1.md) explica migraciones, repositorio, reset y límites.
Con esta rama en el checkout de DDEV, ejecutar dentro del contenedor:

```sh
npm ci
npm run d1:migrate:local
npm run d1:dev:local
# En otra terminal del mismo contenedor:
curl http://127.0.0.1:8788/api/progress
npm test
npm run test:d1
```

No necesita login, credenciales ni recursos remotos. No cambia el frontend ni
activa el reto definitivo; el estado de fixtures queda aislado y gitignored.

## API y sincronización simuladas en local

El [Worker local](docs/local-worker.md) sirve únicamente fixtures y expone el
agregado público; no conecta el frontend ni servicios remotos.

```sh
npm test
node backend/local-server.js
# En otra terminal del mismo contenedor:
curl -i http://127.0.0.1:8787/api/progress
```

No activa Cron, OAuth, D1, servicios remotos ni despliegues. El estado en memoria
se pierde al cerrar; la programación horaria real pertenece a una fase futura.

## Flujo de desarrollo

Cada issue se implementa en una rama `codex/issue-<numero>-<descripcion>` y se
entrega mediante una PR hacia `main`, con un título
`<tipo>: <descripcion> (#<numero>)`, `Closes #N` y resultados de pruebas.
El ciclo completo, los comandos y las responsabilidades están documentados en
[CONTRIBUTING.md](CONTRIBUTING.md). GitHub Actions comprueba la sintaxis y ejecuta
`npm test` cuando se abre o actualiza una PR hacia `main`. La persona responsable
revisa y aprueba el merge; no hay merge automático. Pages solo publica tras
la autorización y activación descritas a continuación; después publica los
cambios que se fusionen en `main` mientras siga habilitado.

## Capturas para revisión

Consulta [Capturas visuales reproducibles](docs/visual-captures.md). Con las
herramientas de desarrollo instaladas:

```sh
npm ci
npx playwright install --with-deps chromium
npm run capture:visual
```

El workflow de PR guarda las capturas como artifacts durante tres días, sin
publicar la web ni modificar el progreso de los jugadores.

## Entorno de pruebas en GitHub Pages

**Estado a 11 de noviembre de 2026: viable, pendiente de activación autorizada.**
El propietario ha hecho público `plopesc/albertoybelen`. La comprobación de solo
lectura devuelve `private: false`, `visibility: public` y `has_pages: false`.
[GitHub Free permite Pages en repositorios públicos](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site);
la limitación inicial del repositorio privado está resuelta. No hay un sitio
configurado ni una URL publicada, y no se ha realizado ningún despliegue.

Si en el futuro se vuelve a hacer privado el repositorio, hará falta un plan
compatible con Pages privado o elegir otro alojamiento. Esas decisiones y cualquier
cambio de visibilidad o creación de otro repositorio corresponden al propietario.

### Funcionamiento y activación pendiente

El workflow [Pages de pruebas](.github/workflows/pages.yml) está separado de CI.
Se puede iniciar por `push` a `main` o manualmente, pero **todos sus pasos quedan
omitidos** salvo que la rama sea `main` y la variable del repositorio
`PAGES_TEST_DEPLOY_ENABLED` sea exactamente `true`. Abrir o actualizar una PR no
lo ejecuta. Una PR fusionada tampoco publica mientras falte esa autorización.
El checkout no conserva credenciales, las acciones están fijadas a SHA, solo el
job de despliegue recibe `contents: read`, `pages: write` e `id-token: write` y
la concurrencia evita cancelar un despliegue en curso.

Publica exclusivamente `frontend/` como raíz: HTML, JS, CSS, recursos y cualquier
configuración pública futura bajo esa carpeta. No publica `.github/`, `.ddev/`,
pruebas, capturas ni el archivo original `icono.jpeg` situado fuera de `frontend/`.
No hay build ni instalación de dependencias. Comprueba sintaxis de todos los
módulos y ejecuta las pruebas antes de empaquetar. `configure-pages` usa
`enablement: false`: no crea ni activa el sitio por iniciativa del workflow.

**Solo tras autorización explícita del propietario:**

1. Revisar y fusionar esta PR mediante el flujo habitual. Confirmar que la cuenta
   ya permite Pages (plan compatible o visibilidad pública autorizada) y aprobar
   el contenido público.
2. En **Settings → Pages → Build and deployment**, seleccionar **GitHub Actions**.
   Este cambio de ajustes debe hacerlo el propietario o autorizarlo explícitamente.
3. En **Settings → Environments → github-pages**, restringir despliegues a `main`
   y añadir revisión obligatoria si el plan la permite.
4. Después de aprobar también el primer despliegue, crear en **Settings → Secrets
   and variables → Actions → Variables** `PAGES_TEST_DEPLOY_ENABLED=true`. Es una
   variable de autorización, no un secreto. No se crea en esta tarea.
5. En **Actions → Pages de pruebas → Run workflow**, seleccionar **main** y ejecutar.
   Los siguientes merges en `main` publicarán mientras esa variable siga activa.

No existe todavía una URL publicada. Sin dominio personalizado, la URL esperada
es `https://plopesc.github.io/albertoybelen/`; **es una previsión, no un sitio
verificado**. Tras el primer despliegue, confirmar la URL de la salida del job
`github-pages` y actualizar aquí si fuera distinta.

### Privacidad y comprobación en móvil

**El sitio puede ser público aunque el repositorio sea privado.** Cualquier
archivo bajo `frontend/` se considerará público, incluida la ilustración del
indicador aportada para el juego y la configuración JSON futura. No añadir
fotografías personales, secretos, credenciales, tokens ni contenido del premio
final. El regalo actual es solo un dibujo decorativo cerrado.

Después de una activación autorizada: abrir la URL con su prefijo
`/albertoybelen/` desde móvil y escritorio; comprobar el aviso **VERSIÓN DE
PRUEBAS**, modo simulado, imágenes, controles, persistencia y teclado. Revisar
320/390/768/1280 px y verificar en la pestaña de red que JS/CSS/configuración e
imágenes no devuelvan 404. El progreso es local al origen del navegador: los datos
de DDEV no aparecen en Pages. Para comprobar sin desplegar bajo un prefijo:

```sh
mkdir -p /tmp/albertoybelen-pages-check
cp -R frontend /tmp/albertoybelen-pages-check/albertoybelen
python3 -m http.server 8001 --bind 127.0.0.1 --directory /tmp/albertoybelen-pages-check
```

Abrir `http://127.0.0.1:8001/albertoybelen/` y ejecutar la prueba de navegador
anterior contra esa URL. Todo recurso de la aplicación usa rutas relativas.

### Desactivar

Para detener publicaciones futuras, cambiar la variable a `false` o eliminarla,
y desactivar **Pages de pruebas** desde Actions. Eso no retira un sitio ya
publicado: para retirarlo, el propietario debe usar **Settings → Pages → Unpublish
site**. Cancelar también ejecuciones activas si las hubiera. La despublicación y
los ajustes requieren su autorización; no se han realizado en esta tarea.

## Invitaciones privadas: prototipo de seguridad

La [especificación de invitaciones](docs/private-invitations.md) describe los dos
slots, enlaces de un solo uso, revocación y supresión. Su máquina de estados y
los contratos de reglas/Worker se comprueban solo con datos sintéticos:

```sh
npm test
node --test tests/invitations.test.js
```

La máquina de estados sigue siendo pura. Su implementación local posterior
incluye endpoints OAuth simulados detrás del callback HTTPS de DDEV y tokens
cifrados en D1 local; consultar las guías anteriores. No se conecta una cuenta
real ni se usa Cloudflare o D1 remotos en estas pruebas.

## Límites y siguiente paso

El mapa sigue usando simulación por origen/navegador. El backend local de ensayo
persiste sus propios fixtures en D1, pero aún no está conectado al mapa ni a
cuentas o API reales; no proporciona sincronización pública entre dispositivos.
El paisaje original se generó con `image_gen` y se sirve como WebP local; la
ilustración del indicador fue aportada para el juego. El camino, los hitos y el
indicador son SVG independientes del fondo. Se conserva el
[prompt y procedencia del arte](frontend/assets/ART.md). No hay fuentes externas,
animaciones de carrera. Las imágenes provisionales de los cofres también son
paisajes generados y locales; sus [prompts y procedencia](frontend/assets/milestones/ART.md)
quedan documentados. El regalo final usa una imagen y un mensaje provisionales; se guarda su
consecución histórica, pero su contenido definitivo queda fuera de esta fase.

Pages queda preparado e inactivo. No iniciar Strava, OAuth, Cloudflare ni el
primer despliegue sin instrucciones explícitas.

## Reglas de kilómetros para la integración futura

La [política de distancia](docs/distance-policy.md) define el agregado conjunto,
permisos, correcciones, supresión y fixtures. Sus pruebas no usan Strava:

```sh
npm test
TZ=UTC node --test tests/distance-policy.test.js
TZ=Pacific/Honolulu node --test tests/distance-policy.test.js
```

El frontend y su configuración siguen siendo independientes de este contrato.

La [configuración compartida de infraestructura](docs/infrastructure-configuration.md) vive en `config.json` (solo metadatos Node, sin secretos). Ejecuta `npm run config:check` para contrastarla con Wrangler, DDEV y las guardas independientes. No cambia la configuración pública del juego.
