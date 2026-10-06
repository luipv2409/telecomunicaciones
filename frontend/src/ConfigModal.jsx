import { useState, useEffect } from 'react';
import { getConfig, saveConfig, resetConfig, probarConexion } from './config';

export default function ConfigModal({ abierto, alCerrar, alGuardar }) {
  const [protocol, setProtocol] = useState('http');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('3000');
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState(null);
  const [guardadoExitoso, setGuardadoExitoso] = useState(false);

  useEffect(() => {
    if (abierto) {
      const cfg = getConfig();
      setProtocol(cfg.protocol || 'http');
      setHost(cfg.host || '127.0.0.1');
      setPort(cfg.port !== undefined ? String(cfg.port) : '3000');
      setResultadoPrueba(null);
      setGuardadoExitoso(false);
    }
  }, [abierto]);

  if (!abierto) return null;

  const handleTest = async () => {
    setProbando(true);
    setResultadoPrueba(null);
    const resultado = await probarConexion({ protocol, host, port });
    setProbando(false);
    setResultadoPrueba(resultado);
  };

  const handleSave = () => {
    const guardado = saveConfig({
      protocol,
      host: host.trim(),
      port: port.trim()
    });
    setGuardadoExitoso(true);
    setTimeout(() => {
      setGuardadoExitoso(false);
      if (alGuardar) alGuardar(guardado);
      if (alCerrar) alCerrar();
    }, 600);
  };

  const handleReset = () => {
    const porDefecto = resetConfig();
    setProtocol(porDefecto.protocol);
    setHost(porDefecto.host);
    setPort(porDefecto.port);
    setResultadoPrueba(null);
  };

  const aplicarPreset = (tipo) => {
    if (tipo === 'local') {
      setProtocol('http');
      setHost('127.0.0.1');
      setPort('3001');
    } else if (tipo === 'tailscale') {
      setProtocol('http');
      setHost('100.96.196.41');
      setPort('3001');
    } else if (tipo === 'nginx') {
      setProtocol('http');
      setHost('127.0.0.1');
      setPort('8080');
    }
    setResultadoPrueba(null);
  };

  const urlGenerada = `${protocol}://${host || '127.0.0.1'}${port ? `:${port}` : ''}`;
  const wsGenerada = `${protocol === 'https' ? 'wss' : 'ws'}://${host || '127.0.0.1'}${port ? `:${port}` : ''}/ws`;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative text-white animate-in fade-in zoom-in duration-200">
        <button
          onClick={alCerrar}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white text-xl font-bold p-1 leading-none"
          title="Cerrar"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-xl">
            ⚙️
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Configuración del Servidor</h2>
            <p className="text-xs text-zinc-400">Conexión para red local o Tailscale</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Accesos Rápidos (Presets):</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => aplicarPreset('local')}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-1.5 px-2 rounded-lg border border-zinc-700 transition-colors"
            >
              💻 Local (3000)
            </button>
            <button
              type="button"
              onClick={() => aplicarPreset('tailscale')}
              className="bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-xs py-1.5 px-2 rounded-lg border border-zinc-700 transition-colors"
            >
              🌐 Tailscale
            </button>
            <button
              type="button"
              onClick={() => aplicarPreset('nginx')}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-1.5 px-2 rounded-lg border border-zinc-700 transition-colors"
            >
              🐳 Docker (8080)
            </button>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1 font-medium">Protocolo</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProtocol('http')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  protocol === 'http'
                    ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-600/20'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                HTTP (Red Local / Tailscale)
              </button>
              <button
                type="button"
                onClick={() => setProtocol('https')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  protocol === 'https'
                    ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-600/20'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                HTTPS (Certificado SSL)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1 font-medium">Dirección IP o Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="100.115.20.45 o 192.168.1.50"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1 font-medium">Puerto</label>
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="3000"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
              />
            </div>
          </div>

          <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80 text-[11px] font-mono text-zinc-400 space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-500">API:</span>
              <span className="text-cyan-400 truncate max-w-[240px]">{urlGenerada}/api/...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">WS:</span>
              <span className="text-emerald-400 truncate max-w-[240px]">{wsGenerada}</span>
            </div>
          </div>
        </div>

        {resultadoPrueba && (
          <div
            className={`p-3 rounded-lg mb-4 text-xs flex items-center gap-2 border ${
              resultadoPrueba.ok
                ? 'bg-green-950/60 border-green-700 text-green-300'
                : 'bg-red-950/60 border-red-700 text-red-300'
            }`}
          >
            <span>{resultadoPrueba.ok ? '✅' : '❌'}</span>
            <span className="flex-1">{resultadoPrueba.mensaje}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={probando}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {probando ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                Probando...
              </>
            ) : (
              <>
                <span>📡</span>
                Probar Conexión
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition-colors shadow-lg shadow-red-600/20"
          >
            {guardadoExitoso ? '¡Guardado! ✓' : 'Guardar y Aplicar'}
          </button>
        </div>

        <div className="mt-3 flex justify-between items-center text-[11px] text-zinc-500">
          <button
            type="button"
            onClick={handleReset}
            className="hover:text-zinc-300 underline"
          >
            Restablecer valores por defecto
          </button>
          <span>Guarda en este dispositivo</span>
        </div>
      </div>
    </div>
  );
}
