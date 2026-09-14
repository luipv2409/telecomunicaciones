import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import '@fastify/jwt';
import { db } from './db';
import bcrypt from 'bcryptjs';

const MAX_DISPOSITIVOS_DIARIOS = 10;
const dispositivosActivos = new Set<string>();

export const rutasHistorico: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Login
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

    // Firmar Token
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
        voltaje
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

  fastify.post('/api/telemetria', async (request, reply) => {
    try {
      const { timestamp, dispositivo_id, latitud, longitud, temperatura, vibracion, voltaje } = request.body as any;

      if (!dispositivosActivos.has(dispositivo_id)) {
        if (dispositivosActivos.size >= MAX_DISPOSITIVOS_DIARIOS) {
          return reply.status(429).send({ error: 'Límite de vehículos alcanzado en este servidor.' });
        }
        dispositivosActivos.add(dispositivo_id);
      }

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
