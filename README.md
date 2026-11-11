# Juego Alberto · Kilómetro Arcade

Prototipo estático, en español y orientado a móvil, con estética arcade de 16 bits.
Un indicador recorre un mundo SVG vertical al sumar kilómetros simulados.
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
  los símbolos del mapa para posición, checkpoint bloqueado/desbloqueado y meta,
  y recuerda la orientación del recorrido.
- Los checkpoints del 20/40/60/80 % cambian de **BLOQUEADO** a **DESBLOQUEADO**
  al alcanzar su porcentaje. Sus posiciones se calculan sobre el mismo trazado
  que el indicador. Cambiar la meta o reiniciar recalcula todos sus estados.
- La meta al 100 % tiene un arco y un regalo misterioso decorativo. Los hitos
  no abren contenido: fotografías, premio y celebración quedan para otras issues.
- La salida y el arco de meta usan madera con vetas, tela, piedra y sombras,
  dibujadas en SVG para integrarse con el paisaje de 16 bits.
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
y [móvil](docs/screenshots/issue-4-mobile.png). Son imágenes del prototipo local,
con datos simulados; no contienen contenido personal ni recursos de terceros.

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

## Límites y siguiente paso

Prototipo visual con rediseño de mapa/HUD (issue #4): los datos son simulados y
propios de cada origen/navegador. No hay
sincronización entre dispositivos ni pestañas, cuentas, API real, base de datos
o despliegue. Los SVG se han creado para este prototipo; no hay fuentes, imágenes
ni música de terceros.

El indicador representa el progreso agregado del proveedor; no presupone un número
de cuentas ni corredores. El paisaje original se generó con `image_gen` y se sirve
como un WebP local de unos 760 KiB, sin solicitudes a servicios externos. El camino,
los hitos y el indicador son SVG independientes del fondo. Se conserva el
[prompt y procedencia del arte](frontend/assets/ART.md). No hay fuentes externas,
animaciones de carrera ni sistema de fotos.

Revisar y aprobar el mapa/HUD y su experiencia en móvil antes de iniciar otras
issues. No iniciar Strava, OAuth,
Cloudflare ni GitHub Pages sin instrucciones explícitas.
