import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import '@fastify/jwt';
import { db } from './db';
import bcrypt from 'bcryptjs';

const MAX_DISPOSITIVOS_DIARIOS = 10;
const dispositivosActivos = new Set<string>();

export const rutasHistorico: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  fastify.post('/api/login', async (request, reply) => {
    const { username, password } = request.body as any;

    const result = await db.query('SELECT * FROM usuarios WHERE username = $1', [username]);
    const usuario = result.rows[0];

    if (!usuario) {
      return reply.status(401).send({ error: 'Usuario no encontrado' });
    }

    const match = await bcrypt.compare(password, usuario.password_hash);
    if (!match) {
      return reply.status(401).send({ error: 'Contraseña incorrecta' });
    }

    const token = fastify.jwt.sign({ 
      id: usuario.id, 
      username: usuario.username, 
      rol: usuario.rol 
    });

    return { token, rol: usuario.rol, username: usuario.username };
  });

  fastify.get('/api/flota/hoy', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    
    const user = request.user as any;
    
    let query = `
      SELECT 
        dispositivo_id,
        timestamp,
        ST_X(ubicacion::geometry) as lo,
        ST_Y(ubicacion::geometry) as la,
        temperatura,
        vibracion,
        voltaje,
        velocidad,
        altitud,
        rumbo,
        bateria,
        pitch,
        roll,
        aceleracion_x,
        aceleracion_y,
        aceleracion_z
      FROM telemetria
      WHERE timestamp >= (NOW() - INTERVAL '24 HOURS')
    `;
    const params: any[] = [];

    if (user.rol !== 'admin') {
      query += ` AND dispositivo_id IN (SELECT dispositivo_id FROM vehiculos_usuarios WHERE usuario_id = $1)`;
      params.push(user.id);
    }
    
    query += ` ORDER BY timestamp ASC`;

    try {
      const result = await db.query(query, params);
      return result.rows;
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error en base de datos' });
    }
  });

  fastify.get('/api/flota/dispositivos', async (request, reply) => {
    try {
      const result = await db.query('SELECT DISTINCT dispositivo_id FROM telemetria ORDER BY dispositivo_id');
      return result.rows.map((row: any) => row.dispositivo_id);
    } catch(err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error BD' });
    }
  });

  fastify.get('/api/flota/historial', async (request, reply) => {
    const { dispositivo_id, inicio, fin } = request.query as any;
    if (!dispositivo_id || !inicio || !fin) {
      return reply.status(400).send({ error: 'Faltan parámetros' });
    }
    const query = `
      SELECT 
        timestamp,
        ST_X(ubicacion::geometry) as lo,
        ST_Y(ubicacion::geometry) as la,
        velocidad, rumbo, bateria
      FROM telemetria
      WHERE dispositivo_id = $1 AND timestamp >= $2 AND timestamp <= $3
      ORDER BY timestamp ASC
    `;
    try {
      const result = await db.query(query, [dispositivo_id, inicio, fin]);
      return result.rows;
    } catch(err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error BD' });
    }
  });

  fastify.get('/api/flota/kpis', async (request, reply) => {
    try {
      const query = `
        SELECT 
          dispositivo_id,
          MAX(velocidad) as vel_max,
          AVG(velocidad) as vel_promedio,
          COUNT(*) as puntos_registrados
        FROM telemetria
        WHERE timestamp >= (NOW() - INTERVAL '24 HOURS')
        GROUP BY dispositivo_id
      `;
      const result = await db.query(query);
      return result.rows;
    } catch(err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error BD' });
    }
  });

  fastify.get('/api/geocercas', async (request, reply) => {
    try {
      const result = await db.query('SELECT id, nombre, ST_AsGeoJSON(poligono)::json as poligono FROM geocercas');
      return result.rows;
    } catch(err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error BD' });
    }
  });

  fastify.post('/api/geocercas', async (request, reply) => {
    const { nombre, poligono } = request.body as any;
    try {
      const query = `
        INSERT INTO geocercas (nombre, poligono)
        VALUES ($1, ST_GeomFromGeoJSON($2)) RETURNING id
      `;
      const result = await db.query(query, [nombre, JSON.stringify(poligono)]);
      return { id: result.rows[0].id, estado: 'ok' };
    } catch(err) {
      console.error(err);
      return reply.status(500).send({ error: 'Error BD' });
    }
  });

  fastify.post('/api/telemetria', async (request, reply) => {
    try {
      const { 
        timestamp, 
        dispositivo_id, 
        latitud, 
        longitud, 
        temperatura, 
        vibracion, 
        voltaje,
        velocidad,
        altitud,
        rumbo,
        bateria,
        pitch,
        roll,
        aceleracion_x,
        aceleracion_y,
        aceleracion_z
      } = request.body as any;

      if (!dispositivosActivos.has(dispositivo_id)) {
        if (dispositivosActivos.size >= MAX_DISPOSITIVOS_DIARIOS) {
          return reply.status(429).send({ error: 'Límite de vehículos alcanzado en este servidor.' });
        }
        dispositivosActivos.add(dispositivo_id);
      }

      const query = `
        INSERT INTO telemetria (
          timestamp, 
          dispositivo_id, 
          ubicacion, 
          temperatura, 
          vibracion, 
          voltaje,
          velocidad,
          altitud,
          rumbo,
          bateria,
          pitch,
          roll,
          aceleracion_x,
          aceleracion_y,
          aceleracion_z
        )
        VALUES (
          $1, 
          $2, 
          ST_SetSRID(ST_MakePoint($3, $4), 4326), 
          $5, 
          $6, 
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16
        )
      `;
      
      await db.query(query, [
        timestamp || new Date().toISOString(),
        dispositivo_id,
        longitud,
        latitud,
        temperatura ?? null,
        vibracion ?? null,
        voltaje ?? null,
        velocidad ?? null,
        altitud ?? null,
        rumbo ?? null,
        bateria ?? null,
        pitch ?? null,
        roll ?? null,
        aceleracion_x ?? null,
        aceleracion_y ?? null,
        aceleracion_z ?? null
      ]);

      const broadcastData = JSON.stringify({ 
        lo: longitud, 
        la: latitud, 
        dispositivo_id,
        temperatura,
        vibracion,
        voltaje,
        velocidad,
        altitud,
        rumbo,
        bateria,
        pitch,
        roll,
        aceleracion_x,
        aceleracion_y,
        aceleracion_z,
        timestamp: timestamp || new Date().toISOString()
      });

      for (const client of fastify.websocketServer.clients) {
        if (client.readyState === 1) {
          client.send(broadcastData);
        }
      }

      // Motor de Alertas
      try {
        const geocercaQuery = `
          SELECT nombre FROM geocercas 
          WHERE ST_Contains(poligono, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        `;
        const geocercas = await db.query(geocercaQuery, [longitud, latitud]);
        
        if (geocercas.rows.length > 0) {
          for (const gc of geocercas.rows) {
            const checkAlert = await db.query(`
              SELECT id FROM alertas 
              WHERE dispositivo_id = $1 AND tipo = 'geocerca' AND mensaje LIKE $2 AND timestamp > (NOW() - INTERVAL '5 MINUTES')
            `, [dispositivo_id, `%${gc.nombre}%`]);

            if (checkAlert.rows.length === 0) {
              const msg = `Vehículo dentro de geocerca: ${gc.nombre}`;
              const timeStr = timestamp || new Date().toISOString();
              await db.query(`
                INSERT INTO alertas (dispositivo_id, tipo, mensaje, timestamp, ubicacion)
                VALUES ($1, 'geocerca', $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
              `, [dispositivo_id, msg, timeStr, longitud, latitud]);

              const alertData = JSON.stringify({ 
                alerta: true,
                dispositivo_id,
                tipo: 'geocerca',
                mensaje: msg,
                timestamp: timeStr
              });

              for (const client of fastify.websocketServer.clients) {
                if (client.readyState === 1) {
                  client.send(alertData);
                }
              }
            }
          }
        }

        if (velocidad > 80) {
          const checkSpeedAlert = await db.query(`
            SELECT id FROM alertas 
            WHERE dispositivo_id = $1 AND tipo = 'exceso_velocidad' AND timestamp > (NOW() - INTERVAL '5 MINUTES')
          `, [dispositivo_id]);
          if (checkSpeedAlert.rows.length === 0) {
            const msg = `Exceso de velocidad: ${velocidad} km/h`;
            const timeStr = timestamp || new Date().toISOString();
            await db.query(`
                INSERT INTO alertas (dispositivo_id, tipo, mensaje, timestamp, ubicacion)
                VALUES ($1, 'exceso_velocidad', $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
              `, [dispositivo_id, msg, timeStr, longitud, latitud]);
              const alertData = JSON.stringify({ 
                alerta: true,
                dispositivo_id,
                tipo: 'exceso_velocidad',
                mensaje: msg,
                timestamp: timeStr
              });
              for (const client of fastify.websocketServer.clients) {
                if (client.readyState === 1) {
                  client.send(alertData);
                }
              }
          }
        }
      } catch (alertErr) {
        console.error('Error generando alertas:', alertErr);
      }

      return { estado: 'ok' };
    } catch (error) {
      console.error('Error en POST telemetria:', error);
      reply.status(500).send({ estado: 'error' });
    }
  });
};
