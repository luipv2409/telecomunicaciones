import { useState, useEffect, useRef } from 'react';
import { getApiUrl, getWsUrl } from './config';

function formatearBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatearTiempoRelativo(isoStr) {
  if (!isoStr) return 'Nunca';
  const seg = Math.max(0, Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000));
  if (seg < 5) return 'Justo ahora';
  if (seg < 60) return `Hace ${seg}s`;
  if (seg < 3600) return `Hace ${Math.floor(seg / 60)} min`;
  return new Date(isoStr).toLocaleString();
}

export default function OtaManager({ auth, alVolver, alIrAlMapa }) {
  const [firmware, setFirmware] = useState(null);
  const [dispositivos, setDispositivos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [wsConectado, setWsConectado] = useState(false);

  // Formulario de subida
  const [archivo, setArchivo] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [versionInput, setVersionInput] = useState('');
  const [notasInput, setNotasInput] = useState('');
  const [autoUpdateInput, setAutoUpdateInput] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [progresoSubida, setProgresoSubida] = useState(0);
  const [guiaAbierta, setGuiaAbierta] = useState(false);

  // Mensajes de feedback
  const [alerta, setAlerta] = useState(null);
  const [ahoraTick, setAhoraTick] = useState(Date.now());
  const fileInputRef = useRef(null);

  const esAdmin = auth?.rol === 'admin';

  const mostrarAlerta = (ok, texto) => {
    setAlerta({ ok, texto });
  };

  const cargarDatosOta = async () => {
    try {
      const res = await fetch(getApiUrl('/api/ota/info'), {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      if (!res.ok) throw new Error('No se pudo consultar el estado OTA');
      const data = await res.json();
      setFirmware(data.firmware || null);
      setDispositivos(Array.isArray(data.dispositivos) ? data.dispositivos : []);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatosOta();
    const pollId = setInterval(cargarDatosOta, 5000);
    const tickId = setInterval(() => setAhoraTick(Date.now()), 2000);

    let ws = null;
    let reconectarId = null;
    let cerrado = false;

    const conectarWs = () => {
      try {
        ws = new WebSocket(getWsUrl('/ws'));
        ws.onopen = () => setWsConectado(true);
        ws.onclose = () => {
          setWsConectado(false);
          if (!cerrado) reconectarId = setTimeout(conectarWs, 3000);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.tipo_evento === 'ota_estado') {
              setFirmware(msg.firmware || null);
              if (Array.isArray(msg.dispositivos)) {
                setDispositivos(msg.dispositivos);
              }
              if (msg.alerta_ota) {
                mostrarAlerta(true, `🎉 ${msg.dispositivo_id}: ${msg.alerta_ota}`);
              }
            }
          } catch {}
        };
      } catch {}
    };
    conectarWs();

    return () => {
      cerrado = true;
      clearInterval(pollId);
      clearInterval(tickId);
      clearTimeout(reconectarId);
      if (ws) ws.close();
    };
  }, [auth.token]);

  const seleccionarArchivo = (file) => {
    if (!file) return;
    const nombre = file.name.toLowerCase();
    if (!nombre.endsWith('.bin')) {
      mostrarAlerta(false, 'Selecciona un archivo compilado con extensión .bin');
      return;
    }
    if (nombre.endsWith('.bootloader.bin') || nombre.endsWith('.partitions.bin') || nombre.endsWith('.merged.bin')) {
      mostrarAlerta(
        false,
        `Seleccionaste "${file.name}". Para actualización OTA debes elegir únicamente "esp32_tracemin.ino.bin" (sin .bootloader, .partitions ni .merged).`
      );
      return;
    }
    setAlerta(null);
    setArchivo(file);
  };

  const subirFirmware = () => {
    if (!archivo) {
      mostrarAlerta(false, 'Primero selecciona el archivo .bin compilado.');
      return;
    }
    setSubiendo(true);
    setProgresoSubida(0);
    setAlerta(null);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', getApiUrl('/api/ota/upload'), true);
    xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Firmware-Filename', encodeURIComponent(archivo.name));
    if (versionInput.trim()) {
      xhr.setRequestHeader('X-Firmware-Version', encodeURIComponent(versionInput.trim()));
    }
    if (notasInput.trim()) {
      xhr.setRequestHeader('X-Firmware-Notas', encodeURIComponent(notasInput.trim()));
    }
    xhr.setRequestHeader('X-Firmware-Autoupdate', autoUpdateInput ? 'true' : 'false');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setProgresoSubida(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      setSubiendo(false);
      let resp = {};
      try {
        resp = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        setFirmware(resp.firmware);
        setArchivo(null);
        setVersionInput('');
        setNotasInput('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        const detectada = resp.version_detectada_en_binario
          ? ` (versión detectada en el binario: ${resp.version_detectada_en_binario})`
          : '';
        mostrarAlerta(true, `✅ Firmware "${resp.firmware.version}" subido y verificado correctamente${detectada}.`);
        cargarDatosOta();
      } else {
        mostrarAlerta(false, resp.error || `Error al subir el firmware (HTTP ${xhr.status})`);
      }
    };

    xhr.onerror = () => {
      setSubiendo(false);
      mostrarAlerta(false, 'Error de red al subir el archivo .bin al servidor.');
    };

    xhr.send(archivo);
  };

  const cambiarAutoUpdate = async (nuevoValor) => {
    try {
      const res = await fetch(getApiUrl('/api/ota/config'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ autoUpdate: nuevoValor })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error actualizando configuración');
      setFirmware(data.firmware);
      mostrarAlerta(
        true,
        nuevoValor
          ? '⚡ Auto-Actualización ACTIVADA: cualquier ESP32 con versión anterior se actualizará solo.'
          : 'Auto-Actualización desactivada (solo envío manual).'
      );
    } catch (err) {
      mostrarAlerta(false, err.message);
    }
  };

  const dispararOta = async (dispositivoId, forzar = false, cancelar = false) => {
    try {
      const res = await fetch(getApiUrl('/api/ota/trigger'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ dispositivo_id: dispositivoId, forzar, cancelar })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar la orden OTA');
      mostrarAlerta(true, `🚀 ${data.mensaje}`);
      cargarDatosOta();
    } catch (err) {
      mostrarAlerta(false, err.message);
    }
  };

  const eliminarFirmware = async () => {
    if (!window.confirm('¿Seguro que deseas quitar el archivo .bin activo del servidor?')) return;
    try {
      const res = await fetch(getApiUrl('/api/ota/firmware'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      if (!res.ok) throw new Error('No se pudo eliminar el firmware');
      setFirmware(null);
      mostrarAlerta(true, '🗑 Firmware eliminado del servidor.');
      cargarDatosOta();
    } catch (err) {
      mostrarAlerta(false, err.message);
    }
  };

  const renderBadgeEstado = (disp) => {
    switch (disp.estado_ota) {
      case 'al_dia':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700/80">✓ AL DÍA</span>;
      case 'actualizacion_disponible':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/90 text-amber-300 border border-amber-700/80">⬆️ NUEVA VERSIÓN</span>;
      case 'pendiente_envio':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-950/90 text-sky-300 border border-sky-700/80 animate-pulse">⏳ EN COLA</span>;
      case 'descargando':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-950/90 text-blue-300 border border-blue-600 animate-pulse">📥 FLASHEANDO...</span>;
      case 'reiniciando':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-950/90 text-purple-300 border border-purple-600 animate-pulse">🔄 REINICIANDO...</span>;
      case 'error':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-950/90 text-red-300 border border-red-600">❌ ERROR OTA</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">SIN RELEASE</span>;
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={alVolver}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-2 px-3.5 rounded-xl text-xs transition"
            >
              ← Menú
            </button>
            {alIrAlMapa && (
              <button
                onClick={alIrAlMapa}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-semibold py-2 px-3.5 rounded-xl text-xs transition"
              >
                🗺️ Ir al Mapa
              </button>
            )}
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
                <span>🔄</span> Actualización Remota de Firmware (OTA)
              </h1>
              <p className="text-xs text-zinc-400">
                Actualiza el código de tus ESP32-S3 por internet sin conectar cables USB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={`w-2.5 h-2.5 rounded-full ${wsConectado ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="text-zinc-400">{wsConectado ? 'Canal en vivo activo' : 'Sincronizando...'}</span>
          </div>
        </div>

        {/* Alerta global */}
        {alerta && (
          <div
            className={`p-4 rounded-2xl border text-sm flex items-center justify-between gap-3 shadow-lg ${
              alerta.ok
                ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
                : 'bg-red-950/70 border-red-700 text-red-200'
            }`}
          >
            <span>{alerta.texto}</span>
            <button onClick={() => setAlerta(null)} className="text-zinc-400 hover:text-white font-bold px-2">
              ✕
            </button>
          </div>
        )}

        {!esAdmin && (
          <div className="bg-amber-950/50 border border-amber-700/70 text-amber-200 p-4 rounded-2xl text-xs">
            Estás conectado con rol <b>{auth.rol}</b> (solo lectura). Inicia sesión como <b>admin</b> para subir nuevos archivos <code>.bin</code> o disparar actualizaciones.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Columna Izquierda: Subida + Firmware Activo */}
          <div className="lg:col-span-5 space-y-6">
            {/* Tarjeta Firmware Activo en la Nube */}
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <span>☁️</span> Firmware Activo en el Servidor
                </h2>
                {firmware && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-red-600/20 text-red-400 border border-red-500/40">
                    v{firmware.version}
                  </span>
                )}
              </div>

              {cargando ? (
                <div className="text-xs text-zinc-500 py-6 text-center">Consultando servidor...</div>
              ) : !firmware ? (
                <div className="bg-zinc-950 border border-dashed border-zinc-800 rounded-xl p-6 text-center text-xs text-zinc-400 space-y-1">
                  <div className="text-2xl mb-1">📭</div>
                  <div className="font-semibold text-zinc-300">Aún no hay ningún binario cargado</div>
                  <div>Compila tu sketch en Arduino IDE y súbelo abajo para habilitar actualizaciones remotas.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Archivo:</span>
                      <span className="font-mono text-zinc-200 truncate max-w-[210px]">{firmware.filename}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tamaño:</span>
                      <span className="font-mono text-cyan-400 font-semibold">{formatearBytes(firmware.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Checksum MD5:</span>
                      <span className="font-mono text-emerald-400 text-[11px]" title={firmware.md5}>
                        {firmware.md5.slice(0, 16)}…
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Subido:</span>
                      <span className="text-zinc-300">{new Date(firmware.uploadedAt).toLocaleString()}</span>
                    </div>
                    {firmware.notas && (
                      <div className="pt-2 border-t border-zinc-800/80 text-zinc-300 italic">
                        “{firmware.notas}”
                      </div>
                    )}
                  </div>

                  {esAdmin && (
                    <>
                      <label className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-xl p-3 cursor-pointer hover:border-zinc-700 transition">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>⚡</span> Auto-Actualizar Flota
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            Si se activa, todo ESP32 con otro MD5 se actualizará al conectarse.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!firmware.autoUpdate}
                          onChange={(e) => cambiarAutoUpdate(e.target.checked)}
                          className="w-5 h-5 accent-red-600 cursor-pointer"
                        />
                      </label>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => dispararOta('*', false)}
                          disabled={dispositivos.length === 0}
                          className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition shadow-lg shadow-red-900/30"
                        >
                          🚀 Actualizar Todos ({dispositivos.length})
                        </button>
                        <button
                          type="button"
                          onClick={eliminarFirmware}
                          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-red-400 font-semibold py-2.5 px-3 rounded-xl text-xs transition"
                          title="Eliminar binario del servidor"
                        >
                          🗑
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Tarjeta Subir Nuevo .bin */}
            {esAdmin && (
              <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <span>📦</span> Subir Nueva Versión (.bin)
                  </h2>
                  <button
                    type="button"
                    onClick={() => setGuiaAbierta(!guiaAbierta)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    {guiaAbierta ? 'Ocultar guía ▲' : '¿Cómo generar el .bin? ▼'}
                  </button>
                </div>

                {guiaAbierta && (
                  <ol className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-xs text-zinc-300 list-decimal pl-7 space-y-1.5 leading-relaxed">
                    <li>
                      Abre <code className="text-cyan-400">esp32_tracemin.ino</code> en <b>Arduino IDE</b> y haz tus mejoras (opcionalmente sube <code className="text-amber-300">FIRMWARE_VERSION</code>, ej. <code className="text-amber-300">"3.2-ota"</code>).
                    </li>
                    <li>
                      En el menú superior haz clic en <b>Sketch &rarr; Export Compiled Binary</b> (o pulsa <kbd className="bg-zinc-800 px-1.5 py-0.5 rounded">Ctrl+Alt+S</kbd>).
                    </li>
                    <li>
                      Entra a la carpeta <code className="text-cyan-400">firmware/esp32_tracemin/build/esp32.esp32.esp32s3/</code>.
                    </li>
                    <li>
                      Elige el archivo <b className="text-emerald-400">esp32_tracemin.ino.bin</b> <span className="text-zinc-500">(no uses .bootloader.bin ni .merged.bin)</span>.
                    </li>
                  </ol>
                )}

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setArrastrando(true);
                  }}
                  onDragLeave={() => setArrastrando(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setArrastrando(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      seleccionarArchivo(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
                    arrastrando
                      ? 'border-red-500 bg-red-950/30'
                      : archivo
                      ? 'border-emerald-600 bg-emerald-950/20'
                      : 'border-zinc-700 hover:border-zinc-500 bg-zinc-950/70'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".bin"
                    className="hidden"
                    onChange={(e) => seleccionarArchivo(e.target.files?.[0])}
                  />
                  {archivo ? (
                    <div className="space-y-1">
                      <div className="text-2xl">✅</div>
                      <div className="text-sm font-bold text-emerald-300 break-all">{archivo.name}</div>
                      <div className="text-xs text-zinc-400 font-mono">{formatearBytes(archivo.size)} · Toca para cambiar</div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-2xl">⬆️</div>
                      <div className="text-sm font-semibold text-zinc-200">
                        Arrastra aquí <code className="text-red-400">esp32_tracemin.ino.bin</code>
                      </div>
                      <div className="text-xs text-zinc-500">o haz clic para seleccionarlo desde tu PC (máx. 3 MB)</div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 uppercase mb-1">
                      Etiqueta de Versión (opcional — se autodetecta del binario)
                    </label>
                    <input
                      type="text"
                      value={versionInput}
                      onChange={(e) => setVersionInput(e.target.value)}
                      placeholder="Ej: 3.2-ota (dejar vacío para detectar automáticamente)"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 uppercase mb-1">
                      Notas del cambio (opcional)
                    </label>
                    <input
                      type="text"
                      value={notasInput}
                      onChange={(e) => setNotasInput(e.target.value)}
                      placeholder="Ej: Calibración HC-SR04 y nuevo filtro GPS"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoUpdateInput}
                      onChange={(e) => setAutoUpdateInput(e.target.checked)}
                      className="w-4 h-4 accent-red-600"
                    />
                    <span>Activar Auto-Actualización inmediatamente al subir</span>
                  </label>

                  {subiendo && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                        <span>Subiendo binario a la nube...</span>
                        <span>{progresoSubida}%</span>
                      </div>
                      <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-600 to-amber-500 transition-all duration-200"
                          style={{ width: `${progresoSubida}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={subirFirmware}
                    disabled={!archivo || subiendo}
                    className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-40 text-white font-bold py-3 px-4 rounded-xl text-sm shadow-lg transition"
                  >
                    {subiendo ? 'Subiendo y validando binario...' : '☁️ Publicar Firmware en el Servidor'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Columna Derecha: Flota de ESP32 Conectados */}
          <div className="lg:col-span-7">
            <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <span>📡</span> Dispositivos ESP32 Reportando
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Cuando envíes una orden OTA, el ESP32 la recibirá en su próximo latido (~2 segundos).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cargarDatosOta}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-xl text-xs font-semibold transition"
                >
                  🔄 Refrescar
                </button>
              </div>

              {dispositivos.length === 0 ? (
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-10 text-center space-y-2">
                  <div className="text-3xl">🛰️</div>
                  <div className="text-sm font-bold text-zinc-300">Esperando primer latido de tu ESP32...</div>
                  <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                    Apenas tu ESP32 tenga internet y envíe telemetría a <code className="text-cyan-400">trace.cybersec7.xyz</code>, aparecerá aquí con su versión de firmware, señal Wi-Fi y botón de actualización en 1 clic.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {dispositivos.map((disp) => {
                    const segSinContacto = disp.ultimo_contacto
                      ? Math.floor((ahoraTick - new Date(disp.ultimo_contacto).getTime()) / 1000)
                      : 999;
                    const enLinea = segSinContacto < 20;
                    const enProceso =
                      disp.estado_ota === 'descargando' ||
                      disp.estado_ota === 'reiniciando' ||
                      disp.estado_ota === 'pendiente_envio';

                    return (
                      <div
                        key={disp.dispositivo_id}
                        className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4 transition space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`w-3 h-3 rounded-full ${
                                enLinea ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-zinc-600'
                              }`}
                            />
                            <span className="font-extrabold text-base text-white">{disp.dispositivo_id}</span>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                                enLinea
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {enLinea ? 'EN LÍNEA' : `OFFLINE (${formatearTiempoRelativo(disp.ultimo_contacto)})`}
                            </span>
                          </div>
                          {renderBadgeEstado(disp)}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2.5">
                            <span className="block text-[10px] text-zinc-500 uppercase">Versión Actual</span>
                            <span className="font-mono font-bold text-cyan-400">{disp.firmware_version || '—'}</span>
                          </div>
                          <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2.5">
                            <span className="block text-[10px] text-zinc-500 uppercase">MD5 en Flash</span>
                            <span className="font-mono text-zinc-300" title={disp.sketch_md5 || 'No reportado (firmware antiguo)'}>
                              {disp.sketch_md5 ? `${disp.sketch_md5.slice(0, 10)}…` : 'v3.0 (sin OTA)'}
                            </span>
                          </div>
                          <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2.5">
                            <span className="block text-[10px] text-zinc-500 uppercase">Red Wi-Fi</span>
                            <span className="font-mono text-zinc-200 truncate block">
                              {disp.wifi_ssid ? `${disp.wifi_ssid} (${disp.wifi_rssi} dBm)` : '—'}
                            </span>
                          </div>
                          <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2.5">
                            <span className="block text-[10px] text-zinc-500 uppercase">IP Local ESP32</span>
                            <span className="font-mono text-emerald-400">{disp.ip_local || '—'}</span>
                          </div>
                        </div>

                        {!disp.sketch_md5 && disp.firmware_version === 'desconocida' && (
                          <div className="bg-amber-950/40 border border-amber-800/60 text-amber-200/90 rounded-xl px-3 py-2 text-[11px]">
                            ⚠️ Este dispositivo aún corre el firmware anterior sin cliente OTA. Cárgale por USB una última vez el nuevo <code>esp32_tracemin.ino</code> (v3.1-ota) y desde entonces todas las futuras mejoras serán 100% por internet.
                          </div>
                        )}

                        {(enProceso || disp.mensaje_ota) && (
                          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-zinc-300">{disp.mensaje_ota || 'Procesando actualización OTA...'}</span>
                              {enProceso && (
                                <span className="font-mono font-bold text-cyan-400">{disp.progreso_pct || 0}%</span>
                              )}
                            </div>
                            {enProceso && (
                              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-300"
                                  style={{ width: `${Math.max(8, disp.progreso_pct || 10)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {esAdmin && firmware && (
                          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                            {disp.estado_ota === 'pendiente_envio' && (
                              <button
                                type="button"
                                onClick={() => dispararOta(disp.dispositivo_id, false, true)}
                                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-xl text-xs font-semibold"
                              >
                                Cancelar cola
                              </button>
                            )}
                            {disp.estado_ota === 'al_dia' ? (
                              <button
                                type="button"
                                onClick={() => dispararOta(disp.dispositivo_id, true)}
                                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3.5 py-2 rounded-xl text-xs font-semibold transition"
                              >
                                🔁 Reinstalar v{firmware.version} (Forzar)
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => dispararOta(disp.dispositivo_id, true)}
                                disabled={disp.estado_ota === 'descargando' || disp.estado_ota === 'reiniciando'}
                                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-red-900/30 transition"
                              >
                                🚀 Enviar v{firmware.version} a {disp.dispositivo_id}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
