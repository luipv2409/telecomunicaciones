# Guía de Implementación ESP32 para Trace-Min Pro

Este documento sirve como registro oficial sobre cómo conectar físicamente un microcontrolador (ESP32) al sistema **Trace-Min Pro** para enviar telemetría de sensores reales y visualizarlos en el mapa en tiempo real.

## Arquitectura de Conexión

1. **Hardware**: Un ESP32 conectado a internet (vía WiFi local o módulo GSM) + un módulo GPS (ej. NEO-6M) + un acelerómetro/giroscopio (ej. MPU6050).
2. **Protocolo**: HTTP POST en formato JSON.
3. **Endpoint**: `http://<IP_DEL_SERVIDOR>:3000/api/telemetria`

## Estructura del Payload (JSON)

El sistema espera recibir los datos con las siguientes claves. No es obligatorio enviarlos todos, puedes empezar enviando solo las coordenadas y la velocidad.

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

## Código Base C++ (Arduino IDE)

A continuación, el código esqueleto para flashear en el ESP32. Este código se conecta al WiFi y envía datos simulados cada 5 segundos al servidor. 

Deberás reemplazar los datos simulados leyendo los sensores reales (vía Serial para el GPS y vía I2C para el MPU6050).

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

// Configuración de tu red WiFi
const char* ssid = "TU_RED_WIFI";
const char* password = "TU_PASSWORD";

// Dirección IP del servidor donde corre Trace-Min (El backend por el puerto 3000)
// Ejemplo: "http://192.168.1.100:3000/api/telemetria"
const String serverName = "http://192.168.X.X:3000/api/telemetria";

void setup() {
  Serial.begin(115200);
  
  WiFi.begin(ssid, password);
  Serial.println("Conectando al WiFi...");
  
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nConectado a la red WiFi");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if(WiFi.status() == WL_CONNECTED){
    HTTPClient http;
    
    // Iniciar conexión al backend
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");
    
    // ---------------------------------------------------------
    // AQUÍ DEBES LEER TUS SENSORES (TinyGPS++, Adafruit_MPU6050, etc)
    // ---------------------------------------------------------
    
    // Payload JSON de ejemplo (simulando lectura de sensores)
    String httpRequestData = "{"
      "\"dispositivo_id\":\"ESP32-Real-01\","
      "\"latitud\":-17.3935,"
      "\"longitud\":-66.1570,"
      "\"velocidad\":65.2,"
      "\"rumbo\":90,"
      "\"temperatura\":26.5,"
      "\"bateria\":95"
    "}";
    
    // Enviar el POST
    int httpResponseCode = http.POST(httpRequestData);
    
    if (httpResponseCode > 0) {
      Serial.print("Código HTTP de Respuesta: ");
      Serial.println(httpResponseCode);
      String payload = http.getString();
      Serial.println(payload); // Debería imprimir {"estado":"ok"}
    }
    else {
      Serial.print("Error en la petición: ");
      Serial.println(httpResponseCode);
    }
    
    // Liberar recursos
    http.end();
  }
  else {
    Serial.println("Desconectado de WiFi");
  }
  
  // Enviar datos cada 5 segundos (Ajusta según tu necesidad de rastreo)
  delay(5000);
}
```

## Próximos pasos
1. Descarga el **Arduino IDE**.
2. Instala el gestor de tarjetas para el ESP32.
3. Adapta el código usando librerías como `TinyGPS++` para el GPS (SoftwareSerial) y `Adafruit MPU6050` para el acelerómetro/giroscopio.
4. Asegúrate de que el servidor (`192.168.x.x`) y el ESP32 estén conectados en la misma red LAN para que el POST llegue sin problemas.
