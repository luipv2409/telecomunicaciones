import { FastifyInstance } from 'fastify';
import { db } from './db';
import { SocketStream } from '@fastify/websocket';

export const configurarWebSockets = (fastify: FastifyInstance) => {
  fastify.get('/ws', { websocket: true }, (connection: SocketStream, req) => {
    connection.socket.on('message', async (message: Buffer) => {
      try {
        const datos = JSON.parse(message.toString());

        const dispositivo_id = datos.dispositivo_id || datos.d;
        const latitud = datos.latitud !== undefined ? Number(datos.latitud) : (datos.la !== undefined ? Number(datos.la) : null);
        const longitud = datos.longitud !== undefined ? Number(datos.longitud) : (datos.lo !== undefined ? Number(datos.lo) : null);

        if (!dispositivo_id || latitud === null || longitud === null || isNaN(latitud) || isNaN(longitud)) {
          connection.socket.send(JSON.stringify({ estado: 'error', mensaje: 'Datos de ubicación requeridos' }));
          return;
        }

        const timestamp = datos.timestamp || (datos.t ? (typeof datos.t === 'number' && datos.t > 1000000000000 ? new Date(datos.t).toISOString() : new Date().toISOString()) : new Date().toISOString());
        const temperatura = datos.temperatura !== undefined ? Number(datos.temperatura) : (datos.te !== undefined ? Number(datos.te) : null);
        const vibracion = datos.vibracion !== undefined ? Number(datos.vibracion) : (datos.vi !== undefined ? Number(datos.vi) : null);
        const voltaje = datos.voltaje !== undefined ? Number(datos.voltaje) : (datos.vo !== undefined ? Number(datos.vo) : null);
        const velocidad = datos.velocidad !== undefined ? Number(datos.velocidad) : (datos.ve !== undefined ? Number(datos.ve) : null);
        const altitud = datos.altitud !== undefined ? Number(datos.altitud) : (datos.al !== undefined ? Number(datos.al) : null);
        const rumbo = datos.rumbo !== undefined ? Number(datos.rumbo) : (datos.ru !== undefined ? Number(datos.ru) : null);
        const bateria = datos.bateria !== undefined ? Number(datos.bateria) : (datos.ba !== undefined ? Number(datos.ba) : null);
        const pitch = datos.pitch !== undefined ? Number(datos.pitch) : (datos.pi !== undefined ? Number(datos.pi) : null);
        const roll = datos.roll !== undefined ? Number(datos.roll) : (datos.ro !== undefined ? Number(datos.ro) : null);
        const aceleracion_x = datos.aceleracion_x !== undefined ? Number(datos.aceleracion_x) : (datos.ax !== undefined ? Number(datos.ax) : null);
        const aceleracion_y = datos.aceleracion_y !== undefined ? Number(datos.aceleracion_y) : (datos.ay !== undefined ? Number(datos.ay) : null);
        const aceleracion_z = datos.aceleracion_z !== undefined ? Number(datos.aceleracion_z) : (datos.az !== undefined ? Number(datos.az) : null);

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
          timestamp,
          dispositivo_id,
          longitud,
          latitud,
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
          timestamp
        });

        for (const client of fastify.websocketServer.clients) {
          if (client.readyState === 1) {
            client.send(broadcastData);
          }
        }

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
                await db.query(`
                  INSERT INTO alertas (dispositivo_id, tipo, mensaje, timestamp, ubicacion)
                  VALUES ($1, 'geocerca', $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
                `, [dispositivo_id, msg, timestamp, longitud, latitud]);

                const alertData = JSON.stringify({ 
                  alerta: true,
                  dispositivo_id,
                  tipo: 'geocerca',
                  mensaje: msg,
                  timestamp
                });

                for (const client of fastify.websocketServer.clients) {
                  if (client.readyState === 1) {
                    client.send(alertData);
                  }
                }
              }
            }
          }

          if (velocidad !== null && velocidad > 80) {
            const checkSpeedAlert = await db.query(`
              SELECT id FROM alertas 
              WHERE dispositivo_id = $1 AND tipo = 'exceso_velocidad' AND timestamp > (NOW() - INTERVAL '5 MINUTES')
            `, [dispositivo_id]);

            if (checkSpeedAlert.rows.length === 0) {
              const msg = `Exceso de velocidad: ${velocidad} km/h`;
              await db.query(`
                INSERT INTO alertas (dispositivo_id, tipo, mensaje, timestamp, ubicacion)
                VALUES ($1, 'exceso_velocidad', $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
              `, [dispositivo_id, msg, timestamp, longitud, latitud]);

              const alertData = JSON.stringify({ 
                alerta: true,
                dispositivo_id,
                tipo: 'exceso_velocidad',
                mensaje: msg,
                timestamp
              });

              for (const client of fastify.websocketServer.clients) {
                if (client.readyState === 1) {
                  client.send(alertData);
                }
              }
            }
          }
        } catch (alertErr) {
          console.error('Error generando alertas en WebSocket:', alertErr);
        }

        connection.socket.send(JSON.stringify({ estado: 'ok' }));
      } catch (error) {
        console.error('Error al procesar mensaje en WebSocket:', error);
        connection.socket.send(JSON.stringify({ estado: 'error' }));
      }
    });
  });
};
