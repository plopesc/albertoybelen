# Strava Adventure · Fase 1

Prototipo estático, en español y orientado a móvil. Un personaje recorre un
sendero SVG al sumar kilómetros simulados. Sin frameworks, paquetes de runtime,
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
playwright-cli -s=adventure-phase1 open http://127.0.0.1:8000 --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=adventure-phase1 run-code --filename=tests/browser-smoke.js
playwright-cli -s=adventure-phase1 close
```

Esta prueba reinicia los datos simulados del origen local y comprueba controles,
posición SVG, persistencia, errores, teclado, movimiento reducido, almacenamiento
bloqueado y ausencia de desbordamientos a 320, 390, 768 y 1280 px.

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

## Organización

```text
frontend/index.html       Interfaz y mapa SVG original
frontend/css/style.css    Diseño responsive, foco y movimiento reducido
frontend/js/progress.js   Cálculos puros con validación, sin DOM ni persistencia
frontend/js/game.js       Contrato DistanceProvider y proveedor simulado local
frontend/js/app.js        Eventos, renderizado y animación con getPointAtLength
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

## Límites y siguiente paso

Solo fase 1: los datos son simulados y propios de cada origen/navegador. No hay
sincronización entre dispositivos ni pestañas, cuentas, API real, base de datos
o despliegue. Los SVG se han creado para este prototipo; no hay fuentes, imágenes
ni música de terceros.

Próxima tarea sugerida: revisar y aprobar el prototipo visual y su experiencia
en móvil antes de planificar la fase siguiente. No iniciar Strava, OAuth,
Cloudflare ni GitHub Pages sin instrucciones explícitas.
