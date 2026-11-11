# Contribuir a Juego Alberto

Trabajamos con el ciclo **issue → rama → implementación → pruebas → Pull Request
→ revisión → merge**. ChatGPT puede ayudar a definir las issues; Codex implementa
el alcance aprobado y abre la PR. La persona responsable revisa y aprueba el merge.

## 1. Definir y leer la issue

Cada issue debe indicar el problema u objetivo, el alcance, los criterios de
aceptación y lo que queda fuera. Mantener las fases separadas: una issue no
autoriza a implementar la siguiente fase. Antes de programar, leer `AGENTS.md`,
la descripción completa y los comentarios de la issue:

```sh
gh issue view 2 --repo plopesc/albertoybelen --comments
```

Cambiar `2` por el número correspondiente. Si falta una decisión menor, adoptar
la opción más simple y explicar el motivo en la PR. Preguntar solo si hay un
bloqueo importante que impida cumplir el alcance.

## 2. Crear una rama por issue

Partir de `main` actualizado y con el trabajo previo guardado. No sobrescribir
cambios locales ni implementar directamente en `main`.

Convención: `codex/issue-<numero>-<descripcion>`, con una descripción breve en
minúsculas, palabras separadas por guiones y sin espacios ni tildes. Ejemplo:

```sh
git switch main
git pull --ff-only origin main
git switch -c codex/issue-2-flujo-issues-pr-ci
```

## 3. Implementar y probar

Inspeccionar primero el código y describir brevemente el plan. Implementar solo
los criterios de la issue, en cambios pequeños y revisables. El frontend es
estático: no requiere compilación, instalación de paquetes ni secretos.

En el entorno habitual con DDEV, desde la raíz del proyecto en la máquina local:

```sh
ddev start
ddev launch /frontend/
ddev exec npm test
git diff --check
```

La aplicación se abre en <https://albertoybelen.ddev.site/frontend/>. Sin DDEV,
consultar en [README.md](README.md) el servidor estático local y ejecutar
`npm test` con Node.js 22 o posterior. La CI usa Node.js 24, igual que DDEV.

Las pruebas usan el ejecutor incorporado `node:test`. Incluyen cálculos de
progreso, configuración JSON, fechas y zonas horarias, migración y precedencia
del estado, selección de modo, simulación y persistencia. Mantener la cobertura
de los cálculos y añadir pruebas para comportamientos nuevos sin duplicarlos ni
añadir dependencias innecesarias. La configuración pública se documenta en
[docs/configuration.md](docs/configuration.md).

Si se cambia la interfaz, comprobar también el navegador y el diseño móvil,
añadir capturas a la PR y ejecutar la prueba de navegador documentada en el
README cuando esté disponible. En cambios solo de documentación o CI, indicar
que las capturas no aplican. No afirmar que se ejecutó una prueba si no se hizo.

## 4. Guardar los cambios y abrir la Pull Request

Revisar el diff y guardar solo los archivos de la tarea. Ejemplo de commit:

```sh
git diff
git add CONTRIBUTING.md AGENTS.md README.md .github/
git diff --cached --check
git commit -m "chore: document issue and PR workflow"
git push -u origin codex/issue-2-flujo-issues-pr-ci
```

Los nombres de archivo y la rama son ejemplos de la issue #2; adaptarlos a cada
tarea. No incluir archivos temporales, credenciales ni cambios ajenos.

Convención del título de PR: `<tipo>: <descripcion> (#<numero>)`. Tipos habituales:
`feat`, `fix`, `docs`, `test` y `chore`. La base siempre es `main`.

GitHub propone la [plantilla de PR](.github/pull_request_template.md). Completar
el resumen, el enlace de cierre `Closes #N`, los comandos y resultados de
pruebas, las capturas cuando proceda y el checklist de seguridad. Documentar
también decisiones simples, limitaciones y trabajo pendiente.

Desde el navegador, crear la PR con esa plantilla; desde GitHub CLI, escribir la
descripción completa en un archivo temporal fuera del repositorio y usar:

```sh
gh pr create --repo plopesc/albertoybelen --base main \
  --head codex/issue-2-flujo-issues-pr-ci \
  --title "chore: establecer flujo de Issues, PRs y CI (#2)" \
  --body-file /tmp/issue-2-pr.md
gh pr checks --watch
```

`/tmp/issue-2-pr.md` debe existir y contener la plantilla completada, incluido
`Closes #2`. Si falla una comprobación por el cambio, corregir en la misma rama,
repetir las pruebas afectadas y subir el nuevo commit: la PR se actualiza.

## 5. CI, revisión y merge

El workflow [CI frontend](.github/workflows/ci.yml) se ejecuta al abrir, reabrir
o actualizar commits de una PR hacia `main`. Comprueba la sintaxis de todos los
módulos JavaScript del frontend y ejecuta `npm test` con Node.js 24. Usa solo permisos de
lectura y no necesita secretos. Las acciones oficiales están fijadas a un commit
para que su actualización sea explícita y revisable. No instala paquetes ni usa
caché porque el proyecto no tiene dependencias. La prueba de navegador sigue siendo una
comprobación local; este workflow no instala Chromium.

La persona responsable revisa alcance, pruebas, seguridad y capturas. Solicita
correcciones o aprueba y realiza el merge cuando corresponda. `Closes #N` enlaza
la issue y permite que GitHub la cierre al fusionar la PR en `main`.

**Codex no debe hacer merge ni desplegar sin aprobación explícita.** Abrir una
PR o que CI pase no constituye esa aprobación. No hay auto-merge ni pasos de
despliegue en el workflow. Tampoco se modifican las reglas de protección de
`main`: exigir CI y aprobaciones mediante esas reglas queda a criterio de la
persona responsable del repositorio.
