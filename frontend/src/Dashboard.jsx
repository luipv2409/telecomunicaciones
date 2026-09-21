import { useState, useEffect } from 'react';
import { getApiUrl } from './config';

export default function Dashboard({ auth, alVolver }) {
  const [kpis, setKpis] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const fetchKpis = async () => {
      try {
        const res = await fetch(getApiUrl('/api/flota/kpis'), {
          headers: { 'Authorization': `Bearer ${auth.token}` }
        });
        const data = await res.json();
        setKpis(data);
      } catch (err) {
        console.error('Error fetching KPIs:', err);
      } finally {
        setCargando(false);
      }
    };
    fetchKpis();
    // Refrescar cada 10 segundos
    const interval = setInterval(fetchKpis, 10000);
    return () => clearInterval(interval);
  }, [auth.token]);

  return (
    <div className="w-full h-screen bg-zinc-950 p-6 overflow-y-auto font-sans relative">
      <button 
        onClick={alVolver} 
        className="absolute top-6 left-6 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white font-semibold py-2 px-4 rounded-lg shadow-xl transition-colors z-20 text-sm"
      >
        ← Volver al Menú
      </button>

      <div className="max-w-6xl mx-auto mt-16">
        <h1 className="text-3xl font-bold text-red-500 mb-2">Panel Analítico (Últimas 24h)</h1>
        <p className="text-zinc-400 mb-8">Rendimiento y estadísticas de la flota</p>

        {cargando ? (
          <div className="text-center text-zinc-500 mt-20">Cargando métricas...</div>
        ) : kpis.length === 0 ? (
          <div className="text-center text-zinc-500 mt-20">No hay datos suficientes para generar estadísticas.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {kpis.map((kpi) => (
              <div key={kpi.dispositivo_id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden group hover:border-red-500/30 transition-colors">
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-red-500/10 transition-colors"></div>
                
                <h2 className="text-xl font-bold text-white mb-6 border-b border-zinc-800 pb-3">{kpi.dispositivo_id}</h2>
                
                <div className="space-y-4">
                  <div>
                    <div className="text-zinc-500 text-xs mb-1">Velocidad Máxima</div>
                    <div className="text-3xl font-mono font-bold text-orange-400">
                      {Number(kpi.vel_max).toFixed(1)} <span className="text-sm text-zinc-500">km/h</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-zinc-500 text-xs mb-1">Velocidad Promedio</div>
                    <div className="text-2xl font-mono font-bold text-blue-400">
                      {Number(kpi.vel_promedio).toFixed(1)} <span className="text-sm text-zinc-500">km/h</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-zinc-500 text-xs mb-1">Puntos Registrados</div>
                    <div className="text-xl font-mono font-bold text-green-400">
                      {kpi.puntos_registrados}
                    </div>
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
