Viewed package.json:1-25
Viewed tsconfig.json:1-14
Listed directory src
Viewed db.ts:1-10
Viewed index.ts:1-27
Viewed package.json:1-23
Viewed vite.config.js:1-19
Listed directory src
Edited db.ts
Created Dockerfile
Created .dockerignore
Searched for "ws"
Created nginx.conf
Created Dockerfile
Created .dockerignore
Created docker-compose.yml

He preparado la configuración completa de Docker para que el sistema sea 100% portable y funcione en cualquier otra computadora sin instalar nada más que Docker.

### Archivos creados y configurados:
1. [backend/Dockerfile](file:///c:/xampp/htdocs/teleco/backend/Dockerfile): Compila TypeScript y ejecuta el servidor Fastify con WebSockets en el contenedor.
2. [backend/src/db.ts](file:///c:/xampp/htdocs/teleco/backend/src/db.ts): Actualizado para conectarse a la base de datos mediante variables de entorno (`DB_HOST`, `DB_PORT`, etc.).
3. [frontend/Dockerfile](file:///c:/xampp/htdocs/teleco/frontend/Dockerfile) y [frontend/nginx.conf](file:///c:/xampp/htdocs/teleco/frontend/nginx.conf): Compila la aplicación React/Vite y la sirve a través de un servidor Nginx ligero que redirige las peticiones de `/api` y `/ws` al backend.
4. [docker-compose.yml](file:///c:/xampp/htdocs/teleco/docker-compose.yml): Orquesta la base de datos (TimescaleDB / PostGIS), el backend y el frontend de forma automática.

---

### Pasos para ejecutar en la otra PC:

1. Instalar **Docker Desktop** (en Windows/Mac) o **Docker + Docker Compose** (en Linux).
2. Copiar o clonar la carpeta del proyecto `teleco/`.
3. Abrir la terminal en la raíz del proyecto y ejecutar:
   ```bash
   docker compose up -d --build
   ```
4. Acceder en el navegador:
   - **Dashboard Web (PC):** `http://localhost:8080`
   - **Simulador / Celular (HTTPS para GPS):** `https://<IP-DE-TU-PC>:8443`
   - **API / WebSockets:** `http://localhost:3000`
   - **PostgreSQL / TimescaleDB:** `localhost:5432`


---

### Credenciales de acceso:
| Usuario | Contraseña | Rol | Acceso |
|---|---|---|---|
| `admin` | `1234` | Administrador | Todos los vehículos y simulador |
| `cliente1` | `1234` | Cliente | Camión-1 |
| `cliente2` | `1234` | Cliente | Camión-2 |
