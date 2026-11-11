# Configuración pública del juego

Editar únicamente [`frontend/config/game.json`](../frontend/config/game.json).
No hace falta modificar JavaScript, instalar paquetes ni compilar. El JSON del
repositorio conserva 100 km y una fecha de ejemplo `2027-01-01`: **no son valores
definitivos del reto**. El título conserva los nombres de Alberto y Belén.

```json
{
  "game": {
    "id": "alberto-belen",
    "title": "Alberto y Belén · Kilómetro Arcade",
    "goalKm": 100,
    "startDate": "2027-01-01",
    "timeZone": "UTC",
    "mode": "simulation"
  },
  "rewards": {
    "milestones": [
      { "id": "milestone-20", "percent": 20 },
      { "id": "milestone-40", "percent": 40 },
      { "id": "milestone-60", "percent": 60 },
      { "id": "milestone-80", "percent": 80 }
    ],
    "finish": 100
  }
}
```

| Campo | Interpretación y validación |
| --- | --- |
| `game.id` | Identidad estable del reto y de su historial. Opcional: `alberto-belen`. Letras minúsculas, números y guiones, empieza por letra, máximo 64 caracteres. No cambiar al editar título o meta. |
| `game.title` | Texto no vacío para el título de la página y el encabezado del juego. Se muestra como texto, sin interpretar HTML. |
| `game.goalKm` | Número JSON positivo y finito, sin comillas. Fuente de verdad del objetivo. |
| `game.startDate` | Fecha existente en formato exacto `YYYY-MM-DD`; admite años 0001–9999 y comprueba años bisiestos. |
| `game.timeZone` | Zona horaria reconocida por `Intl.DateTimeFormat`, como `UTC` o `Europe/Madrid`. Opcional: por defecto `UTC`. |
| `game.mode` | Exactamente `simulation` o `real`, en minúsculas. No hay selección automática ni modo de reserva. |
| `rewards.milestones` | Lista opcional de objetos `{id, percent, image?, title?, alt?}`. IDs únicos con el mismo formato que `game.id`; `finish` está reservado. Porcentajes únicos, crecientes y entre 0 y 100 sin extremos. Por defecto 20/40/60/80 con IDs `milestone-20`, etc. `[]` muestra solo salida y meta. |
| `rewards.finish` | Si se incluye, debe ser el número 100. |

El objeto `rewards` es opcional. Se toleran campos adicionales para futuras
ampliaciones, pero todavía no se utilizan. Los campos obligatorios de `game`
son título, objetivo, fecha y modo.

Usamos **hitos** en la interfaz y **milestones** en JSON y código. La antigua clave
`rewards.checkpoints` debe renombrarse a `rewards.milestones`; se rechaza con un
error claro para evitar ignorar una configuración antigua. Se admite la forma
abreviada `[20, 40, 60, 80]`, que genera IDs `milestone-20`, etc. Para poder mover
porcentajes conservando fotografías e historial, usar objetos con IDs explícitos.

`image` es una ruta local relativa a `frontend/`, por ejemplo
`assets/milestones/mi-imagen.webp`; no admite URL externa, ruta absoluta ni `..`.
Sin `image`, se usa `assets/milestones/<id>.webp`. `title` y `alt` son textos
opcionales no vacíos. Solo se incluyen cuatro imágenes iniciales: un ID nuevo
necesita su archivo o una ruta `image` existente. Si falta, el modal informa del
error sin mostrar otra imagen. Consulta [imágenes e historial de hitos](milestones.md).

## Fecha inclusiva y zona horaria

`startDate` representa las **00:00:00 de ese día en `game.timeZone`, inclusive**.
Por ejemplo, `2027-01-01` en `Europe/Madrid` incluirá las actividades que empiecen
exactamente a medianoche local del 1 de enero, y las posteriores. El adaptador
remoto futuro deberá convertir los instantes de Strava a esa zona para decidir
si entran en el reto; la zona del navegador no debe cambiar ese resultado.

Ahora solo se valida y muestra la fecha con su zona. **No se consulta ni filtra
Strava**, y la fecha no limita los botones de simulación, aunque sea futura.
Cambiarla tampoco borra kilómetros guardados: no existen actividades con fecha
en el estado simulado desde las que recalcularlos.

## Estado simulado y migración

La configuración nunca se toma de `localStorage`. La interfaz pública ya no
incluye un formulario para cambiar el objetivo. Cambiar `goalKm` en JSON y
recargar conserva distancia y recalcula progreso, posición y restantes. Conserva
los hitos conseguidos históricamente, incluido `finish`, sin crear nuevos avisos
por ese cambio. Un aviso pendiente de un logro anterior sí puede mostrarse al
volver a la página; solo abre su foto al pulsar **Ver imagen**.
Los hitos todavía no registrados se descubren únicamente tras otro aumento real
de kilómetros; editar el objetivo o los porcentajes no los desbloquea al cargar.

El estado v2 usa la clave `strava-adventure:simulation:v2` y guarda solo:

```json
{ "version": 2, "distanceKm": 16 }
```

Si no existe v2, se lee la clave anterior `strava-adventure:simulation:v1` y se
migra su distancia numérica, finita y no negativa. Se ignora por completo su
objetivo, incluso si era inválido. Se escribe v2 sin borrar el original v1. Una
vez existe v2, este prevalece; si está dañado se recupera a cero con aviso, sin
resucitar una distancia antigua. Reiniciar escribe cero en v2 y conserva la
configuración del JSON. También limpia explícitamente los hitos simulados para
poder repetir las revelaciones, sin equivaler a una corrección del progreso.

Si el almacenamiento está bloqueado o lleno, la simulación funciona en memoria
y muestra un aviso. Si falla la escritura al migrar, la distancia recuperada se
conserva en memoria. Los datos siguen siendo propios de cada origen/navegador;
no se sincronizan entre pestañas o dispositivos.

## Modo real y errores de configuración

Con `mode: "simulation"` se habilitan +1/+5/+10 km, reinicio y persistencia.
Con `mode: "real"` se muestra **Modo real aún no disponible**, junto al objetivo
y la fecha configurados. Distancia, porcentaje y restantes se muestran como `—`;
se ocultan el marcador, la barra y los controles de simulación. No se lee ni
escribe su almacenamiento y no se atribuyen kilómetros simulados al modo real.
El selector de proveedor devuelve ausencia de proveedor real hasta que exista
una integración expresamente autorizada.

Si falta el archivo, hay un error HTTP/de red, JSON mal formado o un campo
inválido, la interfaz muestra un mensaje de error y la partida no arranca. No se
activa simulación silenciosamente. Corregir el JSON y recargar permite iniciar
normalmente; no es necesario borrar el estado del navegador.

## Servidor estático, Pages y caché

El cargador resuelve `../config/game.json` respecto a la URL del módulo, por lo
que funciona tanto en `/` como en `/albertoybelen/`. No usa rutas absolutas del
servidor ni depende de DDEV. `fetch` usa `cache: 'no-store'` para no reutilizar la
configuración guardada por el navegador. Un CDN o un despliegue aún en curso
pueden tardar en entregar el archivo nuevo: confirmar el JSON servido en la
pestaña de red y recargar después de terminar una publicación autorizada.

Pages se preparó en la issue #7 y mantiene su activación separada. Editar
este JSON no autoriza activar Pages, hacer merge ni desplegar. El workflow de
Pages empaqueta `frontend/`, por lo que incluye `config/` y los recursos de hitos; no necesita un paso de build para la configuración.

**El JSON y los archivos son públicos.** No incluir Client Secret, tokens, claves
ni credenciales. Las imágenes provisionales son paisajes sin personas. El
bloqueo de un cofre es solo visual: su URL directa es pública. Las fotografías
definitivas requieren consentimiento para su publicación abierta. No añadir
contenido que necesite privacidad; véase la [guía de hitos](milestones.md).

## Comprobar una edición

```sh
npm test
git diff --check
```

Las pruebas validan también el JSON versionado. Para comprobar una subruta sin
desplegar, desde la raíz:

```sh
mkdir -p /tmp/albertoybelen-config-check/albertoybelen
cp -R frontend/. /tmp/albertoybelen-config-check/albertoybelen/
python3 -m http.server 8002 --bind 127.0.0.1 --directory /tmp/albertoybelen-config-check
```

Abrir `http://127.0.0.1:8002/albertoybelen/`. Con Playwright CLI disponible:

```sh
playwright-cli -s=config open http://127.0.0.1:8002/albertoybelen/ --config=.ddev/playwright-cli/cli.config.json
playwright-cli -s=config run-code --filename=tests/browser-smoke.js
playwright-cli -s=config run-code --filename=tests/browser-milestones.js
playwright-cli -s=config close
```

La prueba de navegador reinicia el estado local e intercepta temporalmente el
JSON para probar objetivos, fechas, zonas, hitos, modos y errores. No
modifica el archivo. Incluye migración, geometría 0/20/50/80/100 %, teclado,
movimiento reducido y tamaños 320/390/768/1280. La CI usa Node.js; Chromium sigue
siendo una comprobación local opcional, sin dependencias de runtime nuevas.
