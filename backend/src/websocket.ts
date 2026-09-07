import { FastifyInstance } from 'fastify';
import { db } from './db';
import { SocketStream } from '@fastify/websocket';

export const configurarWebSockets = (fastify: FastifyInstance) => {
  fastify.get('/ws', { websocket: true }, (connection: SocketStream, req) => {
    connection.socket.on('message', async (message: Buffer) => {
      try {
        const datos = JSON.parse(message.toString());
        const { timestamp, dispositivo_id, latitud, longitud, temperatura, vibracion, voltaje } = datos;

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

        // Retransmitir a todos los clientes (frontends) conectados
        const broadcastData = JSON.stringify({ lo: longitud, la: latitud, dispositivo_id });
        for (const client of fastify.websocketServer.clients) {
          if (client.readyState === 1) { // 1 = OPEN
            client.send(broadcastData);
          }
        }

        connection.socket.send(JSON.stringify({ estado: 'ok' }));
      } catch (error) {
        console.error('Error al procesar mensaje:', error);
        connection.socket.send(JSON.stringify({ estado: 'error' }));
      }
    });
  });
};
