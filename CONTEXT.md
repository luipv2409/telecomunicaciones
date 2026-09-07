# CONTEXTO DEL PROYECTO: TRACE-MIN TELECOM

## 1. Definición del Sistema
TRACE-MIN es un sistema de telemetría en tiempo real diseñado para rastrear vehículos pesados (camiones mineros). Su función principal es capturar coordenadas GNSS y variables físicas (temperatura, vibración, voltaje) desde un nodo móvil, transmitirlas a través de redes celulares intermitentes y visualizarlas en un centro de control web centralizado.

## 2. Arquitectura de Red y Hardware
- **Nodo Móvil:** Microcontrolador ESP32-S3, módulo celular LTE Cat 1 (SIM7600G-H), receptor GNSS, sensores analógicos y digitales.
- **Canal de Transmisión:** MQTT sobre TCP/IP o WebSockets (WSS). Optimización estricta de payload (JSON minificado o binario) debido a cuotas de datos celulares.
- **Infraestructura de Recepción:** Servidor Ubuntu expuesto a internet de forma segura mediante un túnel inverso gratuito (Cloudflare Tunnel / `cloudflared`), resolviendo la ausencia de IP pública y CGNAT.

## 3. Resiliencia Operativa
El sistema debe tolerar caídas de cobertura celular. Los datos no enviados deben retenerse localmente en el nodo móvil (Store and Forward mediante PSRAM/MicroSD) y sincronizarse hacia el servidor una vez que se recupere la conexión, manteniendo la estampa de tiempo (timestamp) original para no corromper el historial de la ruta.