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

export const getBaseServerUrl = () => {
  const cfg = getConfig();
  if (!cfg.customEnabled && typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== '') {
    return '';
  }
  const cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port ? `:${cfg.port.toString().trim()}` : '';
  const proto = cfg.protocol || 'http';
  return `${proto}://${cleanHost}${cleanPort}`;
};

export const getApiUrl = (path = '') => {
  const base = getBaseServerUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
};

export const getWsUrl = (path = '/ws') => {
  const cfg = getConfig();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (!cfg.customEnabled && typeof window !== 'undefined' && window.location.host) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${cleanPath}`;
  }

  const cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port ? `:${cfg.port.toString().trim()}` : '';
  const wsProto = cfg.protocol === 'https' ? 'wss' : 'ws';
  return `${wsProto}://${cleanHost}${cleanPort}${cleanPath}`;
};

export const probarConexion = async (customCfg = null) => {
  const cfg = customCfg || getConfig();
  const cleanHost = (cfg.host || '127.0.0.1').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const cleanPort = cfg.port ? `:${cfg.port.toString().trim()}` : '';
  const proto = cfg.protocol || 'http';
  const targetUrl = `${proto}://${cleanHost}${cleanPort}/api/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
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
      return { ok: false, mensaje: 'Tiempo de espera agotado (Timeout 6s). Verifica que Tailscale esté conectado en ambos dispositivos o la IP.' };
    }
    return { ok: false, mensaje: `No se pudo conectar: ${err.message}` };
  }
};
