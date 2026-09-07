# HABILIDAD: INGENIERÍA DE FIRMWARE ESP32-S3

## 1. Stack Tecnológico
- Lenguaje: C++
- Framework: ESP-IDF encapsulado en PlatformIO.
- Sistema Operativo en Tiempo Real: FreeRTOS.

## 2. Patrones de Diseño Obligatorios
- **Multithreading (Dual Core):** Asignar la adquisición de sensores (ADC, UART GNSS a 9600 baudios) al Core 0. Asignar el manejo de la pila de red (Comandos AT UART SIM7600G-H, MQTT, TLS) al Core 1.
- **Gestión de Energía:** Prevenir caídas de tensión (brownout) manejando los picos de corriente de 2.5A del módulo LTE aislando los tiempos de transmisión.
- **Calibración ADC:** Implementar sobremuestreo (oversampling) para mitigar el ruido térmico en los pines analógicos del ESP32-S3.

## 3. Restricciones de Generación de Código
- ESTRICTAMENTE PROHIBIDO incluir explicaciones, anotaciones o comentarios de ningún tipo dentro del código fuente generado. Solo produce código limpio y funcional.