import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Simulador from './Simulador';
import Dashboard from './Dashboard';
import Historial from './Historial';
import Geocercas from './Geocercas';
import ConfigModal from './ConfigModal';
import DetalleVehiculoModal from './DetalleVehiculoModal';
import OtaManager from './OtaManager';
import { getApiUrl, getWsUrl, getConfig, getSubpath, CARTO_API_KEY } from './config';

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
    'carto-dark': {
      type: 'raster',
      tiles: [
        `https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`,
        `https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`,
        `https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`
      ],
      tileSize: 256,
      attribution: '&copy; CARTO & OpenStreetMap'
    },
    'esri-sat': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: '&copy; ESRI World Imagery'
    },
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
      id: 'layer-carto-dark',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 20,
      layout: { visibility: 'visible' }
    },
    {
      id: 'layer-esri-sat',
      type: 'raster',
      source: 'esri-sat',
      minzoom: 0,
      maxzoom: 19,
      layout: { visibility: 'none' }
    },
    {
      id: 'layer-osm-tiles',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19,
      layout: { visibility: 'none' }
    }
  ]
};

function MapaView({ auth, alVolver, alIrAOta }) {
  const contenedorMapa = useRef(null);
  const referenciaMapa = useRef(null);
  const vehiculosRef = useRef({}); 
  const [vehiculosUI, setVehiculosUI] = useState({}); 
  const [filtrosVisibles, setFiltrosVisibles] = useState({});
  const [alertasEnVivo, setAlertasEnVivo] = useState([]);
  const [vehiculoSeleccionadoModal, setVehiculoSeleccionadoModal] = useState(null);
  const [capaActiva, setCapaActiva] = useState('oscuro'); // 'oscuro' | 'satelital' | 'calles'

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const montadoRef = useRef(true);
  const centradoInicialHechoRef = useRef(false);

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
      // Asegurar capas de cualquier vehículo que haya llegado por WS antes de terminar el load
      Object.values(vehiculosRef.current).forEach((v) => asegurarCapasEnMapa(v));
      cargarHistorialDeHoy();
      iniciarConexionServidor();
    });

    const manejarResize = () => mapa.resize();
    window.addEventListener('resize', manejarResize);

    const intervaloChequeo = setInterval(() => {
      // Solo consultar historial HTTP como respaldo si el WebSocket en vivo no está conectado
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        cargarHistorialDeHoy();
      }
      setVehiculosUI({ ...vehiculosRef.current });
    }, 3000);

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

  const calcularDistanciaMetros = (c1, c2) => {
    if (!c1 || !c2) return 0;
    const [lon1, lat1] = c1;
    const [lon2, lat2] = c2;
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const esPuntoFallback = (coord) => {
    // Coordenadas base simuladas de la Plaza 14 de Septiembre (-17.3935, -66.1570)
    return calcularDistanciaMetros(coord, [-66.1570, -17.3935]) < 35;
  };

  const asegurarCapasEnMapa = (vehiculo) => {
    const mapa = referenciaMapa.current;
    if (!mapa) return false;
    const { id: dispositivo_id, sourceId, color, features } = vehiculo;
    const capaLineaId = `capa-linea-${dispositivo_id}`;
    const capaPuntosId = `capa-puntos-${dispositivo_id}`;

    try {
      if (!mapa.getSource(sourceId)) {
        mapa.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
      }

      if (!mapa.getLayer(capaLineaId)) {
        mapa.addLayer({
          id: capaLineaId,
          type: 'line',
          source: sourceId,
          filter: ['!=', '$type', 'Point'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': color,
            'line-width': 3.5,
            'line-dasharray': [2.5, 1.8],
            'line-opacity': 0.9
          }
        });
      }

      if (!mapa.getLayer(capaPuntosId)) {
        mapa.addLayer({
          id: capaPuntosId,
          type: 'circle',
          source: sourceId,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': color,
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        mapa.on('click', capaPuntosId, (e) => {
          const props = e.features[0].properties;
          const coord = e.features[0].geometry.coordinates.slice();

          new maplibregl.Popup({ className: 'dark-hud-popup' })
            .setLngLat(coord)
            .setHTML(`
              <div style="color: #f4f4f5; padding: 4px; font-family: ui-sans-serif, system-ui, sans-serif; min-width: 185px;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 5px; margin-bottom: 6px;">
                  <strong style="color: #ef4444; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;">${props.dispositivo_id}</strong>
                  <span style="font-size: 10px; color: #a1a1aa; font-family: monospace;">${props.hora}</span>
                </div>
                <div style="font-size: 11px; line-height: 1.6; font-family: monospace;">
                  <div>🚀 <span style="color: #a1a1aa;">Vel:</span> <b style="color: #22d3ee;">${props.velocidad} km/h</b> | 🧭 ${props.rumbo}°</div>
                  <div>⛰️ <span style="color: #a1a1aa;">Alt:</span> <b style="color: #818cf8;">${props.altitud} m</b></div>
                  <div>🔥 <span style="color: #a1a1aa;">Temp:</span> <b style="color: #fb923c;">${props.temperatura} °C</b></div>
                  <div>〰️ <span style="color: #a1a1aa;">Vib:</span> <b style="color: #facc15;">${props.vibracion} G</b></div>
                  <div>📐 <span style="color: #a1a1aa;">Pitch/Roll:</span> <b style="color: #38bdf8;">${props.pitch}° / ${props.roll}°</b></div>
                  <div>🔋 <span style="color: #a1a1aa;">Batería:</span> <b style="color: #4ade80;">${props.bateria}% (${props.voltaje}V)</b></div>
                </div>
              </div>
            `)
            .addTo(mapa);
        });

        mapa.on('mouseenter', capaPuntosId, () => {
          mapa.getCanvas().style.cursor = 'pointer';
        });
        mapa.on('mouseleave', capaPuntosId, () => {
          mapa.getCanvas().style.cursor = '';
        });
      }
      return true;
    } catch (mapErr) {
      // El estilo del mapa aún se está inicializando; se creará automáticamente en el próximo paquete
      return false;
    }
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

    let vehiculo = vehiculosRef.current[dispositivo_id];
    const sensoresExtraEntrante = datos.sensores_extra || datos.se || null;

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
      roll: formatearNumero(roll, 1, '0.0'),
      aceleracion_x: formatearNumero(datos.aceleracion_x ?? datos.ax, 2, '0.00'),
      aceleracion_y: formatearNumero(datos.aceleracion_y ?? datos.ay, 2, '0.00'),
      aceleracion_z: formatearNumero(datos.aceleracion_z ?? datos.az, 2, '1.00'),
      // Conservar sensores_extra previos (Wi-Fi, Firmware, Radar HC-SR04) si la consulta histórica de BD no los incluye
      sensores_extra: sensoresExtraEntrante
        ? { ...(vehiculo?.sensores_extra || {}), ...sensoresExtraEntrante }
        : (vehiculo?.sensores_extra || null)
    };

    if (!vehiculo) {
      const color = colores[Object.keys(vehiculosRef.current).length % colores.length];
      const sourceId = `ruta-${dispositivo_id}`;
      const esFallbackInicial = esPuntoFallback(nuevaCoordenada);
      const segmentosIniciales = [[nuevaCoordenada, nuevaCoordenada]];
      
      const featuresIniciales = [
        { 
          type: 'Feature', 
          geometry: { type: 'MultiLineString', coordinates: segmentosIniciales }, 
          properties: {} 
        },
        { 
          type: 'Feature', 
          geometry: { type: 'Point', coordinates: nuevaCoordenada }, 
          properties: puntoPropiedades 
        }
      ];

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
      imgCamion.src = `${getSubpath()}/camion.svg`;
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

      elementoMarcador.onclick = (e) => {
        e.stopPropagation();
        if (vehiculosRef.current[dispositivo_id]) {
          setVehiculoSeleccionadoModal({ ...vehiculosRef.current[dispositivo_id] });
        }
      };
      
      let marker = null;
      if (referenciaMapa.current) {
        try {
          marker = new maplibregl.Marker({ element: elementoMarcador })
            .setLngLat(nuevaCoordenada)
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<strong>${dispositivo_id} (Actual)</strong>`))
            .addTo(referenciaMapa.current);
        } catch(mErr) {
          console.warn('Error inicializando marcador:', mErr);
        }
      }

      vehiculo = {
        id: dispositivo_id,
        color,
        marker,
        iconoContenedor,
        coords: [nuevaCoordenada],
        segmentos: segmentosIniciales,
        esSoloFallback: esFallbackInicial,
        features: featuresIniciales,
        sourceId,
        ultimoTimestamp: tiempoMs,
        ...puntoPropiedades
      };
      vehiculosRef.current[dispositivo_id] = vehiculo;
      asegurarCapasEnMapa(vehiculo);
      
      setFiltrosVisibles(prev => ({ ...prev, [dispositivo_id]: true }));

      if (Object.keys(vehiculosRef.current).length === 1 && referenciaMapa.current) {
        try {
          referenciaMapa.current.flyTo({ center: nuevaCoordenada, zoom: 15 });
        } catch(fErr) {}
      }
    } else {
      if (vehiculo.marker) {
        try {
          vehiculo.marker.setLngLat(nuevaCoordenada);
        } catch(mErr) {}
      }

      const esNuevoFallback = esPuntoFallback(nuevaCoordenada);

      // Si el vehículo antes solo tenía puntos simulados en la Plaza y ahora recibe GPS real:
      if (vehiculo.esSoloFallback && !esNuevoFallback) {
        vehiculo.esSoloFallback = false;
        vehiculo.coords = [nuevaCoordenada];
        vehiculo.segmentos = [[nuevaCoordenada, nuevaCoordenada]];
        vehiculo.features = [
          {
            type: 'Feature',
            geometry: { type: 'MultiLineString', coordinates: vehiculo.segmentos },
            properties: {}
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: nuevaCoordenada },
            properties: puntoPropiedades
          }
        ];
      } else {
        const ultimaCoord = vehiculo.coords && vehiculo.coords.length > 0 
          ? vehiculo.coords[vehiculo.coords.length - 1] 
          : nuevaCoordenada;
        const distSalto = calcularDistanciaMetros(ultimaCoord, nuevaCoordenada);
        const velNum = parseFloat(puntoPropiedades.velocidad || 0);

        // Filtro de ruido GPS en reposo:
        // Si el vehículo está quieto (desplazamiento < 10m y velocidad < 2.0 km/h),
        // se fija velocidad a 0.0 y NO se añaden puntos a la línea de ruta para evitar telarañas de deriva
        const estaEnReposo = distSalto < 10.0 && velNum < 2.0;

        if (estaEnReposo) {
          puntoPropiedades.velocidad = '0.0';
        }

        if (!vehiculo.coords) vehiculo.coords = [];
        if (!vehiculo.segmentos) vehiculo.segmentos = [[nuevaCoordenada, nuevaCoordenada]];

        if (!estaEnReposo) {
          vehiculo.coords.push(nuevaCoordenada);

          // Si la distancia entre lecturas consecutivas supera 250 metros,
          // se trata de un salto de GPS (arranque en frío, reconexión o cambio abrupto).
          // Se añade un segmento nuevo en MultiLineString para NUNCA trazar una línea recta entre ellos.
          if (distSalto > 250) {
            vehiculo.segmentos.push([nuevaCoordenada, nuevaCoordenada]);
          } else {
            const ultimoSeg = vehiculo.segmentos[vehiculo.segmentos.length - 1];
            if (ultimoSeg) {
              ultimoSeg.push(nuevaCoordenada);
            } else {
              vehiculo.segmentos.push([nuevaCoordenada, nuevaCoordenada]);
            }
          }

          vehiculo.features[0].geometry = {
            type: 'MultiLineString',
            coordinates: vehiculo.segmentos
          };
        }

        // Actualizar el punto actual (marcador del vehículo en vivo)
        if (vehiculo.features.length > 1) {
          vehiculo.features[vehiculo.features.length - 1] = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: nuevaCoordenada },
            properties: puntoPropiedades
          };
        } else {
          vehiculo.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: nuevaCoordenada },
            properties: puntoPropiedades
          });
        }
      }

      if (referenciaMapa.current && asegurarCapasEnMapa(vehiculo)) {
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
        headers: { 
          'Authorization': `Bearer ${auth.token}`,
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!res.ok) {
        console.warn('Respuesta no-OK al consultar historial:', res.status);
        return;
      }
      const datosHistorial = await res.json();
      
      if (Array.isArray(datosHistorial) && datosHistorial.length > 0) {
        datosHistorial.forEach(punto => {
          registrarOActualizarVehiculo(punto);
        });

        const ultimo = datosHistorial[datosHistorial.length - 1];
        if (!centradoInicialHechoRef.current && referenciaMapa.current && ultimo && ultimo.lo !== undefined && ultimo.la !== undefined) {
          centradoInicialHechoRef.current = true;
          try {
            referenciaMapa.current.panTo([parseFloat(ultimo.lo), parseFloat(ultimo.la)]);
          } catch(panErr) {}
        }
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
            setVehiculoSeleccionadoModal(prev => (prev && prev.id === datos.dispositivo_id ? { ...vehiculosRef.current[datos.dispositivo_id] } : prev));
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

  const limpiarTrazoVehiculo = (id) => {
    const v = vehiculosRef.current[id];
    if (!v) return;
    const ultima = v.coords && v.coords.length > 0 ? v.coords[v.coords.length - 1] : null;
    if (!ultima) return;

    v.coords = [ultima];
    v.segmentos = [[ultima, ultima]];
    v.features = [
      {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: v.segmentos },
        properties: {}
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ultima },
        properties: { ...v }
      }
    ];

    if (referenciaMapa.current && referenciaMapa.current.isStyleLoaded()) {
      const src = referenciaMapa.current.getSource(v.sourceId);
      if (src) {
        src.setData({ type: 'FeatureCollection', features: v.features });
      }
    }
    setVehiculosUI({ ...vehiculosRef.current });
  };

  const cambiarCapaMapa = (tipo) => {
    setCapaActiva(tipo);
    if (!referenciaMapa.current) return;
    try {
      if (referenciaMapa.current.getLayer('layer-carto-dark')) {
        referenciaMapa.current.setLayoutProperty('layer-carto-dark', 'visibility', tipo === 'oscuro' ? 'visible' : 'none');
      }
      if (referenciaMapa.current.getLayer('layer-esri-sat')) {
        referenciaMapa.current.setLayoutProperty('layer-esri-sat', 'visibility', tipo === 'satelital' ? 'visible' : 'none');
      }
      if (referenciaMapa.current.getLayer('layer-osm-tiles')) {
        referenciaMapa.current.setLayoutProperty('layer-osm-tiles', 'visibility', tipo === 'calles' ? 'visible' : 'none');
      }
    } catch (e) {
      console.warn('Error cambiando capa:', e);
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

      {/* Selector Flotante de Estilos de Mapa */}
      <div className="absolute top-4 right-14 z-20 flex bg-zinc-900/90 backdrop-blur-md border border-zinc-700/80 rounded-xl p-1 shadow-2xl">
        <button
          onClick={() => cambiarCapaMapa('oscuro')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            capaActiva === 'oscuro' ? 'bg-red-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Mapa táctico nocturno para telemetría"
        >
          <span>🕶️</span> Táctico
        </button>
        <button
          onClick={() => cambiarCapaMapa('satelital')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            capaActiva === 'satelital' ? 'bg-red-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Fotografía satelital de alta resolución"
        >
          <span>🛰️</span> Satélite
        </button>
        <button
          onClick={() => cambiarCapaMapa('calles')}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
            capaActiva === 'calles' ? 'bg-red-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Mapa estándar de calles OSM"
        >
          <span>🗺️</span> Calles
        </button>
      </div>

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
            {auth.rol === 'admin' && alIrAOta && (
              <button
                onClick={alIrAOta}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-cyan-300 hover:text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition"
                title="Actualización remota de firmware ESP32 (OTA)"
              >
                <span>🔄</span> OTA
              </button>
            )}
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
                    {vehiculo.sensores_extra?.firmware && (
                      <div className="text-[10px] font-mono text-zinc-500 mb-1.5 flex items-center justify-between px-0.5">
                        <span>Firmware ESP32: <b className="text-cyan-400">v{vehiculo.sensores_extra.firmware}</b></span>
                        {vehiculo.sensores_extra.wifi_ssid && (
                          <span className="truncate max-w-[130px]">📶 {vehiculo.sensores_extra.wifi_ssid}</span>
                        )}
                      </div>
                    )}
                    
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

                        {/* Indicador Sonar Proximidad HC-SR04 */}
                        {(() => {
                          const extra = vehiculo.sensores_extra && typeof vehiculo.sensores_extra === 'object' ? vehiculo.sensores_extra : {};
                          const distRaw = extra.distancia_cm !== undefined ? parseFloat(extra.distancia_cm) : null;
                          if (distRaw === null || isNaN(distRaw)) return null;
                          const esCritico = distRaw > 0 && distRaw < 20;
                          const esPrecaucion = distRaw >= 20 && distRaw <= 60;
                          return (
                            <div className={`px-2 py-1 rounded-lg text-[10px] font-mono flex items-center justify-between border ${
                              esCritico 
                                ? 'bg-red-950/80 text-red-300 border-red-600 animate-pulse' 
                                : esPrecaucion 
                                ? 'bg-amber-950/80 text-amber-300 border-amber-600' 
                                : 'bg-zinc-900/90 text-emerald-400 border-zinc-800'
                            }`}>
                              <span className="flex items-center gap-1 font-bold">
                                <span>📡</span>
                                <span>{esCritico ? '¡OBSTÁCULO CERCANO!' : esPrecaucion ? 'PROXIMIDAD' : 'RADAR ECO'}</span>
                              </span>
                              <span className="font-bold text-xs">{distRaw > 0 ? `${distRaw.toFixed(0)} cm` : 'LIBRE'}</span>
                            </div>
                          );
                        })()}

                        <div className="flex justify-between items-center text-[10px] text-zinc-500 px-1">
                          <span>Pitch: <b className="text-zinc-300">{vehiculo.pitch || '0.0'}°</b> | Roll: <b className="text-zinc-300">{vehiculo.roll || '0.0'}°</b></span>
                          <span>🕒 {vehiculo.ultimaAct}</span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-900">
                          <button
                            onClick={() => setVehiculoSeleccionadoModal(vehiculo)}
                            className="flex-1 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 rounded-lg py-1.5 px-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <span>📷</span> Sensores / Cámara / Relés
                          </button>
                          <button
                            onClick={() => centrarEnVehiculo(vehiculo.id)}
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-700 transition"
                            title="Centrar en mapa"
                          >
                            📍
                          </button>
                          <button
                            onClick={() => limpiarTrazoVehiculo(vehiculo.id)}
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-400 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-700 transition"
                            title="Limpiar trazo de ruta en el mapa"
                          >
                            🧹
                          </button>
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

      {vehiculoSeleccionadoModal && (
        <DetalleVehiculoModal
          vehiculo={vehiculoSeleccionadoModal}
          alCerrar={() => setVehiculoSeleccionadoModal(null)}
          auth={auth}
        />
      )}
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    try {
      const guardado = localStorage.getItem('TRACEMIN_AUTH');
      return guardado ? JSON.parse(guardado) : null;
    } catch(e) { return null; }
  });

  const [modo, setModo] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.location.pathname.endsWith('/simulador')) {
        return 'simulador';
      }
      const guardado = localStorage.getItem('TRACEMIN_MODO');
      return guardado || 'menu';
    } catch(e) { return 'menu'; }
  });

  const [modalConfigAbierto, setModalConfigAbierto] = useState(false);
  const [configActual, setConfigActual] = useState(getConfig());

  const cambiarModo = (nuevoModo) => {
    setModo(nuevoModo);
    try {
      localStorage.setItem('TRACEMIN_MODO', nuevoModo);
    } catch(e) {}
  };

  const handleLogin = (datosAuth) => {
    setAuth(datosAuth);
    try {
      localStorage.setItem('TRACEMIN_AUTH', JSON.stringify(datosAuth));
    } catch(e) {}
  };

  const handleLogout = () => {
    setAuth(null);
    try {
      localStorage.removeItem('TRACEMIN_AUTH');
      localStorage.setItem('TRACEMIN_MODO', 'menu');
    } catch(e) {}
    setModo('menu');
  };

  const handleConfigGuardada = (nuevaCfg) => {
    setConfigActual(nuevaCfg);
  };

  if (modo === 'mapa') {
    if (!auth) {
      return (
        <>
          <Login 
            onLogin={handleLogin} 
            alVolver={() => cambiarModo('menu')} 
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
    return <MapaView auth={auth} alVolver={() => cambiarModo('menu')} alIrAOta={() => cambiarModo('ota')} />;
  }

  if (modo === 'ota') {
    if (!auth) {
      return (
        <>
          <Login
            onLogin={handleLogin}
            alVolver={() => cambiarModo('menu')}
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
    return (
      <OtaManager
        auth={auth}
        alVolver={() => cambiarModo('menu')}
        alIrAlMapa={() => cambiarModo('mapa')}
      />
    );
  }

  if (modo === 'simulador') {
    return (
      <div className="relative w-full h-screen overflow-y-auto bg-zinc-950">
        <button 
          onClick={() => cambiarModo('menu')} 
          className="fixed top-4 left-4 bg-zinc-900/90 backdrop-blur hover:bg-zinc-800 text-white px-4 py-2 rounded-lg shadow-xl z-30 transition-colors border border-zinc-700 text-sm"
        >
          ← Volver
        </button>
        <button
          onClick={() => setModalConfigAbierto(true)}
          className="fixed top-4 right-4 bg-zinc-900/90 backdrop-blur hover:bg-zinc-800 text-zinc-300 hover:text-white px-3 py-2 rounded-lg shadow-xl z-30 transition-colors border border-zinc-700 text-xs flex items-center gap-1.5"
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
          onLogin={handleLogin} 
          alVolver={() => cambiarModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Dashboard auth={auth} alVolver={() => cambiarModo('menu')} />;
  }

  if (modo === 'historial') {
    if (!auth) return (
      <>
        <Login 
          onLogin={handleLogin} 
          alVolver={() => cambiarModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Historial auth={auth} alVolver={() => cambiarModo('menu')} />;
  }

  if (modo === 'geocercas') {
    if (!auth) return (
      <>
        <Login 
          onLogin={handleLogin} 
          alVolver={() => cambiarModo('menu')} 
          alAbrirConfig={() => setModalConfigAbierto(true)} 
        />
        <ConfigModal 
          abierto={modalConfigAbierto} 
          alCerrar={() => setModalConfigAbierto(false)} 
          alGuardar={handleConfigGuardada} 
        />
      </>
    );
    return <Geocercas auth={auth} alVolver={() => cambiarModo('menu')} />;
  }

  const hostDisplay = configActual.customEnabled 
    ? `${configActual.protocol}://${configActual.host}:${configActual.port || '3000'}`
    : 'Local / Mismo Servidor';

  return (
    <div className="w-full h-screen bg-zinc-950 bg-tactical-grid flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
      
      {/* Resplandor ambiental de fondo */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-600/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="bg-zinc-900/90 backdrop-blur-xl p-8 sm:p-10 rounded-3xl shadow-2xl border border-zinc-800 max-w-md w-full text-center relative z-10">
        
        <button
          onClick={() => setModalConfigAbierto(true)}
          className="absolute top-4 right-4 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs flex items-center gap-1.5 transition-colors"
          title="Configurar IP y Puerto de conexión"
        >
          <span>⚙️</span>
          <span className="font-mono text-[11px]">Servidor</span>
        </button>

        <div className="inline-block px-3 py-1 rounded-full bg-red-950/60 border border-red-800/80 text-[10px] font-mono text-red-400 font-bold uppercase tracking-widest mb-3">
          SISTEMA DE TELEMETRÍA MINERA & IOT
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 mb-2 tracking-tight">
          TRACE-MIN
        </h1>
        <p className="text-zinc-400 mb-4 text-xs sm:text-sm">
          Monitoreo en Tiempo Real, Inercial & Sensor Hub
        </p>

        <div className="flex flex-col items-center gap-1.5 mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="truncate max-w-[220px]" title={hostDisplay}>Host: {hostDisplay}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button 
            onClick={() => cambiarModo('mapa')}
            className="w-full bg-gradient-to-r from-zinc-800 to-zinc-800/90 hover:from-zinc-700 hover:to-zinc-750 border border-zinc-700 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:scale-110 transition-transform">🗺️</span>
              <span className="text-sm font-semibold">Monitor en Tiempo Real</span>
            </div>
            <span className="text-xs text-zinc-400 group-hover:text-white transition-colors">→</span>
          </button>

          <button 
            onClick={() => cambiarModo('dashboard')}
            className="w-full bg-gradient-to-r from-zinc-800 to-zinc-800/90 hover:from-zinc-700 hover:to-zinc-750 border border-zinc-700 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:scale-110 transition-transform">📊</span>
              <span className="text-sm font-semibold">Dashboard Analítico (KPIs)</span>
            </div>
            <span className="text-xs text-zinc-400 group-hover:text-white transition-colors">→</span>
          </button>

          <button 
            onClick={() => cambiarModo('historial')}
            className="w-full bg-gradient-to-r from-zinc-800 to-zinc-800/90 hover:from-zinc-700 hover:to-zinc-750 border border-zinc-700 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:scale-110 transition-transform">⏪</span>
              <span className="text-sm font-semibold">Historial de Rutas</span>
            </div>
            <span className="text-xs text-zinc-400 group-hover:text-white transition-colors">→</span>
          </button>

          <button 
            onClick={() => cambiarModo('geocercas')}
            className="w-full bg-gradient-to-r from-zinc-800 to-zinc-800/90 hover:from-zinc-700 hover:to-zinc-750 border border-zinc-700 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:scale-110 transition-transform">📍</span>
              <span className="text-sm font-semibold">Configurar Geocercas</span>
            </div>
            <span className="text-xs text-zinc-400 group-hover:text-white transition-colors">→</span>
          </button>

          <button 
            onClick={() => cambiarModo('ota')}
            className="w-full bg-gradient-to-r from-zinc-800 to-zinc-800/90 hover:from-zinc-700 hover:to-zinc-750 border border-cyan-700/50 hover:border-cyan-500 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:rotate-180 transition-transform duration-500">🔄</span>
              <span className="text-sm font-semibold">Actualización Remota ESP32 (OTA)</span>
            </div>
            <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full">CLOUD</span>
          </button>

          <button 
            onClick={() => cambiarModo('simulador')}
            className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 border border-red-500 text-white font-semibold py-3 px-5 rounded-xl transition-all shadow-lg hover:shadow-red-950/60 flex items-center justify-between group mt-1"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl group-hover:scale-110 transition-transform">📱</span>
              <span className="text-sm font-bold">Puente Móvil / Simulador</span>
            </div>
            <span className="text-xs font-mono bg-red-700/60 px-2 py-0.5 rounded-full">EN VIVO</span>
          </button>

          {/* Descarga Directa APK Android */}
          <div className="pt-2 border-t border-zinc-800/80 mt-1 flex flex-col gap-1.5">
            <a 
              href="/tracemin.apk" 
              download="tracemin.apk"
              className="w-full bg-zinc-950 hover:bg-zinc-800/90 border border-emerald-500/40 hover:border-emerald-500 text-emerald-400 font-semibold py-2.5 px-4 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-xs"
            >
              <span>📦</span>
              <span>Descargar App Nativa Android (.APK)</span>
            </a>

            {window.location.protocol !== 'https:' && (
              <a
                href={`https://${configActual.host || window.location.hostname}:8443/simulador`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors underline"
              >
                🔒 Abrir Simulador Web en HTTPS (Puerto 8443)
              </a>
            )}
          </div>
          
          {auth && (
            <button 
              onClick={handleLogout}
              className="w-full mt-2 text-zinc-500 hover:text-zinc-300 text-xs underline pb-1"
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
