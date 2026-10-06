import { useState, useEffect } from 'react';
import { getConfig, getApiUrl } from './config';

const IP_PORTAL_ESP32 = '192.168.4.1';

export default function ConfigEsp32({ puenteId, dispositivoId }) {
  const [abierto, setAbierto] = useState(false);
  const [ssid, setSsid] = useState('');
  const [clave, setClave] = useState('');
  const [host, setHost] = useState('');
  const [puerto, setPuerto] = useState('3001');
  const [ips, setIps] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const cfg = getConfig();
    setHost(cfg.host || '');
    setPuerto(cfg.port ? String(cfg.port) : '3001');
    fetch(getApiUrl('/api/info'))
      .then((res) => res.json())
      .then((info) => setIps(Array.isArray(info.ips) ? info.ips : []))
      .catch(() => setIps([]));
  }, [abierto]);

  const llamarEsp32 = async (ruta, opciones = {}) => {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 6000);
    try {
      const respuesta = await fetch(`http://${IP_PORTAL_ESP32}${ruta}`, { ...opciones, signal: controlador.signal });
      clearTimeout(temporizador);
      return respuesta;
    } catch (err) {
      clearTimeout(temporizador);
      throw err;
    }
  };

  const mensajeErrorConexion = () =>
    `No se encontró el ESP32. Conecta el celular a la red WiFi "TRACEMIN-ESP32" (clave: tracemin123) y vuelve a intentar. Si usas la web por HTTPS, usa la APK o abre http://${IP_PORTAL_ESP32}.`;

  const verificar = async () => {
    setOcupado(true);
    setMensaje(null);
    try {
      const respuesta = await llamarEsp32('/estado');
      const estado = await respuesta.json();
      setMensaje({
        ok: true,
        texto: `ESP32 detectado. Servidor: ${estado.host || 'sin configurar'}:${estado.puerto}. Estado: ${estado.estado}. Paquetes: ${estado.paquetes}`
      });
    } catch (err) {
      setMensaje({ ok: false, texto: mensajeErrorConexion() });
    }
    setOcupado(false);
  };

  const enviarConfiguracion = async () => {
    if (!ssid.trim() || !host.trim()) {
      setMensaje({ ok: false, texto: 'Indica el WiFi del hotspot y la IP del servidor.' });
      return;
    }
    setOcupado(true);
    setMensaje(null);
    try {
      const respuesta = await llamarEsp32('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid: ssid.trim(),
          clave,
          host: host.trim(),
          puerto: puerto.trim(),
          dispositivo: dispositivoId,
          puente: puenteId
        })
      });
      if (respuesta.ok) {
        setMensaje({
          ok: true,
          texto: 'Configuración enviada. El ESP32 se reinicia y se conectará solo a tu hotspot. Activa el hotspot del celular.'
        });
      } else {
        setMensaje({ ok: false, texto: `El ESP32 respondió con código ${respuesta.status}.` });
      }
    } catch (err) {
      setMensaje({ ok: false, texto: mensajeErrorConexion() });
    }
    setOcupado(false);
  };

  return (
    <div className="mb-4 text-left bg-zinc-950 border border-zinc-800 rounded-lg">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-zinc-300"
      >
        <span>🔧 Configurar mi ESP32</span>
        <span>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="px-3 pb-3 space-y-2.5">
          <ol className="text-[11px] text-zinc-400 list-decimal pl-4 space-y-1">
            <li>Enciende el ESP32 y conecta este celular a la red <b className="text-white">TRACEMIN-ESP32</b> (clave <b className="text-white">tracemin123</b>).</li>
            <li>Completa los datos y presiona <b className="text-white">Enviar al ESP32</b>.</li>
            <li>Reconecta el celular a internet y activa tu hotspot con el mismo nombre y clave.</li>
          </ol>

          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Nombre del hotspot (WiFi del celular)</label>
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-red-500"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Clave del hotspot</label>
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-red-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-[11px] text-zinc-500 mb-1">IP del servidor</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Puerto</label>
              <input
                type="text"
                value={puerto}
                onChange={(e) => setPuerto(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-red-500"
              />
            </div>
          </div>

          {ips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-zinc-500 w-full">IPs detectadas del servidor (toca para usar):</span>
              {ips.map((ip) => (
                <button
                  key={ip}
                  type="button"
                  onClick={() => setHost(ip)}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-cyan-300 text-[11px] font-mono px-2 py-1 rounded-md"
                >
                  {ip}
                </button>
              ))}
            </div>
          )}

          {mensaje && (
            <div
              className={`p-2.5 rounded-lg text-[11px] border ${
                mensaje.ok
                  ? 'bg-green-950/60 border-green-700 text-green-300'
                  : 'bg-red-950/60 border-red-700 text-red-300'
              }`}
            >
              {mensaje.texto}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={verificar}
              disabled={ocupado}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-2 rounded-lg text-xs disabled:opacity-50"
            >
              Buscar ESP32
            </button>
            <button
              type="button"
              onClick={enviarConfiguracion}
              disabled={ocupado}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-lg text-xs disabled:opacity-50"
            >
              Enviar al ESP32
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
