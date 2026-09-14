CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetria (
    timestamp TIMESTAMPTZ NOT NULL,
    dispositivo_id VARCHAR(50) NOT NULL,
    ubicacion GEOMETRY(Point, 4326) NOT NULL,
    temperatura NUMERIC,
    vibracion NUMERIC,
    voltaje NUMERIC,
    velocidad NUMERIC,
    altitud NUMERIC,
    rumbo NUMERIC,
    bateria NUMERIC,
    pitch NUMERIC,
    roll NUMERIC,
    aceleracion_x NUMERIC,
    aceleracion_y NUMERIC,
    aceleracion_z NUMERIC
);

SELECT create_hypertable('telemetria', 'timestamp', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetria_ubicacion ON telemetria USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_telemetria_tiempo_dispositivo ON telemetria USING BTREE (timestamp, dispositivo_id);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS vehiculos_usuarios (
    dispositivo_id VARCHAR(50) NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id),
    PRIMARY KEY (dispositivo_id, usuario_id)
);

INSERT INTO usuarios (id, username, password_hash, rol) VALUES 
(1, 'admin', '$2b$10$OWdtXcS/9xrznS7ql23hUuXWMnKI9msOkAkIVBo2JdFW1rvHGsvLy', 'admin'),
(2, 'cliente1', '$2b$10$OWdtXcS/9xrznS7ql23hUuXWMnKI9msOkAkIVBo2JdFW1rvHGsvLy', 'cliente'),
(3, 'cliente2', '$2b$10$OWdtXcS/9xrznS7ql23hUuXWMnKI9msOkAkIVBo2JdFW1rvHGsvLy', 'cliente')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vehiculos_usuarios (dispositivo_id, usuario_id) VALUES 
('Camion-1', 2),
('Camion-2', 3)
ON CONFLICT (dispositivo_id, usuario_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS geocercas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    poligono GEOMETRY(Polygon, 4326) NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS alertas (
    id SERIAL PRIMARY KEY,
    dispositivo_id VARCHAR(50) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    mensaje TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    ubicacion GEOMETRY(Point, 4326) NOT NULL,
    leida BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_alertas_dispositivo_tiempo ON alertas (dispositivo_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_geocercas_poligono ON geocercas USING GIST (poligono);
