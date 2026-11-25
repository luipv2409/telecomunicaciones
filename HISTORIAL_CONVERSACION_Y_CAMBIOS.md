# BITÁCORA TÉCNICA E HISTORIAL DE CONVERSACIÓN — PROYECTO TRACE-MIN

**Proyecto:** TRACE-MIN / TRACE-SECURE (Sistema de Telemetría Vehicular & Sensor Hub para Transporte de Valores)  
**Institución:** Universidad Latinoamericana "ULAT" — Ingeniería de Sistemas  
**Materia:** Telecomunicaciones  
**Estudiante:** Gunar Ludwing Pecho Vallejos  
**Fecha de Actualización:** 25 de Octubre, 2026  
**Entorno:** ESP32-S3 N16R8, Fastify Backend (Node.js), PostgreSQL/TimescaleDB (Docker), React + Vite + MapLibre GL (Nginx Docker en puertos 8080 y 8443).

---

## 1. Resumen Cronológico de Requerimientos y Acciones

| # | Solicitud del Usuario | Causa Raíz Identificada | Solución Implementada | Estado |
|---|------------------------|-------------------------|-----------------------|--------|
| **1** | Interconectar hardware físico (ESP32 + HC-SR04 + MPU + NEO) pero recibir datos inerciales y GPS del celular para simular ruta real. | MPU dañado/inestable físicamente; se requería puente de telemetría celular hacia el ESP32 para inyectar datos reales al backend. | Se implementó el pipeline de puente en `esp32_tracemin.ino` consultando `/api/puente/gps?id=celular-1`, combinándolo con el sensor ultrasónico HC-SR04 físico en GPIO 6 y 7, y temperatura del silicio. | **Completado** |
| **2** | `[ERROR] HTTP -1` al enviar telemetría a `192.168.1.42` y reconexión a Wi-Fi `'JAPON'`. | La memoria no volátil (NVS Flash / `Preferences`) del ESP32 retenía configuraciones antiguas guardadas en sesiones previas. | Se agregó `#define FORZAR_CONFIG_POR_DEFECTO true` en el firmware para sobreescribir la flash al arrancar con la IP `192.168.1.129` y la red actual. | **Resuelto** |
| **3** | El navegador móvil bloqueaba el GPS sobre HTTP no seguro. | Políticas de seguridad de Chromium/Android que bloquean `navigator.geolocation` en orígenes que no sean `localhost` o `https://`. | Se configuraron coordenadas base de respaldo para no trabar el envío inercial, se habilitó el puerto HTTPS `8443` con SSL en Nginx, y se compiló la APK nativa Android (`tracemin.apk`). | **Resuelto** |
| **4** | El celular deja de mandar datos cuando se apaga la pantalla. | Mecanismo Doze Mode del kernel de Android que congela JavaScript y corta interrupciones de sensores en navegadores al pulsar el botón físico de bloqueo. | Se implementó la API **Screen Wake Lock**, el **Modo Bolsillo OLED (Pantalla Negra al 100%)** en `Simulador.jsx`, y se disponibilizó la **APK Nativa Android**. | **Resuelto** |
| **5** | Potenciar visualmente el frontend para que se vea como una consola de alta tecnología. | El mapa original utilizaba OpenStreetMap blanco estándar sin selector de capas ni instrumental visual para los nuevos sensores. | Se integró el mapa táctico oscuro por defecto, selector en vivo de 3 capas (Táctico, Satélite HD, Calles), y un **Radar Sonar de Proximidad para el HC-SR04** con arcos concéntricos animados en `DetalleVehiculoModal.jsx`. | **Completado** |
| **6** | Una línea recta punteada cruzaba desde la Plaza Principal (Cochabamba) hasta la casa del usuario. | Coordenadas dummy de respaldo (`-17.3935, -66.1570`) almacenadas antes de tener señal GPS, unidas como un solo `LineString` al recibir la primera coordenada real a 2.3 km. | Se implementó **Segmentación `MultiLineString`** por distancia ($>250\text{ m}$ crea un segmento nuevo sin línea recta), descarte automático de puntos fallback, botón **`🧹` (Limpiar Trazo)** y depuración de 1986 registros dummy en PostgreSQL. | **Resuelto** |
| **7** | En el mapa táctico aparecía la marca de agua *"API KEY REQUIRED"*. | CARTO actualizó sus políticas de teselas públicas requiriendo clave de API en `basemaps.cartocdn.com`. | Se integró la **API Key oficial de CARTO** (`cb1_4ufq_1_f72384f0858023a188e8a621`) para solicitar teselas HD `@2x.png` con 5,000,000 de peticiones mensuales autorizadas. | **Resuelto** |
| **8** | El camión detenido registraba movimientos falsos de varios metros a los alrededores (deriva de satélites). | Ruido electromagnético y dispersión ionosférica GNSS (851 de 861 puntos en reposo con deriva de hasta 12.2 metros y velocidades de 0.5 km/h). | Se implementó un **Filtro Deadband de Reposo**: si el desplazamiento es $< 12\text{ m}$ y velocidad $< 2.5\text{ km/h}$, se ancla la posición exacta y se fuerza la velocidad a `0.0 km/h`, evitando telarañas de deriva en el mapa. | **Resuelto** |

---

## 2. Detalle Técnico de Problemas y Soluciones

### 2.1. Memoria Flash NVS en ESP32 y Error HTTP -1
* **Síntoma:** El monitor serie del ESP32 mostraba:
  ```text
  [WIFI] Conectando a 'JAPON'...
  [ERROR] HTTP -1 al enviar telemetria a http://192.168.1.42:3001/api/telemetria
  ```
* **Causa:** La librería `Preferences.h` del ESP32 guardaba valores anteriores en la partición NVS. Aunque se modificaran las constantes en el código C++, el firmware leía primero la flash y sobrescribía las variables.
* **Solución en `firmware/esp32_tracemin/esp32_tracemin.ino`:**
  ```cpp
  #define FORZAR_CONFIG_POR_DEFECTO true // Fuerza escritura en NVS de valores actuales
  ```
  Al activarse, la función `cargarConfiguracion()` formatea y graba los valores por defecto: Host `192.168.1.129`, Puerto `3001`, Dispositivo `Camion-1`, Puente `celular-1`.

---

### 2.2. Suspensión de Sensores al Bloquear Pantalla del Celular
* **Síntoma:** Al bloquear físicamente la pantalla del teléfono, la página web dejaba de enviar telemetría.
* **Causa:** Android Doze Mode suspende el hilo de render y eventos de JavaScript para páginas web.
* **Soluciones Desarrolladas:**
  1. **Wake Lock API Automático:** En [Simulador.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/Simulador.jsx), `navigator.wakeLock.request('screen')` previene que la pantalla se apague por tiempo de inactividad mientras se transmita.
  2. **Modo Bolsillo OLED (Pantalla Negra `#000000`):** Al activarse, renderiza un telón negro absoluto que apaga físicamente los píxeles en pantallas OLED/AMOLED (0 consumo de energía y 0 emisión de luz) con bloqueo táctil, permitiendo meter el móvil al bolsillo sin toques involuntarios y manteniendo los sensores y bucles JS al 100% de frecuencia. Doble toque para salir.
  3. **App Nativa Android:** Compilada en [tracemin.apk](file:///c:/xampp/htdocs/teleco/frontend/public/tracemin.apk) con servicios en primer plano (`FOREGROUND_SERVICE`), descargable desde el menú principal.

---

### 2.3. Salto de GPS y Línea Recta de Teletransporte
* **Síntoma:** Aparecía una línea punteada recta de 2.35 km atravesando la ciudad entre la Plaza Principal y la ubicación real del usuario.
* **Causa:**
  1. Cuando el GPS no tenía fijación inicial, el simulador transmitió las coordenadas base de Cochabamba (`-17.3935, -66.1570`).
  2. La capa del mapa acumulaba todas las coordenadas en un único vector de `LineString`. Al llegar la primera lectura real, se unieron ambos puntos distantes con una línea recta continua.
* **Solución en `frontend/src/App.jsx` y `frontend/src/Historial.jsx`:**
  1. **Segmentación `MultiLineString`:**
     ```javascript
     const distSalto = calcularDistanciaMetros(ultimaCoord, nuevaCoordenada);
     if (distSalto > 250) {
       // Salto detectado: se inicia un nuevo segmento independiente
       vehiculo.segmentos.push([nuevaCoordenada, nuevaCoordenada]);
     } else {
       vehiculo.segmentos[vehiculo.segmentos.length - 1].push(nuevaCoordenada);
     }
     ```
  2. **Auto-limpieza de Fallback:** Si un vehículo solo tenía puntos de la Plaza y recibe el primer punto real, se purgan los puntos de la Plaza y la ruta comienza limpia en la posición real.
  3. **Botón `🧹 Limpiar Trazo`:** Permite al operador en el panel lateral vaciar el trazo acumulado en el mapa con 1 clic.
  4. **Limpieza en BD:** Se ejecutó:
     ```sql
     DELETE FROM telemetria WHERE ST_DWithin(ubicacion::geography, ST_SetSRID(ST_MakePoint(-66.157, -17.3935), 4326)::geography, 60);
     ```
     eliminando 1,986 registros ficticios previos.

---

### 2.4. Integración de la API Key Oficial de CARTO
* **Síntoma:** El mapa táctico oscuro cargaba con marcas de agua repetidas: *"API KEY REQUIRED carto.com/basemaps/apikey"*.
* **Solución en `frontend/src/config.js` y `frontend/src/App.jsx`:**
  Se integró la clave proporcionada por el usuario (`cb1_4ufq_1_f72384f0858023a188e8a621`):
  ```javascript
  export const CARTO_API_KEY = 'cb1_4ufq_1_f72384f0858023a188e8a621';

  // URL autenticada de teselas HD @2x:
  `https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`
  ```
  Esto activó el mapa oscuro oficial sin marcas de agua con soporte para 5,000,000 de solicitudes al mes.

---

### 2.5. Deriva GPS en Reposo (Jitter de Satélites)
* **Auditoría de Datos:**
  * Puntos analizados: 861 registros de hoy.
  * Puntos en reposo: 851 registros (98.8%).
  * Dispersión máxima alrededor del punto de reposo: 12.2 metros.
  * Velocidad fantasma reportada: 0.5 km/h.
* **Solución (Filtro Deadband en `Simulador.jsx` y `App.jsx`):**
  * Si la distancia al punto ancla es menor a 12 metros y la velocidad es menor a 2.5 km/h:
    1. Se anclan las coordenadas de latitud y longitud fijas en el transmisor.
    2. Se fuerza la velocidad reportada a `0.0 km/h`.
    3. En el mapa no se insertan puntos repetidos a la polilínea, evitando el efecto "telaraña" o maraña de líneas en vehículos estacionados.

---

### 2.6. Potenciación Visual y Diseño Táctico Premium
* **Radar Sonar de Proximidad HC-SR04 en [DetalleVehiculoModal.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/DetalleVehiculoModal.jsx):**
  * Arcos concéntricos con animación de pulsos de onda acústica (`animate-sonar`).
  * Alertas cromáticas:
    * 🟢 Verde (> 60 cm): Distancia segura / Zona despejada.
    * 🟡 Ámbar (20 a 60 cm): Zona de aproximación / Precaución.
    * 🔴 Rojo parpadeante (< 20 cm): ¡IMPACTO INMINENTE!
  * Indicador de tiempo de eco ($\mu\text{s}$), tensión (5V DC) y frecuencia de ultrasonido (40 kHz).
  * Temperatura real del silicio del ESP32 (`cpu_temp` vía `temperatureRead()`).
* **Selector Flotante de Capas (1 Clic):**
  * 🕶️ **Táctico:** CARTO Dark Matter HD con API Key.
  * 🛰️ **Satélite HD:** Esri World Imagery (resolución fotográfica satelital).
  * 🗺️ **Calles:** OpenStreetMap estándar.
* **HUD Táctico en Popups:** Marcadores de mapa con fondo traslúcido `#121215`, bordes de precisión y tipografía [JetBrains Mono](file:///c:/xampp/htdocs/teleco/frontend/src/index.css).
* **Menú de Inicio / Landing:** Cuadrícula táctica animada `bg-tactical-grid`, enlace directo a descarga de `tracemin.apk` y botón de acceso al simulador HTTPS en el puerto 8443.

---

## 3. Inventario de Archivos Modificados

| Archivo | Ruta Absoluta | Principales Modificaciones |
|---------|---------------|----------------------------|
| **`esp32_tracemin.ino`** | [esp32_tracemin.ino](file:///c:/xampp/htdocs/teleco/firmware/esp32_tracemin/esp32_tracemin.ino) | Parámetro `FORZAR_CONFIG_POR_DEFECTO`, lectura HC-SR04 en GPIO 6 y 7, sensor de temperatura del silicio, lectura del puente inercial celular e ingesta HTTP. |
| **`App.jsx`** | [App.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/App.jsx) | `MultiLineString` track segmentation, filtro de deriva en reposo, botón `🧹 Limpiar Trazo`, selector de capas (Táctico CARTO con API Key, Satélite, Calles), popups HUD oscuros, badge de radar HC-SR04 en barra de flota. |
| **`Simulador.jsx`** | [Simulador.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/Simulador.jsx) | Filtro deadband en reposo con punto ancla, Screen Wake Lock API, Modo Bolsillo OLED (pantalla negra anti-suspensión), horizonte artificial interactivo. |
| **`DetalleVehiculoModal.jsx`** | [DetalleVehiculoModal.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/DetalleVehiculoModal.jsx) | Instrumento gráfico de Radar Sonar HC-SR04 con arcos de proximidad, cálculo de tiempo de eco en $\mu\text{s}$, telemetría térmica de CPU ESP32 y alertas de colisión. |
| **`Historial.jsx`** | [Historial.jsx](file:///c:/xampp/htdocs/teleco/frontend/src/Historial.jsx) | Segmentación de trayectorias históricas en `MultiLineString` para evitar líneas rectas en saltos temporales. |
| **`config.js`** | [config.js](file:///c:/xampp/htdocs/teleco/frontend/src/config.js) | Exportación de constante `CARTO_API_KEY`. |
| **`index.css`** | [index.css](file:///c:/xampp/htdocs/teleco/frontend/src/index.css) | Fuentes Outfit y JetBrains Mono, clases `animate-sonar`, `bg-tactical-grid`, popups MapLibre oscuros y scrollbars finos. |

---

## 4. Procedimientos de Mantenimiento y Comandos Rápidos

### Compilación y Despliegue del Frontend en Docker
```powershell
# 1. Compilar bundle con Vite
cd c:\xampp\htdocs\teleco\frontend
npm run build

# 2. Copiar distribución y APK al contenedor Nginx
docker cp c:\xampp\htdocs\teleco\frontend\dist\. teleco-frontend-1:/usr/share/nginx/html/
docker cp c:\xampp\htdocs\teleco\frontend\public\tracemin.apk teleco-frontend-1:/usr/share/nginx/html/tracemin.apk
```

### Consultar Telemetría en Vivo en Base de Datos
```powershell
docker exec teleco-db-1 psql -U admin -d telemetria -c "SELECT dispositivo_id, ST_AsText(ubicacion), velocidad, pitch, roll, sensores_extra FROM telemetria ORDER BY timestamp DESC LIMIT 5;"
```

### URLs de Acceso del Sistema
* **Dashboard HTTP:** [http://192.168.1.129:8080](http://192.168.1.129:8080)
* **Dashboard HTTPS:** [https://192.168.1.129:8443](https://192.168.1.129:8443)
* **Simulador Web:** [http://192.168.1.129:8080/simulador](http://192.168.1.129:8080/simulador) (o por puerto 8443 para HTTPS)
* **Descarga de App Android (.APK):** [http://192.168.1.129:8080/tracemin.apk](http://192.168.1.129:8080/tracemin.apk)
* **Backend API Fastify:** [http://192.168.1.129:3001](http://192.168.1.129:3001)
