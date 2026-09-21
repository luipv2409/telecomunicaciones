import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { getApiUrl } from './config';

export default function Simulador() {
  const [conectado, setConectado] = useState(false);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('Inactivo');
  const [dispositivoId, setDispositivoId] = useState(`camion-${Math.floor(Math.random() * 1000)}`);
  
  const [sensores, setSensores] = useState({
    latitud: null,
    longitud: null,
    velocidad: 0,
    altitud: 0,
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

  const watchId = useRef(null);
  const isCapacitorWatch = useRef(false);
  const motionListenerRef = useRef(null);
  const orientationListenerRef = useRef(null);
  const sensoresRef = useRef(sensores);
  const intervaloEnvioRef = useRef(null);
  const ultimoEnvioMsRef = useRef(0);

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

  const actualizarPosicion = (coords) => {
    if (!coords) return;
    const lat = coords.latitude;
    const lon = coords.longitude;
    const velKmH = coords.speed !== null && coords.speed >= 0 ? parseFloat((coords.speed * 3.6).toFixed(1)) : 0;
    const alt = coords.altitude !== null ? parseFloat(coords.altitude.toFixed(1)) : 0;
    const head = coords.heading !== null && !isNaN(coords.heading) ? parseFloat(coords.heading.toFixed(1)) : sensoresRef.current.rumbo;
    const prec = coords.accuracy !== null ? parseFloat(coords.accuracy.toFixed(1)) : 0;
    const temp = parseFloat((25.0 + (velKmH * 0.1) + (Math.random() * 1.5)).toFixed(1));

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
        setError('Geolocalización no soportada o bloqueada por HTTP. Usa la APK instalada o HTTPS.');
        setConectado(false);
        setEstado('GPS no disponible');
        return;
      }
      isCapacitorWatch.current = false;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          actualizarPosicion(pos.coords);
        },
        (err) => {
          if (err.message && err.message.includes('secure origins')) {
            setError('El navegador bloquea el GPS sobre HTTP no seguro. Usa la APK instalada o entra por HTTPS (puerto 8443).');
          } else {
            setError(`Error de GPS: ${err.message}`);
          }
          setEstado('Error de GPS');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
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

    fetch(getApiUrl('/api/telemetria'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(res => {
      if (res.ok) setPaquetesEnviados(p => p + 1);
    }).catch(err => console.error('Error al enviar:', err));
  };

  const detenerTransmision = () => {
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
    <div className="w-full min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4">
      <div className="bg-zinc-900 p-6 sm:p-8 rounded-2xl shadow-2xl border border-zinc-800 max-w-lg w-full text-center my-8">
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
          <div className="mb-6 p-3 bg-zinc-950 rounded-lg font-mono text-xs border border-zinc-800 text-left flex justify-between">
            <span className="text-zinc-400">Lat: <b className="text-white">{sensores.latitud.toFixed(5)}</b></span>
            <span className="text-zinc-400">Lon: <b className="text-white">{sensores.longitud?.toFixed(5)}</b></span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 bg-red-900 bg-opacity-30 border border-red-800 text-red-300 rounded-lg text-xs">
            {error}
          </div>
        )}

        {!conectado ? (
          <button 
            onClick={iniciarTransmision}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 px-4 rounded-xl transition-colors shadow-lg text-sm"
          >
            Iniciar Transmisión de Sensores
          </button>
        ) : (
          <button 
            onClick={detenerTransmision}
            className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-3.5 px-4 rounded-xl transition-colors shadow-lg text-sm"
          >
            Detener Transmisión
          </button>
        )}
      </div>
    </div>
  );
}
