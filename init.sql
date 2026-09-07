CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE telemetria (
    timestamp TIMESTAMPTZ NOT NULL,
    dispositivo_id VARCHAR(50) NOT NULL,
    ubicacion GEOMETRY(Point, 4326) NOT NULL,
    temperatura NUMERIC,
    vibracion NUMERIC,
    voltaje NUMERIC
);

SELECT create_hypertable('telemetria', 'timestamp');

CREATE INDEX idx_telemetria_ubicacion ON telemetria USING GIST (ubicacion);
CREATE INDEX idx_telemetria_tiempo_dispositivo ON telemetria USING BTREE (timestamp, dispositivo_id);
