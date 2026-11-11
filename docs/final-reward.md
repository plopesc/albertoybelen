# Regalo final y celebración

La meta reutiliza el diálogo, la animación de cofre y el historial versionado de
los hitos (#9). `finish` es el ID reservado del logro final: no se guarda una fecha
de consecución ni se necesita otro registro de persistencia.

Al aumentar kilómetros y desbloquear por primera vez `finish`, se presenta una
celebración verde/dorada. El cofre espera a **Ver imagen**, igual que los avisos
acordados en #9. Al pulsar se abre y revela imagen y mensaje. Con movimiento
reducido se omite la animación. Si se cruzan varios hitos, se usa una sola cola;
cerrar la cola no borra los logros. La celebración pendiente de esa interacción
se descarta al cerrarla; no se revive en otra visita.

Una vez conseguido, la pantalla muestra permanentemente **¡Reto completado!** y
**Abrir regalo final**. El botón permite abrir el cofre otra vez sin celebración
especial. Escape, cierre visible, fondo exterior y restauración del foco usan el
mismo controlador accesible de los otros hitos. Los hitos normales continúan
abriendo directamente su imagen al pulsarlos en el mapa.

La barra, posición y porcentaje reflejan el progreso actual, limitado a 100 %;
los kilómetros válidos se conservan aunque superen la meta. Una corrección de
100 a 95 km baja el indicador, pero el logro y su botón permanecen disponibles.
Recuperar el 100 %, recargar o cambiar la meta no repite la celebración. Cargar
con un logro antiguo permite consultar el regalo sin simular otra llegada.
`notifyOnVisit: false` excluye el regalo de los avisos restaurados en otra visita.
El reinicio explícito de simulación limpia también `finish`, como los demás logros.

## Contenido provisional

Editar `frontend/js/final-reward.js` para sustituir `image`, `title`, `alt` y
`message`, sin tocar el cálculo ni la lógica de desbloqueos. La imagen local
`frontend/assets/milestones/milestone-100.webp` es una copia del paisaje sintético
provisional de cumbres usado en el hito 80. Su procedencia y prompt están en
`frontend/assets/milestones/ART.md`; no es una fotografía personal ni un premio
real. No se ha generado otra imagen ni usado un servicio durante la ejecución.

Los archivos son públicos, incluidas sus URLs directas: el desbloqueo es visual.
El contenido definitivo requiere consentimiento y revisión separada. Esta issue
no modifica `game.json` ni la configuración definitiva del reto.

## Verificar

Desde la raíz, con el servidor estático del README:

```sh
npm test
playwright-cli -s=final open http://127.0.0.1:8000 --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=final run-code --filename=tests/browser-milestones.js
playwright-cli -s=final run-code --filename=tests/browser-finale.js
playwright-cli -s=final close
git diff --check
```

La prueba final intercepta la configuración solo en el navegador y utiliza datos
sintéticos. Comprueba 99→100, exceso, recarga, 100→95→100, objetivo nuevo, consulta
manual, Escape/foco, movimiento reducido y vista móvil/escritorio. Genera capturas
en `docs/screenshots/issue-16-{mobile,desktop,gift}.png`. No modifica el JSON.

El contrato del modo real futuro debe aportar `finish` entre los IDs históricos
compartidos del backend. La UI no debe derivar ese logro del porcentaje actual
ni inventar una fecha. Este cambio sigue usando simulación y `localStorage`;
no conecta backend, OAuth, Strava o D1 ni despliega recursos.
