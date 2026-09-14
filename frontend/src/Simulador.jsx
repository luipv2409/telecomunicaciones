import { useState, useEffect, useRef } from 'react';

// Fórmula Haversine
const calcularDistancia = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const toRad = (valor) => (valor * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function Simulador() {
  const [conectado, setConectado] = useState(false);
  const [ubicacion, setUbicacion] = useState(null); // la renderizada
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('Inactivo');
  const [dispositivoId, setDispositivoId] = useState(`camion-${Math.floor(Math.random() * 1000)}`);
  
  const watchId = useRef(null);
  const posActualRef = useRef(null);
  const ultimoEnvioRef = useRef({ lat: 0, lon: 0, temp: 0, tiempo: 0 });
  const simulacionTickRef = useRef(null);

  useEffect(() => {
    return () => detenerTransmision();
  }, []);

  useEffect(() => {
    if (conectado) {
      // Loop de control (Ingeniería de Control: Thresholding & Heartbeat)
      simulacionTickRef.current = setInterval(() => {
        const actual = posActualRef.current;
        if (!actual) return;

        const ult = ultimoEnvioRef.current;
        const ahora = Date.now();
        
        // Simular sensores
        const tempActual = 25.0 + Math.random() * 5;
        const vibActual = 0.5 + Math.random() * 2;

        let enviar = false;
        let motivo = '';

        if (ult.tiempo === 0) {
          enviar = true;
          motivo = 'Primer Fix';
        } else {
          const dist = calcularDistancia(ult.lat, ult.lon, actual.lat, actual.lon);
          const deltaTemp = Math.abs(tempActual - ult.temp);
          const deltaTiempo = ahora - ult.tiempo;

          if (dist > 50.0) { enviar = true; motivo = 'Movimiento > 50m'; }
          else if (deltaTemp > 2.0) { enviar = true; motivo = 'Anomalía Temp > 2°C'; }
          else if (vibActual > 2.0) { enviar = true; motivo = 'Impacto (Vib)'; }
          else if (deltaTiempo > 300000) { enviar = true; motivo = 'Heartbeat (5 min)'; }
        }

        if (enviar) {
          setEstado(`Transmitiendo: ${motivo}`);
          setUbicacion({ latitud: actual.lat, longitud: actual.lon });
          
          const datos = {
            timestamp: new Date().toISOString(),
            dispositivo_id: dispositivoId.trim(),
            latitud: actual.lat,
            longitud: actual.lon,
            temperatura: tempActual,
            vibracion: vibActual,
            voltaje: 3.7
          };

          fetch('/api/telemetria', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
          }).then(res => {
            if (res.status === 429) {
              setError('ERROR: Límite del Servidor Alcanzado (Max 10 vehículos/día).');
              detenerTransmision();
            } else if (!res.ok) {
              setError(`Error HTTP: ${res.status}`);
            }
          }).catch(err => console.error('Error al enviar:', err));

          ultimoEnvioRef.current = { lat: actual.lat, lon: actual.lon, temp: tempActual, tiempo: ahora };
        } else {
          setEstado('Standby (Ahorrando recursos)');
        }
      }, 2000); // Evalúa cada 2 segundos, pero solo envía si cumple umbrales
    }

    return () => {
      if (simulacionTickRef.current) clearInterval(simulacionTickRef.current);
    };
  }, [conectado, dispositivoId]);

  const iniciarTransmision = () => {
    if (!navigator.geolocation) {
      setError('Geolocalización no soportada en este navegador.');
      return;
    }
    if (!dispositivoId.trim()) {
      setError('Debes ingresar un ID de dispositivo.');
      return;
    }
    
    setError(null);
    setEstado('Conectado. Esperando GPS...');
    setConectado(true);
    
    // Solo usamos watchPosition para actualizar la ref en memoria
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        posActualRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      },
      (err) => {
        setError(`Error de GPS: ${err.message}`);
        setConectado(false);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  const detenerTransmision = () => {
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    if (simulacionTickRef.current) clearInterval(simulacionTickRef.current);
    setConectado(false);
    setEstado('Inactivo');
    setUbicacion(null);
    ultimoEnvioRef.current = { lat: 0, lon: 0, temp: 0, tiempo: 0 };
    posActualRef.current = null;
  };

  return (
    <div className="w-full h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4">
      <div className="bg-zinc-900 p-8 rounded-xl shadow-2xl border border-zinc-800 max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-red-500 mb-2">Simulador Edge AI</h1>
        <p className="text-zinc-400 mb-8">Usa Ingeniería de Control para ahorrar ancho de banda.</p>

        <div className="mb-6 text-left">
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            ID del Vehículo
          </label>
          <input 
            type="text" 
            value={dispositivoId}
            onChange={(e) => setDispositivoId(e.target.value)}
            disabled={conectado}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 disabled:opacity-50"
          />
        </div>

        <div className="mb-8">
          <div className="text-sm text-zinc-500 mb-1">Estado</div>
          <div className={`text-lg font-mono ${conectado ? 'text-green-400' : 'text-zinc-300'}`}>
            {estado}
          </div>
        </div>

        {ubicacion && (
          <div className="mb-8 p-4 bg-zinc-950 rounded-lg font-mono text-sm border border-zinc-800">
            <div className="text-zinc-400 mb-2">Último paquete (Transmitido):</div>
            <div className="text-blue-400">Lat: {ubicacion.latitud.toFixed(6)}</div>
            <div className="text-green-400">Lon: {ubicacion.longitud.toFixed(6)}</div>
          </div>
        )}

        {error && (
          <div className="mb-8 p-3 bg-red-900 bg-opacity-30 border border-red-800 text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!conectado ? (
          <button onClick={iniciarTransmision} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-4 rounded-xl shadow-lg">
            Iniciar Transmisión Inteligente
          </button>
        ) : (
          <button onClick={detenerTransmision} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-4 px-4 rounded-xl shadow-lg">
            Apagar Motor (Detener)
          </button>
        )}
      </div>
    </div>
  );
}
