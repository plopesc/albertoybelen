# Backup D1 staging y paso previo a 0003 (#46)

Esta entrega **no ejecutó ninguna operación remota ni creó un backup real**.
Solo se ensayó con SQLite/Miniflare temporales y un Wrangler simulado. La última
información del propietario dice que staging sirve fixtures y tiene 0001/0002;
no se ha consultado Cloudflare para confirmarlo. OAuth/red/operador siguen cerrados,
DDEV aparcado y producción fuera de los destinos operativos.

## Comprobación local, sin cuenta ni red

```sh
npm run staging -- d1-check
npm run staging -- d1-plan
```

Validan `config.json`, Wrangler fixture y allowlist independiente; también el
inventario **exacto** 0001/0002/0003 y sus SHA-256 fijados en
`scripts/lib/staging-d1-policy.mjs`. Rechazan SQL editado, nombres adicionales y
symlinks. Un autorizador SQLite comprueba que 0003 solo crea/inicializa sus tablas
`staging_auth_*`, sin modificar las tablas fixture. Los hashes no se regeneran
solos: cambiar SQL/pins exige revisión humana. No constituyen una prueba formal
de todas las propiedades posibles de SQL/Cloudflare: hay que revisar el SQL y las
pruebas D1, especialmente si se cambian estas versiones.

`check`/`plan` nunca llaman a Wrangler remoto, acceden a backups privados ni
inspeccionan `.dev.vars`, el piloto o D1 persistente. Node 24 debe disponer de
`node:sqlite.setAuthorizer` (probado con 24.22.1); si falta, falla cerrado.

Destino fijo, sin overrides:

| Worker / D1 | Binding / UUID |
| --- | --- |
| `albertoybelen-api-staging` / `albertoybelen-db-staging` | `DB` / `c6bde806-cf94-4ff3-8c4f-c08b8de477f6` |

## Runbook futuro del propietario: una aprobación por etapa

**No ejecutar los comandos remotos para revisar esta PR.** Una autorización de
listado no autoriza export, migración, GET o despliegue. El propietario selecciona
manualmente la cuenta correcta con `CLOUDFLARE_ACCOUNT_ID` y autentica su terminal
privada con permisos mínimos; no pegar valores en GitHub, chat, archivos de
configuración o argumentos. Comprobar el formato de cuenta no demuestra que sea
la correcta: las solicitudes usan también el UUID fijo del destino permitido.
Verificar condiciones/cuotas/coste 0 € y espacio local antes del export; Wrangler
advierte que exportar puede hacer la base temporalmente indisponible.

1. **Leer inventario, con permiso de lectura remota.** Tras aprobación específica:

   ```sh
   npm run staging -- list --confirm-staging
   ```

   Usa un SELECT fijo sobre historial, nombres de tablas y contadores agregados.
   No ejecuta `d1 migrations list`, porque ese comando de Wrangler puede crear la
   tabla de historial. Si falta el historial, hay tablas/versiones inesperadas,
   orden incorrecto o 0003 parcial, parar; no inicializar ni reparar por SQL manual.
   List admite solo 0001/0002 completas o 0001/0002/0003 completas. Para avanzar se
   exige que **solo 0003 esté pendiente**. Si ya está aplicada, no volver a migrar.
2. **Exportar, con nueva autorización de backup y ventana sin otros escritores.**
   Coordinar todos los operadores/checkouts; el lock local no bloquea herramientas
   externas ni otras máquinas. No ejecutar sync, cambios de datos o migraciones en
   paralelo. Confirmar que el destino sigue siendo el de la tabla y ejecutar:

   ```sh
   npm run staging -- backup --confirm-staging
   ```

   Hace inventario, export y lectura de consistencia dentro de esta operación
   autorizada. El único subprocess runner reutiliza el staging fixture guardado,
   con configuración aislada y `.dev.vars` vacío, sin leer los del proyecto/piloto. Captura
   stdout/stderr de Wrangler y elimina su log privado temporal: **no imprime SQL,
   valores ni la URL firmada que Wrangler emite durante export**.

   Crea un ID aleatorio de 24 caracteres hexadecimales y una carpeta nueva
   `.local/staging-backups/<id>/` 0700. SQL y manifiesto tienen modo 0600. Rechaza
   permisos/propietario inseguros, symlinks, hardlinks, rutas publicadas y colisiones;
   no permite `--output` ni un destino DB aportado por el usuario. La raíz
   del checkout y los directorios del backup no pueden ser escribibles por otros
   usuarios/grupos; usar un
   checkout privado si es necesario, sin cambiar permisos del piloto automáticamente.

   Solo publica `manifest.json` tras salida exitosa del export, marcador del UUID
   esperado, descarga completa, tamaño y checksum, restauración SQLite en memoria,
   esquema/integridad/FKs válidos y contadores/historial estables antes/después.
   En esa copia restaurada también ensaya 0003 y comprueba que no cambia ninguna
   fila fixture. Se sincronizan los archivos a disco. El formato soportado es
   **SQL D1 completo**, no binario SQLite, schema-only ni data-only. Se limita la
   inspección a 64 MiB: Wrangler descarga antes de esa comprobación, por lo que
   el límite no garantiza espacio de descarga. Si el formato real no es compatible,
   conservar la salida privada y pedir revisión; no rebajar validaciones ni fabricar
   un manifiesto. La compatibilidad se probó con export real de **Miniflare local**,
   no con un export Cloudflare.
3. **Inspeccionar la evidencia local, sin llamadas remotas.** Usar el ID recibido:

   ```sh
   npm run staging -- inspect-backup BACKUP_ID_24_HEX
   ```

   `BACKUP_ID_24_HEX` es un placeholder inválido deliberado: sustituirlo por el ID
   exacto, nunca por una ruta. Recalcula SHA-256, restaura en memoria, verifica
   esquema/datos y vuelve a ensayar 0003. Informa de antigüedad y si está dentro
   del máximo de 24 horas para migrar. La cuenta se compara al migrar, no se pide
   para inspeccionar localmente. El manifiesto contiene target, hash de cuenta
   (no Account ID), fechas, tamaño, huellas y contadores agregados; no filas,
   secretos o URLs. Es evidencia del proceso local protegido, **no una firma de
   Cloudflare ni una defensa contra un administrador local malicioso**.

   Se puede compartir la salida resumida del CLI (ID, target, tamaño y SHA).
   Mantener privados el SQL, manifiesto, parciales, logs residuales de una caída y
   credenciales. No subir carpetas `.local` a logs, Git, Actions, capturas o issues.
   Un backup válido se conserva para recuperación; no borrar sus claves de cifrado
   si hicieran falta para datos cifrados. No leer ni copiar claves del piloto DDEV.
4. **Aplicar solo 0003, con autorización nueva de escritura.** Con backup revisado,
   cuenta correcta, ventana exclusiva y antigüedad inferior a 24 horas:

   ```sh
   npm run staging -- migrate BACKUP_ID_24_HEX --confirm-staging
   ```

   El antiguo `migrate --confirm-staging` queda **bloqueado**. La escritura exige
   evidencia verificable antes de cualquier lectura remota de esta etapa: target,
   huellas, SHA/tamaño, restore local, cuenta seleccionada y vigencia. Comprueba de
   nuevo el inventario remoto exacto y contadores contra el backup. Solo entrega
   a Wrangler una carpeta aislada con **0003 fijada**, sin posibilidad de aplicar
   0001/0002 u otra migración añadida al checkout. El executor también exige el
   backup: no basta con obtener un array de argumentos para `migrations apply`.
   Luego verifica historial 0001–0003, tablas esperadas y contadores fixture iguales.
   No arranca OAuth, Cron, operador ni deploy.
5. **Verificar el Worker fixture, con permiso independiente para GET.** Después de
   revisar el resultado, el propietario puede consultar solo el endpoint conocido
   `/api/progress` y comprobar source=fixture, agregado y no-store. No se hace ese
   GET automáticamente ni se presentan pruebas locales como evidencia remota.
   `staging -- deploy` sigue limitado al entry fixture y requiere su propia
   autorización; aplicar 0003 no cambia el Worker.

## Si algo falla

- Export incompleto, timeout, falta de espacio o discrepancia: **no hay evidencia
  válida para migrar**. Los archivos parciales quedan privados con su ID; no se
  imprimen ni se sobrescriben. Revisarlos/retirarlos manualmente, y pedir nueva
  autorización para otro intento. No reutilizar un archivo parcial como backup.
- Backup alterado/antiguo, cuenta distinta o plan distinto: la escritura se bloquea.
  No cambiar nombres/UUID, regenerar hashes a mano, editar manifiestos o usar
  Wrangler directo para sortearlo. Pedir un backup nuevo si corresponde.
- Fallo/estado incierto al aplicar: no hay retry, reparación SQL, restore o deploy
  automático. Con autorización de lectura separada, usar `list`. Si no encaja en
  un estado completo conocido, parar y revisar; no ejecutar DROP/DELETE para limpiar.
- Lock tras caída: identificar y confirmar que terminó el proceso anotado en el
  lock privado antes de retirarlo manualmente. No matar servicios ajenos para avanzar.
- **Revertir el Worker** significa volver al entry fixture (que no se cambia aquí),
  no restaurar datos. No hace falta borrar las tablas aditivas para servir fixtures.
  **Restaurar D1** desde SQL es destructivo, requiere otra revisión/autorización y
  no tiene comando en esta herramienta. La restauración probada fue solo local.

La exclusión local y los inventarios no son una transacción distribuida: no se
puede impedir que otro administrador cambie Cloudflare entre comprobaciones.
La ventana exclusiva es obligatoria. Los contadores no prueban identidad de todos
los valores remotos; la integridad depende también del export completo de Wrangler,
la cuenta/destino verificados y las huellas locales. Una respuesta inesperada falla
cerrada. Esto no reemplaza revisión humana de SQL, permisos o estado remoto.
