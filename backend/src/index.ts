import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { rutasHistorico } from './routes';
import { configurarWebSockets } from './websocket';

const iniciarServidor = async () => {
  const fastify = Fastify();

  await fastify.register(websocketPlugin);
  await fastify.register(rutasHistorico);

  configurarWebSockets(fastify);

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

iniciarServidor();
