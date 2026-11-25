# REGISTRO DE ESTADO Y SEGUIMIENTO: TRACE-MIN TELECOM

**Última actualización:** 25 de Octubre, 2026 - 14:32  
**Estado General:** Sistema 100% Operativo y Validado en Tiempo Real (ESP32-S3 + Sensores + Puente Inercial + Docker + Frontend Táctico).  
**Documento Detallado de Bitácora:** Consultar [HISTORIAL_CONVERSACION_Y_CAMBIOS.md](file:///c:/xampp/htdocs/teleco/HISTORIAL_CONVERSACION_Y_CAMBIOS.md) para el desglose cronológico completo.

---

## 1. Estado de Módulos del Sistema

| Componente | Estado | Detalles Técnicos |
|------------|--------|-------------------|
| **ESP32-S3 Firmware** | ✅ Operativo | `esp32_tracemin.ino` transmitiendo telemetría continua cada ~2.4s. Sobrescritura de NVS con `FORZAR_CONFIG_POR_DEFECTO`. Lectura HC-SR04 en GPIO 6/7, temperatura de silicio y puente inercial `/api/puente/gps`. |
| **Backend Fastify** | ✅ En Línea | Contenedor `teleco-backend-1` en puerto 3001 con endpoints `/api/telemetria`, `/api/puente/gps`, `/api/flota/hoy` y WebSockets en `/ws`. |
| **Base de Datos** | ✅ En Línea | TimescaleDB / PostgreSQL (`teleco-db-1`) en puerto 5432 con tabla particionada `telemetria`. Purgados los registros de prueba antiguos. |
| **Frontend Nginx** | ✅ En Línea | Contenedor `teleco-frontend-1` en puertos 8080 (HTTP) y 8443 (HTTPS). Distribución Vite actualizada con CARTO API Key, Radar Sonar HC-SR04, segmentación `MultiLineString` y filtros deadband. |
| **Puente Móvil / Simulador** | ✅ Operativo | `Simulador.jsx` con Wake Lock, Modo Bolsillo OLED (pantalla negra) y filtro deadband de reposo. APK compilada disponible en `/tracemin.apk`. |

---

## 2. Parámetros Críticos Validados y Activos

1. **Hardware en Protoboard:**
   - Ultrasonido HC-SR04: Trig = GPIO 6, Echo = GPIO 7 (alimentado a 5V).
   - GPS NEO-6M: RX = GPIO 16, TX = GPIO 17 (3.3V).
   - Tierra común (GND unificado entre 5V, 3.3V y ESP32).
2. **Filtros Anti-Ruido y Anti-Salto de GPS:**
   - Filtro Deadband de Reposo: radio de 12 metros y $< 2.5\text{ km/h}$ fija coordenadas y fuerza `0.0 km/h`.
   - Segmentación `MultiLineString`: saltos $> 250\text{ m}$ inician segmentos nuevos sin trazar líneas rectas que crucen la ciudad.
3. **Cartografía Táctica:**
   - CARTO Dark Matter HD oficial con API Key activa (`cb1_4ufq_1_f72384f0858023a188e8a621`) sin marcas de agua.
   - Selector en caliente de capas (Táctico, Satélite Esri HD, Calles OSM).