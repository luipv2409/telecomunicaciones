import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const MAX_PUENTES = 20;
const EDAD_MAXIMA_MS = 5 * 60 * 1000;

interface LecturaPuente {
  datos: Record<string, unknown>;
  recibido: number;
}

const ultimasLecturas = new Map<string, LecturaPuente>();

function limpiarAntiguas() {
  const ahora = Date.now();
  for (const [id, lectura] of ultimasLecturas) {
    if (ahora - lectura.recibido > EDAD_MAXIMA_MS) {
      ultimasLecturas.delete(id);
    }
  }
}

export const rutasPuente: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/api/info', async () => {
    const ips = (process.env.HOST_IPS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    return {
      servidor: 'TRACE-MIN',
      ips,
      puerto_api: 3001,
      puerto_web: 8080,
      timestamp: new Date().toISOString()
    };
  });

  fastify.post('/api/puente/gps', async (request, reply) => {
    const cuerpo = (request.body as Record<string, unknown>) || {};
    const puenteId = String(cuerpo.puente_id || '').trim();
    const latitud = Number(cuerpo.latitud);
    const longitud = Number(cuerpo.longitud);

    if (!puenteId || isNaN(latitud) || isNaN(longitud)) {
      return reply.status(400).send({ error: 'puente_id, latitud y longitud son requeridos' });
    }

    limpiarAntiguas();

    if (!ultimasLecturas.has(puenteId) && ultimasLecturas.size >= MAX_PUENTES) {
      return reply.status(429).send({ error: 'Límite de puentes alcanzado' });
    }

    ultimasLecturas.set(puenteId, {
      datos: { ...cuerpo, latitud, longitud, timestamp: new Date().toISOString() },
      recibido: Date.now()
    });

    return { estado: 'ok' };
  });

  fastify.get('/api/puente/gps', async (request, reply) => {
    const { id } = request.query as { id?: string };
    const puenteId = String(id || '').trim();

    if (!puenteId) {
      return reply.status(400).send({ error: 'Falta el parámetro id' });
    }

    const lectura = ultimasLecturas.get(puenteId);
    if (!lectura) {
      return reply.status(404).send({ error: 'Sin datos del celular para este puente' });
    }

    return { ...lectura.datos, edad_ms: Date.now() - lectura.recibido };
  });
};
