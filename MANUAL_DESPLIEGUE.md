# 🚛 TRACE-MIN — Manual de Instalación y Despliegue Paso a Paso

Guía completa para poner en funcionamiento el sistema de telemetría y seguimiento satelital **TRACE-MIN** en cualquier máquina (servidor local, PC de desarrollo o entorno de producción).

---

## 📋 Arquitectura del Sistema

```
                        📱 Dispositivos Móviles / APK Android
                       (GPS nativo, Fake GPS, Sensor Hub)
                                        │
                         📡 HTTP POST / WebSocket
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        🖥️ SERVIDOR (Docker Stack)                      │
│                                                                        │
│   🌐 Frontend (Nginx)        ⚙️ Backend (Fastify API)   🗄️ Base de Datos │
│      Puerto: 8080 / 8443         Puerto: 3001          (TimescaleDB)   │
│      Dashboard Web SPA           Telemetría + WS          Puerto: 5432 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Requisitos Previos

Antes de comenzar, asegúrate de tener instalado en la máquina anfitriona:

1. **Docker y Docker Desktop** (o Docker Engine + Docker Compose v2).  
   👉 [Descargar Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. **Git** para clonar el repositorio.  
   👉 [Descargar Git](https://git-scm.com/)
3. *(Opcional)* **Tailscale** si deseas acceder de forma remota y segura a través de Internet sin abrir puertos en tu router.  
   👉 [Descargar Tailscale](https://tailscale.com/)
4. *(Opcional, solo si vas a compilar la APK Android en esa máquina)*:
   * Node.js v20 o superior.
   * Java JDK 21 (LTS).
   * Android Studio o Android Command Line Tools (SDK Platform 37).

---

## 🚀 PASO 1: Clonar el Repositorio

Abre una terminal (PowerShell, CMD o Bash) y ejecuta:

```bash
git clone https://github.com/luipv2409/telecomunicaciones.git
cd telecomunicaciones
```

---

## 🐳 PASO 2: Levantar el Servidor con Docker

TRACE-MIN viene completamente empaquetado en contenedores. Para compilar y levantar los 3 servicios (Base de Datos, Backend y Frontend), ejecuta:

```bash
docker compose up -d --build
```

### ¿Qué hace este comando?
* **`db-1` (TimescaleDB / PostGIS):** Levanta la base de datos en el puerto `5432` y ejecuta automáticamente el script `init.sql` (creando las tablas de telemetría, usuarios, vehículos y geocercas).
* **`backend-1` (Fastify Node.js):** Levanta el motor de telemetría en el puerto `3001` (`0.0.0.0:3001`).
* **`frontend-1` (Nginx + React SPA):** Levanta el panel web en el puerto `8080` (HTTP) y `8443` (HTTPS).

### Verificar que todo esté corriendo:
```bash
docker ps
```
Deberás ver los 3 contenedores con estado `Up` y sus puertos asignados.

---

## 💻 PASO 3: Acceder al Panel de Control Web

Abre tu navegador web favorito e ingresa a:

* **En la misma PC:** [http://localhost:8080](http://localhost:8080)
* **Desde otra PC en la misma red local:** `http://<IP_LOCAL_DE_LA_PC>:8080`
* **Vía Tailscale (cualquier lugar del mundo):** `http://<IP_TAILSCALE>:8080`

### 🔑 Credenciales de Acceso Iniciales:
| Usuario | Contraseña | Rol | Descripción |
|---|---|---|---|
| **`admin`** | `1234` | Administrador | Acceso total a toda la flota, histórico, geocercas y alertas |
| **`cliente1`** | `1234` | Cliente | Acceso filtrado a vehículos asignados |
| **`cliente2`** | `1234` | Cliente | Acceso filtrado a vehículos asignados |

---

## 📱 PASO 4: Conectar la APK de Android (Celular)

### 1. Obtener la IP de la máquina Servidor:
* **Si usas Red Wi-Fi Local:** Abre la terminal en la PC del servidor y ejecuta `ipconfig` (Windows) o `ifconfig` (Linux/Mac) y copia la dirección IPv4 (ej. `192.168.1.50`).
* **Si usas Tailscale:** Abre Tailscale en la PC y copia la IP asignada (ej. `100.96.196.41`).

### 2. Configurar la APK en el Celular:
1. Instala la APK en tu teléfono.
2. Abre la app **TRACE-MIN**.
3. En la esquina superior derecha, toca el botón **⚙️ Servidor**.
4. Configura los parámetros:
   * **Protocolo:** `HTTP (Red Local / Tailscale)`
   * **Dirección IP o Host:** La IP de tu servidor (ej. `100.96.196.41` o `192.168.1.50`).
   * **Puerto:** `3001` *(o `8080`)*.
5. Toca **📡 Probar Conexión**. Debe responder: **`✅ Conexión exitosa con el servidor TRACE-MIN`**.
6. Toca **Guardar y Aplicar**.

---

## 📡 PASO 5: Probar Transmisión de Sensores en Vivo

### Desde la APK Android (GPS Físico o Fake GPS):
1. En la pantalla principal de la APK, toca **"📡 Transmisión de Sensores"**.
2. Ingresa un identificador para tu vehículo (ej. `camion-01`).
3. Toca **"Iniciar Transmisión"**.
4. Verás en pantalla las coordenadas GPS y el contador de paquetes transmitidos (`📦 Paquetes transmitidos: 1, 2, 3...`) subiendo cada segundo.
5. En el panel Web de tu PC verás aparecer el vehículo en el mapa y desplazarse en tiempo real.

---

## 🔨 PASO 6: Cómo Recompilar la APK (Opcional para Desarrolladores)

Si realizas cambios en el código del frontend y deseas generar un nuevo archivo `.apk`:

```powershell
# 1. Ir a la carpeta del frontend
cd frontend

# 2. Instalar dependencias si es la primera vez
npm install

# 3. Compilar el frontend web
npm run build

# 4. Sincronizar activos con el proyecto nativo Android
npx cap sync android

# 5. Compilar la APK con Gradle
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
cd android
.\gradlew.bat assembleDebug
```

La APK recién generada se ubicará en:
`frontend/android/app/build/outputs/apk/debug/app-debug.apk`

---

## ❓ Solución de Problemas Frecuentes (FAQ)

### 1. Error de puerto ocupado (Port already allocated)
Si al ejecutar `docker compose up` recibes un error indicando que el puerto `3001`, `8080` o `5432` ya está en uso por otro programa:
* Edita el archivo `docker-compose.yml`.
* Cambia el puerto izquierdo del servicio conflictivo (ejemplo: cambiar `"3001:3000"` por `"3005:3000"`).
* Ajusta el puerto en el modal de configuración de la APK.

### 2. La APK dice "Tiempo de espera agotado (Timeout 6s)"
* Verifica que el celular y la PC estén en la misma red Wi-Fi o ambos tengan **Tailscale activo y conectado**.
* En Windows, asegúrate de que el Firewall permita conexiones entrantes a Docker Desktop.

### 3. La Web no actualiza los camiones en tiempo real
* Asegúrate de acceder por `http://localhost:8080` (o `http://<IP>:8080`).
* Verifica que el WebSocket esté conectado (en la consola del navegador `F12` no deben haber errores de conexión en `/ws`).

---

## 🛑 Detener o Reiniciar el Servidor

```bash
# Detener los contenedores
docker compose down

# Reiniciar y recompilar tras cambios
docker compose up -d --build

# Ver logs en vivo del backend
docker compose logs -f backend
```
