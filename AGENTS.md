# Instrucciones para agentes — Strava Adventure

## Objetivo
Juego web para un amigo: cada kilómetro registrado en Strava hace avanzar un personaje por un camino desde el inicio hasta una meta. Objetivo de distancia configurable.

## Arquitectura acordada
- Frontend estático en GitHub Pages, pensado primero para móvil.
- Frontend: JavaScript moderno (sin React), CSS y SVG para el camino/personaje.
- Backend futuro: Cloudflare Workers + D1, conexión OAuth con Strava, sincronización programada.
- Mantener el juego y las fuentes de datos desacoplados; la fase inicial usa datos simulados.
- Nunca almacenar Client Secret, refresh tokens, access tokens ni claves privadas en el repositorio o código frontend.

## Reglas de desarrollo
1. Implementar las tareas por fases; no avanzar a la fase siguiente sin aprobación.
2. Antes de editar, inspeccionar los archivos actuales y describir brevemente el plan.
3. Usar convenciones claras y código modular; evitar dependencias innecesarias.
4. Mantener la web responsive, accesible con teclado, y adecuada para móvil.
5. Incluir pruebas para cálculos críticos: progreso acotado entre 0 y 1, kilómetros restantes, objetivo inválido, cero km y más de 100 %.
6. Proporcionar comandos de ejecución y pruebas en README.md.
7. Al terminar cada tarea, ejecutar las comprobaciones disponibles e informar qué se cambió, qué se probó y qué queda pendiente.
8. No desplegar a producción, configurar secretos ni integrar la API real de Strava hasta recibir instrucciones explícitas.
9. No borrar ni sobrescribir trabajo existente sin necesidad; mantener cambios pequeños y revisables.

## Primera fase: prototipo visual
- Un mapa SVG con recorrido sinuoso de inicio a meta.
- Un personaje/indicador que avanza a lo largo del trazado conforme al porcentaje.
- Panel de kilómetros acumulados, objetivo, porcentaje y restantes.
- Controles de simulación para aumentar/reiniciar kilómetros; persistencia local.
- Sin OAuth, sin base de datos, sin llamadas a Strava.
- Documentar la forma de ejecutar el prototipo y verificarlo.
