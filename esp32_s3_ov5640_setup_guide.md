# Guía Técnica de Configuración: ESP32-S3 N16R8 + Cámara OV5640 (5MP)

Este documento contiene todos los parámetros de hardware, configuración de software en Arduino IDE, mapeo de pines y pruebas funcionales validadas para la placa **ESP32-S3 N16R8** con sensor de cámara **OV5640**. Sirve como referencia técnica integral para cualquier agente o desarrollador que necesite replicar el entorno funcional.

---

## 1. Especificaciones de Hardware

- **SoC:** Espressif ESP32-S3 (Dual-core Xtensa LX7 a 240 MHz).
- **Memoria Flash:** 16 MB SPI Flash.
- **Memoria PSRAM:** 8 MB Octal SPI (OPI) PSRAM.
- **Sensor de imagen:** Omnivision OV5640 (5 Megapíxeles, soporta resoluciones de hasta 2560x1920 QSXGA).
- **Interfaz de comunicación:** Puerto USB-UART (Chip conversor serie a USB) / Puerto USB Nativo CDC.

---

## 2. Configuración en Arduino IDE

Para que la placa compile y no sufra desbordamientos de memoria (*out of memory*) al cargar imágenes de 5 MP en el buffer, es **mandatorio** usar la configuración exacta bajo el menú `Tools` (Herramientas):

| Parámetro en Arduino IDE | Valor Seleccionado | Motivo Técnico |
| :--- | :--- | :--- |
| **Board (Placa)** | `ESP32S3 Dev Module` | Perfil base compatible con variantes S3 genéricas. |
| **PSRAM** | `OPI PSRAM` | **Crítico.** Habilita el direccionamiento de los 8 MB de memoria RAM extendida octal necesarios para alojar buffers QSXGA/JPEG. |
| **Flash Size** | `16MB (128Mb)` | Corresponde al tamaño del chip N16. |
| **Partition Scheme** | `16M Flash (3MB APP/9.9MB FATFS)` o `Huge APP (3MB No OTA)` | Evita que el firmware supere el espacio de la partición de aplicación. |
| **Upload Speed** | `921600` (o `115200` si hay ruido) | Velocidad de flasheo serie. |
| **USB CDC On Boot** | `Disabled` (si se usa el puerto UART) / `Enabled` (si se usa puerto nativo) | Determina por dónde sale el monitor serie. |
| **Flash Mode** | `QIO 80MHz` / `OPI` | Depende de la variante específica de la placa. |

---

## 3. Mapeo de Pines (Pinout) para ESP32-S3 CAM

El sensor OV5640 se comunica mediante DVP (Digital Video Port) paralelo y SCCB (I2C compatible). La asignación de pines validada para placas ESP32-S3 CAM genéricas es:

```cpp
// Control de energía y reloj
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define PCLK_GPIO_NUM     13
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7

// Bus I2C / SCCB
#define SIOD_GPIO_NUM      4  // SDA
#define SIOC_GPIO_NUM      5  // SCL

// Bus de datos paralelo de 8 bits (D0 - D7)
#define Y2_GPIO_NUM       11  // D0
#define Y3_GPIO_NUM        9  // D1
#define Y4_GPIO_NUM        8  // D2
#define Y5_GPIO_NUM       10  // D3
#define Y6_GPIO_NUM       12  // D4
#define Y7_GPIO_NUM       18  // D5
#define Y8_GPIO_NUM       17  // D6
#define Y9_GPIO_NUM       16  // D7
```

---

## 4. Código Validado de Diagnóstico de Captura (5MP)

Este script fue probado exitosamente. Verifica la PSRAM disponible, inicializa el sensor OV5640 a máxima resolución (2560x1920) y captura un fotograma en memoria:

```cpp
#include "esp_camera.h"

// Mapeo de pines
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5

#define Y9_GPIO_NUM       16
#define Y8_GPIO_NUM       17
#define Y7_GPIO_NUM       18
#define Y6_GPIO_NUM       12
#define Y5_GPIO_NUM       10
#define Y4_GPIO_NUM        8
#define Y3_GPIO_NUM        9
#define Y2_GPIO_NUM       11
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n--- TEST HARDWARE: ESP32-S3 + OV5640 ---");

  // 1. Verificación de PSRAM
  if (!psramFound()) {
    Serial.println("[ERROR CRÍTICO] PSRAM no detectada. Verifique Tools > PSRAM > OPI PSRAM.");
    while (true);
  }
  Serial.printf("[OK] PSRAM detectada. Libre: %d MB\n", ESP.getFreePsram() / (1024 * 1024));

  // 2. Configuración de parámetros de cámara
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Resolución 5MP QSXGA (2560x1920)
  config.frame_size = FRAMESIZE_QSXGA;
  config.jpeg_quality = 12; // Rango 0-63 (menor número = mayor calidad)
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  // 3. Inicialización del controlador
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Fallo al iniciar la cámara (código: 0x%x)\n", err);
    return;
  }
  Serial.println("[OK] Sensor OV5640 reconocido e inicializado.");

  // 4. Captura de prueba
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[ERROR] No se pudo obtener el frame buffer.");
  } else {
    Serial.printf("[ÉXITO] Fotograma capturado: %d x %d px | Tamaño: %d bytes\n", 
                  fb->width, fb->height, fb->len);
    esp_camera_fb_return(fb); // Liberar memoria
  }
}

void loop() {
  delay(10000);
}
```

---

## 5. Salida Exitosa Esperada en el Monitor Serie (115200 baudios)

```text
--- TEST HARDWARE: ESP32-S3 + OV5640 ---
[OK] PSRAM detectada. Libre: 7 MB
[OK] Sensor OV5640 reconocido e inicializado.
[ÉXITO] Fotograma capturado: 2560 x 1920 px | Tamaño: 142850 bytes
```

---

## 6. Errores Comunes Identificados y Soluciones

1. **`stray '#' in program` / `stray '`' in program`:**
   - **Causa:** Copiar texto explicativo o formato Markdown directamente en el editor `.ino` de Arduino IDE.
   - **Solución:** Borrar por completo el archivo (`Ctrl + A` y `Supr`) y pegar exclusivamente código C++ limpio.

2. **`Camera init failed with error 0x20001` / `0x20002`:**
   - **Causa:** Pines SCCB (SDA/SCL) o bus DVP mal asignados, o cable flex de la cámara flojo.
   - **Solución:** Revisar inserción del conector flex FPC (contactos hacia la placa) y confirmar pines 4 y 5.

3. **`Out of memory` / Fallo al asignar frame buffer:**
   - **Causa:** `PSRAM` deshabilitada o en modo Quad en vez de Octal.
   - **Solución:** Comprobar en `Tools` > `PSRAM` > `OPI PSRAM`. Sin OPI PSRAM, los buffers de 5 MP superan los 512 KB de SRAM interna y colapsan el microcontrolador.

4. **Puerto COM "Unknown" o no seleccionado:**
   - **Causa:** Windows asigna puertos COM genéricos (por ejemplo `COM4`), pero el IDE no lo selecciona automáticamente.
   - **Solución:** Seleccionar explícitamente el puerto en `Tools` > `Port` correspondiente al chip UART.