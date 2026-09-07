import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { db } from './db';

export const rutasHistorico: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/historico/:dispositivo_id', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    const { inicio, fin } = request.query as { inicio: string, fin: string };

    const query = `
      SELECT ST_AsGeoJSON(ST_MakeLine(ubicacion ORDER BY timestamp ASC)) AS ruta
      FROM telemetria
      WHERE dispositivo_id = $1
        AND timestamp >= $2
        AND timestamp <= $3;
    `;

    const result = await db.query(query, [dispositivo_id, inicio, fin]);
    
    return result.rows[0];
  });

  fastify.post('/api/telemetria', async (request, reply) => {
    try {
      const { timestamp, dispositivo_id, latitud, longitud, temperatura, vibracion, voltaje } = request.body as any;

      const query = `
        INSERT INTO telemetria (timestamp, dispositivo_id, ubicacion, temperatura, vibracion, voltaje)
        VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7)
      `;
      
      await db.query(query, [
        timestamp,
        dispositivo_id,
        longitud,
        latitud,
        temperatura,
        vibracion,
        voltaje
      ]);

      // Retransmitir a los clientes de websocket
      const broadcastData = JSON.stringify({ 
        lo: longitud, 
        la: latitud, 
        dispositivo_id,
        temperatura,
        vibracion,
        voltaje,
        timestamp
      });
      for (const client of fastify.websocketServer.clients) {
        if (client.readyState === 1) { // OPEN
          client.send(broadcastData);
        }
      }

      return { estado: 'ok' };
    } catch (error) {
      console.error('Error en POST telemetria:', error);
      reply.status(500).send({ estado: 'error' });
    }
  });
};
