# HABILIDAD: DESARROLLO FRONTEND PWA

## 1. Stack Tecnológico
- Framework: React compilado con Vite.
- Estilos: Tailwind CSS.
- Mapas: MapLibre GL JS o React-Leaflet.

## 2. Requerimientos de Interfaz
- **Aplicación Web Progresiva (PWA):** Configurar `manifest.json` y Service Workers para permitir su instalación nativa en dispositivos Android e iOS.
- **Rendimiento de Renderizado:** La actualización del marcador GPS en el mapa (vía WebSocket) debe ser fluida (60 FPS). No se debe recargar el componente del mapa entero con cada nueva coordenada entrante, solo actualizar la capa vectorial del vehículo y el trazo (polyline) de la ruta.

## 3. Restricciones de Generación de Código
- ESTRICTAMENTE PROHIBIDO incluir explicaciones, anotaciones o comentarios de ningún tipo dentro del código fuente generado.