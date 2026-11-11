# Capturas reproducibles para revisión

El workflow **Capturas visuales** ejecuta Chromium en un runner Ubuntu estándar,
con permisos de lectura. No publica Pages ni realiza comparaciones gráficas que
bloqueen la PR por diferencias de píxeles. Sí falla ante errores de ejecución,
recursos ausentes, peticiones externas o una colección de capturas de 5 MB o más.

Las capturas usan fixtures aisladas del navegador: objetivo ficticio 100 km,
inicio local 2026-11-01, Europe/Madrid, modo simulado y progreso 0/60/100 %.
No se modifica `frontend/config/game.json`, la lógica del juego ni el progreso de
ninguna persona. Solo se solicitan recursos del servidor local. Las imágenes son
los paisajes sintéticos ya incluidos y la ilustración del indicador del prototipo;
no añadir fotografías personales a los recursos de pruebas.

## Ejecutar en Ubuntu/DDEV

Con Node.js 22 o posterior, desde la raíz del repositorio:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run capture:visual
```

Dentro del contenedor DDEV usar `ddev exec` delante de los comandos. No es
necesario cambiar el router ni el origen existente: el capturador crea un servidor
estático efímero en loopback y sirve únicamente `frontend/` bajo
`/albertoybelen/`, igual que el prefijo de Pages. El servidor se cierra al terminar.
La aplicación sigue siendo estática y no necesita dependencias de runtime.
Playwright es exclusivamente una dependencia de desarrollo fijada por lockfile.

La salida por defecto es `artifacts/visual/` (ignorada por git). Para cambiarla:

```sh
VISUAL_OUTPUT=/tmp/alberto-capturas npm run capture:visual
```

Se usan contextos independientes de 390×844 y 1280×900, escala 1, idioma español,
zona Europe/Madrid y movimiento reducido. Cada uno genera capturas JPEG de
página completa al 0/60/100 %, aviso de hito y foto abierta. Las esperas se basan
en DOM, fuentes e imágenes decodificadas, sin pausas arbitrarias. `manifest.json`
registra nombres, dimensiones y bytes, sin marcas de tiempo variables. Las
capturas son para revisión humana, no snapshots que exijan identidad binaria
entre distintas plataformas de Chromium.

Cuando está disponible la implementación de #16, también se pulsa **Abrir regalo
final** al 100 % y se captura su contenido. La ausencia de ese botón en la versión
anterior no falla: la cobertura de #9 funciona por sí sola. No se copia lógica ni
recursos de #16 a esta rama.

## Descargar desde GitHub

Abrir **PR → Checks → Capturas visuales → Details**, o **Actions → Capturas
visuales → ejecución de la PR**. En **Artifacts**, descargar
`capturas-pr-<numero>-<run_attempt>`. Retención: **3 días**; después hay que volver
a ejecutar el workflow para generar otro artefacto. El nombre permite distinguir
reintentos; no hay publicación del contenido en Pages ni comentarios automáticos.

Solo se suben JPEG y el manifiesto. No se guardan vídeos, trazas, cookies, estado
del navegador ni logs que contengan credenciales. La suma de JPEG debe quedar por
debajo de 5 MB y el ZIP de Actions se comprobará en la PR. No activar runners de
pago ni servicios externos. Las imágenes locales no se envían a ningún proveedor
externo durante la ejecución: el único destino es el artefacto de GitHub autorizado.
