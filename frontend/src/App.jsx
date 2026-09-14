import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Simulador from './Simulador';

function Login({ onLogin, alVolver }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
      
      onLogin(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <button 
        onClick={alVolver} 
        className="absolute top-4 left-4 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg z-10 border border-zinc-700"
      >
        ← Volver
      </button>
      
      <div className="bg-zinc-900 p-10 rounded-2xl shadow-2xl border border-zinc-800 max-w-sm w-full">
        <h2 className="text-2xl font-bold text-red-500 mb-6 text-center">Acceso a Flotas</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-zinc-400 text-sm mb-1 block">Usuario</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
              required 
            />
          </div>
          <div>
            <label className="text-zinc-400 text-sm mb-1 block">Contraseña</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
              required 
            />
          </div>
          
          {error && <div className="text-red-400 text-sm text-center bg-red-900 bg-opacity-20 p-2 rounded">{error}</div>}
          
          <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg mt-2">
            Ingresar
          </button>
        </form>
        <div className="mt-6 text-xs text-zinc-500 text-center">
          Usuarios de prueba: admin, cliente1, cliente2 (Pass: 1234)
        </div>
      </div>
    </div>
  );
}

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

function MapaView({ auth, alVolver }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  const vehiculosRef = useRef({}); 
  const [vehiculosUI, setVehiculosUI] = useState({}); 
  const [filtrosVisibles, setFiltrosVisibles] = useState({});

  const colores = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  useEffect(() => {
    if (!contenedorMapa.current) return;

    const mapa = new maplibregl.Map({
      container: contenedorMapa.current,
      style: estiloMapa,
      center: [-66.16, -17.41],
      zoom: 13
    });

    referenciaMapa.current = mapa;
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    mapa.on('load', () => {
      mapa.resize();
      setTimeout(() => mapa.resize(), 300);
      cargarHistorialDeHoy();
      iniciarConexionServidor();
    });

    const manejarResize = () => mapa.resize();
    window.addEventListener('resize', manejarResize);

    const intervaloChequeo = setInterval(() => {
      setVehiculosUI({ ...vehiculosRef.current });
    }, 4000);

    return () => {
      clearInterval(intervaloChequeo);
      window.removeEventListener('resize', manejarResize);
      mapa.remove();
    };
  }, []);

  useEffect(() => {
    if (!referenciaMapa.current || !referenciaMapa.current.isStyleLoaded()) return;

    Object.keys(filtrosVisibles).forEach(id => {
      const isVisible = filtrosVisibles[id] ? 'visible' : 'none';
      if (referenciaMapa.current.getLayer(`capa-linea-${id}`)) {
        referenciaMapa.current.setLayoutProperty(`capa-linea-${id}`, 'visibility', isVisible);
      }
      if (referenciaMapa.current.getLayer(`capa-puntos-${id}`)) {
        referenciaMapa.current.setLayoutProperty(`capa-puntos-${id}`, 'visibility', isVisible);
      }
      
      const v = vehiculosRef.current[id];
      if (v && v.marker) {
        const el = v.marker.getElement();
        el.style.display = isVisible === 'none' ? 'none' : 'block';
      }
    });
  }, [filtrosVisibles, vehiculosUI]);

  const alternarFiltro = (id) => {
    setFiltrosVisibles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const mostrarTodos = () => {
    const nuevosFiltros = {};
    Object.keys(vehiculosUI).forEach(id => nuevosFiltros[id] = true);
    setFiltrosVisibles(nuevosFiltros);
  };

  const formatearNumero = (valor, decimales = 1, def = '0') => {
    if (valor === undefined || valor === null || isNaN(Number(valor))) return def;
    return Number(valor).toFixed(decimales);
  };

  const registrarOActualizarVehiculo = (datos) => {
    const { 
      dispositivo_id, 
      lo, 
      la, 
      temperatura, 
      vibracion, 
      voltaje, 
      velocidad,
      altitud,
      rumbo,
      bateria,
      pitch,
      roll,
      timestamp 
    } = datos;

    const numLon = parseFloat(lo);
    const numLat = parseFloat(la);
    if (isNaN(numLon) || isNaN(numLat)) return;

    const nuevaCoordenada = [numLon, numLat];
    const tiempoMs = timestamp ? new Date(timestamp).getTime() : Date.now();
    const horaLegible = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    const puntoPropiedades = {
      dispositivo_id,
      hora: horaLegible,
      temperatura: formatearNumero(temperatura, 1, '25.0'),
      vibracion: formatearNumero(vibracion, 2, '0.00'),
      velocidad: formatearNumero(velocidad, 1, '0.0'),
      altitud: formatearNumero(altitud, 1, '0.0'),
      rumbo: formatearNumero(rumbo, 0, '0'),
      bateria: formatearNumero(bateria, 0, '100'),
      voltaje: formatearNumero(voltaje, 2, '3.70'),
      pitch: formatearNumero(pitch, 1, '0.0'),
      roll: formatearNumero(roll, 1, '0.0')
    };

    let vehiculo = vehiculosRef.current[dispositivo_id];

    if (!vehiculo) {
      const color = colores[Object.keys(vehiculosRef.current).length % colores.length];
      const sourceId = `ruta-${dispositivo_id}`;
      
      const featuresIniciales = [
        { 
          type: 'Feature', 
          geometry: { type: 'LineString', coordinates: [nuevaCoordenada, nuevaCoordenada] }, 
          properties: {} 
        },
        { 
          type: 'Feature', 
          geometry: { type: 'Point', coordinates: nuevaCoordenada }, 
          properties: puntoPropiedades 
        }
      ];

      if (referenciaMapa.current && referenciaMapa.current.isStyleLoaded()) {
        referenciaMapa.current.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: featuresIniciales }
        });

        referenciaMapa.current.addLayer({
          id: `capa-linea-${dispositivo_id}`,
          type: 'line',
          source: sourceId,
          filter: ['==', '$type', 'LineString'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0.8 }
        });

        const capaPuntosId = `capa-puntos-${dispositivo_id}`;
        referenciaMapa.current.addLayer({
          id: capaPuntosId,
          type: 'circle',
          source: sourceId,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 6,
            'circle-color': color,
            'circle-opacity': 0.85,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });

        referenciaMapa.current.on('click', capaPuntosId, (e) => {
          const props = e.features[0].properties;
          const coord = e.features[0].geometry.coordinates.slice();
          
          new maplibregl.Popup()
            .setLngLat(coord)
            .setHTML(`
              <div style="color: #18181b; padding: 6px; font-family: sans-serif; min-width: 170px;">
                <strong style="color: #dc2626; display: block; font-size: 14px; border-bottom: 1px solid #e4e4e7; padding-bottom: 4px; margin-bottom: 6px;">${props.dispositivo_id}</strong>
                <div style="font-size: 11px; line-height: 1.6;">
                  <div>🕒 Hora: <b>${props.hora}</b></div>
                  <div>🚀 Vel: <b>${props.velocidad} km/h</b> | 🧭 ${props.rumbo}°</div>
                  <div>⛰️ Alt: <b>${props.altitud} m</b></div>
                  <div>🔥 Temp: <b>${props.temperatura} °C</b></div>
                  <div>〰️ Vib: <b>${props.vibracion} G</b></div>
                  <div>📐 Pitch/Roll: <b>${props.pitch}° / ${props.roll}°</b></div>
                  <div>🔋 Bat: <b>${props.bateria}% (${props.voltaje}V)</b></div>
                </div>
              </div>
            `)
            .addTo(referenciaMapa.current);
        });

        referenciaMapa.current.on('mouseenter', capaPuntosId, () => {
          referenciaMapa.current.getCanvas().style.cursor = 'pointer';
        });
        referenciaMapa.current.on('mouseleave', capaPuntosId, () => {
          referenciaMapa.current.getCanvas().style.cursor = '';
        });
      }

      const elementoMarcador = document.createElement('div');
      elementoMarcador.style.width = '20px';
      elementoMarcador.style.height = '20px';
      elementoMarcador.style.borderRadius = '50%';
      elementoMarcador.style.backgroundColor = color;
      elementoMarcador.style.border = '3px solid #ffffff';
      elementoMarcador.style.boxShadow = `0 0 12px ${color}, 0 0 4px #000000`;
      elementoMarcador.style.cursor = 'pointer';
      
      const marker = new maplibregl.Marker({ element: elementoMarcador })
        .setLngLat(nuevaCoordenada)
        .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>${dispositivo_id} (Actual)</strong>`))
        .addTo(referenciaMapa.current);

      vehiculo = {
        id: dispositivo_id,
        color,
        marker,
        coords: [nuevaCoordenada],
        features: featuresIniciales,
        sourceId,
        ultimoTimestamp: tiempoMs,
        ...puntoPropiedades
      };
      vehiculosRef.current[dispositivo_id] = vehiculo;
      
      setFiltrosVisibles(prev => ({ ...prev, [dispositivo_id]: true }));

      if (Object.keys(vehiculosRef.current).length === 1) {
        referenciaMapa.current.flyTo({ center: nuevaCoordenada, zoom: 15 });
      }
    } else {
      vehiculo.marker.setLngLat(nuevaCoordenada);
      vehiculo.coords.push(nuevaCoordenada);
      vehiculo.features[0].geometry.coordinates = vehiculo.coords;
      
      vehiculo.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: nuevaCoordenada },
        properties: puntoPropiedades
      });
      
      if (referenciaMapa.current && referenciaMapa.current.isStyleLoaded()) {
        const fuenteDatos = referenciaMapa.current.getSource(vehiculo.sourceId);
        if (fuenteDatos) {
          fuenteDatos.setData({
            type: 'FeatureCollection',
            features: vehiculo.features
          });
        }
      }
      vehiculo.ultimoTimestamp = tiempoMs;
      Object.assign(vehiculo, puntoPropiedades);
    }

    vehiculo.ultimaAct = horaLegible;
  };

  const cargarHistorialDeHoy = async () => {
    try {
      const res = await fetch('/api/flota/hoy', {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      const datosHistorial = await res.json();
      
      if (Array.isArray(datosHistorial) && datosHistorial.length > 0) {
        datosHistorial.forEach(punto => {
          registrarOActualizarVehiculo(punto);
        });

        const ultimo = datosHistorial[datosHistorial.length - 1];
        referenciaMapa.current.panTo([parseFloat(ultimo.lo), parseFloat(ultimo.la)]);
        setVehiculosUI({ ...vehiculosRef.current });
      }
    } catch (e) {
      console.error('Error cargando historial', e);
    }
  };

  const iniciarConexionServidor = () => {
    const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const conexionWebsocket = new WebSocket(`${protocolo}//${window.location.host}/ws`);
    
    conexionWebsocket.onmessage = (evento) => {
      const datos = JSON.parse(evento.data);
      if (datos.dispositivo_id && datos.lo && datos.la) {
        registrarOActualizarVehiculo(datos);
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

  const ahora = Date.now();

  return (
    <div className="w-full h-screen relative bg-zinc-950 overflow-hidden font-sans">
      <div 
        ref={contenedorMapa} 
        className="absolute inset-0 w-full h-full" 
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }} 
      />
      
      <button 
        onClick={alVolver} 
        className="absolute top-4 left-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-semibold py-2 px-4 rounded-lg shadow-xl transition-colors z-20 text-sm"
      >
        ← Volver al Menú
      </button>

      <div className="absolute top-16 left-4 w-88 max-w-[90vw] max-h-[85vh] flex flex-col bg-zinc-900 bg-opacity-95 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl z-20">
        <div className="p-3.5 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-red-500">Panel de Flota Activa</h1>
          </div>
          <div className="text-xs text-zinc-400 flex justify-between items-center">
            <span>Operador: <b className="text-white">{auth.username}</b> ({auth.rol})</span>
            <button onClick={mostrarTodos} className="text-blue-400 hover:text-blue-300 underline">Ver Todos</button>
          </div>
        </div>

        <div className="p-3.5 overflow-y-auto flex-1">
          {Object.keys(vehiculosUI).length === 0 ? (
            <div className="text-zinc-500 text-xs italic text-center py-6">Esperando telemetría de sensores...</div>
          ) : (
            <div className="flex flex-col gap-3">
              {Object.values(vehiculosUI).map((vehiculo) => {
                const activo = vehiculo.ultimoTimestamp && (ahora - vehiculo.ultimoTimestamp < 25000);
                return (
                  <div 
                    key={vehiculo.id} 
                    className={`bg-zinc-950 border rounded-xl p-3 transition-colors ${filtrosVisibles[vehiculo.id] ? 'border-zinc-700' : 'border-zinc-900 opacity-50'}`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <input 
                        type="checkbox" 
                        checked={!!filtrosVisibles[vehiculo.id]}
                        onChange={() => alternarFiltro(vehiculo.id)}
                        className="w-4 h-4 accent-red-500 cursor-pointer"
                      />
                      <div className="w-3 h-3 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: vehiculo.color, color: vehiculo.color }}></div>
                      <div 
                        className="font-bold text-white text-sm cursor-pointer hover:underline flex-1 truncate"
                        onClick={() => centrarEnVehiculo(vehiculo.id)}
                      >
                        {vehiculo.id}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${activo ? 'bg-green-950 text-green-400 border border-green-800 animate-pulse' : 'bg-zinc-800 text-zinc-400'}`}>
                        {activo ? 'EN LÍNEA' : 'OFFLINE'}
                      </span>
                    </div>
                    
                    {filtrosVisibles[vehiculo.id] && (
                      <div className="flex flex-col gap-2 mt-2">
                        <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Velocidad</span>
                            <span className="font-mono text-cyan-400 font-bold">{vehiculo.velocidad || '0.0'} km/h</span>
                          </div>
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Altitud</span>
                            <span className="font-mono text-indigo-400 font-bold">{vehiculo.altitud || '0.0'} m</span>
                          </div>
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Rumbo</span>
                            <span className="font-mono text-blue-400 font-bold">{vehiculo.rumbo || '0'}°</span>
                          </div>
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Temp</span>
                            <span className="font-mono text-orange-400 font-bold">{vehiculo.temperatura || '25.0'} °C</span>
                          </div>
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Vibración</span>
                            <span className="font-mono text-yellow-400 font-bold">{vehiculo.vibracion || '0.00'} G</span>
                          </div>
                          <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800/80">
                            <span className="text-zinc-500 block text-[9px]">Batería</span>
                            <span className="font-mono text-green-400 font-bold">{vehiculo.bateria || '100'}%</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-zinc-500 px-1">
                          <span>Pitch: <b className="text-zinc-300">{vehiculo.pitch || '0.0'}°</b> | Roll: <b className="text-zinc-300">{vehiculo.roll || '0.0'}°</b></span>
                          <span>🕒 {vehiculo.ultimaAct}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [modo, setModo] = useState('menu');
  const [auth, setAuth] = useState(null);

  if (modo === 'mapa') {
    if (!auth) {
      return <Login onLogin={setAuth} alVolver={() => setModo('menu')} />;
    }
    return <MapaView auth={auth} alVolver={() => { setModo('menu'); setAuth(null); }} />;
  }

  if (modo === 'simulador') {
    return (
      <div className="relative">
        <button 
          onClick={() => setModo('menu')} 
          className="absolute top-4 left-4 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg shadow-lg z-10 transition-colors border border-zinc-700 text-sm"
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
        <p className="text-zinc-400 mb-10 text-sm">Sistema de Telemetría Vehicular & Sensor Hub</p>

        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setModo('mapa')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-2xl">🗺️</span>
            Ingresar al Panel de Flotas
          </button>

          <button 
            onClick={() => setModo('simulador')}
            className="w-full bg-red-600 hover:bg-red-700 border border-red-500 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-2xl">📱</span>
            Simular Sensores Móviles
          </button>
        </div>
      </div>
    </div>
  );
}
