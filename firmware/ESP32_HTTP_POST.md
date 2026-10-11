# Guía de Implementación ESP32 para Trace-Min Pro

Este documento sirve como registro oficial sobre cómo conectar físicamente un microcontrolador (ESP32) al sistema **Trace-Min Pro** para enviar telemetría de sensores reales y visualizarlos en el mapa en tiempo real.

## Arquitectura de Conexión

1. **Hardware**: Un microcontrolador ESP32 o ESP32-S3 (Dual Core) conectado a internet (vía Wi-Fi local, hotspot celular o túnel permanente).
2. **Protocolo**: HTTP / HTTPS POST en formato JSON con soporte SSL (`WiFiClientSecure` con `setInsecure()`).
3. **Endpoints de Destino**:
   * **Por Internet (Pública Permanente con SSL):** `https://chummy-conductor-wilt.ngrok-free.dev/teleco/api/telemetria`
   * **Local / Tailscale:** `http://<IP_SERVIDOR>:3001/api/telemetria`
   * **Vía Docker Web:** `http://<IP_SERVIDOR>:8080/api/telemetria`

> [!IMPORTANT]
> Al enviar peticiones a través de Ngrok, es obligatorio incluir el encabezado HTTP:  
> `ngrok-skip-browser-warning: true`  
> de lo contrario Ngrok devolverá la página de advertencia HTML en lugar de procesar el JSON en el backend.

---

## Estructura del Payload (JSON)

El sistema espera recibir los datos con las siguientes claves:

```json
{
  "dispositivo_id": "ESP32-Camion-01",
  "latitud": -17.3935,
  "longitud": -66.1570,
  "velocidad": 45.5,
  "rumbo": 120,
  "altitud": 2570,
  "temperatura": 28.5,
  "vibracion": 1.2,
  "voltaje": 3.75,
  "bateria": 85,
  "pitch": 2.1,
  "roll": -1.5,
  "aceleracion_x": 0.1,
  "aceleracion_y": 0.05,
  "aceleracion_z": 9.81
}
```

---

## 🚀 Sketch Oficial Resiliente para Arduino IDE

El sketch completo, probado y listo para compilar se encuentra en:  
📂 **[`firmware/esp32_tracemin/esp32_tracemin.ino`](file:///c:/xampp/htdocs/teleco/firmware/esp32_tracemin/esp32_tracemin.ino)**

### Características Principales:
* **Portal Cautivo DNS Automático:** Si no hay Wi-Fi o se mantiene presionado el botón BOOT por 3s, levanta la red `TRACEMIN-ESP32` (clave: `tracemin123`) y abre `http://192.168.4.1` automáticamente en el celular.
* **Memoria Flash Permanente (NVS):** Almacena credenciales Wi-Fi, URL de servidor y parámetros con `Preferences.h`.
* **Soporte HTTPS con `WiFiClientSecure`:** Se conecta sin problemas a dominios SSL de Ngrok o Cloudflare.
* **Bypass de Pantalla Ngrok:** Incluye automáticamente `ngrok-skip-browser-warning: true`.
* **Hardware Watchdog Timer (WDT):** 20 segundos de timeout para autorecuperación en caso de cuelgues.
* **Reconexión con Backoff Exponencial:** Evita saturar la CPU si el router o túnel se desconectan temporalmente.

### Cómo Subirlo con Arduino IDE:
1. Abre **Arduino IDE 2.x**.
2. Ve a **Archivo** > **Abrir...** y selecciona:
   `c:\xampp\htdocs\teleco\firmware\esp32_tracemin\esp32_tracemin.ino`
3. En **Herramientas** > **Placa**, selecciona **ESP32S3 Dev Module** (o **ESP32 Dev Module** según tu placa).
4. En **Herramientas** > **Administrador de Bibliotecas**, asegúrate de tener instalada la librería **ArduinoJson** (v7.x).
5. Conecta tu ESP32 por USB y selecciona el puerto COM correspondiente.
6. Haz clic en **Subir (Upload)**.
7. Abre el Monitor Serie a **115200 baudios**.

---

## 📱 Configuración Inicial desde el Teléfono
1. Conecta tu teléfono celular a la red Wi-Fi abierta por el ESP32: **`TRACEMIN-ESP32`** (clave: `tracemin123`).
2. Tu teléfono abrirá automáticamente la página de configuración (o abre `http://192.168.4.1`).
3. Toca el botón rápido **🚀 Internet Ngrok** (configurará automáticamente el host a `chummy-conductor-wilt.ngrok-free.dev/teleco`).
4. Selecciona tu red Wi-Fi e ingresa la contraseña.
5. Toca **Guardar y Conectar**. El ESP32 se reiniciará y comenzará a transmitir hacia la nube de inmediato.

