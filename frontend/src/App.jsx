import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Simulador from './Simulador';

function MapaView({ alVolver }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  const referenciaMarcador = useRef(null);
  const coordendasRuta = useRef([]);

  useEffect(() => {
    referenciaMapa.current = new maplibregl.Map({
      container: contenedorMapa.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-66.16, -17.41], // Centrado cerca de Bolivia
      zoom: 14
    });

    referenciaMapa.current.on('error', (e) => console.error('MapLibre error:', e));

    referenciaMapa.current.on('load', () => {
      referenciaMapa.current.addSource('ruta-camion', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      referenciaMapa.current.addLayer({
        id: 'capa-ruta',
        type: 'line',
        source: 'ruta-camion',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#ff0000',
          'line-width': 4
        }
      });

      const elementoMarcador = document.createElement('div');
      elementoMarcador.className = 'w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg';
      
      referenciaMarcador.current = new maplibregl.Marker({ element: elementoMarcador })
        .setLngLat([-66.16, -17.41]) // Inicial en Bolivia
        .addTo(referenciaMapa.current);
    });

    iniciarConexionServidor();

    return () => {
      referenciaMapa.current.remove();
    };
  }, []);

  const iniciarConexionServidor = () => {
    // Usar window.location.hostname para funcionar en red local
    const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const conexionWebsocket = new WebSocket(`${protocolo}//${window.location.host}/ws`);
    
    conexionWebsocket.onmessage = (evento) => {
      const datos = JSON.parse(evento.data);
      console.log('Datos recibidos del servidor:', datos);
      
      // El backend ahora envía 'lo' y 'la' cuando alguien transmite
      if (datos.lo && datos.la) {
        const nuevaCoordenada = [datos.lo, datos.la];
        
        referenciaMarcador.current.setLngLat(nuevaCoordenada);
        coordendasRuta.current.push(nuevaCoordenada);
        
        const fuenteDatos = referenciaMapa.current.getSource('ruta-camion');
        if (fuenteDatos) {
          fuenteDatos.setData({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: coordendasRuta.current
            }
          });
        }
        
        referenciaMapa.current.panTo(nuevaCoordenada);
      }
    };
  };

  return (
    <div className="w-full h-screen relative bg-zinc-950" style={{ width: '100vw', height: '100vh' }}>
      <div ref={contenedorMapa} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      <div className="absolute top-4 left-4 bg-zinc-900 bg-opacity-90 text-white p-4 rounded-lg shadow-2xl backdrop-blur-sm border border-zinc-800 z-10">
        <h1 className="text-xl font-bold mb-1 text-red-500">TRACE-MIN</h1>
        <p className="text-xs text-zinc-400 font-mono">ESTADO: EN LÍNEA</p>
        <button 
          onClick={alVolver} 
          className="mt-4 w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-semibold py-2 px-3 rounded transition-colors"
        >
          ← Volver al Menú
        </button>
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
            Ver Mapa en Vivo
          </button>

          <button 
            onClick={() => setModo('simulador')}
            className="w-full bg-red-600 hover:bg-red-700 border border-red-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-2xl">📱</span>
            Simular ESP32
          </button>
        </div>
      </div>
    </div>
  );
}
