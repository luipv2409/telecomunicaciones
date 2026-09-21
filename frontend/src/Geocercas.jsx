import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getApiUrl } from './config';

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
  layers: [{ id: 'osm-tiles-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
};

export default function Geocercas({ auth, alVolver }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  
  const [geocercas, setGeocercas] = useState([]);
  const [puntos, setPuntos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);

  const cargarGeocercas = async () => {
    try {
      const res = await fetch(getApiUrl('/api/geocercas'), { headers: { 'Authorization': `Bearer ${auth.token}` }});
      const data = await res.json();
      setGeocercas(data);
      if (referenciaMapa.current) dibujarGeocercasGuardadas(data);
    } catch (e) {
      console.error(e);
    }
  };

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
      mapa.addSource('dibujo', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      mapa.addLayer({
        id: 'dibujo-fill',
        type: 'fill',
        source: 'dibujo',
        paint: { 'fill-color': '#f87171', 'fill-opacity': 0.4 }
      });
      mapa.addLayer({
        id: 'dibujo-line',
        type: 'line',
        source: 'dibujo',
        paint: { 'line-color': '#ef4444', 'line-width': 2 }
      });

      cargarGeocercas();
    });

    mapa.on('click', (e) => {
      if (referenciaMapa.current.getCanvas().style.cursor === 'crosshair') {
        setPuntos(prev => {
          const nuevos = [...prev, [e.lngLat.lng, e.lngLat.lat]];
          actualizarDibujo(nuevos);
          return nuevos;
        });
      }
    });

    return () => mapa.remove();
  }, []);

  const actualizarDibujo = (pts) => {
    if (!referenciaMapa.current || !referenciaMapa.current.isStyleLoaded()) return;
    
    let geom = null;
    if (pts.length === 1) geom = { type: 'Point', coordinates: pts[0] };
    else if (pts.length === 2) geom = { type: 'LineString', coordinates: pts };
    else geom = { type: 'Polygon', coordinates: [[...pts, pts[0]]] };

    referenciaMapa.current.getSource('dibujo').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: geom }]
    });
  };

  const dibujarGeocercasGuardadas = (lista) => {
    const features = lista.map(gc => ({
      type: 'Feature',
      properties: { nombre: gc.nombre },
      geometry: gc.poligono
    }));

    if (!referenciaMapa.current.getSource('geocercas-guardadas')) {
      referenciaMapa.current.addSource('geocercas-guardadas', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });
      referenciaMapa.current.addLayer({
        id: 'geocercas-guardadas-fill',
        type: 'fill',
        source: 'geocercas-guardadas',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.3 }
      });
      referenciaMapa.current.addLayer({
        id: 'geocercas-guardadas-line',
        type: 'line',
        source: 'geocercas-guardadas',
        paint: { 'line-color': '#2563eb', 'line-width': 2 }
      });
      
      referenciaMapa.current.on('click', 'geocercas-guardadas-fill', (e) => {
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<strong style="color:#000;">${e.features[0].properties.nombre}</strong>`)
          .addTo(referenciaMapa.current);
      });
    } else {
      referenciaMapa.current.getSource('geocercas-guardadas').setData({
        type: 'FeatureCollection', features
      });
    }
  };

  const iniciarDibujo = () => {
    setCreando(true);
    setPuntos([]);
    actualizarDibujo([]);
    if (referenciaMapa.current) {
      referenciaMapa.current.getCanvas().style.cursor = 'crosshair';
    }
  };

  const cancelarDibujo = () => {
    setCreando(false);
    setPuntos([]);
    actualizarDibujo([]);
    if (referenciaMapa.current) {
      referenciaMapa.current.getCanvas().style.cursor = '';
    }
  };

  const guardarGeocerca = async () => {
    if (puntos.length < 3) return alert('Una geocerca debe tener al menos 3 puntos');
    if (!nombre) return alert('Debes darle un nombre a la geocerca');

    const poligono = {
      type: 'Polygon',
      coordinates: [[...puntos, puntos[0]]]
    };

    try {
      const res = await fetch(getApiUrl('/api/geocercas'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` 
        },
        body: JSON.stringify({ nombre, poligono })
      });
      if (res.ok) {
        cancelarDibujo();
        setNombre('');
        cargarGeocercas();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="w-full h-screen relative bg-zinc-950 font-sans flex flex-col">
      <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex gap-4 items-end z-20 shadow-xl">
        <button 
          onClick={alVolver} 
          className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg border border-zinc-700 text-sm h-10"
        >
          ← Volver
        </button>
        
        {!creando ? (
          <button 
            onClick={iniciarDibujo}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-bold h-10 ml-auto"
          >
            + Nueva Geocerca
          </button>
        ) : (
          <div className="flex gap-3 ml-auto items-end">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Nombre</label>
              <input 
                type="text" 
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej. Sede Central"
                className="bg-zinc-950 border border-zinc-700 text-white px-3 py-2 rounded h-10 text-sm"
              />
            </div>
            <button 
              onClick={guardarGeocerca}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-bold h-10"
            >
              Guardar
            </button>
            <button 
              onClick={cancelarDibujo}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-bold h-10"
            >
              Cancelar
            </button>
            <div className="text-zinc-400 text-xs self-center ml-2">Haz clic en el mapa para dibujar</div>
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        <div ref={contenedorMapa} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}
