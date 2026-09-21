import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Simulador from './Simulador';
import Dashboard from './Dashboard';
import Historial from './Historial';
import Geocercas from './Geocercas';
import ConfigModal from './ConfigModal';
import { getApiUrl, getWsUrl, getConfig } from './config';

function Login({ onLogin, alVolver, alAbrirConfig }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(getApiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error('Respuesta inválida del servidor. Abre "⚙️ Servidor" y revisa la IP y Puerto configurados.');
      }
      
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
      
      onLogin(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 relative">
      <button 
        onClick={alVolver} 
        className="absolute top-4 left-4 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg z-10 border border-zinc-700 text-sm"
      >
        ← Volver
      </button>

      <button
        onClick={alAbrirConfig}
        className="absolute top-4 right-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 rounded-lg z-10 border border-zinc-700 text-xs flex items-center gap-1.5"
        title="Configurar IP / Puerto del Servidor"
      >
        <span>⚙️</span> Servidor
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
  const [alertasEnVivo, setAlertasEnVivo] = useState([]);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const montadoRef = useRef(true);

  const colores = ['#06b6d4', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];

  useEffect(() => {
    montadoRef.current = true;
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
      montadoRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch(e) {}
      }
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
          paint: { 
            'line-color': color, 
            'line-width': 3, 
            'line-dasharray': [3, 2],
            'line-opacity': 0.65 
          }
        });

        const capaPuntosId = `capa-puntos-${dispositivo_id}`;
        referenciaMapa.current.addLayer({
          id: capaPuntosId,
          type: 'circle',
          source: sourceId,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 4.5,
            'circle-color': color,
            'circle-opacity': 0.75,
            'circle-stroke-width': 1.5,
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
      elementoMarcador.style.display = 'flex';
      elementoMarcador.style.flexDirection = 'column';
      elementoMarcador.style.alignItems = 'center';
      elementoMarcador.style.cursor = 'pointer';

      const iconoContenedor = document.createElement('div');
      iconoContenedor.style.width = '34px';
      iconoContenedor.style.height = '34px';
      iconoContenedor.style.borderRadius = '50%';
      iconoContenedor.style.backgroundColor = '#18181b';
      iconoContenedor.style.border = `2.5px solid ${color}`;
      iconoContenedor.style.boxShadow = `0 0 12px ${color}88, 0 2px 6px rgba(0,0,0,0.8)`;
      iconoContenedor.style.display = 'flex';
      iconoContenedor.style.alignItems = 'center';
      iconoContenedor.style.justifyContent = 'center';
      iconoContenedor.style.padding = '4px';
      iconoContenedor.style.transition = 'transform 0.3s ease';

      const imgCamion = document.createElement('img');
      imgCamion.src = '/camion.svg';
      imgCamion.style.width = '20px';
      imgCamion.style.height = '20px';
      imgCamion.style.objectFit = 'contain';
      imgCamion.style.filter = 'invert(1) drop-shadow(0 0 1px white)';

      iconoContenedor.appendChild(imgCamion);

      const etiquetaBadge = document.createElement('div');
      etiquetaBadge.innerText = dispositivo_id;
      etiquetaBadge.style.fontSize = '10px';
      etiquetaBadge.style.fontWeight = 'bold';
      etiquetaBadge.style.color = '#ffffff';
      etiquetaBadge.style.backgroundColor = '#09090bcc';
      etiquetaBadge.style.border = `1px solid ${color}aa`;
      etiquetaBadge.style.borderRadius = '4px';
      etiquetaBadge.style.padding = '1px 5px';
      etiquetaBadge.style.marginTop = '2px';
      etiquetaBadge.style.whiteSpace = 'nowrap';
      etiquetaBadge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5)';

      elementoMarcador.appendChild(iconoContenedor);
      elementoMarcador.appendChild(etiquetaBadge);
      
      const marker = new maplibregl.Marker({ element: elementoMarcador })
        .setLngLat(nuevaCoordenada)
        .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>${dispositivo_id} (Actual)</strong>`))
        .addTo(referenciaMapa.current);

      vehiculo = {
        id: dispositivo_id,
        color,
        marker,
        iconoContenedor,
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

      if (rumbo && Number(rumbo) > 0 && vehiculo.iconoContenedor) {
        vehiculo.iconoContenedor.style.transform = `rotate(${rumbo}deg)`;
      }
    }

    vehiculo.ultimaAct = horaLegible;
  };

  const cargarHistorialDeHoy = async () => {
    try {
      const res = await fetch(getApiUrl('/api/flota/hoy'), {
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
    if (!montadoRef.current) return;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch(e) {}
    }

    try {
      const urlWs = getWsUrl('/ws');
      const conexionWebsocket = new WebSocket(urlWs);
      wsRef.current = conexionWebsocket;
      
      conexionWebsocket.onmessage = (evento) => {
        try {
          const datos = JSON.parse(evento.data);

          if (datos.alerta) {
            const nuevaAlerta = {
              id: Date.now() + Math.random(),
              ...datos
            };
            setAlertasEnVivo(prev => [nuevaAlerta, ...prev.slice(0, 3)]);
            setTimeout(() => {
              setAlertasEnVivo(prev => prev.filter(a => a.id !== nuevaAlerta.id));
            }, 6000);
            return;
          }

          if (datos.dispositivo_id && datos.lo !== undefined && datos.la !== undefined) {
            registrarOActualizarVehiculo(datos);
            setVehiculosUI({ ...vehiculosRef.current });
          }
        } catch (err) {}
      };

      conexionWebsocket.onclose = () => {
        if (montadoRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            if (montadoRef.current) iniciarConexionServidor();
          }, 3500);
        }
      };

      conexionWebsocket.onerror = (e) => {
        console.warn('WebSocket error, se reintentará conexión:', e);
      };
    } catch (err) {
      if (montadoRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          if (montadoRef.current) iniciarConexionServidor();
        }, 4000);
      }
    }
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

      {alertasEnVivo.length > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">
          {alertasEnVivo.map(alerta => (
            <div 
              key={alerta.id}
              className="bg-red-950/95 border-2 border-red-500 text-white p-3 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-3 animate-in fade-in slide-in-from-top duration-300 pointer-events-auto"
            >
              <div className="text-2xl animate-bounce">⚠️</div>
              <div className="flex-1 text-xs">
                <div className="font-bold text-red-400 uppercase tracking-wide flex justify-between">
                  <span>{alerta.tipo === 'geocerca' ? 'Alerta Geocerca' : 'Exceso de Velocidad'}</span>
                  <span className="font-mono text-zinc-400 text-[10px]">{alerta.dispositivo_id}</span>
                </div>
                <div className="text-white mt-0.5">{alerta.mensaje}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      
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
  const [modalConfigAbierto, setModalConfigAbierto] = useState(false);
  const [configActual, setConfigActual] = useState(getConfig());

  const handleConfigGuardada = (nuevaCfg) => {
    setConfigActual(nuevaCfg);
  };

  if (modo === 'mapa') {
    if (!auth) {
      return (
        <>
          <Login 
            onLogin={setAuth} 
            alVolver={() => setModo('menu')} 
            alAbrirConfig={() => setModalConfigAbierto(true)} 
          />
          <ConfigModal 
            abierto={modalConfigAbierto} 
            alCerrar={() => setModalConfigAbierto(false)} 
            alGuardar={handleConfigGuardada} 
          />
        </>
      );
    }
    return <MapaView auth={auth} alVolver={() => { setModo('menu'); }} />;
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
        <button
          onClick={() => setModalConfigAbierto(true)}
          className="absolute top-4 right-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 rounded-lg shadow-lg z-10 transition-colors border border-zinc-700 text-xs flex items-center gap-1.5"
          title="Configurar IP / Puerto"
        >
          <span>⚙️</span> Servidor
        </button>
        <Simulador />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </div>
    );
  }

  if (modo === 'dashboard') {
    if (!auth) return (
      <>
        <Login 
          onLogin={setAuth} 
          alVolver={() => setModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Dashboard auth={auth} alVolver={() => { setModo('menu'); }} />;
  }

  if (modo === 'historial') {
    if (!auth) return (
      <>
        <Login 
          onLogin={setAuth} 
          alVolver={() => setModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Historial auth={auth} alVolver={() => { setModo('menu'); }} />;
  }

  if (modo === 'geocercas') {
    if (!auth) return (
      <>
        <Login 
          onLogin={setAuth} 
          alVolver={() => setModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Geocercas auth={auth} alVolver={() => { setModo('menu'); }} />;
  }

  const hostDisplay = configActual.customEnabled 
    ? `${configActual.protocol}://${configActual.host}:${configActual.port || '3000'}`
    : 'Local / Mismo Servidor';

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 font-sans relative">
      <div className="bg-zinc-900 p-10 rounded-2xl shadow-2xl border border-zinc-800 max-w-md w-full text-center relative">
        
        <button
          onClick={() => setModalConfigAbierto(true)}
          className="absolute top-4 right-4 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs flex items-center gap-1.5 transition-colors"
          title="Configurar IP y Puerto de conexión"
        >
          <span>⚙️</span>
          <span className="font-mono text-[11px]">Servidor</span>
        </button>

        <h1 className="text-4xl font-bold text-red-500 mb-2 tracking-tight">TRACE-MIN</h1>
        <p className="text-zinc-400 mb-2 text-sm">Sistema de Telemetría Vehicular & Sensor Hub</p>

        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400 mb-6">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="truncate max-w-[200px]" title={hostDisplay}>Host: {hostDisplay}</span>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={() => setModo('mapa')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-xl">🗺️</span>
            Monitor en Tiempo Real
          </button>

          <button 
            onClick={() => setModo('dashboard')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-xl">📊</span>
            Dashboard Analítico (KPIs)
          </button>

          <button 
            onClick={() => setModo('historial')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-xl">⏪</span>
            Historial de Rutas
          </button>

          <button 
            onClick={() => setModo('geocercas')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
          >
            <span className="text-xl">📍</span>
            Configurar Geocercas
          </button>

          <button 
            onClick={() => setModo('simulador')}
            className="w-full bg-red-600 hover:bg-red-700 border border-red-500 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3 mt-2"
          >
            <span className="text-xl">📱</span>
            Simular Sensores Móviles
          </button>
          
          {auth && (
            <button 
              onClick={() => setAuth(null)}
              className="w-full mt-2 text-zinc-500 hover:text-zinc-300 text-sm underline pb-2"
            >
              Cerrar Sesión ({auth.username})
            </button>
          )}
        </div>
      </div>

      <ConfigModal 
        abierto={modalConfigAbierto} 
        alCerrar={() => setModalConfigAbierto(false)} 
        alGuardar={handleConfigGuardada} 
      />
    </div>
  );
}
