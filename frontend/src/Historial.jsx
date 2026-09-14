import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const estiloMapa = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap'
    }
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

export default function Historial({ auth, alVolver }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  const markerRef = useRef(null);

  const [dispositivos, setDispositivos] = useState([]);
  const [seleccionado, setSeleccionado] = useState('');
  const [inicio, setInicio] = useState(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [fin, setFin] = useState(new Date().toISOString().slice(0, 16));
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    if (!contenedorMapa.current) return;

    const mapa = new maplibregl.Map({
      container: contenedorMapa.current,
      style: estiloMapa,
      center: [-66.16, -17.41],
      zoom: 13
    });

    referenciaMapa.current = mapa;
    mapa.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapa.on('load', () => {
      mapa.addSource('ruta-historial', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      mapa.addLayer({
        id: 'capa-ruta-historial',
        type: 'line',
        source: 'ruta-historial',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4,
          'line-opacity': 0.8
        }
      });
      
      const el = document.createElement('div');
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.backgroundColor = '#18181b';
      el.style.border = '2px solid #f59e0b';
      el.style.borderRadius = '50%';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.8)';
      
      const img = document.createElement('img');
      img.src = '/camion.svg';
      img.style.width = '14px';
      img.style.height = '14px';
      img.style.filter = 'invert(1)';
      el.appendChild(img);

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([-66.16, -17.41])
        .addTo(mapa);

      const fetchDispositivos = async () => {
        try {
          const res = await fetch('/api/flota/dispositivos', {
            headers: { 'Authorization': `Bearer ${auth.token}` }
          });
          const data = await res.json();
          setDispositivos(data);
          if (data.length > 0) setSeleccionado(data[0]);
        } catch (err) {
          console.error('Error fetching dispositivos:', err);
        }
      };
      fetchDispositivos();
    });

    return () => mapa.remove();
  }, []);

  const buscarHistorial = async () => {
    setCargando(true);
    setIndice(0);
    try {
      const isostart = new Date(inicio).toISOString();
      const isoend = new Date(fin).toISOString();
      const res = await fetch(`/api/flota/historial?dispositivo_id=${seleccionado}&inicio=${isostart}&fin=${isoend}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      const data = await res.json();
      setHistorial(data);

      if (data.length > 0 && referenciaMapa.current) {
        const coords = data.map(d => [parseFloat(d.lo), parseFloat(d.la)]);
        referenciaMapa.current.getSource('ruta-historial').setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords }
          }]
        });

        // Calculate bounds to fit the whole route
        const bounds = coords.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(coords[0], coords[0])
        );
        referenciaMapa.current.fitBounds(bounds, { padding: 50 });
        
        markerRef.current.setLngLat(coords[0]);
        if (data[0].rumbo) markerRef.current.getElement().style.transform += ` rotate(${data[0].rumbo}deg)`;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (historial.length > 0 && markerRef.current) {
      const punto = historial[indice];
      if (punto) {
        const coord = [parseFloat(punto.lo), parseFloat(punto.la)];
        markerRef.current.setLngLat(coord);
        referenciaMapa.current.panTo(coord, { duration: 200 });
      }
    }
  }, [indice, historial]);

  return (
    <div className="w-full h-screen relative bg-zinc-950 font-sans flex flex-col">
      <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex gap-4 items-end z-20 shadow-xl">
        <button 
          onClick={alVolver} 
          className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg border border-zinc-700 text-sm h-10"
        >
          ← Volver
        </button>
        
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Vehículo</label>
          <select 
            value={seleccionado} 
            onChange={e => setSeleccionado(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 text-white px-3 py-2 rounded h-10 text-sm"
          >
            {dispositivos.map(d => <option key={d} value={d}>{d}</option>)}
            {dispositivos.length === 0 && <option value="">Cargando...</option>}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Desde</label>
          <input 
            type="datetime-local" 
            value={inicio}
            onChange={e => setInicio(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 text-white px-3 py-2 rounded h-10 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Hasta</label>
          <input 
            type="datetime-local" 
            value={fin}
            onChange={e => setFin(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 text-white px-3 py-2 rounded h-10 text-sm"
          />
        </div>

        <button 
          onClick={buscarHistorial}
          disabled={cargando}
          className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded font-bold h-10"
        >
          {cargando ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      <div className="flex-1 relative">
        <div ref={contenedorMapa} className="absolute inset-0 w-full h-full" />
      </div>

      {historial.length > 0 && (
        <div className="bg-zinc-900 border-t border-zinc-800 p-6 z-20">
          <div className="flex justify-between text-xs text-zinc-400 mb-2">
            <span>{new Date(historial[0].timestamp).toLocaleString()}</span>
            <span className="font-bold text-white text-base">
              {new Date(historial[indice].timestamp).toLocaleString()} | Vel: {historial[indice].velocidad || 0} km/h
            </span>
            <span>{new Date(historial[historial.length-1].timestamp).toLocaleString()}</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max={historial.length - 1} 
            value={indice} 
            onChange={e => setIndice(parseInt(e.target.value))}
            className="w-full accent-red-500 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}
