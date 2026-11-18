# Vista opt-in de Strava Staging en GitHub Pages (#52)

La ruta pública normal sigue abriendo la simulación. Después de publicar una
versión revisada y desplegar el cambio compatible del Worker, el enlace de
prueba es:

**https://plopesc.github.io/albertoybelen/?pages-staging=strava**

El perfil público separado usa 500 km, inicio inclusivo 2026-11-01 y
`Europe/Madrid`. La etiqueta visible es **PRUEBA · STAGING STRAVA**. El botón
«Actualizar vista» solicita el último snapshot guardado una sola vez; no activa
sync ni polling. `partial`, `stale`, fecha y los hitos históricos se representan
con los mismos datos de la API. Si falla la API, el perfil muestra el error y no
vuelve a la simulación ni reutiliza el estado de otro perfil.

La URL del Worker está fijada en el código frontend y la validación exige el
host `plopesc.github.io`, la ruta `/albertoybelen/` y el parámetro único
`pages-staging=strava`. El perfil no acepta fixtures. La API remota solo permite
ser leída por este origen desde navegador; Worker y backend no reciben
credenciales del navegador. El navegador envía un GET sin cookies ni
Authorization. El Worker responde `Access-Control-Allow-Origin` únicamente para
ese GET agregado y ese origen; no habilita preflight ni CORS para administración,
OAuth u otras rutas. La lectura directa sin `Origin` sigue siendo pública.

## Privacidad y publicación

`GET /api/progress` es un endpoint **público**: CORS limita navegadores, pero no
impide que alguien consulte la URL directamente. Expone solo la suma agregada,
estado parcial/desactualizado, fecha e IDs públicos de hitos; no identidades,
aportaciones por cuenta, actividades ni credenciales. Antes de publicar o
compartir el enlace, el propietario debe confirmar que acepta que el progreso
agregado de staging sea visible públicamente. Pages de prueba también puede
compartirse conscientemente.

Esta PR no despliega ni altera ajustes remotos. Después de revisión y autorización
separada, el procedimiento manual protegido para actualizar el mismo Worker es:

```sh
npm run staging:mvp -- deploy --confirm-staging-oauth
```

El deploy reutiliza el Worker/D1 staging existentes; no ejecuta migraciones, no
activa Cron y no cambia secretos. Tras el despliegue, comprobar en navegador que
el GET del origen Pages devuelve `Access-Control-Allow-Origin` exacto y
`Cache-Control: no-store`, y que otros orígenes, `/admin/staging` y `/oauth/*` no
incluyen CORS.

La publicación Pages sigue bajo control del propietario mediante la variable
`PAGES_TEST_DEPLOY_ENABLED` del workflow existente. No habilitarla ni ejecutar
`workflow_dispatch` sin autorización específica de publicación. Una vez
autorizado, publicar la rama revisada desde `main`, abrir el enlace anterior en
móvil y escritorio, y confirmar que la ruta raíz `/albertoybelen/` sigue en
modo simulado. No cambiar el objetivo definitivo ni la fecha del juego público.

## Comprobaciones locales

```sh
npm test
npm run test:d1
npm run test:staging:mvp
npm run test:pages:staging:browser
npm run test:frontend:api
npm run test:frontend:staging
npm run staging -- check
npm run staging -- dry-run
```

Las pruebas del navegador interceptan todo el tráfico y usan snapshots
sintéticos para 0, 62.66, 500 km y retroceso. No realizan peticiones a
Cloudflare, Strava ni GitHub Pages.
