# GUÍA MAESTRA DE DESPLIEGUE, TÚNELES Y ACCESO A INTERNET
## Arquitectura Multi-Sistema, Enrutador NGINX Central y Protocolo de Aislamiento para Agentes de IA

> [!IMPORTANT]
> **AVISO CRÍTICO PARA AGENTES DE IA Y DESARROLLADORES:**  
> En esta máquina operan **múltiples sistemas en producción simultánea** (Punata Vacunas en `/`, Ventas IA en `/ventas/`, TRACE-MIN en `/teleco/`).  
> Todos los sistemas comparten una **única URL fija permanente de Ngrok** gracias a un **Enrutador Inverso NGINX centralizado**.  
> Sigue estas reglas al pie de la letra para agregar un **Cuarto (o N-ésimo) Sistema** sin romper los sistemas existentes, sin causar colisiones de puertos y sin dejar contenedores innecesarios o huérfanos.

### 📋 Prompt Listo para Copiar y Pegar al Siguiente Agente de IA
Si vas a encargar la creación o integración de otro sistema a un nuevo agente, copia y dale este prompt:

```text
Por favor lee el archivo MANUAL_EXPONER_SISTEMAS_INTERNET.md.
En esta máquina ya operan 3 sistemas en producción simultánea que comparten la URL pública permanente https://chummy-conductor-wilt.ngrok-free.dev mediante un enrutador NGINX central.
REGLAS OBLIGATORIAS:
1. NO modifiques ni apagues contenedores existentes de otros proyectos (punata-*, ventas_ia_*, teleco_*).
2. NO uses puertos ocupados en el host (80, 443, 3000, 3001, 3306, 3307, 5432, 8000, 8080, 8082, 8085, 8096, 8443). Usa un puerto libre verificado (ej. 8090, 9000, 9090).
3. NO abras túneles redundantes (nada de contenedores cloudflared o ngrok extras).
4. Configura el frontend de tu sistema con rutas relativas (base: './').
5. Agrega tu sub-ruta (ej. /sistema4/) en C:\xampp\htdocs\ingenieria-control\nginx\nginx.conf y recarga con:
   docker exec punata-vacuna-segura-router-1 nginx -t
   docker exec punata-vacuna-segura-router-1 nginx -s reload
6. OBLIGATORIO: Una vez terminado el despliegue, actualiza este manual (MANUAL_EXPONER_SISTEMAS_INTERNET.md) agregando tu sistema, los puertos host que ocupaste y tu sub-ruta a la tabla del Punto 2, para que futuros agentes sepan que ya están en uso.
```

---

## 1. Inventario de Credenciales y Recursos Activos

| Recurso | Identificador / Dominio | Detalle / Uso |
|---|---|---|
| **URL Pública Fija Maestra** | `https://chummy-conductor-wilt.ngrok-free.dev` | Dominio permanente con SSL asignado a Ngrok. **NUNCA CAMBIA**. |
| **Ngrok Authtoken** | `3KY6nIMyFfARCLHWswtRyticcYE_nWdR3BtW4ArFtFToaA55` | Token activo en el contenedor `punata-vacuna-segura-ngrok-1`. |
| **Enrutador Central (Router)** | Contenedor `punata-vacuna-segura-router-1` (NGINX Alpine) | Distribuye el tráfico entrante de Ngrok según la sub-ruta solicitada. |
| **Cloudflare Zero Trust** | ID: `6b985376-e04c-4fc1-b277-459bd46c38d1` | Túnel alternativo de respaldo con token corporativo. |
| **Cloudflare Quick Tunnels** | `*.trycloudflare.com` | **Solo para pruebas efímeras aisladas**. No dejar encendido si ya se usa el router central. |

---

## 2. Mapa Completo de Puertos Ocupados en el Host (AUDITORÍA COMPLETA)

Antes de levantar cualquier nuevo servicio, verifica este mapa de puertos. **ESTÁ ESTRICTAMENTE PROHIBIDO usar puertos ya mapeados:**

| Servicio / Proyecto | Proceso / Origen | Puerto Host Mapeado | Sub-ruta en Ngrok | Estado |
|---|---|:---:|:---:|---|
| **XAMPP Apache (Web Host)** | Host (`httpd.exe`) | `0.0.0.0:80` | - | **OCUPADO (HOST)** |
| **XAMPP Apache SSL / Tailscale** | Host (`httpd.exe` / `tailscaled`) | `0.0.0.0:443` | - | **OCUPADO (HOST)** |
| **XAMPP MySQL / MariaDB** | Host (`mysqld.exe`) | `[::]:3306` | - | **OCUPADO (HOST)** |
| **Jellyfin Media Server** | Host (`jellyfin.exe`) | `0.0.0.0:8096` | - | **OCUPADO (HOST)** |
| **Sistema 1: Punata Vacuna Segura** | Docker (`punata-web`) | `0.0.0.0:8000` | `/` (Raíz) | **OCUPADO (PRODUCCIÓN)** |
| **Enrutador NGINX Central** | Docker (`punata-router`) | *Red interna Docker* | Recibe Ngrok | **ACTIVO (CRÍTICO)** |
| **Túnel Ngrok (punata-ngrok)** | Docker (`punata-ngrok`) | `4040` interno | Expone Router | **ACTIVO (CRÍTICO)** |
| **Sistema 2: Ventas IA (Web)** | Docker (`ventas_ia_app`) | `0.0.0.0:8085` | `/ventas/` | **OCUPADO (PRODUCCIÓN)** |
| **Sistema 2: Ventas IA (MariaDB)** | Docker (`ventas_ia_db`) | `0.0.0.0:3307` | - | **OCUPADO (PRODUCCIÓN)** |
| **Sistema 2: phpMyAdmin (Ventas IA)** | Docker (`ventas_ia_pma`) | `0.0.0.0:8082` | - | **OCUPADO (HERRAMIENTA)** |
| **Sistema 3: Teleco TRACE-MIN (Web)** | Docker (`teleco-frontend-1`) | `0.0.0.0:8080` / `8443` | `/teleco/` | **ACTIVO (PRODUCCIÓN)** |
| **Sistema 3: Teleco Backend (API Fastify)** | Docker (`teleco-backend-1`) | `0.0.0.0:3001` | `/teleco/api/` | **ACTIVO (PRODUCCIÓN)** |
| **Sistema 3: Teleco TimescaleDB** | Docker (`teleco-db-1`) | `0.0.0.0:5432` | - | **OCUPADO (PRODUCCIÓN)** |
| **Consultorio Backend** | Docker (`consultorio_backend`) | `0.0.0.0:3000` | - | **OCUPADO** |

### ⛔ Puertos Estrictamente Prohibidos (NO TOCAR):
* **Servidores Web / HTTP / HTTPS:** `80`, `443`, `8000`, `8080`, `8082`, `8085`, `8096`, `8443`.
* **Servicios Backend / APIs Node.js:** `3000`, `3001`.
* **Bases de Datos:** `3306`, `3307`, `5432`.

### 🟢 Puertos Libres Verificados para Nuevos Sistemas:
* **Para Servicio Web / Backend:** `5000`, `8090`, `8092`, `9000`, `9090`, `9500`.
* **Para Base de Datos (si requiere exponer puerto al host):** `3308`, `3309`, `5433`, `5434`.

---

## 3. Arquitectura del Enrutador NGINX Central (Multi-Tenant)

El tráfico entra por la única URL pública fija y el NGINX Router lo redirige transparentemente al sistema correspondiente:

```text
                                  ┌───> [ / ]            ───> Sistema 1: Punata Vacunas (web:8000)
                                  │
[ https://chummy-...ngrok-free.dev ] ───> NGINX Router ───┼───> [ /ventas/ ]     ───> Sistema 2: Ventas IA (host:8085)
                                  │
                                  └───> [ /teleco/ ]     ───> Sistema 3: TRACE-MIN Teleco (host:8080 + WS)
```

---

## 4. Protocolo Paso a Paso: Incorporar un Cuarto (o N-ésimo) Sistema

Sigue estos 5 pasos exactos para integrar cualquier nuevo sistema sin alterar los sistemas existentes:

### Paso 1: Configurar el `docker-compose.yml` del Nuevo Sistema
Elige un puerto host libre (por ejemplo `8090`) y **asigna prefijos únicos a todos los contenedores y volúmenes**:

```yaml
services:
  app:
    build: .
    container_name: sistema4_app        # <-- Nombre único, evita 'app' genérico
    restart: unless-stopped
    ports:
      - "8090:80"                      # <-- Puerto libre en el host (ej. 8090, 8095, 9000)
    networks:
      - red_sistema4

  db:
    image: postgres:15-alpine
    container_name: sistema4_db         # <-- Nombre único
    restart: unless-stopped
    ports:
      - "5433:5432"                    # <-- Puerto libre (evita 5432, 3306 y 3307)
    volumes:
      - sistema4_data:/var/lib/postgresql/data
    networks:
      - red_sistema4

volumes:
  sistema4_data:                       # <-- Volumen con prefijo propio

networks:
  red_sistema4:
    driver: bridge
```

Levanta el nuevo sistema en su propio directorio:
```powershell
docker compose up -d
```
Verifica que responda localmente en el puerto elegido:
```powershell
curl.exe -I http://localhost:8090
```

---

### Paso 2: Registrar el Nuevo Sistema en el NGINX Router Central
En el archivo de configuración del router (`C:\xampp\htdocs\ingenieria-control\nginx\nginx.conf`), agrega la redirección limpia y el bloque `location` correspondiente:

```nginx
events { 
    worker_connections 1024; 
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    server {
        listen 80;
        server_name chummy-conductor-wilt.ngrok-free.dev localhost;

        # 1. Sistema 2: Ventas IA (en puerto 8085 del host)
        location = /ventas { return 301 https://$host/ventas/; }
        location /ventas/ {
            proxy_pass http://host.docker.internal:8085/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_redirect http://host.docker.internal:8085/ /ventas/;
            proxy_redirect / /ventas/;
            proxy_cookie_path / /ventas/;
        }

        # 2. Sistema 3: TRACE-MIN Teleco (en puerto 8080 del host con WebSockets)
        location = /teleco { return 301 https://$host/teleco/; }
        location /teleco/ {
            proxy_pass http://host.docker.internal:8080/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_redirect http://host.docker.internal:8080/ /teleco/;
            proxy_redirect / /teleco/;
            proxy_cookie_path / /teleco/;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # 3. Sistema 4: NUEVO SISTEMA (en puerto 8090 del host)
        location = /sistema4 { return 301 https://$host/sistema4/; }
        location /sistema4/ {
            proxy_pass http://host.docker.internal:8090/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_redirect http://host.docker.internal:8090/ /sistema4/;
            proxy_redirect / /sistema4/;
            proxy_cookie_path / /sistema4/;
        }

        # 4. Sistema 1: Punata Vacuna Segura (Django en contenedor web:8000)
        location / {
            proxy_pass http://web:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }
    }
}
```

> [!NOTE]
> La barra final `/` en `proxy_pass http://host.docker.internal:8090/;` es crucial: indica a NGINX que debe remover el prefijo `/sistema4/` antes de reenviar la petición interna al contenedor si la aplicación fue escrita para la raíz.

---

### Paso 3: Probar Sintaxis y Recargar NGINX en Caliente (Zero Downtime)
**NO reinicies todo Docker ni detengas los otros sistemas**. Ejecuta:

```powershell
docker exec punata-vacuna-segura-router-1 nginx -t
docker exec punata-vacuna-segura-router-1 nginx -s reload
```

---

### Paso 4: Validar Acceso por Internet
Prueba la respuesta directamente desde la URL pública permanente:
```powershell
curl.exe -I -H "ngrok-skip-browser-warning: true" https://chummy-conductor-wilt.ngrok-free.dev/sistema4/
```
Debe devolver `HTTP/1.1 200 OK` (o redirección válida).

---

### Paso 5: Actualizar este Manual con los Nuevos Puertos en Uso (OBLIGATORIO)
Una vez que el nuevo sistema responda correctamente, **debes documentarlo en este mismo archivo** para proteger tus puertos:
1. Abre `MANUAL_EXPONER_SISTEMAS_INTERNET.md`.
2. Dirígete a la tabla del **Punto 2: Mapa Completo de Puertos Ocupados en el Host**.
3. Añade la fila de tu nuevo sistema indicando:
   * Nombre del proyecto / servicio.
   * Proceso o nombre del contenedor Docker.
   * Puerto host que reservaste (ej. `0.0.0.0:8090`).
   * Sub-ruta en Ngrok (ej. `/sistema4/`).
   * Estado: `ACTIVO (PRODUCCIÓN)`.
4. Añade tus puertos a la lista de **Puertos Estrictamente Prohibidos** y elimínalos de la lista de recomendados.
*Esto garantiza que la cadena de conocimiento no se rompa y el siguiente agente no sobreescriba tus puertos.*

---

## 5. Política de Higiene: Cero Contenedores Innecesarios o Huérfanos

Para mantener la estabilidad y los recursos de la máquina:

### Reglas de Eliminación Segura:
1. **NO dejar túneles redundantes abiertos:**  
   Si un sistema fue integrado al Router NGINX central, **no debe tener contenedores de túneles adicionales** (como `cloudflared` efímero o un segundo `ngrok`).  
   Detenlos y bórralos inmediatamente:
   ```powershell
   docker stop <nombre_contenedor_tunel>
   docker rm <nombre_contenedor_tunel>
   ```
2. **Eliminar el servicio en `docker-compose.yml`:**  
   Retira el bloque `tunnel:` o `cloudflared:` del archivo compose del proyecto para evitar que vuelva a levantarse por accidente en el próximo `docker compose up`.
3. **⛔ PROHIBICIÓN ABSOLUTA DE PRUNE GENERAL:**  
   **NUNCA ejecutes:**
   - ❌ `docker system prune`
   - ❌ `docker system prune -a`
   - ❌ `docker volume prune`  
   *Ejecutar estos comandos destruiría las bases de datos y volúmenes de los sistemas Punata, Ventas IA y Teleco.*
4. **Limpieza quirúrgica de imágenes huérfanas:**  
   Si requieres liberar espacio tras un build fallido, usa únicamente:
   ```powershell
   docker image prune --filter "dangling=true"
   ```
   *(Este comando solo borra capas temporales sin nombre y no toca contenedores ni volúmenes).*

---

## 6. Variables de Entorno y Rutas en Aplicaciones Detrás de Sub-rutas

Cuando un sistema corre detrás de una sub-ruta (como `/ventas/` o `/sistema3/`), asegúrate de que el frontend y el backend manejen rutas relativas:

* **HTML / CSS / JS:**  
  Usa rutas relativas (`assets/css/estilo.css` en lugar de `/assets/css/estilo.css`) o etiqueta `<base href="/sistema3/">`.
* **Frameworks (Django / Laravel / FastAPI):**
  - Configura `FORCE_SCRIPT_NAME = '/sistema3'` o `root_path = "/sistema3"`.
  - En Django `settings.py`:
    ```python
    ALLOWED_HOSTS = ['*', 'localhost', '127.0.0.1', '.ngrok-free.dev']
    CSRF_TRUSTED_ORIGINS = ['https://*.ngrok-free.dev']
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    USE_X_FORWARDED_HOST = True
    ```
* **Evitar la pantalla de bienvenida de Ngrok en llamadas API / microcontroladores:**  
  Envía siempre el encabezado HTTP:
  ```http
  ngrok-skip-browser-warning: true
  ```

---

## 7. Resumen de Comandos Rápidos para Agentes

| Acción | Comando PowerShell Exacto |
|---|---|
| **Ver todos los contenedores y puertos activos** | `docker ps` |
| **Probar respuesta local de un puerto** | `curl.exe -I http://localhost:<puerto>` |
| **Recargar NGINX Router sin downtime** | `docker exec punata-vacuna-segura-router-1 nginx -s reload` |
| **Probar URL pública del nuevo sistema** | `curl.exe -I https://chummy-conductor-wilt.ngrok-free.dev/<sub-ruta>/` |
| **Apagar contenedor innecesario de forma segura** | `docker stop <nombre_contenedor> ; docker rm <nombre_contenedor>` |
| **Ver logs del router NGINX si hay error 502** | `docker logs --tail=30 punata-vacuna-segura-router-1` |
