# Hitos, imágenes e historial

La interfaz llama **hitos** a los puntos del mapa; el término del JSON y del
código es **milestones**. Las definiciones viven únicamente en
[`frontend/config/game.json`](../frontend/config/game.json), incorporado en #6.
No hay una segunda lista de porcentajes o fotografías dentro de JavaScript.

## Sustituir las imágenes

Las cuatro imágenes provisionales son paisajes originales sin personas, servidos
localmente: `frontend/assets/milestones/milestone-20.webp`, `milestone-40.webp`,
`milestone-60.webp` y `milestone-80.webp`. Su [procedencia y prompts](../frontend/assets/milestones/ART.md)
quedan registrados. El cofre usa SVG/CSS verde/dorado acorde con el mapa.

Para sustituir una imagen sin tocar lógica, reemplazar el archivo conservando
nombre y extensión. Alternativamente, editar su objeto en `rewards.milestones`:

```json
{
  "id": "milestone-40",
  "percent": 40,
  "image": "assets/milestones/otro-paisaje.webp",
  "title": "Un recuerdo del camino",
  "alt": "Descripción breve de la imagen para lectores de pantalla."
}
```

`image` es opcional; por defecto se resuelve `assets/milestones/<id>.webp`
relativo al frontend, también bajo `/albertoybelen/`. Se rechazan URLs externas,
rutas absolutas y componentes `..`. Un ID nuevo necesita un archivo o una ruta
explícita. Una imagen ausente muestra un aviso en su cofre, nunca otra imagen.

**El bloqueo es exclusivamente visual.** Los archivos y sus URLs directas son
públicos aunque el juego no permita abrir un cofre bloqueado. No hay cifrado,
autenticación ni enlaces firmados. Antes de añadir fotos definitivas, confirmar
que Alberto y Belén han autorizado su publicación abierta y que no contienen
información sensible. Una foto que necesite privacidad no debe subirse al
frontend ni al repositorio público. No hay servicios externos ni gasto adicional.

## Avisos de logros y consulta de imágenes

- Al conseguir un hito aumentando kilómetros se muestra un aviso con su cofre.
  Permanece en ese estado hasta pulsar **Ver imagen**: entonces se anima la
  apertura y se muestra la imagen. Esperar no abre la foto. Con movimiento
  reducido, pulsar el botón abre la imagen inmediatamente.
- Al volver a la página se muestran, por orden, los avisos de hitos que ya están
  desbloqueados pero cuyo aviso todavía no se ha mostrado. Esto incluye los
  pendientes de una cola anterior. No se deducen nuevos desbloqueos por editar
  porcentajes o el objetivo al cargar.
- Un aviso se da por visto cuando aparece, aunque se cierre sin abrir su imagen.
  Las siguientes visitas no lo repiten. Si se cierra el primero de varios,
  únicamente ese queda visto: los demás continúan pendientes para otra visita.
  **Siguiente hito** permite recorrerlos sin superponer modales ni obligar a abrir
  cada foto. Cerrar la cola conserva todos los logros.
- Clic, toque, Enter o Espacio en un hito desbloqueado abren **directamente su
  imagen**, sin aviso ni animación del cofre. Consultarlo manualmente también da
  su aviso por visto, sin consumir los avisos de otros hitos. Los bloqueados no
  abren contenido.
- Escape, Cerrar o pulsar fuera del cuadro cierran el modal y restauran el foco.
  Tab y Mayús+Tab circulan por sus controles. Cambiar la preferencia de movimiento
  reducido nunca abre una imagen sin una acción previa.

## Progreso actual e historial son independientes

El porcentaje, la posición y los kilómetros restantes se calculan siempre a
partir de la distancia actual y `game.goalKm`; el porcentaje está acotado a
0–100 %. Los IDs desbloqueados se agregan al historial y no desaparecen cuando
baja la distancia. Ejemplo: después de llegar al 40 %, una corrección a 38 %
mueve el personaje hacia atrás pero permite seguir abriendo la imagen del 40 %.
Volver al 40 % no repite un aviso ya mostrado.

Cambiar la meta de 500 a 700 km conserva los 500 km y todos los hitos ganados,
incluido `finish` si ya se alcanzó el final. El HUD muestra el porcentaje actual
y una nota separada de hitos históricos y meta conseguida anteriormente.
El regalo final conserva su estado histórico; el contenido definitivo del premio
no forma parte de #9.

Bajar la meta, añadir un hito o mover su porcentaje tampoco desbloquea nada al
cargar. En el siguiente aumento efectivo de distancia se descubren los IDs aún
no registrados cuyo umbral ya se alcanza. Esto también funciona si el porcentaje
visual ya está limitado al 100 % y siguen aumentando los kilómetros.

## Identidades y migración

- Mantener `game.id` (`alberto-belen`) al cambiar título, fecha o meta. Otro ID
  representa otro historial de reto, no un cambio de nombre. La distancia de
  simulación sigue siendo única por navegador y no se divide por juego.
- Cada hito tiene un `id` estable, independiente de su porcentaje y texto. Mover
  `{ "id": "milestone-40", "percent": 40 }` al 45 % conserva su imagen e historial.
  No renombrar el ID para cambiar solo el porcentaje. El ID `finish` está reservado.
- Retirar un ID de la lista lo oculta, pero conserva su registro histórico. Si se
  añade de nuevo con el mismo ID recupera su desbloqueo. Un ID distinto es una
  recompensa nueva: no hereda fotos ni desbloqueos de otra posición de la lista.
- La forma abreviada `[20, 40, 60, 80]` se normaliza a IDs `milestone-20`, etc.
  Cambiar esos números cambia también sus IDs: usar objetos antes de mover un
  porcentaje. La clave anterior `rewards.checkpoints` debe renombrarse a
  `rewards.milestones`; el validador avisa en lugar de ignorarla.

El estado de distancia v2 de #6 no cambia. El historial usa una clave independiente
y distingue los logros de los avisos vistos:

```text
strava-adventure:milestones:v2:alberto-belen
```

```json
{
  "version": 2,
  "gameId": "alberto-belen",
  "unlockedIds": ["milestone-20", "milestone-40", "finish"],
  "seenNoticeIds": ["milestone-20"]
}
```

Al instalar esta función por primera vez, si no existe historial, se infieren una
sola vez los IDs ya alcanzados con la distancia guardada y la meta configurada.
Esos logros se consideran antiguos y sus avisos se marcan como vistos, sin
abrir modales. El estado previo solo tenía distancia: no permite reconstruir
logros anteriores a un cambio antiguo de meta. Una vez existe historial, incluso
vacío, cargar o modificar la configuración nunca añade ni borra IDs por porcentaje.

Si existe historial v1 (`strava-adventure:milestones:v1:<gameId>`), se copia a v2
sin borrar el original. Se conservan también IDs retirados y `finish`; todos los
logros de v1 se consideran avisados para evitar anunciar de nuevo recuerdos
antiguos cuya presentación no se registraba. V2 prevalece, incluso vacío o dañado:
no se vuelve a importar v1. Los avisos vistos también se conservan al mover,
retirar o restaurar IDs. El ejemplo anterior tiene el aviso de `milestone-40`
pendiente para la siguiente visita; `finish` no tiene aviso de fotografía en #9.

**Reiniciar kilómetros** es una acción explícita de pruebas que pone la distancia
a cero y vacía tanto los logros como los avisos vistos para repetir los cofres. No equivale a una corrección
de Strava. Si el almacenamiento está bloqueado o lleno, el estado continúa en
memoria con aviso visible y puede perderse al cerrar. Un historial dañado no se
sobrescribe al cargar: se usa una recuperación en memoria desde el progreso
actual; el siguiente avance explícito o reinicio puede guardar ese estado reparado.

## Modo real futuro y dos dispositivos

Esta fase es solo simulación local. No consulta Strava, no configura Cloudflare,
no crea D1 y no despliega. El modo `real` continúa mostrando que no está disponible
y no lee ni escribe el historial local simulado.

En una issue futura, el backend será la única fuente de verdad del historial
compartido de Alberto y Belén. D1 persistirá los IDs por juego de forma monotónica;
una corrección de distancia no borrará filas de desbloqueos. La API devolverá el
total conjunto y los IDs históricos, sin desglose por participante ni información
privada. Cada dispositivo recuperará esa misma información; `localStorage` no
será la autoridad ni servirá para sincronizar móviles. Los avisos vistos son un
estado de presentación separado de esos logros compartidos; en esta fase solo
se guardan en el navegador. Ninguna prueba local implica sincronización real.

Prueba prevista con backend ficticio: dos clientes leen 40 km y los mismos IDs;
el servidor corrige a 38 km manteniendo IDs; ambos conservan la imagen del 40 %.
Al volver a 40 no se celebra otra vez. Al subir la meta se conserva también
`finish`; un ID nuevo solo se agrega tras otro avance. Las pruebas unitarias
incluyen dos clientes con snapshots compartidos ficticios para validar este
contrato; no demuestran sincronización real ni implementan red.

## Verificación local

Con el servidor del README y Playwright CLI/Chromium disponibles:

```sh
npm test
playwright-cli -s=hitos open http://127.0.0.1:8000 --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=hitos run-code --filename=tests/browser-smoke.js
playwright-cli -s=hitos run-code --filename=tests/browser-milestones.js
playwright-cli -s=hitos close
git diff --check
```

Las pruebas de navegador reinician datos simulados e interceptan el JSON solo en
ese navegador, sin modificar archivos. Repiten 19→20 %, 40/60/80, cola múltiple,
avisos pendientes entre visitas, cierre, consulta directa de imágenes con teclado/táctil, Escape/foco, recarga, 40→38→40,
500→700 y reducción de meta, IDs movidos/archivados, imagen ausente y movimiento
reducido. Revisan 320/390/768/1280 px y las rutas bajo el prefijo de Pages local.
No hay pruebas en Safari ni dispositivos físicos en esta entrega.
