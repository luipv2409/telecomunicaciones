import { FastifyInstance, FastifyPluginAsync } from 'fastify';

interface FrameCamara {
  buffer: Buffer;
  contentType: string;
  timestamp: string;
}

interface ComandoActuador {
  id: string;
  actuador: string;
  valor: any;
  timestamp: string;
}

// Almacenamiento en memoria ultrarrápido (no satura disco ni BD)
const ultimosFrames = new Map<string, FrameCamara>();
const estadoActuadores = new Map<string, Record<string, any>>();
const colaComandos = new Map<string, ComandoActuador[]>();

export function obtenerComandosPendientes(dispositivoId: string): ComandoActuador[] {
  const comandos = colaComandos.get(dispositivoId) || [];
  if (comandos.length > 0) {
    colaComandos.delete(dispositivoId);
  }
  return comandos;
}

export function registrarEstadoActuadores(dispositivoId: string, nuevosEstados: Record<string, any>) {
  const actual = estadoActuadores.get(dispositivoId) || {};
  estadoActuadores.set(dispositivoId, { ...actual, ...nuevosEstados });
}

// Validación estricta de cabecera mágica binaria de imagen
export function esBufferImagenValido(buf: Buffer): boolean {
  if (!buf || buf.length < 32) return false;
  // JPEG: 0xFF, 0xD8
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true;
  // PNG: 0x89, 0x50, 0x4E, 0x47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WebP: RIFF .... WEBP
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  // SVG: <svg o <?xml
  const slice = buf.subarray(0, 60).toString('utf-8').toLowerCase();
  if (slice.includes('<svg') || slice.includes('<?xml')) return true;
  return false;
}

// Imagen SVG elegante por defecto si no hay foto disponible aún
function generarPlaceholderSvg(dispositivoId: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#09090b"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
    <radialGradient id="lensGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#27272a"/>
      <stop offset="65%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </radialGradient>
  </defs>
  <rect width="640" height="480" fill="url(#bgGrad)"/>
  <g stroke="#27272a" stroke-width="1" opacity="0.35">
    <line x1="80" y1="0" x2="80" y2="480"/>
    <line x1="160" y1="0" x2="160" y2="480"/>
    <line x1="240" y1="0" x2="240" y2="480"/>
    <line x1="320" y1="0" x2="320" y2="480"/>
    <line x1="400" y1="0" x2="400" y2="480"/>
    <line x1="480" y1="0" x2="480" y2="480"/>
    <line x1="560" y1="0" x2="560" y2="480"/>
    <line x1="0" y1="80" x2="640" y2="80"/>
    <line x1="0" y1="160" x2="640" y2="160"/>
    <line x1="0" y1="240" x2="640" y2="240"/>
    <line x1="0" y1="320" x2="640" y2="320"/>
    <line x1="0" y1="400" x2="640" y2="400"/>
  </g>
  <rect x="20" y="20" width="600" height="440" rx="14" fill="none" stroke="#3f3f46" stroke-width="1.5" stroke-dasharray="8 6"/>
  
  <!-- Lente y Camara -->
  <circle cx="320" cy="190" r="56" fill="url(#lensGrad)" stroke="#52525b" stroke-width="2.5"/>
  <circle cx="320" cy="190" r="34" fill="#09090b" stroke="#71717a" stroke-width="1.5"/>
  <circle cx="332" cy="178" r="9" fill="#a1a1aa" opacity="0.5"/>
  
  <!-- Badge Standby -->
  <rect x="220" y="265" width="200" height="28" rx="14" fill="#450a0a" stroke="#dc2626" stroke-width="1"/>
  <circle cx="236" cy="279" r="4" fill="#ef4444"/>
  <text x="325" y="284" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700" fill="#fca5a5" text-anchor="middle" letter-spacing="1">MODO ESPERA (STANDBY)</text>
  
  <!-- Info -->
  <text x="320" y="325" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#f4f4f5" text-anchor="middle">Camara Onboard: ${dispositivoId}</text>
  <text x="320" y="352" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#a1a1aa" text-anchor="middle">Sin transmision activa desde el ESP32 o telefono celular</text>
  <text x="320" y="375" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#71717a" text-anchor="middle">Presione el boton "Simular Frame" en el panel para probar el visor</text>
  
  <text x="320" y="430" font-family="monospace, monospace" font-size="11" fill="#52525b" text-anchor="middle">TRACE-MIN TELECOM - SISTEMA DE TELEMETRIA</text>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

export const rutasCamaraActuadores: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Parser para aceptar imagenes crudas en binario (ideal para ESP32-CAM)
  fastify.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  // 1. Recibir fotograma de camara (soporta Binario y JSON Base64)
  fastify.post('/api/camara/frame', async (request, reply) => {
    let dispositivoId = '';
    let buffer: Buffer | null = null;
    let contentType = 'image/jpeg';

    const contentTypeHeader = (request.headers['content-type'] || '').toLowerCase();

    if (contentTypeHeader.startsWith('image/')) {
      dispositivoId = String(request.headers['x-dispositivo-id'] || request.headers['dispositivo-id'] || '').trim();
      buffer = request.body as Buffer;
      contentType = contentTypeHeader.split(';')[0];
    } else {
      const b = (request.body as Record<string, any>) || {};
      dispositivoId = String(b.dispositivo_id || b.id || '').trim();
      if (b.imagen_base64) {
        let base64Data = String(b.imagen_base64);
        if (base64Data.includes(',')) {
          const partes = base64Data.split(',');
          if (partes[0].includes('image/png')) contentType = 'image/png';
          else if (partes[0].includes('image/webp')) contentType = 'image/webp';
          base64Data = partes[1];
        }
        buffer = Buffer.from(base64Data, 'base64');
      }
    }

    console.log(`[HTTP POST /api/camara/frame] Disp: '${dispositivoId}', ContentType: '${contentType}', Bytes: ${buffer ? buffer.length : 0}`);

    if (!dispositivoId || !buffer || buffer.length === 0) {
      console.log(`[HTTP POST /api/camara/frame] ERROR: id o buffer vacio`);
      return reply.status(400).send({ error: 'dispositivo_id e imagen son requeridos' });
    }

    // Validación estricta: asegurar que es una imagen real y no texto de prueba corrupto
    if (!esBufferImagenValido(buffer)) {
      console.log(`[HTTP POST /api/camara/frame] ERROR: buffer no es imagen valida (primeros 4 bytes: ${buffer.subarray(0, 4).toString('hex')})`);
      return reply.status(400).send({ error: 'Formato de imagen invalido o corrupto (se requiere JPEG, PNG o WebP valido)' });
    }

    const timestamp = new Date().toISOString();
    ultimosFrames.set(dispositivoId, {
      buffer,
      contentType,
      timestamp
    });

    // Notificar a clientes WebSocket sobre nuevo fotograma disponible
    const notifWs = JSON.stringify({
      tipo_evento: 'camara_frame',
      dispositivo_id: dispositivoId,
      timestamp,
      tamano_bytes: buffer.length
    });

    for (const client of fastify.websocketServer.clients) {
      if (client.readyState === 1) {
        client.send(notifWs);
      }
    }

    return { estado: 'ok', dispositivo_id: dispositivoId, tamano_bytes: buffer.length, timestamp };
  });

  // 2. Obtener ultimo fotograma de camara de un vehiculo
  fastify.get('/api/camara/:dispositivo_id/frame', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    const frame = ultimosFrames.get(dispositivo_id);

    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    if (!frame || !esBufferImagenValido(frame.buffer)) {
      if (frame) {
        ultimosFrames.delete(dispositivo_id);
      }
      const svg = generarPlaceholderSvg(dispositivo_id);
      reply.type('image/svg+xml');
      return reply.send(svg);
    }

    reply.type(frame.contentType);
    reply.header('X-Timestamp-Frame', frame.timestamp);
    return reply.send(frame.buffer);
  });

  // 3. Info de estado de la camara
  fastify.get('/api/camara/:dispositivo_id/info', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    const frame = ultimosFrames.get(dispositivo_id);

    if (!frame || !esBufferImagenValido(frame.buffer)) {
      return {
        dispositivo_id,
        activo: false,
        ultimo_frame: null,
        edad_segundos: null
      };
    }

    const ahora = Date.now();
    const tiempoFrame = new Date(frame.timestamp).getTime();
    const edadSegundos = Math.max(0, Math.floor((ahora - tiempoFrame) / 1000));

    return {
      dispositivo_id,
      activo: edadSegundos < 30,
      ultimo_frame: frame.timestamp,
      edad_segundos: edadSegundos,
      tamano_bytes: frame.buffer.length
    };
  });

  // 4. Purgar fotograma de la memoria (Reset)
  fastify.delete('/api/camara/:dispositivo_id/frame', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    ultimosFrames.delete(dispositivo_id);
    return { estado: 'ok', mensaje: `Fotograma de ${dispositivo_id} purgado` };
  });

  // 5. Consultar estado de actuadores de un vehiculo
  fastify.get('/api/actuadores/:dispositivo_id', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    const estados = estadoActuadores.get(dispositivo_id) || {
      corte_motor: false,
      alarma_sonora: false,
      luces_emergencia: false,
      bloqueo_puertas: false
    };

    const pendientes = colaComandos.get(dispositivo_id) || [];

    return {
      dispositivo_id,
      actuadores: estados,
      comandos_pendientes: pendientes.length
    };
  });

  // 6. Enviar comando a un actuador (ej: cortar encendido, encender alarma)
  fastify.post('/api/actuadores/:dispositivo_id', async (request, reply) => {
    const { dispositivo_id } = request.params as { dispositivo_id: string };
    const b = (request.body as Record<string, any>) || {};
    const actuador = String(b.actuador || '').trim();
    const valor = b.valor !== undefined ? b.valor : true;

    if (!actuador) {
      return reply.status(400).send({ error: 'Nombre de actuador requerido' });
    }

    // Actualizar estado esperado
    const actual = estadoActuadores.get(dispositivo_id) || {};
    actual[actuador] = valor;
    estadoActuadores.set(dispositivo_id, actual);

    // Encolar comando para que el ESP32 lo reciba en su proximo POST
    const comando: ComandoActuador = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actuador,
      valor,
      timestamp: new Date().toISOString()
    };

    const cola = colaComandos.get(dispositivo_id) || [];
    cola.push(comando);
    colaComandos.set(dispositivo_id, cola);

    // Notificar por WebSocket a paneles abiertos
    const alertData = JSON.stringify({
      alerta: true,
      tipo: 'actuador',
      dispositivo_id,
      mensaje: `Comando enviado: ${actuador} = ${valor ? 'ACTIVO' : 'INACTIVO'}`,
      timestamp: comando.timestamp
    });

    for (const client of fastify.websocketServer.clients) {
      if (client.readyState === 1) {
        client.send(alertData);
      }
    }

    return {
      estado: 'ok',
      mensaje: `Comando encolado para ${dispositivo_id}`,
      comando,
      actuadores: actual
    };
  });
};
