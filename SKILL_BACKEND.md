# HABILIDAD: ARQUITECTURA BACKEND Y GIS

## 1. Stack Tecnológico
- Entorno: Node.js (TypeScript) con el framework Fastify.
- Protocolos de Entrada: REST y WebSockets (Socket.io o ws).
- Motor de Base de Datos: PostgreSQL.
- Extensiones Críticas: PostGIS (manejo espacial) y TimescaleDB (series temporales).

## 2. Modelado de Datos
- Las coordenadas espaciales deben almacenarse obligatoriamente usando el tipo nativo `GEOMETRY(Point, 4326)`.
- La tabla de telemetría debe convertirse en una "hypertable" de TimescaleDB particionada por la columna `timestamp`.
- Los índices deben ser `GIST` para la geometría y `BTREE` compuesto para tiempo y dispositivo.

## 3. Restricciones de Generación de Código
- ESTRICTAMENTE PROHIBIDO incluir explicaciones, anotaciones o comentarios de ningún tipo dentro del código fuente o los scripts SQL generados.