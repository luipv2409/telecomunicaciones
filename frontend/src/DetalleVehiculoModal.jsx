import { useState, useEffect, useRef } from 'react';
import { getApiUrl } from './config';

export default function DetalleVehiculoModal({ vehiculo, alCerrar, auth }) {
  const [tabActiva, setTabActiva] = useState('sensores'); // 'sensores' | 'camara' | 'actuadores'
  const [timestampFrame, setTimestampFrame] = useState(Date.now());
  const [pausadoStream, setPausadoStream] = useState(false);
  const [infoCamara, setInfoCamara] = useState(null);
  const [cargandoCamara, setCargandoCamara] = useState(false);
  const [simulandoFrame, setSimulandoFrame] = useState(false);

  // Estados de actuadores
  const [estadosActuadores, setEstadosActuadores] = useState({
    corte_motor: false,
    alarma_sonora: false,
    luces_emergencia: false,
    bloqueo_puertas: false
  });
  const [comandosPendientes, setComandosPendientes] = useState(0);
  const [enviandoComando, setEnviandoComando] = useState(null);
  const [mensajeActuador, setMensajeActuador] = useState(null);
  const [confirmarCorteMotor, setConfirmarCorteMotor] = useState(false);

  const vehiculoId = vehiculo ? vehiculo.id : '';

  // 1. Polling para el streaming de cámara (solo si la pestaña 'camara' está activa y no pausada)
  useEffect(() => {
    if (!vehiculoId || tabActiva !== 'camara' || pausadoStream) return;

    const actualizarFrame = () => {
      setTimestampFrame(Date.now());
      consultarInfoCamara();
    };

    actualizarFrame();
    const intervalo = setInterval(actualizarFrame, 1500); // 1.5s: fluido sin saturar la red ni el ESP32

    return () => clearInterval(intervalo);
  }, [vehiculoId, tabActiva, pausadoStream]);

  // 2. Polling o carga de actuadores cuando se abre la pestaña 'actuadores'
  useEffect(() => {
    if (!vehiculoId || tabActiva !== 'actuadores') return;

    cargarEstadosActuadores();
    const intervalo = setInterval(cargarEstadosActuadores, 2500);

    return () => clearInterval(intervalo);
  }, [vehiculoId, tabActiva]);

  const consultarInfoCamara = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/camara/${encodeURIComponent(vehiculoId)}/info`), {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setInfoCamara(data);
      }
    } catch (e) {
      // silencioso en polling
    }
  };

  const cargarEstadosActuadores = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/actuadores/${encodeURIComponent(vehiculoId)}`), {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.actuadores) {
          setEstadosActuadores(prev => ({ ...prev, ...data.actuadores }));
        }
        setComandosPendientes(data.comandos_pendientes || 0);
      }
    } catch (e) {
      console.warn('Error consultando actuadores:', e);
    }
  };

  const ejecutarComandoActuador = async (actuador, nuevoValor) => {
    setEnviandoComando(actuador);
    setMensajeActuador(null);

    try {
      const res = await fetch(getApiUrl(`/api/actuadores/${encodeURIComponent(vehiculoId)}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(auth?.token ? { 'Authorization': `Bearer ${auth.token}` } : {})
        },
        body: JSON.stringify({ actuador, valor: nuevoValor })
      });

      const data = await res.json();
      if (res.ok) {
        setEstadosActuadores(prev => ({ ...prev, [actuador]: nuevoValor }));
        setMensajeActuador({
          tipo: 'ok',
          texto: `Comando "${actuador.replace('_', ' ')}" enviado. Se aplicará en el próximo ciclo del ESP32.`
        });
        cargarEstadosActuadores();
      } else {
        setMensajeActuador({
          tipo: 'error',
          texto: data.error || 'Error al enviar comando'
        });
      }
    } catch (err) {
      setMensajeActuador({
        tipo: 'error',
        texto: `Fallo de conexión: ${err.message}`
      });
    } finally {
      setEnviandoComando(null);
      setTimeout(() => setMensajeActuador(null), 5000);
    }
  };

  // 3. Simular fotograma de prueba (para probar el pipeline visual sin hardware conectado)
  const simularFrameDePrueba = async () => {
    setSimulandoFrame(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');

      // Fondo de cabina minera
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 640, 480);

      // Simular horizonte de socavón / tajo
      const grad = ctx.createLinearGradient(0, 0, 0, 480);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.5, '#334155');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 100, 640, 280);

      // Líneas de perspectiva (túnel o ruta minera)
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 4;
      ctx.setLineDash([20, 15]);
      ctx.beginPath();
      ctx.moveTo(320, 240);
      ctx.lineTo(120, 480);
      ctx.moveTo(320, 240);
      ctx.lineTo(520, 480);
      ctx.stroke();
      ctx.setLineDash([]);

      // OSD HUD (Over-Screen Display)
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(15, 15, 610, 65);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(15, 15, 610, 65);

      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`CAM-ONBOARD [${vehiculoId}]`, 30, 40);

      ctx.font = '12px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`VEL: ${vehiculo?.velocidad || 0} km/h | ALT: ${vehiculo?.altitud || 0}m | RUMBO: ${vehiculo?.rumbo || 0}°`, 30, 62);

      const fechaStr = new Date().toLocaleTimeString();
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`REC ● ${fechaStr}`, 470, 40);

      // Mira central
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(320, 240, 30, 0, Math.PI * 2);
      ctx.moveTo(320, 195);
      ctx.lineTo(320, 285);
      ctx.moveTo(275, 240);
      ctx.lineTo(365, 240);
      ctx.stroke();

      const base64 = canvas.toDataURL('image/jpeg', 0.85);

      await fetch(getApiUrl('/api/camara/frame'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          dispositivo_id: vehiculoId,
          imagen_base64: base64
        })
      });

      setTimestampFrame(Date.now());
      consultarInfoCamara();
    } catch (err) {
      console.error('Error generando frame simulado:', err);
    } finally {
      setSimulandoFrame(false);
    }
  };

  const descargarSnapshot = () => {
    const url = getApiUrl(`/api/camara/${encodeURIComponent(vehiculoId)}/frame?t=${timestampFrame}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot_${vehiculoId}_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!vehiculo) return null;

  // Cálculos de inclinómetro
  const pitchNum = parseFloat(vehiculo.pitch || 0) || 0;
  const rollNum = parseFloat(vehiculo.roll || 0) || 0;
  const inclinacionExcesiva = Math.abs(pitchNum) > 20 || Math.abs(rollNum) > 20;

  // Acelerómetro
  const ax = parseFloat(vehiculo.aceleracion_x || 0) || 0;
  const ay = parseFloat(vehiculo.aceleracion_y || 0) || 0;
  const az = parseFloat(vehiculo.aceleracion_z || 0) || 0;

  // Sensores extra dinámicos
  const sensoresExtra = vehiculo.sensores_extra && typeof vehiculo.sensores_extra === 'object'
    ? Object.entries(vehiculo.sensores_extra)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ENCABEZADO */}
        <div className="bg-zinc-900/90 border-b border-zinc-800 p-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div 
              className="w-4 h-4 rounded-full shadow-[0_0_10px_currentColor] flex-shrink-0"
              style={{ backgroundColor: vehiculo.color || '#ef4444', color: vehiculo.color || '#ef4444' }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                  {vehiculo.id}
                </h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold">
                  SISTEMA ACTIVO
                </span>
                {inclinacionExcesiva && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-700 animate-pulse font-bold">
                    ⚠️ ALERTA INCLINACIÓN
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 truncate">
                Último reporte: <b className="text-zinc-200">{vehiculo.hora || vehiculo.ultimaAct || 'Ahora'}</b>
              </p>
            </div>
          </div>

          <button
            onClick={alCerrar}
            className="w-9 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition border border-zinc-700 flex-shrink-0 text-sm font-bold"
            title="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* NAVEGACIÓN POR PESTAÑAS */}
        <div className="bg-zinc-900/40 border-b border-zinc-800/80 px-4 sm:px-6 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setTabActiva('sensores')}
            className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
              tabActiva === 'sensores'
                ? 'border-red-500 text-white bg-red-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            <span>📊</span> Sensores e Instrumentación
          </button>
          <button
            onClick={() => setTabActiva('camara')}
            className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
              tabActiva === 'camara'
                ? 'border-red-500 text-white bg-red-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            <span>📷</span> Cámara en Vivo
            {infoCamara?.activo && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            )}
          </button>
          <button
            onClick={() => setTabActiva('actuadores')}
            className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
              tabActiva === 'actuadores'
                ? 'border-red-500 text-white bg-red-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            <span>⚡</span> Actuadores y Relés
            {comandosPendientes > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 bg-amber-500 text-black font-bold rounded-full">
                {comandosPendientes}
              </span>
            )}
          </button>
        </div>

        {/* CONTENIDO DEL MODAL */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 text-zinc-200 space-y-6">

          {/* TAB 1: SENSORES */}
          {tabActiva === 'sensores' && (
            <div className="space-y-6">
              {/* Tarjetas Principales de Telemetría */}
              <div>
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">
                  Variables Dinámicas de Operación
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Velocidad</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-cyan-400">{vehiculo.velocidad || '0.0'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">km/h</span>
                    </div>
                    <div className="w-full bg-zinc-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-cyan-400 h-full transition-all" 
                        style={{ width: `${Math.min(100, ((parseFloat(vehiculo.velocidad || 0)) / 100) * 100)}%` }} 
                      />
                    </div>
                  </div>

                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Altitud</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-indigo-400">{vehiculo.altitud || '0.0'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">msnm</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-2 block">Nivel mina/ruta</span>
                  </div>

                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Rumbo / Giro</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-blue-400">{vehiculo.rumbo || '0'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">°</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-2 block">Orientación brújula</span>
                  </div>

                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Temperatura</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-orange-400">{vehiculo.temperatura || '25.0'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">°C</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-2 block">Sensor ESP32/Térmico</span>
                  </div>

                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Vibración</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-amber-400">{vehiculo.vibracion || '0.00'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">G</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-2 block">Magnitud sísmica</span>
                  </div>

                  <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl flex flex-col justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium uppercase">Batería</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold font-mono text-emerald-400">{vehiculo.bateria || '100'}</span>
                      <span className="text-[10px] text-zinc-400 ml-1">% ({vehiculo.voltaje || '3.70'}V)</span>
                    </div>
                    <div className="w-full bg-zinc-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-emerald-400 h-full transition-all" 
                        style={{ width: `${Math.min(100, Math.max(5, parseFloat(vehiculo.bateria || 100)))}%` }} 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Inclinómetro Visual 3D y Acelerómetro */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Inclinómetro / Giróscopo */}
                <div className={`p-4 rounded-xl border transition ${
                  inclinacionExcesiva 
                    ? 'bg-red-950/40 border-red-600 shadow-lg shadow-red-950/50' 
                    : 'bg-zinc-900/80 border-zinc-800'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      <span>📐</span> Inclinómetro Minero (Pitch & Roll)
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      inclinacionExcesiva ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-300'
                    }`}>
                      {inclinacionExcesiva ? 'PELIGRO VUELCO' : 'NIVEL SEGURO'}
                    </span>
                  </div>

                  {/* Burbuja / Horizonte Artificial */}
                  <div className="flex flex-col sm:flex-row items-center gap-4 py-2">
                    <div className="relative w-36 h-36 rounded-full border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center overflow-hidden shadow-inner flex-shrink-0">
                      {/* Retícula */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-full h-px bg-zinc-700/80" />
                        <div className="h-full w-px bg-zinc-700/80" />
                        <div className="w-16 h-16 rounded-full border border-zinc-700/60" />
                        <div className="w-24 h-24 rounded-full border border-dashed border-red-500/40" />
                      </div>
                      
                      {/* Burbuja dinámica según Pitch y Roll */}
                      <div 
                        className={`w-7 h-7 rounded-full shadow-lg transition-transform duration-300 flex items-center justify-center text-[10px] font-bold ${
                          inclinacionExcesiva ? 'bg-red-500 text-white shadow-red-500/80' : 'bg-cyan-400 text-black shadow-cyan-400/80'
                        }`}
                        style={{
                          transform: `translate(${Math.max(-50, Math.min(50, rollNum * 1.5))}px, ${Math.max(-50, Math.min(50, -pitchNum * 1.5))}px)`
                        }}
                      >
                        ●
                      </div>
                    </div>

                    <div className="flex-1 space-y-2.5 w-full text-xs">
                      <div>
                        <div className="flex justify-between text-zinc-400 mb-1">
                          <span>Inclinación Longitudinal (Pitch):</span>
                          <b className="font-mono text-white">{pitchNum > 0 ? `+${pitchNum}` : pitchNum}°</b>
                        </div>
                        <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden flex">
                          <div className="w-1/2 flex justify-end">
                            <div 
                              className="bg-amber-400 h-full"
                              style={{ width: `${pitchNum < 0 ? Math.min(100, Math.abs(pitchNum) * 2.5) : 0}%` }}
                            />
                          </div>
                          <div className="w-1/2">
                            <div 
                              className="bg-cyan-400 h-full"
                              style={{ width: `${pitchNum > 0 ? Math.min(100, pitchNum * 2.5) : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] text-zinc-500 mt-0.5">
                          <span>Bajada (-40°)</span>
                          <span>0°</span>
                          <span>Subida (+40°)</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-zinc-400 mb-1">
                          <span>Inclinación Lateral (Roll):</span>
                          <b className="font-mono text-white">{rollNum > 0 ? `+${rollNum}` : rollNum}°</b>
                        </div>
                        <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden flex">
                          <div className="w-1/2 flex justify-end">
                            <div 
                              className="bg-amber-400 h-full"
                              style={{ width: `${rollNum < 0 ? Math.min(100, Math.abs(rollNum) * 2.5) : 0}%` }}
                            />
                          </div>
                          <div className="w-1/2">
                            <div 
                              className="bg-cyan-400 h-full"
                              style={{ width: `${rollNum > 0 ? Math.min(100, rollNum * 2.5) : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] text-zinc-500 mt-0.5">
                          <span>Izquierda (-40°)</span>
                          <span>0°</span>
                          <span>Derecha (+40°)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Acelerómetro Triaxial (IMU MPU6050 / BNO055) */}
                <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      <span>📈</span> Acelerómetro Triaxial (Fuerzas G)
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">IMU Calibrado</span>
                  </div>

                  <div className="space-y-3 py-1">
                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Eje X (Lateral):</span>
                        <b className="font-mono text-cyan-400">{ax.toFixed(2)} G</b>
                      </div>
                      <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-cyan-400 h-full transition-all"
                          style={{ width: `${Math.min(100, Math.abs(ax) * 50)}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Eje Y (Longitudinal):</span>
                        <b className="font-mono text-indigo-400">{ay.toFixed(2)} G</b>
                      </div>
                      <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-400 h-full transition-all"
                          style={{ width: `${Math.min(100, Math.abs(ay) * 50)}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Eje Z (Vertical / Gravedad):</span>
                        <b className="font-mono text-amber-400">{az.toFixed(2)} G</b>
                      </div>
                      <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-amber-400 h-full transition-all"
                          style={{ width: `${Math.min(100, Math.abs(az) * 33)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Radar de Proximidad Ultrasonico HC-SR04 y Telemetría Hardware */}
              {(() => {
                const extra = vehiculo.sensores_extra && typeof vehiculo.sensores_extra === 'object' ? vehiculo.sensores_extra : {};
                const distRaw = extra.distancia_cm !== undefined ? parseFloat(extra.distancia_cm) : null;
                const tieneSensorDistancia = distRaw !== null && !isNaN(distRaw);
                const distCm = tieneSensorDistancia ? distRaw : 0;
                
                // Zonas de alerta
                const esAlertaCritica = tieneSensorDistancia && distCm > 0 && distCm < 20;
                const esPrecaucion = tieneSensorDistancia && distCm >= 20 && distCm <= 60;
                const esSeguro = tieneSensorDistancia && (distCm > 60 || distCm === 0);

                const colorBorde = esAlertaCritica 
                  ? 'border-red-500 bg-red-950/30 shadow-[0_0_20px_rgba(239,68,68,0.3)]' 
                  : esPrecaucion 
                  ? 'border-amber-500/70 bg-amber-950/20' 
                  : 'border-zinc-800 bg-zinc-900/70';

                return (
                  <div className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 ${colorBorde}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">📡</span>
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            Radar de Proximidad y Anticolisión (HC-SR04)
                            {esAlertaCritica && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white font-extrabold animate-pulse">
                                ¡IMPACTO INMINENTE!
                              </span>
                            )}
                          </h4>
                          <span className="text-[11px] text-zinc-400 font-mono">
                            Hardware: GPIO 6 (Trig) / GPIO 7 (Echo) | Tiempo Real
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {extra.cpu_temp !== undefined && (
                          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center gap-1.5">
                            <span>🌡️ ESP32:</span>
                            <b className="text-orange-400">{extra.cpu_temp} °C</b>
                          </span>
                        )}
                        {extra.puente_inercial && (
                          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-700 text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            Puente Celular Activo
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Gráfico de Radar Sonar y Barra de Distancia */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
                      
                      {/* Visualizador Sonar / Arcos concéntricos */}
                      <div className="flex flex-col items-center justify-center p-3 bg-zinc-950/90 rounded-xl border border-zinc-800/80 relative overflow-hidden">
                        <div className="relative w-44 h-36 flex flex-col items-center justify-end pb-2">
                          
                          {/* Arcos de Proximidad */}
                          {/* Zona 3: > 60 cm (Verde) */}
                          <div className={`absolute top-2 w-40 h-40 rounded-full border-t-4 border-l border-r border-transparent transition-all duration-300 ${
                            distCm > 60 || distCm === 0 ? 'border-emerald-500/80 shadow-[0_-5px_15px_rgba(16,185,129,0.3)]' : 'border-zinc-800'
                          }`} />

                          {/* Zona 2: 20-60 cm (Amarillo) */}
                          <div className={`absolute top-8 w-28 h-28 rounded-full border-t-4 border-l border-r border-transparent transition-all duration-300 ${
                            distCm > 0 && distCm <= 60 ? (distCm < 20 ? 'border-zinc-800' : 'border-amber-400/90 shadow-[0_-5px_15px_rgba(251,191,36,0.4)]') : 'border-zinc-800'
                          }`} />

                          {/* Zona 1: < 20 cm (Rojo Crítico) */}
                          <div className={`absolute top-14 w-16 h-16 rounded-full border-t-4 border-l border-r border-transparent transition-all duration-300 ${
                            distCm > 0 && distCm < 20 ? 'border-red-500 shadow-[0_-5px_20px_rgba(239,68,68,0.7)] animate-pulse' : 'border-zinc-800'
                          }`} />

                          {/* Onda Sonar Animada */}
                          {tieneSensorDistancia && (
                            <div className="absolute top-14 w-16 h-16 rounded-full border border-cyan-400/60 animate-sonar pointer-events-none" />
                          )}

                          {/* Icono del Sensor / Camión */}
                          <div className="z-10 mt-16 bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs text-zinc-300 font-mono shadow-md">
                            <span>🚛</span>
                            <span>SENSOR FRONTAL</span>
                          </div>
                        </div>

                        <div className="text-[10px] text-zinc-400 font-mono flex justify-between w-full px-2 mt-1">
                          <span className="text-red-400 font-bold">&lt; 20 cm</span>
                          <span className="text-amber-400 font-bold">20-60 cm</span>
                          <span className="text-emerald-400 font-bold">&gt; 60 cm</span>
                        </div>
                      </div>

                      {/* Display Numérico Gigante y Medidor */}
                      <div className="md:col-span-2 space-y-3">
                        <div className="flex items-end justify-between">
                          <div>
                            <span className="text-xs uppercase text-zinc-400 font-medium">Distancia al Obstáculo</span>
                            <div className="flex items-baseline gap-2 mt-0.5">
                              <span className={`text-4xl font-extrabold font-mono tracking-tight ${
                                esAlertaCritica 
                                  ? 'text-red-400 animate-pulse' 
                                  : esPrecaucion 
                                  ? 'text-amber-400' 
                                  : 'text-emerald-400'
                              }`}>
                                {tieneSensorDistancia && distCm > 0 ? distCm.toFixed(1) : (distCm === 0 ? 'DESPEJADO' : '--')}
                              </span>
                              {tieneSensorDistancia && distCm > 0 && (
                                <span className="text-sm font-mono text-zinc-400">centímetros</span>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-zinc-500 uppercase font-mono block">Estado del Radar</span>
                            <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-md inline-block mt-0.5 ${
                              esAlertaCritica 
                                ? 'bg-red-500 text-white' 
                                : esPrecaucion 
                                ? 'bg-amber-500 text-black' 
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            }`}>
                              {esAlertaCritica 
                                ? '⚠️ ALERTA: FRENO RECOMENDADO' 
                                : esPrecaucion 
                                ? '⚠️ PRECAUCIÓN: APROXIMACIÓN' 
                                : '✓ ZONA DESPEJADA'}
                            </span>
                          </div>
                        </div>

                        {/* Barra Progresiva de Proximidad */}
                        <div>
                          <div className="w-full bg-zinc-950 h-3.5 rounded-full overflow-hidden p-0.5 border border-zinc-800">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                esAlertaCritica 
                                  ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' 
                                  : esPrecaucion 
                                  ? 'bg-amber-400' 
                                  : 'bg-emerald-400'
                              }`}
                              style={{ 
                                width: `${tieneSensorDistancia && distCm > 0 ? Math.min(100, Math.max(5, (distCm / 150) * 100)) : (distCm === 0 ? 100 : 0)}%` 
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1 px-1">
                            <span>0 cm (Colisión)</span>
                            <span>50 cm</span>
                            <span>100 cm</span>
                            <span>150+ cm</span>
                          </div>
                        </div>

                        {/* Mini indicadores técnicos */}
                        <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono text-[11px]">
                          <div className="bg-zinc-950/70 border border-zinc-800/80 p-2 rounded-lg">
                            <span className="text-zinc-500 text-[9px] block">TIEMPO ECO</span>
                            <span className="text-zinc-300 font-bold">
                              {distCm > 0 ? `${(distCm * 58.2).toFixed(0)} µs` : 'Sin eco'}
                            </span>
                          </div>
                          <div className="bg-zinc-950/70 border border-zinc-800/80 p-2 rounded-lg">
                            <span className="text-zinc-500 text-[9px] block">CONEXIÓN VCC</span>
                            <span className="text-cyan-400 font-bold">5.0 V DC</span>
                          </div>
                          <div className="bg-zinc-950/70 border border-zinc-800/80 p-2 rounded-lg">
                            <span className="text-zinc-500 text-[9px] block">FRECUENCIA</span>
                            <span className="text-indigo-400 font-bold">40 kHz Sonar</span>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Sensores Extra Modulares (Extensibilidad Dinámica) */}
              <div className="bg-zinc-900/40 border border-dashed border-zinc-800 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <span>🔌</span> Módulos y Sensores Adicionales Conectados
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Cualquier nuevo sensor acoplado al ESP32 (Gas, Ultrasonido, Presión, Carga) se detecta aquí automáticamente sin tocar la base de datos.
                    </p>
                  </div>
                </div>

                {sensoresExtra.length === 0 ? (
                  <div className="bg-zinc-950/60 border border-zinc-900 p-4 rounded-lg text-center text-xs text-zinc-500">
                    <span className="block text-zinc-400 mb-1 font-medium">No hay sensores adicionales activos en este momento</span>
                    El firmware puede enviar en el JSON de telemetría la clave <code className="text-cyan-400">"sensores_extra": {'{ "gas_co2": 410, "distancia_m": 4.2 }'}</code> y aparecerán en tiempo real.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {sensoresExtra.map(([clave, valor]) => (
                      <div key={clave} className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg">
                        <span className="text-[10px] text-zinc-400 uppercase font-mono block truncate">
                          {clave.replace(/_/g, ' ')}
                        </span>
                        <span className="text-lg font-bold font-mono text-emerald-400 mt-1 block">
                          {typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CÁMARA EN VIVO */}
          {tabActiva === 'camara' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">Canal de Video Onboard</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                      infoCamara?.activo 
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                        : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {infoCamara?.activo ? 'TRANSMISIÓN ACTIVA' : 'MODO STANDBY (AHORRO)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    El ESP32 transmite fotogramas ligeros solo bajo demanda para no calentar la CPU.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setPausadoStream(!pausadoStream)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      pausadoStream 
                        ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500' 
                        : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                    }`}
                  >
                    {pausadoStream ? '▶ Reanudar' : '⏸ Pausar'}
                  </button>

                  <button
                    onClick={descargarSnapshot}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 flex items-center gap-1.5 transition"
                    title="Guardar fotograma actual en disco"
                  >
                    <span>📸</span> Capturar
                  </button>

                  <button
                    onClick={simularFrameDePrueba}
                    disabled={simulandoFrame}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white border border-red-500 flex items-center gap-1.5 transition"
                    title="Enviar fotograma sintético desde el navegador para verificar la pantalla"
                  >
                    <span>🧪</span> {simulandoFrame ? 'Enviando...' : 'Simular Frame'}
                  </button>
                </div>
              </div>

              {/* Visor de Video / Frame */}
              <div className="relative aspect-video max-h-[500px] w-full bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center group shadow-2xl">
                <img
                  src={getApiUrl(`/api/camara/${encodeURIComponent(vehiculoId)}/frame?t=${timestampFrame}`)}
                  alt={`Cámara ${vehiculoId}`}
                  className="w-full h-full object-contain"
                  onLoad={() => setCargandoCamara(false)}
                  onError={() => setCargandoCamara(false)}
                />

                {/* Overlay OSD HUD */}
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-mono text-white flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    EN VIVO
                  </span>
                  <span className="text-zinc-400">|</span>
                  <span>{vehiculoId}</span>
                  <span className="text-zinc-400">|</span>
                  <span className="text-cyan-400">{vehiculo.velocidad || '0.0'} km/h</span>
                </div>

                <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-zinc-300">
                  {new Date(timestampFrame).toLocaleTimeString()}
                </div>
              </div>

              {/* Guía informativa de hardware */}
              <div className="bg-zinc-900/40 p-3.5 rounded-xl border border-zinc-800 text-xs text-zinc-400 flex items-start gap-3">
                <span className="text-lg">💡</span>
                <div>
                  <strong className="text-zinc-200 block mb-0.5">Operación Inteligente sin sobrecalentamiento del ESP32:</strong>
                  El sensor de cámara (ej. OV2640 de 2MP o celular acoplado) realiza la compresión JPEG por hardware interno y DMA a memoria PSRAM. El ESP32 solo envía el buffer binario por HTTP POST al servidor central TRACE-MIN, el cual se encarga del almacenamiento y streaming a múltiples usuarios.
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ACTUADORES */}
          {tabActiva === 'actuadores' && (
            <div className="space-y-6">
              <div className="bg-zinc-900/60 p-4 rounded-xl border border-zinc-800">
                <h3 className="text-sm font-bold text-white mb-1">
                  Telemetría Bidireccional & Control de Relés
                </h3>
                <p className="text-xs text-zinc-400">
                  Los comandos de control se encolan en el servidor de TRACE-MIN y son entregados al ESP32 en el cuerpo de respuesta de su siguiente paquete de telemetría (cada 3 seg). De este modo el ESP32 no necesita mantener conexiones abiertas extras ni sufre por tráfico continuo.
                </p>
              </div>

              {mensajeActuador && (
                <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  mensajeActuador.tipo === 'ok' 
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                    : 'bg-red-950 text-red-300 border border-red-800'
                }`}>
                  <span>{mensajeActuador.tipo === 'ok' ? '✓' : '⚠'}</span>
                  <span>{mensajeActuador.texto}</span>
                </div>
              )}

              {/* Grilla de Controles de Actuador */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* 1. CORTE DE MOTOR (ALTA SEGURIDAD) */}
                <div className="bg-zinc-900/90 border border-red-900/50 p-4 rounded-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🛑</span>
                        <h4 className="font-bold text-sm text-red-400">Corte Remoto de Motor</h4>
                      </div>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        estadosActuadores.corte_motor ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {estadosActuadores.corte_motor ? 'MOTOR BLOQUEADO' : 'MOTOR HABILITADO'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4">
                      Inmovilizador por relé secundario. Requiere confirmación expresa para evitar accidentes en ruta.
                    </p>
                  </div>

                  {confirmarCorteMotor ? (
                    <div className="bg-red-950/80 border border-red-600 p-3 rounded-lg space-y-2">
                      <p className="text-[11px] text-red-200 font-bold">
                        ¿Confirmar cambio de estado de corte de motor en la unidad {vehiculoId}?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            ejecutarComandoActuador('corte_motor', !estadosActuadores.corte_motor);
                            setConfirmarCorteMotor(false);
                          }}
                          className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold transition"
                        >
                          Sí, Aplicar
                        </button>
                        <button
                          onClick={() => setConfirmarCorteMotor(false)}
                          className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-semibold transition"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmarCorteMotor(true)}
                      disabled={enviandoComando === 'corte_motor'}
                      className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                        estadosActuadores.corte_motor
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30'
                      }`}
                    >
                      {estadosActuadores.corte_motor ? '🔓 Desbloquear e Iniciar Motor' : '🛑 Cortar Ignición / Apagar'}
                    </button>
                  )}
                </div>

                {/* 2. SIRENA / ALARMA ACÚSTICA */}
                <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🚨</span>
                        <h4 className="font-bold text-sm text-white">Alarma Sonora / Bocina</h4>
                      </div>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        estadosActuadores.alarma_sonora ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {estadosActuadores.alarma_sonora ? 'SONANDO' : 'SILENCIADA'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4">
                      Emite alerta acústica de 110dB para disuasión o aviso de emergencia en zona de descarga.
                    </p>
                  </div>

                  <button
                    onClick={() => ejecutarComandoActuador('alarma_sonora', !estadosActuadores.alarma_sonora)}
                    disabled={enviandoComando === 'alarma_sonora'}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                      estadosActuadores.alarma_sonora
                        ? 'bg-amber-500 hover:bg-amber-400 text-black'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
                    }`}
                  >
                    {estadosActuadores.alarma_sonora ? '🔇 Apagar Alarma' : '🔊 Activar Alarma Minera'}
                  </button>
                </div>

                {/* 3. BALIZAS ESTROBOSCÓPICAS / LUCES */}
                <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">💡</span>
                        <h4 className="font-bold text-sm text-white">Balizas de Emergencia</h4>
                      </div>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        estadosActuadores.luces_emergencia ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {estadosActuadores.luces_emergencia ? 'ENCENDIDAS' : 'APAGADAS'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4">
                      Luces estroboscópicas perimetrales de alta intensidad para visibilidad en niebla o polvo.
                    </p>
                  </div>

                  <button
                    onClick={() => ejecutarComandoActuador('luces_emergencia', !estadosActuadores.luces_emergencia)}
                    disabled={enviandoComando === 'luces_emergencia'}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                      estadosActuadores.luces_emergencia
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
                    }`}
                  >
                    {estadosActuadores.luces_emergencia ? 'Apagar Balizas' : 'Encender Balizas 360°'}
                  </button>
                </div>

                {/* 4. CIERRE CENTRALIZADO DE CABINA */}
                <div className="bg-zinc-900/90 border border-zinc-800 p-4 rounded-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🔒</span>
                        <h4 className="font-bold text-sm text-white">Cierre de Cabina</h4>
                      </div>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        estadosActuadores.bloqueo_puertas ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {estadosActuadores.bloqueo_puertas ? 'BLOQUEADAS' : 'DESBLOQUEADAS'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4">
                      Bloqueo central electromagnético de puertas para protección del conductor ante intrusión.
                    </p>
                  </div>

                  <button
                    onClick={() => ejecutarComandoActuador('bloqueo_puertas', !estadosActuadores.bloqueo_puertas)}
                    disabled={enviandoComando === 'bloqueo_puertas'}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                      estadosActuadores.bloqueo_puertas
                        ? 'bg-purple-600 hover:bg-purple-500 text-white'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
                    }`}
                  >
                    {estadosActuadores.bloqueo_puertas ? '🔓 Desbloquear Puertas' : '🔒 Trabar Puertas'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PIE DEL MODAL */}
        <div className="bg-zinc-900/90 border-t border-zinc-800 px-4 py-3 sm:px-6 flex items-center justify-between text-xs text-zinc-400">
          <span>Telemetría Minera en Tiempo Real • TRACE-MIN</span>
          <button
            onClick={alCerrar}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition font-medium border border-zinc-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
