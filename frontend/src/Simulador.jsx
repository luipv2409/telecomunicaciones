import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { getApiUrl } from './config';
import ConfigEsp32 from './ConfigEsp32';

export default function Simulador() {
  const [conectado, setConectado] = useState(false);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('Inactivo');
  const [dispositivoId, setDispositivoId] = useState(`camion-${Math.floor(Math.random() * 1000)}`);
  const [modoPuente, setModoPuente] = useState(() => localStorage.getItem('TRACEMIN_MODO_PUENTE') === '1');
  const [puenteId, setPuenteId] = useState(() => localStorage.getItem('TRACEMIN_PUENTE_ID') || 'celular-1');
  
  const [sensores, setSensores] = useState({
    latitud: -17.3935,
    longitud: -66.1570,
    velocidad: 0,
    altitud: 2570,
    rumbo: 0,
    precision: 0,
    vibracion: 0,
    acelX: 0,
    acelY: 0,
    acelZ: 0,
    pitch: 0,
    roll: 0,
    bateria: 100,
    voltaje: 3.7,
    temperatura: 25.0
  });

  const [paquetesEnviados, setPaquetesEnviados] = useState(0);
  const [modoOledNegro, setModoOledNegro] = useState(false);
  const [bloqueoPantallaActivo, setBloqueoPantallaActivo] = useState(false);

  const watchId = useRef(null);
  const isCapacitorWatch = useRef(false);
  const motionListenerRef = useRef(null);
  const orientationListenerRef = useRef(null);
  const sensoresRef = useRef(sensores);
  const intervaloEnvioRef = useRef(null);
  const ultimoEnvioMsRef = useRef(0);
  const modoPuenteRef = useRef(modoPuente);
  const puenteIdRef = useRef(puenteId);
  const wakeLockRef = useRef(null);

  const solicitarWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setBloqueoPantallaActivo(true);
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
          setBloqueoPantallaActivo(false);
        });
      } catch (e) {
        console.warn('WakeLock no disponible o denegado:', e);
      }
    }
  };

  const liberarWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setBloqueoPantallaActivo(false);
    }
  };

  useEffect(() => {
    modoPuenteRef.current = modoPuente;
    localStorage.setItem('TRACEMIN_MODO_PUENTE', modoPuente ? '1' : '0');
  }, [modoPuente]);

  useEffect(() => {
    puenteIdRef.current = puenteId;
    localStorage.setItem('TRACEMIN_PUENTE_ID', puenteId);
  }, [puenteId]);

  useEffect(() => {
    sensoresRef.current = sensores;
  }, [sensores]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        const actualizarBateria = () => {
          const nivel = Math.round(battery.level * 100);
          const volt = parseFloat((3.5 + (battery.level * 0.7)).toFixed(2));
          setSensores(prev => ({ ...prev, bateria: nivel, voltaje: volt }));
        };
        actualizarBateria();
        battery.addEventListener('levelchange', actualizarBateria);
      }).catch(() => {});
    }

    return () => {
      detenerTransmision();
    };
  }, []);

  useEffect(() => {
    const handleVis = () => {
      if (document.visibilityState === 'visible' && conectado) {
        solicitarWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
  }, [conectado]);

  const anclaGpsRef = useRef({ lat: null, lon: null });

  const calcularDistanciaMetrosSim = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const actualizarPosicion = (coords) => {
    if (!coords) return;
    const rawLat = coords.latitude;
    const rawLon = coords.longitude;
    const rawSpeed = coords.speed !== null && coords.speed >= 0 ? coords.speed * 3.6 : 0;

    // Filtro Deadband de Reposo (elimina deriva de 3 a 12 metros cuando el vehículo está parado)
    let latFinal = rawLat;
    let lonFinal = rawLon;
    let velFinal = rawSpeed;

    if (anclaGpsRef.current.lat === null) {
      anclaGpsRef.current = { lat: rawLat, lon: rawLon };
    } else {
      const distAlAncla = calcularDistanciaMetrosSim(
        anclaGpsRef.current.lat,
        anclaGpsRef.current.lon,
        rawLat,
        rawLon
      );

      // Si el desplazamiento es menor a 12m y la velocidad es baja (< 2.5 km/h):
      // Está en reposo: anclamos la coordenada fija para que el ruido GPS no cree telarañas ni falsos puntos
      if (distAlAncla < 12.0 && rawSpeed < 2.5) {
        latFinal = anclaGpsRef.current.lat;
        lonFinal = anclaGpsRef.current.lon;
        velFinal = 0.0;
      } else {
        // Movimiento real confirmado: actualizar punto ancla
        anclaGpsRef.current = { lat: rawLat, lon: rawLon };
      }
    }

    const lat = parseFloat(latFinal.toFixed(7));
    const lon = parseFloat(lonFinal.toFixed(7));
    const velKmH = parseFloat(velFinal.toFixed(1));
    const alt = coords.altitude !== null ? parseFloat(coords.altitude.toFixed(1)) : 0;
    const head = coords.heading !== null && !isNaN(coords.heading) && velKmH > 1.5 
      ? parseFloat(coords.heading.toFixed(1)) 
      : sensoresRef.current.rumbo;
    const prec = coords.accuracy !== null ? parseFloat(coords.accuracy.toFixed(1)) : 0;
    const temp = parseFloat((25.0 + (velKmH * 0.1) + (Math.random() * 0.5)).toFixed(1));

    setSensores(prev => ({
      ...prev,
      latitud: lat,
      longitud: lon,
      velocidad: velKmH,
      altitud: alt,
      rumbo: head,
      precision: prec,
      temperatura: temp
    }));

    setEstado('Transmitiendo en tiempo real (1s)...');

    enviarPaquete({
      latitud: lat,
      longitud: lon,
      velocidad: velKmH,
      altitud: alt,
      rumbo: head,
      temperatura: temp
    });
  };

  const iniciarTransmision = async () => {
    if (!dispositivoId.trim()) {
      setError('Debes ingresar un ID de dispositivo.');
      return;
    }

    setError(null);
    setEstado('Conectando GPS y sensores...');
    setConectado(true);
    solicitarWakeLock();

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { await DeviceMotionEvent.requestPermission(); } catch (e) {}
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
    }

    motionListenerRef.current = (e) => {
      const acc = e.acceleration || e.accelerationIncludingGravity;
      if (acc) {
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;
        const mag = Math.sqrt(x * x + y * y + z * z) / 9.81;
        setSensores(prev => ({
          ...prev,
          acelX: parseFloat(x.toFixed(2)),
          acelY: parseFloat(y.toFixed(2)),
          acelZ: parseFloat(z.toFixed(2)),
          vibracion: parseFloat(mag.toFixed(2))
        }));
      }
    };
    window.addEventListener('devicemotion', motionListenerRef.current);

    orientationListenerRef.current = (e) => {
      setSensores(prev => ({
        ...prev,
        pitch: e.beta !== null && e.beta !== undefined ? parseFloat(e.beta.toFixed(1)) : prev.pitch,
        roll: e.gamma !== null && e.gamma !== undefined ? parseFloat(e.gamma.toFixed(1)) : prev.roll,
        rumbo: e.alpha !== null && e.alpha !== undefined ? parseFloat(e.alpha.toFixed(1)) : prev.rumbo
      }));
    };
    window.addEventListener('deviceorientation', orientationListenerRef.current);

    const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();

    if (isNative) {
      try {
        const perm = await Geolocation.requestPermissions();
        if (perm.location === 'denied') {
          setError('Permiso de ubicación denegado en el dispositivo.');
          setConectado(false);
          setEstado('Permiso denegado');
          return;
        }

        try {
          const currentPos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
          if (currentPos && currentPos.coords) {
            actualizarPosicion(currentPos.coords);
          }
        } catch (posErr) {}

        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (err) {
              setError(`Error de GPS nativo: ${err.message}`);
              return;
            }
            if (pos && pos.coords) {
              actualizarPosicion(pos.coords);
            }
          }
        );
        watchId.current = id;
        isCapacitorWatch.current = true;
      } catch (nativeErr) {
        setError(`Error iniciando GPS nativo: ${nativeErr.message}`);
      }
    } else {
      if (!navigator.geolocation) {
        setError('Geolocalización bloqueada por HTTP. Entra por HTTPS (:8443) para GPS satelital. Transmitiendo sensores inerciales.');
      } else {
        isCapacitorWatch.current = false;
        watchId.current = navigator.geolocation.watchPosition(
          (pos) => {
            actualizarPosicion(pos.coords);
          },
          (err) => {
            if (err.message && err.message.includes('secure origins')) {
              setError('Navegador bloqueó GPS satelital sobre HTTP. Usando posición base Cochabamba (-17.3935, -66.1570). ¡El giróscopo y acelerómetro están transmitiendo en vivo! (Para GPS real entra por HTTPS :8443 o descarga el APK).');
            } else {
              setError(`Aviso GPS: ${err.message}. Usando coordenadas base.`);
            }
            setEstado('Transmitiendo inercial (giroscopio y acelerómetro)...');
            actualizarPosicion({
              latitude: -17.3935,
              longitude: -66.1570,
              speed: 0,
              altitude: 2570,
              heading: 0,
              accuracy: 15
            });
          },
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
        );
      }
    }

    intervaloEnvioRef.current = setInterval(async () => {
      if (isNative) {
        try {
          const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 3000 });
          if (p && p.coords) {
            actualizarPosicion(p.coords);
          }
        } catch(e) {}
      }
      if (sensoresRef.current.latitud !== null && sensoresRef.current.longitud !== null) {
        enviarPaquete();
      }
    }, 1000);
  };

  const enviarPaquete = (overrides) => {
    const ahora = Date.now();
    if (ahora - ultimoEnvioMsRef.current < 600) {
      return;
    }
    const s = { ...sensoresRef.current, ...overrides };
    if (s.latitud === null || s.longitud === null) return;
    ultimoEnvioMsRef.current = ahora;

    const payload = {
      timestamp: new Date().toISOString(),
      dispositivo_id: dispositivoId.trim(),
      latitud: s.latitud,
      longitud: s.longitud,
      velocidad: s.velocidad,
      altitud: s.altitud,
      rumbo: s.rumbo,
      bateria: s.bateria,
      voltaje: s.voltaje,
      pitch: s.pitch,
      roll: s.roll,
      vibracion: s.vibracion,
      aceleracion_x: s.acelX,
      aceleracion_y: s.acelY,
      aceleracion_z: s.acelZ,
      temperatura: s.temperatura
    };

    const esPuente = modoPuenteRef.current;
    const cuerpo = esPuente ? { ...payload, puente_id: puenteIdRef.current.trim() } : payload;
    const ruta = esPuente ? '/api/puente/gps' : '/api/telemetria';

    fetch(getApiUrl(ruta), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    }).then(res => {
      if (res.ok) setPaquetesEnviados(p => p + 1);
    }).catch(err => console.error('Error al enviar:', err));
  };

  const detenerTransmision = () => {
    liberarWakeLock();
    setModoOledNegro(false);
    if (watchId.current) {
      if (isCapacitorWatch.current) {
        Geolocation.clearWatch({ id: watchId.current }).catch(() => {});
      } else if (navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      watchId.current = null;
    }
    if (motionListenerRef.current) window.removeEventListener('devicemotion', motionListenerRef.current);
    if (orientationListenerRef.current) window.removeEventListener('deviceorientation', orientationListenerRef.current);
    if (intervaloEnvioRef.current) clearInterval(intervaloEnvioRef.current);
    
    setConectado(false);
    setEstado('Inactivo');
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-white flex flex-col items-center p-3 sm:p-6 pt-20 pb-36 overflow-y-auto">
      <div className="bg-zinc-900 p-5 sm:p-8 rounded-2xl shadow-2xl border border-zinc-800 max-w-lg w-full text-center my-2">
        <h1 className="text-3xl font-bold text-red-500 mb-1">Telemetría Sensor Hub</h1>
        <p className="text-zinc-400 mb-6 text-xs sm:text-sm">Captura y transmisión de sensores móviles en tiempo real</p>

        <div className="mb-4 text-left">
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            ID del Vehículo / Dispositivo
          </label>
          <input 
            type="text" 
            value={dispositivoId}
            onChange={(e) => setDispositivoId(e.target.value)}
            disabled={conectado}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 transition-colors disabled:opacity-50 font-mono text-sm"
            placeholder="Ej. camion-123"
          />
        </div>

        <div className="mb-4 text-left bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <input
              type="checkbox"
              checked={modoPuente}
              disabled={conectado}
              onChange={(e) => setModoPuente(e.target.checked)}
            />
            Modo puente ESP32 (el celular solo aporta el GPS)
          </label>
          {modoPuente && (
            <div className="mt-2">
              <label className="block text-[11px] text-zinc-500 mb-1">ID del puente (debe coincidir con el del ESP32)</label>
              <input
                type="text"
                value={puenteId}
                onChange={(e) => setPuenteId(e.target.value)}
                disabled={conectado}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-red-500 disabled:opacity-50"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                En este modo el vehículo aparece en el mapa con los datos que reenvía el ESP32.
              </p>
            </div>
          )}
        </div>

        <ConfigEsp32 puenteId={puenteId} dispositivoId={dispositivoId} />

        <div className="mb-6 flex items-center justify-between bg-zinc-950 p-3 rounded-lg border border-zinc-800">
          <span className="text-xs text-zinc-400">Estado</span>
          <span className={`text-xs font-mono font-bold ${conectado ? 'text-green-400 animate-pulse' : 'text-zinc-400'}`}>
            {estado}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4 text-left">
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg col-span-2 sm:col-span-3">
            <span className="text-[10px] text-zinc-500 block">Coordenadas GPS (Lat / Lon)</span>
            <span className="font-mono text-emerald-400 text-xs font-bold truncate block">
              {sensores.latitud !== null ? `${sensores.latitud.toFixed(6)}, ${sensores.longitud.toFixed(6)}` : 'Buscando satélites...'}
            </span>
            <span className="text-[10px] text-zinc-400 mt-1 block">
              📦 Paquetes transmitidos: <b className="text-cyan-400 font-mono">{paquetesEnviados}</b>
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Velocidad</span>
            <span className="font-mono text-cyan-400 text-sm font-bold">{sensores.velocidad} km/h</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Altitud</span>
            <span className="font-mono text-indigo-400 text-sm font-bold">{sensores.altitud} m</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Rumbo</span>
            <span className="font-mono text-blue-400 text-sm font-bold">{sensores.rumbo}°</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Vibración Total</span>
            <span className="font-mono text-yellow-400 text-sm font-bold">{sensores.vibracion} G</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Inclinación (Pitch)</span>
            <span className="font-mono text-emerald-400 text-sm font-bold">{sensores.pitch}°</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Inclinación (Roll)</span>
            <span className="font-mono text-teal-400 text-sm font-bold">{sensores.roll}°</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Temperatura</span>
            <span className="font-mono text-orange-400 text-sm font-bold">{sensores.temperatura} °C</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Batería</span>
            <span className="font-mono text-green-400 text-sm font-bold">{sensores.bateria} %</span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-zinc-500 block">Voltaje</span>
            <span className="font-mono text-purple-400 text-sm font-bold">{sensores.voltaje} V</span>
          </div>
        </div>

        {sensores.latitud !== null && (
          <div className="mb-4 p-3 bg-zinc-950 rounded-lg font-mono text-xs border border-zinc-800 text-left flex justify-between">
            <span className="text-zinc-400">Lat: <b className="text-white">{sensores.latitud.toFixed(5)}</b></span>
            <span className="text-zinc-400">Lon: <b className="text-white">{sensores.longitud?.toFixed(5)}</b></span>
          </div>
        )}

        {/* MINI HORIZONTE ARTIFICIAL EN VIVO EN EL SIMULADOR */}
        <div className="mb-4 bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center gap-3 text-left">
          <div className="relative w-16 h-16 rounded-full border-2 border-zinc-700 bg-zinc-900 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-inner">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-full h-px bg-zinc-700/80" />
              <div className="h-full w-px bg-zinc-700/80" />
              <div className="w-8 h-8 rounded-full border border-zinc-700/50" />
            </div>
            <div 
              className="w-4 h-4 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] flex items-center justify-center text-[7px] font-bold text-black transition-transform duration-100"
              style={{
                transform: `translate(${Math.max(-22, Math.min(22, sensores.roll * 0.75))}px, ${Math.max(-22, Math.min(22, -sensores.pitch * 0.75))}px)`
              }}
            >
              ●
            </div>
          </div>
          <div className="flex-1 text-xs">
            <div className="font-bold text-zinc-300 uppercase tracking-wide flex justify-between items-center text-[11px]">
              <span className="flex items-center gap-1.5"><span>📐</span> Inclinómetro en Vivo</span>
              <span className="font-mono text-cyan-400 font-bold">{sensores.pitch > 0 ? `+${sensores.pitch}` : sensores.pitch}° / {sensores.roll > 0 ? `+${sensores.roll}` : sensores.roll}°</span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              Mueve tu celular: esta burbuja reacciona a tu mano y se envía al ESP32.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/50 border border-red-800/80 text-red-300 rounded-xl text-xs text-left space-y-2.5">
            <div className="leading-relaxed">{error}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <a 
                href={`https://${window.location.hostname}:8443/simulador`}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3 rounded-lg text-center block text-[11px] shadow-sm transition"
              >
                🔒 Abrir HTTPS (:8443)
              </a>
              <a 
                href="/tracemin.apk"
                download="tracemin.apk"
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-3 rounded-lg text-center block text-[11px] shadow-sm transition"
              >
                📥 Descargar App APK
              </a>
            </div>
          </div>
        )}

        {conectado && (
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <button
              type="button"
              onClick={() => setModoOledNegro(true)}
              className="flex-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-zinc-200 font-bold py-3 px-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition active:scale-95"
            >
              <span>🌙</span> Modo Bolsillo (Pantalla Negra OLED)
            </button>
            <div className="bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-mono text-zinc-400">
              <span className={`w-2.5 h-2.5 rounded-full ${bloqueoPantallaActivo ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`}></span>
              <span>{bloqueoPantallaActivo ? 'Pantalla Siempre Activa (ON)' : 'WakeLock OFF'}</span>
            </div>
          </div>
        )}

        {!conectado ? (
          <button 
            onClick={iniciarTransmision}
            className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold py-4 px-4 rounded-xl transition shadow-xl text-sm tracking-wide flex items-center justify-center gap-2"
          >
            <span>▶️</span> Iniciar Transmisión de Sensores
          </button>
        ) : (
          <button 
            onClick={detenerTransmision}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold py-4 px-4 rounded-xl transition shadow-lg text-sm flex items-center justify-center gap-2"
          >
            <span>⏹️</span> Detener Transmisión
          </button>
        )}
      </div>

      {/* OVERLAY ULTRA-AHORRO MODO BOLSILLO (NEGRO PURO #000000 PARA PANTALLAS OLED/AMOLED) */}
      {modoOledNegro && (
        <div 
          onClick={() => setModoOledNegro(false)}
          className="fixed inset-0 z-50 bg-black text-zinc-400 flex flex-col items-center justify-between p-6 select-none cursor-pointer"
          style={{ backgroundColor: '#000000' }}
        >
          <div className="flex items-center gap-2 text-zinc-700 text-[11px] mt-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="font-mono tracking-wider">MODO BOLSILLO OLED (0% GASTO DE BATERÍA)</span>
          </div>

          <div className="space-y-4 my-auto text-center w-full max-w-xs">
            <div className="text-6xl font-mono text-zinc-500 font-bold tracking-tight">
              {sensores.velocidad.toFixed(0)} <span className="text-sm text-zinc-700 font-normal">km/h</span>
            </div>
            <div className="text-xs font-mono text-zinc-600 space-y-2 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 text-left">
              <div className="flex justify-between"><span>📦 Paquetes enviados:</span><b className="text-zinc-300">{paquetesEnviados}</b></div>
              <div className="flex justify-between"><span>📐 Inclinación Pitch:</span><b className="text-zinc-300">{sensores.pitch}°</b></div>
              <div className="flex justify-between"><span>📐 Inclinación Roll:</span><b className="text-zinc-300">{sensores.roll}°</b></div>
              <div className="flex justify-between"><span>〰️ Vibración:</span><b className="text-zinc-300">{sensores.vibracion} G</b></div>
              <div className="flex justify-between"><span>🔋 Batería:</span><b className="text-zinc-300">{sensores.bateria}% ({sensores.temperatura}°C)</b></div>
            </div>
          </div>

          <div className="text-zinc-700 text-xs text-center pb-8 animate-pulse font-medium">
            👆 Toca en cualquier parte para volver a la pantalla completa
          </div>
        </div>
      )}
    </div>
  );
}
