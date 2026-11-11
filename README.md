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

- Empieza con 0 km y una meta de 100 km.
- En móvil se muestra primero el mapa y debajo el HUD con kilómetros, objetivo,
  porcentaje y restantes. **Ir a los controles** salta directamente a la simulación.
- **Explorar mapa** lleva al recorrido completo. La salida está abajo y la meta
  arriba: desplázate por bosque, río, cañón y montaña desde el primer día.
- El paisaje aparece directamente, sin cabecera. La leyenda inferior reutiliza
  los símbolos del mapa para posición, checkpoint bloqueado/desbloqueado y meta.
- Los checkpoints del 20/40/60/80 % cambian de **BLOQUEADO** a **DESBLOQUEADO**
  al alcanzar su porcentaje. Sus posiciones se calculan sobre el mismo trazado
  que el indicador. Cambiar la meta o reiniciar recalcula todos sus estados.
  Los cinco tramos del 20 % tienen igual longitud siguiendo el camino; su altura
  visible varía según las curvas.
- La meta al 100 % tiene un arco y un regalo misterioso decorativo con perspectiva,
  papel verde con brocado y lazo dorado. Los hitos
  no abren contenido: fotografías, premio y celebración quedan para otras issues.
- La salida y el arco de meta usan madera con vetas, tela, piedra y sombras,
  dibujadas en SVG para integrarse con el paisaje de 16 bits.
- El indicador de avance usa la ilustración aportada en `frontend/assets/icono.jpeg`,
  ajustada a un círculo con borde claro; la leyenda comparte el mismo símbolo.
- Suma +1, +5 o +10 km para mover el personaje por el camino.
- Introduce una meta de al menos 0,1 km, en pasos de 0,1, y pulsa **Guardar meta**
  o Enter. Un valor inválido muestra un error sin cambiar la meta vigente.
- Al llegar o superar la meta, el marcador permanece al final y el progreso
  se limita al 100 %. Los kilómetros acumulados se conservan.
- **Reiniciar kilómetros** vuelve a la salida y conserva la meta.
- Los kilómetros y la meta se guardan en este navegador para la próxima visita.
  Si el almacenamiento está bloqueado o lleno, el juego continúa en memoria y
  muestra un aviso. Un estado guardado dañado recupera los valores iniciales.
- Los controles funcionan con Tab, Mayús+Tab, Enter y Espacio según su control
  nativo. El foco es visible y los cambios se anuncian a lectores de pantalla.
  La preferencia de movimiento reducido desactiva la animación del marcador.

## Pruebas automáticas

Node.js 22 o posterior; sin instalación de dependencias:

```sh
npm test
git diff --check
```

Desde tu máquina, dentro del proyecto DDEV, usa `ddev exec npm test` para
ejecutar las mismas pruebas en el contenedor.

Las pruebas usan `node:test` y cubren salida, progreso parcial, decimales, meta,
objetivo superado, límites 0–100 %, objetivos/distancias inválidos, simulación,
reinicio, persistencia, estados corruptos y almacenamiento bloqueado o lleno.

Con el servidor en marcha, se puede repetir la prueba de navegador usando el
`playwright-cli` y Chromium ya disponibles en este entorno (herramientas de
desarrollo opcionales, no son dependencias de la aplicación):

```sh
playwright-cli -s=adventure open http://127.0.0.1:8000 --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=adventure run-code --filename=tests/browser-smoke.js
playwright-cli -s=adventure close
```

Esta prueba reinicia los datos simulados del origen local y comprueba controles,
posición SVG, persistencia, errores, teclado, movimiento reducido, almacenamiento
bloqueado y ausencia de desbordamientos a 320, 390, 768 y 1280 px. Comprueba también
el indicador al 0/20/50/80/100 %, los cuatro umbrales justo antes y al alcanzarlos,
sus etiquetas dentro del mapa, el bloqueo tras reiniciar y el orden mapa → datos
→ controles en móvil.

Comprobaciones manuales con el servidor local:

1. A 0 km, comprobar que el personaje está en SALIDA. Sumar 1, 5 y 10 km:
   deben aparecer 16 km y 16 %. Recargar y comprobar que se mantienen.
2. Cambiar la meta a 16: debe marcar 100 %, 0 km restantes y estar en META.
   Sumar 10 más: conserva 26 km, 100 % y 0 restantes sin salir del camino.
3. Probar una meta vacía, cero y negativa: se muestra el error, sin alterar
   el objetivo. Reiniciar: vuelve a 0 km y conserva el último objetivo válido.
4. Recorrer los controles con el teclado. Revisar a 320, 390 y 1280 px y con
   zoom de texto. Activar movimiento reducido: el marcador salta a su posición
   sin animarse. El recorrido mantiene sus proporciones al cambiar de ancho.
5. Bloquear `localStorage` o introducir JSON inválido en la clave
   `strava-adventure:simulation:v1`: la aplicación debe seguir siendo utilizable.
6. Con meta 100, comprobar a 0/20/50/80/100 km: deben estar desbloqueados
   0/1/2/4/4 checkpoints. Ningún tramo futuro desaparece ni se revela contenido.
   A 125 km el indicador sigue en el arco. Reiniciar vuelve a bloquear los cuatro.
7. Desde móvil, recorrer todo el mapa con desplazamiento normal y usar los enlaces
   de salto con teclado. El mapa tiene descripción y una lista textual de estados
   para lectores de pantalla; la indicación de bloqueo no depende solo del color.

Capturas de referencia del rediseño: [escritorio](docs/screenshots/issue-4-desktop.png)
y [móvil](docs/screenshots/issue-4-mobile.png), además del
[detalle de la meta al 100 %](docs/screenshots/issue-4-goal.png). Son imágenes del prototipo local,
con datos simulados y la ilustración aportada para el indicador.

## Organización

```text
frontend/index.html       HUD arcade, recorrido e hitos SVG
frontend/assets/          Fondo original de 16 bits y prompt de generación
frontend/css/style.css    Diseño responsive, foco y movimiento reducido
frontend/js/progress.js   Cálculos puros con validación, sin DOM ni persistencia
frontend/js/game.js       Contrato DistanceProvider y proveedor simulado local
frontend/js/app.js        Eventos, hitos y posición con getPointAtLength
tests/                   Pruebas de cálculos y proveedor con node:test
.github/                 Plantilla de PR y workflow de CI
CONTRIBUTING.md           Flujo de Issues, ramas, pruebas y revisión
```

`app.js` consume el contrato `DistanceProvider` documentado en `game.js`:
`getState()`, `addDistance(km)`, `setGoal(km)`, `reset()` e `isPersistent()`.
Los métodos devuelven copias de `{ distanceKm, goalKm }` y rechazan valores no
válidos antes de modificar el estado. El proveedor simulado es la única capa
que conoce `localStorage`. Una futura fuente remota necesitará un adaptador y
gestión asíncrona; ni los cálculos ni la geometría dependen del origen de datos.

## Flujo de desarrollo

Cada issue se implementa en una rama `codex/issue-<numero>-<descripcion>` y se
entrega mediante una PR hacia `main`, con un título
`<tipo>: <descripcion> (#<numero>)`, `Closes #N` y resultados de pruebas.
El ciclo completo, los comandos y las responsabilidades están documentados en
[CONTRIBUTING.md](CONTRIBUTING.md). GitHub Actions comprueba la sintaxis y ejecuta
`npm test` cuando se abre o actualiza una PR hacia `main`. La persona responsable
revisa y aprueba el merge; no hay merge ni despliegue automático.

## Entorno de pruebas en GitHub Pages

**Estado a 11 de noviembre de 2026: publicación bloqueada por el plan.** El
repositorio `plopesc/albertoybelen` es privado y su propietario ha confirmado
GitHub Free. [Pages en repositorios privados requiere GitHub Pro u otro plan
compatible](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
La consulta de solo lectura al repositorio devuelve `private: true` y
`has_pages: false`; `GET /repos/plopesc/albertoybelen/pages` responde 404 porque
no hay un sitio configurado. Ese 404 por sí solo no identifica el plan.
No se ha cambiado la visibilidad, activado Pages ni realizado un despliegue.

Alternativas que debe decidir y autorizar el propietario: pasar a un plan
compatible conservando el repositorio privado; preparar un repositorio público
separado que contenga únicamente recursos aprobados; o elegir otro alojamiento
estático compatible con repositorios privados. No se crea otro repositorio ni se
cambia de proveedor automáticamente.

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

**Solo tras autorización explícita del propietario y resolviendo el bloqueo:**

1. Revisar y fusionar esta PR mediante el flujo habitual. Confirmar que la cuenta
   ya permite Pages para el repositorio privado y aprobar el contenido público.
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

## Límites y siguiente paso

Los datos siguen siendo simulados y propios de cada origen/navegador. No hay
sincronización entre dispositivos ni pestañas, cuentas, API real ni base de datos.
El paisaje original se generó con `image_gen` y se sirve como WebP local; la
ilustración del indicador fue aportada para el juego. El camino, los hitos y el
indicador son SVG independientes del fondo. Se conserva el
[prompt y procedencia del arte](frontend/assets/ART.md). No hay fuentes externas,
animaciones de carrera ni sistema de fotos.

Pages queda preparado e inactivo. No iniciar Strava, OAuth, Cloudflare ni el
primer despliegue sin instrucciones explícitas.
