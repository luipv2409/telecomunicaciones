import { useState, useEffect, useRef } from 'react';

export default function Simulador() {
  const [conectado, setConectado] = useState(false);
  const [ubicacion, setUbicacion] = useState(null);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('Inactivo');
  const [dispositivoId, setDispositivoId] = useState(`camion-${Math.floor(Math.random() * 1000)}`);
  const watchId = useRef(null);

  useEffect(() => {
    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  const iniciarTransmision = () => {
    if (!navigator.geolocation) {
      setError('Geolocalización no soportada en este dispositivo.');
      return;
    }

    if (!dispositivoId.trim()) {
      setError('Debes ingresar un ID de dispositivo.');
      return;
    }
    
    setError(null);
    setEstado('Conectado. Obteniendo GPS...');
    setConectado(true);
    
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const latitud = pos.coords.latitude;
        const longitud = pos.coords.longitude;
        setUbicacion({ latitud, longitud });
        setEstado('Transmitiendo datos GPS...');

        const datos = {
          timestamp: new Date().toISOString(),
          dispositivo_id: dispositivoId.trim(),
          latitud: latitud,
          longitud: longitud,
          temperatura: 25.0 + Math.random() * 10,
          vibracion: 0.5 + Math.random() * 1.5,
          voltaje: 3.7
        };
        
        fetch('/api/telemetria', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        }).catch(err => {
          console.error('Error al enviar:', err);
        });
      },
      (err) => {
        setError(`Error de GPS: ${err.message}`);
        setEstado('Error de GPS');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const detenerTransmision = () => {
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    setConectado(false);
    setEstado('Inactivo');
    setUbicacion(null);
  };

  return (
    <div className="w-full h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4">
      <div className="bg-zinc-900 p-8 rounded-xl shadow-2xl border border-zinc-800 max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-red-500 mb-2">Simulador ESP32</h1>
        <p className="text-zinc-400 mb-8">Envía tu ubicación GPS o Fake GPS al servidor en tiempo real.</p>

        <div className="mb-6 text-left">
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            ID del Vehículo (Placa / Nombre)
          </label>
          <input 
            type="text" 
            value={dispositivoId}
            onChange={(e) => setDispositivoId(e.target.value)}
            disabled={conectado}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors disabled:opacity-50"
            placeholder="Ej. camion-123"
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
            <div className="text-zinc-400 mb-2">Última coordenada enviada:</div>
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
          <button 
            onClick={iniciarTransmision}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-4 rounded-xl transition-colors shadow-lg"
          >
            Iniciar Transmisión
          </button>
        ) : (
          <button 
            onClick={detenerTransmision}
            className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-4 px-4 rounded-xl transition-colors shadow-lg"
          >
            Detener Transmisión
          </button>
        )}
      </div>
    </div>
  );
}
