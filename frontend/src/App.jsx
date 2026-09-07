import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Simulador from './Simulador';

function MapaView({ alVolver }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  const vehiculosRef = useRef({}); // Diccionario de { id: { marker, coords, sourceId, color, ... } }
  const [vehiculosUI, setVehiculosUI] = useState({}); // Para renderizar el dashboard

  // Colores para asignar dinámicamente a nuevos camiones
  const colores = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  useEffect(() => {
    referenciaMapa.current = new maplibregl.Map({
      container: contenedorMapa.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-66.16, -17.41], // Centrado cerca de Bolivia
      zoom: 14
    });

    referenciaMapa.current.on('error', (e) => console.error('MapLibre error:', e));

    referenciaMapa.current.on('load', () => {
      // Iniciar websocket solo cuando el mapa base cargó
      iniciarConexionServidor();
    });

    return () => {
      referenciaMapa.current.remove();
    };
  }, []);

  const iniciarConexionServidor = () => {
    const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const conexionWebsocket = new WebSocket(`${protocolo}//${window.location.host}/ws`);
    
    conexionWebsocket.onmessage = (evento) => {
      const datos = JSON.parse(evento.data);
      console.log('Datos recibidos del servidor:', datos);
      
      const { dispositivo_id, lo, la, temperatura, vibracion, voltaje } = datos;

      if (dispositivo_id && lo && la) {
        const nuevaCoordenada = [lo, la];
        let vehiculo = vehiculosRef.current[dispositivo_id];
        let esNuevo = false;

        if (!vehiculo) {
          esNuevo = true;
          // Asignar un color según cuántos vehículos haya
          const color = colores[Object.keys(vehiculosRef.current).length % colores.length];

          // 1. Crear el Source y Layer para la ruta
          const sourceId = `ruta-${dispositivo_id}`;
          referenciaMapa.current.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [nuevaCoordenada]
              }
            }
          });

          referenciaMapa.current.addLayer({
            id: `capa-${dispositivo_id}`,
            type: 'line',
            source: sourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': color,
              'line-width': 4,
              'line-opacity': 0.8
            }
          });

          // 2. Crear el Marcador
          const elementoMarcador = document.createElement('div');
          elementoMarcador.className = 'w-4 h-4 rounded-full border-2 border-white shadow-lg cursor-pointer transition-transform hover:scale-125';
          elementoMarcador.style.backgroundColor = color;
          
          const marker = new maplibregl.Marker({ element: elementoMarcador })
            .setLngLat(nuevaCoordenada)
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>${dispositivo_id}</strong>`))
            .addTo(referenciaMapa.current);

          vehiculo = {
            id: dispositivo_id,
            color,
            marker,
            coords: [nuevaCoordenada],
            sourceId
          };
          vehiculosRef.current[dispositivo_id] = vehiculo;
        } else {
          // Si ya existe, actualizar posición y ruta
          vehiculo.marker.setLngLat(nuevaCoordenada);
          vehiculo.coords.push(nuevaCoordenada);
          
          const fuenteDatos = referenciaMapa.current.getSource(vehiculo.sourceId);
          if (fuenteDatos) {
            fuenteDatos.setData({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: vehiculo.coords
              }
            });
          }
        }

        // Actualizar datos del sensor para el UI
        vehiculo.ultimaAct = new Date().toLocaleTimeString();
        if (temperatura !== undefined) vehiculo.temperatura = temperatura;
        if (vibracion !== undefined) vehiculo.vibracion = vibracion;
        if (voltaje !== undefined) vehiculo.voltaje = voltaje;

        // Centrar mapa si es el primer dato del primer vehículo
        if (esNuevo && Object.keys(vehiculosRef.current).length === 1) {
          referenciaMapa.current.panTo(nuevaCoordenada);
        }

        // Forzar render de React para actualizar el Dashboard lateral
        setVehiculosUI({ ...vehiculosRef.current });
      }
    };
  };

  const centrarEnVehiculo = (id) => {
    const vehiculo = vehiculosRef.current[id];
    if (vehiculo && vehiculo.coords.length > 0) {
      const ultimaCoord = vehiculo.coords[vehiculo.coords.length - 1];
      referenciaMapa.current.flyTo({ center: ultimaCoord, zoom: 16 });
      vehiculo.marker.togglePopup();
    }
  };

  return (
    <div className="w-full h-screen relative bg-zinc-950" style={{ width: '100vw', height: '100vh' }}>
      {/* Contenedor del Mapa */}
      <div ref={contenedorMapa} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      
      {/* Botón Volver */}
      <button 
        onClick={alVolver} 
        className="absolute top-4 left-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors z-10"
      >
        ← Volver al Menú
      </button>

      {/* Dashboard Lateral (Sidebar) */}
      <div className="absolute top-20 left-4 w-80 max-h-[80vh] overflow-y-auto bg-zinc-900 bg-opacity-90 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl p-4 z-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-red-500">TRACE-MIN Flotas</h1>
          <span className="flex items-center gap-2 text-xs text-green-400 font-mono bg-green-400 bg-opacity-10 px-2 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
            EN LÍNEA
          </span>
        </div>

        {Object.keys(vehiculosUI).length === 0 ? (
          <div className="text-zinc-500 text-sm italic text-center py-8">
            Esperando conexión de vehículos...
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {Object.values(vehiculosUI).map((vehiculo) => (
              <div 
                key={vehiculo.id} 
                className="bg-zinc-950 bg-opacity-50 border border-zinc-800 rounded-lg p-3 hover:border-zinc-600 transition-colors cursor-pointer"
                onClick={() => centrarEnVehiculo(vehiculo.id)}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: vehiculo.color }}></div>
                  <div className="font-bold text-white">{vehiculo.id}</div>
                  <div className="text-xs text-zinc-500 ml-auto">{vehiculo.ultimaAct}</div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 mb-1">Temperatura</div>
                    <div className="font-mono text-orange-400">{vehiculo.temperatura ? vehiculo.temperatura.toFixed(1) + ' °C' : 'N/A'}</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 mb-1">Vibración</div>
                    <div className="font-mono text-yellow-400">{vehiculo.vibracion ? vehiculo.vibracion.toFixed(2) + ' G' : 'N/A'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [modo, setModo] = useState('menu'); // 'menu', 'mapa', 'simulador'

  if (modo === 'mapa') {
    return <MapaView alVolver={() => setModo('menu')} />;
  }

  if (modo === 'simulador') {
    return (
      <div className="relative">
        <button 
          onClick={() => setModo('menu')} 
          className="absolute top-4 left-4 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg shadow-lg z-10 transition-colors border border-zinc-700"
        >
          ← Volver
        </button>
        <Simulador />
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 font-sans">
      <div className="bg-zinc-900 p-10 rounded-2xl shadow-2xl border border-zinc-800 max-w-md w-full text-center">
        <h1 className="text-4xl font-bold text-red-500 mb-2 tracking-tight">TRACE-MIN</h1>
        <p className="text-zinc-400 mb-10 text-sm">Sistema de Telemetría Vehicular</p>

        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setModo('mapa')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-2xl">🗺️</span>
            Ver Mapa de Flotas
          </button>

          <button 
            onClick={() => setModo('simulador')}
            className="w-full bg-red-600 hover:bg-red-700 border border-red-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-2xl">📱</span>
            Simular Vehículo
          </button>
        </div>
      </div>
    </div>
  );
}
