# Transición a una app Strava y callback exclusivo de staging (#44)

**Decisión del propietario, 16/11/2026:** usar la aplicación Strava existente,
con un solo callback activo. Staging será el único entorno OAuth real por ahora;
DDEV queda aparcado. No hay app adicional, relay, puente ni uso simultáneo.
Esta PR **solo prepara**: no cambia Strava, callback, Cloudflare, D1 ni secretos.

## Preflight local de solo lectura

```sh
npm run staging:preflight
```

Lee solo configuración/código versionados y reutiliza las guardas de metadata,
allowlist y los tres Wrangler. No acepta argumentos, red ni activación. Una
salida correcta significa **configuración local coherente**, no permiso para
activar ni evidencia de aceptación del proveedor o del estado remoto.

| Dato mostrado | Valor / alcance |
| --- | --- |
| Campo Authorization Callback Domain propuesto | `albertoybelen-api-staging.autumn-dream-2a39.workers.dev` — solo hostname, sin esquema/puerto/ruta. Nunca `workers.dev` genérico. |
| URI callback del backend | `https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/oauth/callback` |
| Worker / DB / binding | `albertoybelen-api-staging` / `albertoybelen-db-staging` / `DB` |
| UUID D1 permitido | `c6bde806-cf94-4ff3-8c4f-c08b8de477f6` |
| Release versionada | OAuth/red/operador deshabilitados; sin Cron ni comando de despliegue OAuth. |
| Estado remoto comunicado en la issue | Fixtures; 0003 pendiente; secretos staging pendientes. **No comprobado remotamente.** |
| Ingreso de terminal | Bloqueado: no implementado. La RPC de Miniflare no lo sustituye. |
| App / proveedor | Capacidad, autorizaciones contadas, cuotas y aceptación del hostname **no verificadas**. |
| DDEV | Aparcado por política; procesos/archivos privados **no inspeccionados** por el preflight. |

No inspeccionar `.dev.vars`, `.local/pilot-config`, D1 persistente ni el perfil
local para completar el informe. Tampoco usar `pilot:local -- status`, refresh,
revoke, erase o sync para comprobar si las credenciales siguen funcionando.
Las suites de regresión usan DB temporales y credenciales exclusivamente sintéticas.

## Procedimiento futuro, manual y con autorizaciones por fase

1. **Capacidad y cuotas de la app existente.** Con aprobación para la revisión del
   panel, el propietario comprueba athlete capacity suficiente para los dos
   participantes **y las autorizaciones ya contadas**: el piloto propio y otras
   conexiones pueden ocupar plazas adicionales. Revisar también límites/uso de
   cuota y condiciones, sin asumir margen disponible ni coste 0 € garantizado.
   No revocar el piloto para liberar capacidad. Si no cabe o implica gastos no
   autorizados, parar. La única app comparte cuotas y contexto de tokens entre usos.
2. **Comprobar el campo, sin guardar.** El propietario evalúa si el panel admite
   exactamente el hostname indicado arriba. La admisión de workers.dev sigue sin
   confirmar; una comprobación local o validación del formulario no prueba el
   flujo OAuth completo. No pulsar Guardar todavía. Si no se admite, mantener la
   transición bloqueada y revisar la decisión con el propietario, sin inventar
   relay ni otra app.
3. **Preparar staging antes de la ventana.** Otra tarea debe implementar el ingreso
   remoto privado del operador y la activación guardada. Backup, migración remota
   0003, release y secretos requieren cada uno autorización explícita. El
   [backup y preflight D1](staging-d1-backup.md) no se ejecutan remotamente en la
   preparación; se usarán tras consentimiento separado, conforme al
   [runbook del operador](staging-operator.md). Las credenciales de app serán las de
   **la misma app existente**, introducidas manualmente por el propietario, no
   leídas/copias de DDEV. Las claves AES y de firma serán nuevas y exclusivas de
   staging. No rotar el Client Secret de Strava por esta transición. No importar
   cuenta, tokens, D1 o cofres del piloto. Hasta resolver estos requisitos no
   cambiar callback: la release cerrada puede responder 503 y no es operativa.
4. **Ventana y cambio del único campo.** Con staging listo, consentimientos previstos
   y una autorización expresa para cambiar el callback, el propietario confirma
   manualmente que no hay flujos/sync reales DDEV en ejecución, sin borrar datos.
   Anota el valor anterior del campo (comunicado actualmente como
   `albertoybelen.ddev.site`), guarda el hostname staging exacto y mantiene DDEV
   aparcado. No cambiar otros campos, secretos o datasets en la misma acción.
   Ese es un cambio real posterior: **no se ejecuta desde el preflight ni esta PR**.
5. **Validar por consentimiento nuevo y acotado.** Primero una cuenta de prueba
   autorizada específicamente, mediante el operador privado. Luego ambos
   participantes con su consentimiento explícito y capacidad comprobada. No
   importar las autorizaciones ni tokens del piloto: incluso si se eligiera la
   misma cuenta de prueba, requiere un flujo nuevo expresamente autorizado.
   Verificar callback seguro, cifrado, presupuesto y progreso agregado sin
   publicar IDs/tokens/actividades. No conectar Pages ni el visor fixture #36.
6. **Rollback del callback si falla.** Parar nuevos flujos reales de staging por el
   canal aprobado y, con autorización para revertir el campo, el propietario
   restaura el hostname anterior de DDEV en **la misma app**. No copiar, borrar,
   refrescar, revocar ni restaurar tokens o D1 para este rollback. Volver el campo
   no arranca DDEV ni garantiza validez de sus tokens: reactivarlo como banco
   local requiere una decisión y autorización separadas. El rollback de código a
   fixtures en Cloudflare es otra operación de despliegue, con permiso separado;
   sus guardas y datos originales se conservan.

El cambio del callback afecta **nuevos flujos OAuth**; no es un mecanismo para
migrar tokens entre datasets y no garantiza que autorizaciones anteriores sean
válidas para staging. Conservar archivos no garantiza la validez futura de sus
tokens; no probarlos contra Strava para averiguarlo en esta fase. La cuenta
propia del piloto DDEV no se importa ni se revoca. Ningún estado/premio de prueba
se transfiere a producción (500 km desde 2026-11-28); el dataset de ensayo sigue
separado, desde 2026-11-01 Europe/Madrid.

## Validación de esta PR

```sh
npm test
npm run test:d1
npm run test:staging:auth
npm run test:staging:operator
npm run config:check
npm run staging:oauth -- check
npm run staging:preflight
```

Las pruebas negativas alteran copias de JSON/Wrangler y valores de dominio/URI;
no consultan el panel. Una réplica aislada del CLI prohíbe red, subprocesos,
escrituras y lecturas privadas y comprueba que su salida sigue siendo correcta.
Las pruebas de separación usan un piloto y un staging **sintéticos** en DB
temporales, sin abrir los archivos del propietario. Sin cambios visuales.
