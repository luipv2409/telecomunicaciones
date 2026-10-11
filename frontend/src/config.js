import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'TRACEMIN_SERVER_CONFIG';

export const getDefaultConfig = () => {
  const isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
  const isBrowser = typeof window !== 'undefined';
  const protocol = isBrowser && window.location.protocol === 'https:' ? 'https' : 'http';
  
  if (isNative) {
    return {
      protocol: 'http',
      host: '100.96.196.41',
      port: '3001',
      customEnabled: true
    };
  }

  const host = isBrowser && window.location.hostname ? window.location.hostname : '127.0.0.1';
  const port = isBrowser && window.location.port ? window.location.port : '8080';

  return {
    protocol,
    host,
    port,
    customEnabled: false
  };
};

export const getConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    const parsed = JSON.parse(raw);
    return { ...getDefaultConfig(), ...parsed };
  } catch (e) {
    return getDefaultConfig();
  }
};

export const saveConfig = (newConfig) => {
  try {
    const merged = { ...getConfig(), ...newConfig, customEnabled: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.error('Error guardando configuración:', e);
    return getConfig();
  }
};

export const resetConfig = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  return getDefaultConfig();
};

export const getSubpath = () => {
  if (typeof window !== 'undefined' && window.location && window.location.pathname) {
    if (window.location.pathname.startsWith('/teleco')) {
      return '/teleco';
    }
  }
  return '';
};

export const getBaseServerUrl = () => {
  const cfg = getConfig();
  if (!cfg.customEnabled && typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== '') {
    return '';
  }
  let cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port && String(cfg.port).trim() !== '' ? `:${String(cfg.port).trim()}` : '';
  const proto = cfg.protocol || 'http';

  if (cleanHost.includes('/')) {
    const slashIdx = cleanHost.indexOf('/');
    const domain = cleanHost.slice(0, slashIdx);
    const sub = cleanHost.slice(slashIdx);
    return `${proto}://${domain}${cleanPort}${sub}`;
  }

  return `${proto}://${cleanHost}${cleanPort}`;
};

export const getApiUrl = (path = '') => {
  const base = getBaseServerUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (base) {
    return `${base}${cleanPath}`;
  }
  const sub = getSubpath();
  return `${sub}${cleanPath}`;
};

export const getWsUrl = (path = '/ws') => {
  const cfg = getConfig();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (!cfg.customEnabled && typeof window !== 'undefined' && window.location.host) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sub = getSubpath();
    return `${proto}//${window.location.host}${sub}${cleanPath}`;
  }

  let cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port && String(cfg.port).trim() !== '' ? `:${String(cfg.port).trim()}` : '';
  const wsProto = cfg.protocol === 'https' ? 'wss' : 'ws';

  if (cleanHost.includes('/')) {
    const slashIdx = cleanHost.indexOf('/');
    const domain = cleanHost.slice(0, slashIdx);
    const sub = cleanHost.slice(slashIdx);
    return `${wsProto}://${domain}${cleanPort}${sub}${cleanPath}`;
  }

  return `${wsProto}://${cleanHost}${cleanPort}${cleanPath}`;
};

export const probarConexion = async (customCfg = null) => {
  const cfg = customCfg || getConfig();
  let cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port && String(cfg.port).trim() !== '' ? `:${String(cfg.port).trim()}` : '';
  const proto = cfg.protocol || 'http';
  let targetUrl = '';

  if (cleanHost.includes('/')) {
    const slashIdx = cleanHost.indexOf('/');
    const domain = cleanHost.slice(0, slashIdx);
    const sub = cleanHost.slice(slashIdx);
    targetUrl = `${proto}://${domain}${cleanPort}${sub}/api/health`;
  } else {
    targetUrl = `${proto}://${cleanHost}${cleanPort}/api/health`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'ngrok-skip-browser-warning': 'true'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return { ok: true, mensaje: 'Conexión exitosa con el servidor TRACE-MIN' };
    }
    return { ok: false, mensaje: `Servidor respondió con código ${res.status}` };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, mensaje: 'Tiempo de espera agotado (Timeout 6s). Verifica que la URL o IP esté accesible.' };
    }
    return { ok: false, mensaje: `No se pudo conectar: ${err.message}` };
  }
};
