import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FirmwareMetadata {
  version: string;
  md5: string;
  sha256: string;
  size: number;
  filename: string;
  notas: string;
  autoUpdate: boolean;
  uploadedAt: string;
  uploadedBy: string;
}

export interface EstadoDispositivoOta {
  dispositivo_id: string;
  firmware_version: string;
  sketch_md5: string;
  wifi_ssid: string;
  wifi_rssi: number | null;
  ip_local: string;
  uptime_s: number | null;
  ultimo_contacto: string;
  estado_ota: 'al_dia' | 'actualizacion_disponible' | 'pendiente_envio' | 'descargando' | 'reiniciando' | 'completado' | 'error' | 'sin_firmware';
  progreso_pct: number;
  mensaje_ota: string;
  ultimo_evento_ota: string | null;
}

interface OrdenManualOta {
  forzar: boolean;
  solicitadoEn: number;
}

const OTA_DIR = process.env.OTA_DIR || path.join(process.cwd(), 'ota_storage');
const BIN_PATH = path.join(OTA_DIR, 'firmware.bin');
const META_PATH = path.join(OTA_DIR, 'metadata.json');

const MAX_OTA_SIZE = 3 * 1024 * 1024; // 3 MB (tamaño exacto de ota_0 / ota_1 en ESP32-S3 16MB)
const MIN_OTA_SIZE = 65536;           // 64 KB mínimo para una app ESP32 real
const ESP_IMAGE_MAGIC = 0xE9;
const ESP_APP_DESC_MAGIC = 0xABCD5432;

const dispositivosOta = new Map<string, EstadoDispositivoOta>();
const ordenesManuales = new Map<string, OrdenManualOta>();
// Evita bucles infinitos si un dispositivo falla al instalar un MD5 específico en modo autoUpdate
const fallosRecientes = new Map<string, { md5: string; ts: number }>();

function asegurarDirectorioOta() {
  if (!fs.existsSync(OTA_DIR)) {
    fs.mkdirSync(OTA_DIR, { recursive: true });
  }
}

export function leerMetadataFirmware(): FirmwareMetadata | null {
  try {
    if (!fs.existsSync(META_PATH) || !fs.existsSync(BIN_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(META_PATH, 'utf-8');
    const meta = JSON.parse(raw) as FirmwareMetadata;
    const stat = fs.statSync(BIN_PATH);
    if (stat.size !== meta.size) {
      meta.size = stat.size;
    }
    return meta;
  } catch (err) {
    console.error('[OTA] Error leyendo metadata.json:', err);
    return null;
  }
}

function guardarMetadataFirmware(meta: FirmwareMetadata) {
  asegurarDirectorioOta();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}

function extraerVersionEmbebida(buf: Buffer): string | null {
  // Busca el marcador embebido en el binario: "TRACEMIN_FW:<version>|"
  const needle = Buffer.from('TRACEMIN_FW:', 'ascii');
  const idx = buf.indexOf(needle);
  if (idx >= 0) {
    const start = idx + needle.length;
    const end = buf.indexOf(0x7C, start); // '|'
    if (end > start && end - start <= 48) {
      const ver = buf.subarray(start, end).toString('utf-8').trim();
      if (ver.length > 0 && /^[\w.\-+]+$/.test(ver)) {
        return ver;
      }
    }
  }
  return null;
}

function validarBinarioEsp32(buf: Buffer): { valido: boolean; error?: string } {
  if (!buf || buf.length === 0) {
    return { valido: false, error: 'El archivo está vacío.' };
  }
  if (buf.length < MIN_OTA_SIZE) {
    return {
      valido: false,
      error: `El archivo es demasiado pequeño (${(buf.length / 1024).toFixed(1)} KB). Asegúrate de subir el archivo de aplicación (.ino.bin) y NO partitions.bin ni bootloader.bin.`
    };
  }
  if (buf.length > MAX_OTA_SIZE) {
    return {
      valido: false,
      error: `El archivo supera el límite de 3.0 MB de la partición OTA (${(buf.length / (1024 * 1024)).toFixed(2)} MB). No subas el archivo .merged.bin; sube únicamente esp32_tracemin.ino.bin.`
    };
  }
  if (buf[0] !== ESP_IMAGE_MAGIC) {
    return {
      valido: false,
      error: `Cabecera binaria inválida (0x${buf[0].toString(16).toUpperCase()}, se esperaba 0xE9). El archivo no es un firmware compilado de ESP32.`
    };
  }
  // En imágenes de aplicación ESP-IDF/Arduino, esp_app_desc_t inicia en el byte 32 con 0xABCD5432.
  // Esto distingue esp32_tracemin.ino.bin de bootloader.bin o merged.bin (que llevan el bootloader en el byte 0).
  if (buf.length >= 36) {
    const appMagic = buf.readUInt32LE(32);
    if (appMagic !== ESP_APP_DESC_MAGIC) {
      return {
        valido: false,
        error: 'Este binario parece ser un Bootloader o un archivo .merged.bin (tiene bootloader al inicio). Para OTA debes subir esp32_tracemin.ino.bin.'
      };
    }
  }
  return { valido: true };
}

function calcularEstadoBase(
  disp: EstadoDispositivoOta,
  meta: FirmwareMetadata | null
): EstadoDispositivoOta['estado_ota'] {
  if (ordenesManuales.has(disp.dispositivo_id)) {
    return 'pendiente_envio';
  }
  if (!meta) {
    return 'sin_firmware';
  }
  if (disp.sketch_md5 && disp.sketch_md5.toLowerCase() === meta.md5.toLowerCase()) {
    return 'al_dia';
  }
  if (!disp.sketch_md5 && disp.firmware_version && disp.firmware_version === meta.version) {
    return 'al_dia';
  }
  return 'actualizacion_disponible';
}

function emitirEventoWsOta(fastify: FastifyInstance, extra: Record<string, any> = {}) {
  if (!fastify.websocketServer) return;
  const meta = leerMetadataFirmware();
  const payload = JSON.stringify({
    tipo_evento: 'ota_estado',
    firmware: meta,
    dispositivos: listarDispositivosOta(meta),
    ...extra
  });
  for (const client of fastify.websocketServer.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

export function listarDispositivosOta(metaArg?: FirmwareMetadata | null): EstadoDispositivoOta[] {
  const meta = metaArg !== undefined ? metaArg : leerMetadataFirmware();
  const salida: EstadoDispositivoOta[] = [];
  for (const disp of dispositivosOta.values()) {
    const enTransicion = disp.estado_ota === 'descargando' || disp.estado_ota === 'reiniciando' || disp.estado_ota === 'error';
    const edadEvento = disp.ultimo_evento_ota ? Date.now() - new Date(disp.ultimo_evento_ota).getTime() : Infinity;
    // Si lleva más de 90s en descargando/reiniciando sin terminar, recalcular estado real
    const estadoEfectivo = (enTransicion && edadEvento < 90000)
      ? disp.estado_ota
      : calcularEstadoBase(disp, meta);

    salida.push({
      ...disp,
      estado_ota: estadoEfectivo
    });
  }
  return salida.sort((a, b) => a.dispositivo_id.localeCompare(b.dispositivo_id));
}

export function registrarHeartbeatOta(
  fastify: FastifyInstance,
  dispositivoId: string,
  body: Record<string, any>
): { actualizar: boolean; version?: string; md5?: string; size?: number; url?: string; forzar?: boolean } | null {
  const extra = (body.sensores_extra && typeof body.sensores_extra === 'object') ? body.sensores_extra : {};
  const fwVersion = String(body.firmware_version || extra.firmware || '').trim();
  const sketchMd5 = String(body.sketch_md5 || extra.sketch_md5 || '').trim().toLowerCase();
  const wifiSsid = String(extra.wifi_ssid || '').trim();
  const wifiRssi = extra.wifi_rssi !== undefined ? Number(extra.wifi_rssi) : null;
  const ipLocal = String(extra.ip_local || '').trim();
  const uptimeS = extra.uptime_s !== undefined ? Number(extra.uptime_s) : null;

  const meta = leerMetadataFirmware();
  const previo = dispositivosOta.get(dispositivoId);
  const ahoraIso = new Date().toISOString();

  const nuevo: EstadoDispositivoOta = {
    dispositivo_id: dispositivoId,
    firmware_version: fwVersion || (previo?.firmware_version ?? 'desconocida'),
    sketch_md5: sketchMd5 || (previo?.sketch_md5 ?? ''),
    wifi_ssid: wifiSsid || (previo?.wifi_ssid ?? ''),
    wifi_rssi: wifiRssi !== null && !isNaN(wifiRssi) ? wifiRssi : (previo?.wifi_rssi ?? null),
    ip_local: ipLocal || (previo?.ip_local ?? ''),
    uptime_s: uptimeS !== null && !isNaN(uptimeS) ? uptimeS : (previo?.uptime_s ?? null),
    ultimo_contacto: ahoraIso,
    estado_ota: previo?.estado_ota ?? 'sin_firmware',
    progreso_pct: previo?.progreso_pct ?? 0,
    mensaje_ota: previo?.mensaje_ota ?? '',
    ultimo_evento_ota: previo?.ultimo_evento_ota ?? null
  };

  // Si el ESP32 acaba de reconectar con el MD5 del firmware nuevo tras reiniciar:
  if (meta && nuevo.sketch_md5 && nuevo.sketch_md5 === meta.md5.toLowerCase()) {
    if (previo && (previo.estado_ota === 'reiniciando' || previo.estado_ota === 'descargando' || (previo.sketch_md5 && previo.sketch_md5 !== nuevo.sketch_md5))) {
      nuevo.estado_ota = 'al_dia';
      nuevo.progreso_pct = 100;
      nuevo.mensaje_ota = `Actualizado exitosamente a ${nuevo.firmware_version}`;
      nuevo.ultimo_evento_ota = ahoraIso;
      ordenesManuales.delete(dispositivoId);
      fallosRecientes.delete(dispositivoId);
      dispositivosOta.set(dispositivoId, nuevo);
      emitirEventoWsOta(fastify, { alerta_ota: nuevo.mensaje_ota, dispositivo_id: dispositivoId });
      return null;
    }
  }

  // Verificar si cambió versión o estado para refrescar clientes WS
  const cambioVersion = !previo || previo.firmware_version !== nuevo.firmware_version || previo.sketch_md5 !== nuevo.sketch_md5;
  if (!previo || (nuevo.estado_ota !== 'descargando' && nuevo.estado_ota !== 'reiniciando' && nuevo.estado_ota !== 'error')) {
    nuevo.estado_ota = calcularEstadoBase(nuevo, meta);
  }
  dispositivosOta.set(dispositivoId, nuevo);
  if (cambioVersion) {
    emitirEventoWsOta(fastify);
  }

  if (!meta) {
    return null;
  }

  const mismoMd5 = nuevo.sketch_md5.length > 0 && nuevo.sketch_md5 === meta.md5.toLowerCase();
  const mismaVersionSinMd5 = nuevo.sketch_md5.length === 0 && nuevo.firmware_version === meta.version;

  // 1. ¿Hay una orden manual disparada desde el panel web para este ESP32?
  const orden = ordenesManuales.get(dispositivoId);
  if (orden) {
    ordenesManuales.delete(dispositivoId);
    if (mismoMd5 && !orden.forzar) {
      nuevo.estado_ota = 'al_dia';
      nuevo.progreso_pct = 100;
      nuevo.mensaje_ota = 'El ESP32 ya tiene instalado exactamente este mismo binario (MD5 idéntico).';
      nuevo.ultimo_evento_ota = ahoraIso;
      dispositivosOta.set(dispositivoId, nuevo);
      emitirEventoWsOta(fastify);
      return null;
    }
    nuevo.estado_ota = 'descargando';
    nuevo.progreso_pct = 5;
    nuevo.mensaje_ota = `Orden OTA enviada al ESP32 (${meta.version})...`;
    nuevo.ultimo_evento_ota = ahoraIso;
    dispositivosOta.set(dispositivoId, nuevo);
    emitirEventoWsOta(fastify);
    return {
      actualizar: true,
      version: meta.version,
      md5: meta.md5,
      size: meta.size,
      url: `/api/ota/download?dispositivo_id=${encodeURIComponent(dispositivoId)}`,
      forzar: orden.forzar
    };
  }

  // 2. ¿Está activado Auto-Update en el servidor?
  if (meta.autoUpdate && !mismoMd5 && !mismaVersionSinMd5) {
    // Si el dispositivo es un simulador web/celular (no envió firmware_version ni sketch_md5), NO enviarle OTA
    if (!fwVersion && !sketchMd5) {
      return null;
    }
    const fallo = fallosRecientes.get(dispositivoId);
    if (fallo && fallo.md5 === meta.md5 && Date.now() - fallo.ts < 5 * 60 * 1000) {
      return null; // Esperar 5 min tras un fallo antes de reintentar automáticamente
    }
    nuevo.estado_ota = 'descargando';
    nuevo.progreso_pct = 5;
    nuevo.mensaje_ota = `Auto-Update iniciado hacia versión ${meta.version}...`;
    nuevo.ultimo_evento_ota = ahoraIso;
    dispositivosOta.set(dispositivoId, nuevo);
    emitirEventoWsOta(fastify);
    return {
      actualizar: true,
      version: meta.version,
      md5: meta.md5,
      size: meta.size,
      url: `/api/ota/download?dispositivo_id=${encodeURIComponent(dispositivoId)}`,
      forzar: false
    };
  }

  return null;
}

export const rutasOta: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  asegurarDirectorioOta();

  // Parser para subida directa de archivos .bin en binario crudo
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 16 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  // 1. Estado general OTA + flota conectada (Panel Web)
  fastify.get('/api/ota/info', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    const meta = leerMetadataFirmware();
    return {
      firmware: meta,
      dispositivos: listarDispositivosOta(meta)
    };
  });

  // 2. Subir nuevo archivo .bin compilado (Solo Admin)
  fastify.post('/api/ota/upload', async (request, reply) => {
    let user: any;
    try {
      await request.jwtVerify();
      user = request.user as any;
    } catch {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    if (user.rol !== 'admin') {
      return reply.status(403).send({ error: 'Solo los administradores pueden subir actualizaciones de firmware' });
    }

    const buf = request.body as Buffer;
    const validacion = validarBinarioEsp32(buf);
    if (!validacion.valido) {
      return reply.status(400).send({ error: validacion.error });
    }

    const headerVersion = decodeURIComponent(String(request.headers['x-firmware-version'] || '')).trim();
    const headerFilename = decodeURIComponent(String(request.headers['x-firmware-filename'] || 'esp32_tracemin.ino.bin')).trim();
    const headerNotas = decodeURIComponent(String(request.headers['x-firmware-notas'] || '')).trim();
    const autoUpdate = String(request.headers['x-firmware-autoupdate'] || 'false') === 'true';

    const versionDetectada = extraerVersionEmbebida(buf);
    const versionFinal = headerVersion || versionDetectada || `build-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;

    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    asegurarDirectorioOta();
    const tmpPath = `${BIN_PATH}.tmp`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, BIN_PATH);

    const meta: FirmwareMetadata = {
      version: versionFinal,
      md5,
      sha256,
      size: buf.length,
      filename: headerFilename,
      notas: headerNotas,
      autoUpdate,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.username || 'admin'
    };
    guardarMetadataFirmware(meta);
    fallosRecientes.clear();

    console.log(`[OTA] Nuevo firmware subido: v=${meta.version}, size=${meta.size} bytes, md5=${meta.md5}, autoUpdate=${meta.autoUpdate}`);
    emitirEventoWsOta(fastify);

    return {
      ok: true,
      version_detectada_en_binario: versionDetectada,
      firmware: meta
    };
  });

  // 3. Actualizar configuración OTA (toggle autoUpdate / editar notas o versión)
  fastify.post('/api/ota/config', async (request, reply) => {
    let user: any;
    try {
      await request.jwtVerify();
      user = request.user as any;
    } catch {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    if (user.rol !== 'admin') {
      return reply.status(403).send({ error: 'Solo administradores' });
    }

    const meta = leerMetadataFirmware();
    if (!meta) {
      return reply.status(404).send({ error: 'No hay ningún firmware cargado actualmente' });
    }

    const b = (request.body as Record<string, any>) || {};
    if (typeof b.autoUpdate === 'boolean') meta.autoUpdate = b.autoUpdate;
    if (typeof b.version === 'string' && b.version.trim()) meta.version = b.version.trim();
    if (typeof b.notas === 'string') meta.notas = b.notas.trim();

    guardarMetadataFirmware(meta);
    if (meta.autoUpdate) {
      fallosRecientes.clear();
    }
    emitirEventoWsOta(fastify);
    return { ok: true, firmware: meta };
  });

  // 4. Disparar actualización OTA remota hacia un ESP32 específico o todos ('*')
  fastify.post('/api/ota/trigger', async (request, reply) => {
    let user: any;
    try {
      await request.jwtVerify();
      user = request.user as any;
    } catch {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    if (user.rol !== 'admin') {
      return reply.status(403).send({ error: 'Solo administradores pueden enviar actualizaciones OTA' });
    }

    const meta = leerMetadataFirmware();
    if (!meta) {
      return reply.status(400).send({ error: 'Primero debes subir un archivo .bin de firmware' });
    }

    const b = (request.body as Record<string, any>) || {};
    const target = String(b.dispositivo_id || '').trim();
    const forzar = Boolean(b.forzar);
    const cancelar = Boolean(b.cancelar);

    if (!target) {
      return reply.status(400).send({ error: 'dispositivo_id es requerido' });
    }

    const ids = target === '*' ? Array.from(dispositivosOta.keys()) : [target];
    for (const id of ids) {
      if (cancelar) {
        ordenesManuales.delete(id);
        const d = dispositivosOta.get(id);
        if (d) {
          d.estado_ota = calcularEstadoBase(d, meta);
          d.mensaje_ota = 'Orden OTA cancelada';
        }
      } else {
        ordenesManuales.set(id, { forzar, solicitadoEn: Date.now() });
        fallosRecientes.delete(id);
        const d = dispositivosOta.get(id);
        if (d) {
          d.estado_ota = 'pendiente_envio';
          d.progreso_pct = 0;
          d.mensaje_ota = `Esperando siguiente latido de ${id} para iniciar descarga...`;
          d.ultimo_evento_ota = new Date().toISOString();
        } else {
          dispositivosOta.set(id, {
            dispositivo_id: id,
            firmware_version: 'pendiente',
            sketch_md5: '',
            wifi_ssid: '',
            wifi_rssi: null,
            ip_local: '',
            uptime_s: null,
            ultimo_contacto: new Date().toISOString(),
            estado_ota: 'pendiente_envio',
            progreso_pct: 0,
            mensaje_ota: `Orden en cola. Se actualizará apenas ${id} se conecte.`,
            ultimo_evento_ota: new Date().toISOString()
          });
        }
      }
    }

    emitirEventoWsOta(fastify);
    return {
      ok: true,
      objetivos: ids,
      mensaje: cancelar ? 'Orden cancelada' : `Orden de actualización enviada a: ${ids.join(', ')}`
    };
  });

  // 5. Eliminar firmware actual del servidor
  fastify.delete('/api/ota/firmware', async (request, reply) => {
    let user: any;
    try {
      await request.jwtVerify();
      user = request.user as any;
    } catch {
      return reply.status(401).send({ error: 'No autorizado' });
    }
    if (user.rol !== 'admin') {
      return reply.status(403).send({ error: 'Solo administradores' });
    }

    if (fs.existsSync(BIN_PATH)) fs.unlinkSync(BIN_PATH);
    if (fs.existsSync(META_PATH)) fs.unlinkSync(META_PATH);
    ordenesManuales.clear();
    fallosRecientes.clear();
    emitirEventoWsOta(fastify);
    return { ok: true };
  });

  // 6. Consulta directa desde el ESP32 (al arrancar o desde botón en 192.168.4.1)
  fastify.get('/api/ota/check', async (request) => {
    const q = (request.query as Record<string, string>) || {};
    const dispId = String(q.dispositivo_id || '').trim();
    const versionActual = String(q.version || '').trim();
    const md5Actual = String(q.md5 || '').trim().toLowerCase();
    const manual = q.manual === '1';

    const meta = leerMetadataFirmware();
    if (!meta) {
      return { disponible: false, actualizar: false };
    }

    const mismoMd5 = md5Actual.length > 0 && md5Actual === meta.md5.toLowerCase();
    const hayNueva = !mismoMd5 && (md5Actual.length > 0 || versionActual !== meta.version);
    const ordenPendiente = dispId ? ordenesManuales.has(dispId) : false;

    return {
      disponible: true,
      actualizar: ordenPendiente || (manual ? hayNueva : (meta.autoUpdate && hayNueva)),
      hay_nueva: hayNueva,
      version: meta.version,
      md5: meta.md5,
      size: meta.size,
      notas: meta.notas,
      url: `/api/ota/download${dispId ? `?dispositivo_id=${encodeURIComponent(dispId)}` : ''}`
    };
  });

  // 7. Descarga binaria del firmware hacia el ESP32
  fastify.get('/api/ota/download', async (request, reply) => {
    const meta = leerMetadataFirmware();
    if (!meta || !fs.existsSync(BIN_PATH)) {
      return reply.status(404).send({ error: 'No hay firmware disponible en el servidor' });
    }

    const q = (request.query as Record<string, string>) || {};
    const dispId = String(q.dispositivo_id || '').trim();
    if (dispId) {
      ordenesManuales.delete(dispId);
      const d = dispositivosOta.get(dispId);
      if (d) {
        d.estado_ota = 'descargando';
        d.progreso_pct = 25;
        d.mensaje_ota = `Transfiriendo ${meta.filename} (${(meta.size / 1024).toFixed(0)} KB)...`;
        d.ultimo_evento_ota = new Date().toISOString();
        emitirEventoWsOta(fastify);
      }
    }

    console.log(`[OTA] Descargando firmware v${meta.version} (${meta.size} bytes) -> dispositivo='${dispId || 'directo'}'`);
    const buffer = fs.readFileSync(BIN_PATH);

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', String(buffer.length));
    reply.header('Content-Disposition', `attachment; filename="${meta.filename}"`);
    reply.header('X-MD5', meta.md5);
    reply.header('X-Firmware-Version', meta.version);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return reply.send(buffer);
  });

  // 8. Reporte de progreso/resultado enviado por el ESP32
  fastify.post('/api/ota/reporte', async (request) => {
    const b = (request.body as Record<string, any>) || {};
    const dispId = String(b.dispositivo_id || '').trim();
    const estado = String(b.estado || '').trim();
    const progreso = b.progreso !== undefined ? Number(b.progreso) : 0;
    const mensaje = String(b.mensaje || '').trim();
    const version = String(b.version || '').trim();
    const md5 = String(b.md5 || '').trim().toLowerCase();

    if (!dispId) return { ok: false };

    const ahoraIso = new Date().toISOString();
    const d = dispositivosOta.get(dispId) || {
      dispositivo_id: dispId,
      firmware_version: version || 'desconocida',
      sketch_md5: md5,
      wifi_ssid: '',
      wifi_rssi: null,
      ip_local: '',
      uptime_s: null,
      ultimo_contacto: ahoraIso,
      estado_ota: 'descargando' as const,
      progreso_pct: 0,
      mensaje_ota: '',
      ultimo_evento_ota: ahoraIso
    };

    if (version) d.firmware_version = version;
    if (md5 && estado === 'completado') d.sketch_md5 = md5;
    d.ultimo_contacto = ahoraIso;
    d.ultimo_evento_ota = ahoraIso;
    d.progreso_pct = Math.max(0, Math.min(100, isNaN(progreso) ? 0 : progreso));
    if (mensaje) d.mensaje_ota = mensaje;

    if (estado === 'descargando') {
      d.estado_ota = 'descargando';
    } else if (estado === 'reiniciando') {
      d.estado_ota = 'reiniciando';
      d.progreso_pct = 95;
    } else if (estado === 'completado') {
      d.estado_ota = 'al_dia';
      d.progreso_pct = 100;
      fallosRecientes.delete(dispId);
    } else if (estado === 'error') {
      d.estado_ota = 'error';
      const meta = leerMetadataFirmware();
      if (meta) {
        fallosRecientes.set(dispId, { md5: meta.md5, ts: Date.now() });
      }
    }

    dispositivosOta.set(dispId, d);
    console.log(`[OTA REPORTE] ${dispId}: estado=${estado}, progreso=${d.progreso_pct}%, msg="${mensaje}"`);
    emitirEventoWsOta(fastify);
    return { ok: true };
  });
};
