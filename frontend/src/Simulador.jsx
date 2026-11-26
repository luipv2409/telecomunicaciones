import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { getApiUrl } from './config';
import ConfigEsp32 from './ConfigEsp32';

// Circuito urbano realista en Cochabamba (El Prado -> Heroínas -> Blanco Galindo -> Beijing -> América -> Libertador)
const RUTA_DEMO_COCHABAMBA = [
  [-17.3936, -66.1569],
  [-17.3912, -66.1566],
  [-17.3885, -66.1563],
  [-17.3854, -66.1568],
  [-17.3831, -66.1585],
  [-17.3795, -66.1620],
  [-17.3762, -66.1665],
  [-17.3748, -66.1725],
  [-17.3745, -66.1788],
  [-17.3785, -66.1792],
  [-17.3838, -66.1795],
  [-17.3895, -66.1798],
  [-17.3928, -66.1740],
  [-17.3931, -66.1665],
  [-17.3934, -66.1605]
];

export default function Simulador() {
  const [conectado, setConectado] = useState(false);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('Inactivo');
  const [dispositivoId, setDispositivoId] = useState(
    () => localStorage.getItem('TRACEMIN_DISP_ID') || 'Camion-1'
  );
  // Por defecto activado en Modo Puente ESP32 para alimentar a Camion-1 en escritorio
  const [modoPuente, setModoPuente] = useState(() => {
    const guardado = localStorage.getItem('TRACEMIN_MODO_PUENTE');
    return guardado === null ? true : guardado === '1';
  });
  const [puenteId, setPuenteId] = useState(
    () => localStorage.getItem('TRACEMIN_PUENTE_ID') || 'celular-1'
  );
  const [fuenteGps, setFuenteGps] = useState('gps'); // 'gps' (Real o Fake GPS) | 'ruta_demo'

  const [sensores, setSensores] = useState({
    latitud: null,
    longitud: null,
    velocidad: 0,
    altitud: 2570,
    rumbo: 0,
    precision: 0,
    vibracion: 1.0,
    acelX: 0,
    acelY: 0,
    acelZ: 9.81,
    pitch: 0,
    roll: 0,
    bateria: 100,
    voltaje: 3.85,
    temperatura: 25.0
  });

  const [paquetesEnviados, setPaquetesEnviados] = useState(0);
  const [modoOledNegro, setModoOledNegro] = useState(false);
  const [bloqueoPantallaActivo, setBloqueoPantallaActivo] = useState(false);
  const [modoAltaPrecision, setModoAltaPrecision] = useState(true);

  const watchId = useRef(null);
  const isCapacitorWatch = useRef(false);
  const motionListenerRef = useRef(null);
  const orientationListenerRef = useRef(null);
  const sensoresRef = useRef(sensores);
  const intervaloEnvioRef = useRef(null);
  const intervaloGpsPollRef = useRef(null);
  const intervaloDemoRef = useRef(null);
  const ultimoEnvioMsRef = useRef(0);
  const modoPuenteRef = useRef(modoPuente);
  const puenteIdRef = useRef(puenteId);
  const dispositivoIdRef = useRef(dispositivoId);
  const fuenteGpsRef = useRef(fuenteGps);
  const wakeLockRef = useRef(null);
  const ultimaMuestraMovRef = useRef({ lat: null, lon: null, ts: 0 });
  const demoProgresoRef = useRef({ indice: 0, fraccion: 0 });

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
    dispositivoIdRef.current = dispositivoId;
    localStorage.setItem('TRACEMIN_DISP_ID', dispositivoId);
  }, [dispositivoId]);

  useEffect(() => {
    fuenteGpsRef.current = fuenteGps;
  }, [fuenteGps]);

  useEffect(() => {
    sensoresRef.current = sensores;
  }, [sensores]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        const actualizarBateria = () => {
          const nivel = Math.round(battery.level * 100);
          const volt = parseFloat((3.5 + battery.level * 0.7).toFixed(2));
          setSensores((prev) => ({ ...prev, bateria: nivel, voltaje: volt }));
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
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const calcularRumboGrados = (lat1, lon1, lat2, lon2) => {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  };

  const actualizarPosicion = (coords, esSimulacionRuta = false) => {
    if (!coords || coords.latitude === undefined || coords.longitude === undefined) return;
    const rawLat = Number(coords.latitude);
    const rawLon = Number(coords.longitude);
    if (isNaN(rawLat) || isNaN(rawLon)) return;

    const ahora = Date.now();
    const prec = coords.accuracy !== null && coords.accuracy !== undefined ? Number(coords.accuracy) : 5;
    let rawSpeed = coords.speed !== null && coords.speed !== undefined && coords.speed >= 0 ? coords.speed * 3.6 : null;
    let rumboCalc = coords.heading !== null && coords.heading !== undefined && !isNaN(coords.heading) ? Number(coords.heading) : null;

    // Si Fake GPS no provee velocidad ni rumbo, calcularlos automáticamente a partir del desplazamiento real
    const prev = ultimaMuestraMovRef.current;
    if (prev.lat !== null && prev.ts > 0) {
      const dtSeg = (ahora - prev.ts) / 1000;
      const distPaso = calcularDistanciaMetrosSim(prev.lat, prev.lon, rawLat, rawLon);
      if (dtSeg >= 0.4 && distPaso > 1.5) {
        if (rawSpeed === null || rawSpeed === 0) {
          const velEstimada = (distPaso / dtSeg) * 3.6;
          rawSpeed = Math.min(140, velEstimada);
        }
        if (rumboCalc === null || rumboCalc === 0) {
          rumboCalc = calcularRumboGrados(prev.lat, prev.lon, rawLat, rawLon);
        }
        ultimaMuestraMovRef.current = { lat: rawLat, lon: rawLon, ts: ahora };
      } else if (dtSeg > 4.0) {
        if (rawSpeed === null) rawSpeed = 0;
        ultimaMuestraMovRef.current = { lat: rawLat, lon: rawLon, ts: ahora };
      }
    } else {
      ultimaMuestraMovRef.current = { lat: rawLat, lon: rawLon, ts: ahora };
    }

    if (rawSpeed === null) rawSpeed = 0;

    let latFinal = rawLat;
    let lonFinal = rawLon;
    let velFinal = rawSpeed;

    // Filtro anti-deriva inteligente:
    // - Si viene de Fake GPS o Ruta Demo (precisión <= 8m), dejar pasar el movimiento desde 2 metros para ver el recorrido fluido en tiempo real.
    // - Si es GPS satelital con ruido alto (precisión > 8m), aplicar deadband de 10m en reposo.
    const umbralDeadband = esSimulacionRuta ? 0 : prec <= 8 ? 2.0 : 10.0;

    if (anclaGpsRef.current.lat === null || umbralDeadband === 0) {
      anclaGpsRef.current = { lat: rawLat, lon: rawLon };
    } else {
      const distAlAncla = calcularDistanciaMetrosSim(
        anclaGpsRef.current.lat,
        anclaGpsRef.current.lon,
        rawLat,
        rawLon
      );

      if (distAlAncla < umbralDeadband && velFinal < 2.0) {
        latFinal = anclaGpsRef.current.lat;
        lonFinal = anclaGpsRef.current.lon;
        velFinal = 0.0;
      } else {
        anclaGpsRef.current = { lat: rawLat, lon: rawLon };
      }
    }

    const lat = parseFloat(latFinal.toFixed(7));
    const lon = parseFloat(lonFinal.toFixed(7));
    const velKmH = parseFloat(velFinal.toFixed(1));
    const alt = coords.altitude !== null && coords.altitude !== undefined ? parseFloat(Number(coords.altitude).toFixed(1)) : 2570;
    const head = rumboCalc !== null && !isNaN(rumboCalc) && velKmH > 0.8
      ? parseFloat(rumboCalc.toFixed(1))
      : sensoresRef.current.rumbo;
    const temp = parseFloat((25.0 + velKmH * 0.08).toFixed(1));

    setSensores((prevSens) => ({
      ...prevSens,
      latitud: lat,
      longitud: lon,
      velocidad: velKmH,
      altitud: alt,
      rumbo: head,
      precision: parseFloat(prec.toFixed(1)),
      temperatura: temp
    }));

    setError(null);
    setEstado(
      esSimulacionRuta
        ? '🛣️ Simulando ruta en vivo (1s)...'
        : modoPuenteRef.current
        ? `🔗 Enviando GPS a puente '${puenteIdRef.current}' (1s)...`
        : `🚛 Enviando directo como '${dispositivoIdRef.current}' (1s)...`
    );

    enviarPaquete({
      latitud: lat,
      longitud: lon,
      velocidad: velKmH,
      altitud: alt,
      rumbo: head,
      temperatura: temp
    });
  };

  const limpiarWatchersGps = () => {
    if (watchId.current !== null) {
      if (isCapacitorWatch.current) {
        Geolocation.clearWatch({ id: watchId.current }).catch(() => {});
      } else if (navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      watchId.current = null;
    }
    if (intervaloGpsPollRef.current) {
      clearInterval(intervaloGpsPollRef.current);
      intervaloGpsPollRef.current = null;
    }
    if (intervaloDemoRef.current) {
      clearInterval(intervaloDemoRef.current);
      intervaloDemoRef.current = null;
    }
  };

  const iniciarRutaDemoAutomatica = () => {
    limpiarWatchersGps();
    setError(null);
    setEstado('🛣️ Iniciando recorrido virtual por Cochabamba...');

    const avanzarPaso = () => {
      const prog = demoProgresoRef.current;
      const p1 = RUTA_DEMO_COCHABAMBA[prog.indice];
      const sigIndice = (prog.indice + 1) % RUTA_DEMO_COCHABAMBA.length;
      const p2 = RUTA_DEMO_COCHABAMBA[sigIndice];

      const distTramo = calcularDistanciaMetrosSim(p1[0], p1[1], p2[0], p2[1]);
      const velMs = 12.5; // ~45 km/h
      const pasoFraccion = distTramo > 1 ? velMs / distTramo : 1;

      prog.fraccion += pasoFraccion;
      if (prog.fraccion >= 1) {
        prog.fraccion = 0;
        prog.indice = sigIndice;
      }

      const actualP1 = RUTA_DEMO_COCHABAMBA[prog.indice];
      const actualP2 = RUTA_DEMO_COCHABAMBA[(prog.indice + 1) % RUTA_DEMO_COCHABAMBA.length];
      const lat = actualP1[0] + (actualP2[0] - actualP1[0]) * prog.fraccion;
      const lon = actualP1[1] + (actualP2[1] - actualP1[1]) * prog.fraccion;
      const rumbo = calcularRumboGrados(actualP1[0], actualP1[1], actualP2[0], actualP2[1]);

      actualizarPosicion(
        {
          latitude: lat,
          longitude: lon,
          speed: velMs + (Math.random() * 1.5 - 0.75),
          altitude: 2572,
          heading: rumbo,
          accuracy: 3.0
        },
        true
      );
    };

    avanzarPaso();
    intervaloDemoRef.current = setInterval(avanzarPaso, 1000);
  };

  const iniciarCapturaGpsDispositivo = async (usarAltaPrecision = true) => {
    limpiarWatchersGps();
    setModoAltaPrecision(usarAltaPrecision);

    const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
    if (isNative) {
      try {
        const perm = await Geolocation.requestPermissions();
        if (perm.location === 'denied') {
          setError('Permiso de ubicación denegado en el celular. Actívalo en Ajustes de Android.');
          setConectado(false);
          setEstado('Permiso denegado');
          return;
        }

        try {
          const currentPos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: usarAltaPrecision,
            timeout: 5000,
            maximumAge: 2000
          });
          if (currentPos?.coords) actualizarPosicion(currentPos.coords);
        } catch {}

        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: usarAltaPrecision, maximumAge: 1000, timeout: 10000 },
          (pos, err) => {
            if (err) {
              if (usarAltaPrecision) {
                iniciarCapturaGpsDispositivo(false);
              }
              return;
            }
            if (pos?.coords) actualizarPosicion(pos.coords);
          }
        );
        watchId.current = id;
        isCapacitorWatch.current = true;
      } catch (nativeErr) {
        setError(`Error iniciando GPS nativo: ${nativeErr.message}`);
      }
      return;
    }

    if (!navigator.geolocation) {
      setError('Tu navegador no permite geolocalización en esta página. Asegúrate de entrar por https://trace.cybersec7.xyz/simulador.');
      return;
    }

    isCapacitorWatch.current = false;
    let recibioFijacion = false;

    // 1. Escucha continua de cambios de ubicación (GPS real o Fake GPS)
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        recibioFijacion = true;
        actualizarPosicion(pos.coords);
      },
      (err) => {
        if (err.code === 1) {
          setError(
            '🔒 Permiso de Ubicación bloqueado en el navegador. Toca el ícono de candado/ajustes junto a la barra de dirección (trace.cybersec7.xyz) → Permisos → Ubicación → Permitir, y vuelve a iniciar.'
          );
          setEstado('Sin permiso de GPS');
          return;
        }
        // En interiores con Fake GPS, enableHighAccuracy=true suele dar Timeout (código 3) porque busca satélites físicos.
        // Cambiamos automáticamente a proveedor Fusionado/Mock (enableHighAccuracy=false) SIN pisar las coordenadas con la Plaza.
        if (usarAltaPrecision) {
          console.log('Cambiando a modo proveedor Fusionado / Fake GPS (enableHighAccuracy: false)...');
          iniciarCapturaGpsDispositivo(false);
        } else if (!recibioFijacion && sensoresRef.current.latitud === null) {
          setError('Esperando señal del GPS o de tu app Fake GPS... Mueve el joystick en tu app Fake GPS o usa el botón "Ruta Virtual Automática".');
        }
      },
      {
        enableHighAccuracy: usarAltaPrecision,
        timeout: usarAltaPrecision ? 5000 : 12000,
        maximumAge: 2000
      }
    );

    // 2. Sondeo activo cada 1.5s: muchas apps de Fake GPS en Android actualizan getCurrentPosition aunque watchPosition no dispare eventos
    intervaloGpsPollRef.current = setInterval(() => {
      if (fuenteGpsRef.current !== 'gps') return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          recibioFijacion = true;
          actualizarPosicion(pos.coords);
        },
        () => {},
        { enableHighAccuracy: false, timeout: 3000, maximumAge: 1500 }
      );
    }, 1500);
  };

  const iniciarTransmision = async () => {
    if (!dispositivoId.trim()) {
      setError('Debes ingresar un ID de dispositivo (ej. Camion-1).');
      return;
    }

    setError(null);
    setEstado('Conectando sensores y ubicación...');
    setConectado(true);
    anclaGpsRef.current = { lat: null, lon: null };
    ultimaMuestraMovRef.current = { lat: null, lon: null, ts: 0 };
    solicitarWakeLock();

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try { await DeviceMotionEvent.requestPermission(); } catch {}
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { await DeviceOrientationEvent.requestPermission(); } catch {}
    }

    motionListenerRef.current = (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (acc) {
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;
        const mag = Math.sqrt(x * x + y * y + z * z) / 9.81;
        setSensores((prev) => ({
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
      setSensores((prev) => ({
        ...prev,
        pitch: e.beta !== null && e.beta !== undefined ? parseFloat(e.beta.toFixed(1)) : prev.pitch,
        roll: e.gamma !== null && e.gamma !== undefined ? parseFloat(e.gamma.toFixed(1)) : prev.roll,
        rumbo:
          sensoresRef.current.velocidad < 1.0 && e.alpha !== null && e.alpha !== undefined
            ? parseFloat(e.alpha.toFixed(1))
            : prev.rumbo
      }));
    };
    window.addEventListener('deviceorientation', orientationListenerRef.current);

    if (fuenteGps === 'ruta_demo') {
      iniciarRutaDemoAutomatica();
    } else {
      await iniciarCapturaGpsDispositivo(true);
    }

    if (intervaloEnvioRef.current) clearInterval(intervaloEnvioRef.current);
    intervaloEnvioRef.current = setInterval(() => {
      if (sensoresRef.current.latitud !== null && sensoresRef.current.longitud !== null) {
        enviarPaquete();
      }
    }, 1000);
  };

  const cambiarFuenteEnVivo = (nuevaFuente) => {
    setFuenteGps(nuevaFuente);
    fuenteGpsRef.current = nuevaFuente;
    if (conectado) {
      if (nuevaFuente === 'ruta_demo') {
        iniciarRutaDemoAutomatica();
      } else {
        iniciarCapturaGpsDispositivo(true);
      }
    }
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
      dispositivo_id: dispositivoIdRef.current.trim(),
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
    })
      .then((res) => {
        if (res.ok) setPaquetesEnviados((p) => p + 1);
      })
      .catch((err) => console.error('Error al enviar:', err));
  };

  const detenerTransmision = () => {
    liberarWakeLock();
    setModoOledNegro(false);
    limpiarWatchersGps();
    if (motionListenerRef.current) window.removeEventListener('devicemotion', motionListenerRef.current);
    if (orientationListenerRef.current) window.removeEventListener('deviceorientation', orientationListenerRef.current);
    if (intervaloEnvioRef.current) clearInterval(intervaloEnvioRef.current);

    setConectado(false);
    setEstado('Inactivo');
  };

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-white flex flex-col items-center p-3 sm:p-6 pt-20 pb-36 overflow-y-auto">
      <div className="bg-zinc-900 p-5 sm:p-7 rounded-2xl shadow-2xl border border-zinc-800 max-w-lg w-full text-center my-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-red-500 mb-1">Telemetría Sensor Hub</h1>
        <p className="text-zinc-400 mb-5 text-xs sm:text-sm">
          Transmite GPS real, Fake GPS o Ruta Virtual + Giroscopios en vivo
        </p>

        {/* Selector claro de Destino: Puente hacia ESP32 vs Directo */}
        <div className="mb-4 text-left">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
            1. ¿Cómo quieres enviar los datos?
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={conectado}
              onClick={() => setModoPuente(true)}
              className={`p-3 rounded-xl border text-left transition disabled:opacity-60 ${
                modoPuente
                  ? 'bg-red-950/50 border-red-500 text-white shadow-md'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>🔗</span> Puente a ESP32
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 leading-snug">
                Une el GPS/giroscopio de este celular con el ultrasónico de tu ESP32 en mesa.
              </div>
            </button>

            <button
              type="button"
              disabled={conectado}
              onClick={() => setModoPuente(false)}
              className={`p-3 rounded-xl border text-left transition disabled:opacity-60 ${
                !modoPuente
                  ? 'bg-red-950/50 border-red-500 text-white shadow-md'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>📱</span> Celular Directo
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 leading-snug">
                Envía directo al mapa sin necesitar que el ESP32 esté encendido.
              </div>
            </button>
          </div>
        </div>

        {/* IDs según el modo */}
        <div className="grid grid-cols-2 gap-2.5 mb-4 text-left">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1 font-medium">
              ID Vehículo en Mapa
            </label>
            <input
              type="text"
              value={dispositivoId}
              onChange={(e) => setDispositivoId(e.target.value)}
              disabled={conectado}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 disabled:opacity-50 font-mono text-xs"
              placeholder="Camion-1"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1 font-medium">
              ID Puente ESP32
            </label>
            <input
              type="text"
              value={puenteId}
              onChange={(e) => setPuenteId(e.target.value)}
              disabled={conectado || !modoPuente}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-cyan-300 focus:outline-none focus:border-red-500 disabled:opacity-40 font-mono text-xs"
              placeholder="celular-1"
            />
          </div>
        </div>

        {/* Selector de Fuente de Ubicación: GPS / Fake GPS vs Ruta Automática */}
        <div className="mb-4 text-left">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
            2. Fuente de Ubicación (puedes cambiarla en vivo)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cambiarFuenteEnVivo('gps')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                fuenteGps === 'gps'
                  ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <span>📍</span> GPS Real / Fake GPS
            </button>
            <button
              type="button"
              onClick={() => cambiarFuenteEnVivo('ruta_demo')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                fuenteGps === 'ruta_demo'
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <span>🛣️</span> Simular Recorrido
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1.5">
            {fuenteGps === 'gps'
              ? `Compatible con Fake GPS y GPS satelital (${modoAltaPrecision ? 'Alta precisión' : 'Modo Fusionado / Mock GPS activo'}).`
              : 'Recorre automáticamente avenidas de Cochabamba a ~45 km/h mientras sigue leyendo el giroscopio real de tu mano.'}
          </p>
        </div>

        <ConfigEsp32 puenteId={puenteId} dispositivoId={dispositivoId} />

        <div className="mb-4 flex items-center justify-between bg-zinc-950 p-3 rounded-lg border border-zinc-800">
          <span className="text-xs text-zinc-400">Estado</span>
          <span className={`text-xs font-mono font-bold truncate max-w-[230px] ${conectado ? 'text-green-400 animate-pulse' : 'text-zinc-400'}`}>
            {estado}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4 text-left">
          <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg col-span-2 sm:col-span-3">
            <span className="text-[10px] text-zinc-500 block">Coordenadas Activas (Lat / Lon)</span>
            <span className="font-mono text-emerald-400 text-xs font-bold truncate block">
              {sensores.latitud !== null
                ? `${sensores.latitud.toFixed(6)}, ${sensores.longitud.toFixed(6)}`
                : conectado
                ? 'Obteniendo ubicación de GPS / Fake GPS...'
                : 'Listo para iniciar'}
            </span>
            <span className="text-[10px] text-zinc-400 mt-1 block">
              📦 Paquetes transmitidos: <b className="text-cyan-400 font-mono">{paquetesEnviados}</b>
              {sensores.precision > 0 && (
                <span className="ml-2 text-zinc-500">· Precisión: ±{sensores.precision}m</span>
              )}
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
              <span className="font-mono text-cyan-400 font-bold">
                {sensores.pitch > 0 ? `+${sensores.pitch}` : sensores.pitch}° / {sensores.roll > 0 ? `+${sensores.roll}` : sensores.roll}°
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              Mueve tu celular: esta burbuja reacciona a tu mano y se envía al ESP32.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/50 border border-red-800/80 text-red-300 rounded-xl text-xs text-left space-y-2">
            <div className="leading-relaxed">{error}</div>
            <button
              type="button"
              onClick={() => cambiarFuenteEnVivo('ruta_demo')}
              className="w-full bg-cyan-700 hover:bg-cyan-600 text-white font-bold py-2 px-3 rounded-lg text-center text-[11px] transition"
            >
              🛣️ Usar Recorrido Virtual Automático ahora
            </button>
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
              <span>{bloqueoPantallaActivo ? 'Pantalla Activa (ON)' : 'WakeLock OFF'}</span>
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

      {/* OVERLAY ULTRA-AHORRO MODO BOLSILLO */}
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
