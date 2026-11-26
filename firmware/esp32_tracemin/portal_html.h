#pragma once
#include <Arduino.h>

// =============================================================================
//  PORTAL WEB DE CONFIGURACION (HTML + CSS + JS SERVIDO DESDE FLASH)
//  Se mantiene en un archivo .h separado para evitar que el preprocesador
//  de Arduino IDE confunda las funciones JavaScript con funciones C++.
// =============================================================================

static const char PAGINA_PORTAL[] PROGMEM = R"PORTAL(<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>TRACE-MIN &middot; Conexion</title>
<style>
:root{--bg:#09090b;--card:#18181b;--line:#27272a;--muted:#a1a1aa;--txt:#fafafa;--red:#ef4444;--green:#22c55e;--amber:#f59e0b;--blue:#38bdf8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:14px 12px 60px}
.wrap{max-width:460px;margin:0 auto}
header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.logo{width:44px;height:44px;border-radius:14px;background:#dc2626;display:grid;place-items:center;font-size:24px;box-shadow:0 6px 18px rgba(220,38,38,.35)}
h1{font-size:18px;margin:0}.sub{color:var(--muted);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
.card h2{font-size:15px;margin:0 0 10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.estado{display:flex;align-items:center;gap:12px}
.dot{width:16px;height:16px;border-radius:50%;flex:none}
.ok{background:var(--green);box-shadow:0 0 14px var(--green)}
.warn{background:var(--amber);animation:pulse 1s infinite}
.bad{background:var(--red)}
@keyframes pulse{50%{opacity:.3}}
.big{font-size:16px;font-weight:700;word-break:break-word}.small{font-size:12px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.kv{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:8px 10px;min-width:0}
.kv b{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.kv span{font-size:13px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.btn{border:0;border-radius:12px;padding:13px 14px;font-weight:700;font-size:15px;cursor:pointer;color:#fff;background:#3f3f46}
.btn-p{background:#dc2626;box-shadow:0 4px 14px rgba(220,38,38,.35)}.btn-g{background:#16a34a}
.btn-s{padding:8px 11px;font-size:12px;border-radius:10px;box-shadow:none}
.btn-ghost{background:transparent;border:1px solid #3f3f46;color:var(--txt)}
.btn:disabled{opacity:.5}.full{width:100%}
.red{display:flex;align-items:center;gap:12px;padding:13px 12px;border:1px solid var(--line);border-radius:14px;margin-bottom:8px;background:#0e0e11;cursor:pointer;-webkit-tap-highlight-color:transparent}
.red:active{background:#1c1c20}.red.activa{border-color:var(--green)}.red.abierta{border-radius:14px 14px 0 0;margin-bottom:0;border-color:#52525b}
.red .n{flex:1;min-width:0}.red .nom{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:4px}
.b-g{background:#14532d;color:#86efac}.b-b{background:#0c4a6e;color:#7dd3fc}
.bars{display:flex;align-items:flex-end;gap:2px;height:16px;flex:none}
.bars i{width:4px;background:#3f3f46;border-radius:1px}.bars i.on{background:var(--green)}
.panel{margin:0 0 8px;padding:12px;border:1px solid #52525b;border-top:0;border-radius:0 0 14px 14px;background:#0e0e11}
label{display:block;font-size:11px;font-weight:600;color:var(--muted);margin:10px 0 5px;text-transform:uppercase;letter-spacing:.5px}
input[type=text],input[type=password],input[type=number]{width:100%;background:var(--bg);border:1px solid #3f3f46;border-radius:12px;padding:12px;color:#fff;font-size:16px}
input:focus{outline:none;border-color:var(--red)}
.pw{position:relative}.pw input{padding-right:48px}
.pw button{position:absolute;right:4px;top:4px;bottom:4px;width:42px;background:none;border:0;color:var(--muted);font-size:18px}
.check{display:flex;align-items:center;gap:10px;font-size:14px;color:#d4d4d8;margin:12px 0;text-transform:none;letter-spacing:0;font-weight:500}
.check input{width:20px;height:20px;accent-color:#dc2626}
.row{display:flex;gap:8px}.row>*{flex:1;min-width:0}
.presets{display:grid;gap:6px;margin-top:12px}
.preset{text-align:left;background:#0e0e11;border:1px solid var(--line);color:var(--txt);border-radius:12px;padding:11px;font-size:13px;cursor:pointer}
.preset.sel{border-color:var(--green);background:#052e16}
details summary{cursor:pointer;list-style:none;font-weight:700;font-size:15px;display:flex;justify-content:space-between}
details summary::-webkit-details-marker{display:none}
.vacio{text-align:center;color:var(--muted);font-size:13px;padding:16px 8px;line-height:1.5}
.toast{position:fixed;left:50%;bottom:16px;transform:translate(-50%,160px);background:#27272a;border:1px solid #3f3f46;padding:13px 16px;border-radius:14px;font-size:14px;transition:transform .3s;width:calc(100% - 24px);max-width:440px;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.toast.show{transform:translate(-50%,0)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#fff;border-radius:50%;animation:sp 1s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.pasos{font-size:13px;color:var(--muted);line-height:1.7;margin:0 0 12px;padding-left:20px}
a.link{color:var(--blue);text-decoration:none;font-weight:600}
.err{color:#fca5a5;font-size:13px;margin-top:10px}
.num{width:22px;height:22px;border-radius:50%;background:#27272a;color:var(--muted);font-size:11px;font-weight:700;display:grid;place-items:center;flex:none}
</style></head><body><div class="wrap">

<header><div class="logo">&#128667;</div><div><h1>TRACE-MIN ESP32</h1><div class="sub">Conexion a internet y servidor</div></div></header>

<div class="card">
 <div class="estado"><div class="dot warn" id="dot"></div><div style="min-width:0"><div class="big" id="estTitulo">Cargando...</div><div class="small" id="estDetalle"></div></div></div>
 <div class="grid">
  <div class="kv"><b>Red Wi-Fi</b><span id="kvRed">-</span></div>
  <div class="kv"><b>Senal</b><span id="kvSenal">-</span></div>
  <div class="kv"><b>Servidor</b><span id="kvServidor">-</span></div>
  <div class="kv"><b>Envios</b><span id="kvTx">-</span></div>
 </div>
 <div class="err" id="estError"></div>
</div>

<div class="card">
 <h2><span>&#128246; Darle internet</span><button class="btn btn-s btn-ghost" id="btnBuscar" onclick="escanear(true)">&#128260; Buscar</button></h2>
 <ol class="pasos"><li>Toca tu Wi-Fi o el <b>hotspot de tu celular</b>.</li><li>Escribe la contrasena y pulsa <b>Conectar</b>.</li><li>Queda guardada: la proxima vez se conecta sola.</li></ol>
 <div id="listaRedes"><div class="vacio"><span class="spin"></span> Buscando redes Wi-Fi cercanas...</div></div>
 <button class="btn btn-ghost full btn-s" style="margin-top:4px" onclick="toggleManual()">&#10133; Agregar una red que no aparece (oculta o lejana)</button>
 <div id="formManual" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#0e0e11">
  <label>Nombre de la red (SSID)</label><input type="text" id="mSsid" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Ej: WiFi-Universidad">
  <label>Contrasena</label><div class="pw"><input type="password" id="mClave" placeholder="Vacio si es abierta"><button type="button" onclick="verClave('mClave')">&#128065;</button></div>
  <div class="row" style="margin-top:12px"><button class="btn btn-ghost" onclick="guardarManual(false)">&#128190; Solo guardar</button><button class="btn btn-p" onclick="guardarManual(true)">Conectar</button></div>
  <div class="small" style="margin-top:8px">"Solo guardar" sirve para dejar lista una red que usaras despues: se conectara sola cuando este en rango.</div>
 </div>
</div>

<div class="card">
 <h2><span>&#128190; Redes guardadas <span class="small" id="cntGuardadas"></span></span></h2>
 <div id="listaGuardadas"><div class="vacio">Sin redes guardadas</div></div>
 <div class="small">Al encender o perder la senal, el ESP32 se conecta automaticamente a la red guardada con <b>mejor senal</b>.</div>
</div>

<div class="card">
 <details id="detServidor"><summary><span>&#9729;&#65039; Servidor de telemetria</span><span class="small">&#9662;</span></summary>
  <div class="presets">
   <button class="preset" data-h="trace.cybersec7.xyz" data-p="443">&#9729;&#65039; <b>Nube TRACE-MIN</b> &mdash; trace.cybersec7.xyz <span class="badge b-g">RECOMENDADO</span></button>
   <button class="preset" data-h="192.168.1.129" data-p="3001">&#128187; PC local &mdash; 192.168.1.129:3001</button>
   <button class="preset" data-h="100.96.196.41" data-p="3001">&#127760; Tailscale &mdash; 100.96.196.41:3001</button>
  </div>
  <label>Servidor / Dominio</label><input type="text" id="sHost" autocapitalize="off" autocorrect="off" spellcheck="false">
  <label>Puerto (443 = HTTPS)</label><input type="number" id="sPuerto" inputmode="numeric">
  <div class="row"><div><label>ID Camion</label><input type="text" id="sDisp"></div><div><label>ID Puente celular</label><input type="text" id="sPuente"></div></div>
  <button class="btn btn-p full" style="margin-top:14px" onclick="guardarServidor()">Guardar servidor</button>
 </details>
</div>

<div class="card small">
 <div class="row" style="align-items:center;margin-bottom:8px">
  <a class="link" href="/sensor">&#128241; Transmisor directo del celular</a>
  <button class="btn btn-s btn-ghost" style="flex:none" onclick="buscarOta()">&#128260; Buscar OTA en nube</button>
 </div>
 <div id="infoDisp" style="margin-top:6px;line-height:1.6"></div>
</div>
</div>
<div class="toast" id="toast"></div>

<script>
const $=id=>document.getElementById(id);
let redes=[],guardadas=[],abierta=null,esperando=null,timerScan=null,reintentosScan=0,servidorCargado=false;
function toast(m,ms){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),ms||3500);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function nivel(r){return r>=-55?4:r>=-67?3:r>=-75?2:r>=-85?1:0;}
function calidad(r){return ['Muy debil','Debil','Regular','Buena','Excelente'][nivel(r)];}
function barras(r){const n=nivel(r);let h='<div class="bars">';for(let i=1;i<=4;i++)h+='<i class="'+(i<=n?'on':'')+'" style="height:'+(i*4)+'px"></i>';return h+'</div>';}
async function api(url,body){
 const o=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'};
 const r=await fetch(url,o);let j={};try{j=await r.json();}catch(e){}
 if(!r.ok)throw new Error(j.error||('Error HTTP '+r.status));return j;}
function verClave(id){const i=$(id);if(i)i.type=i.type==='password'?'text':'password';}

async function cargarEstado(){
 try{pintarEstado(await api('/api/estado'));}
 catch(e){$('dot').className='dot warn';$('estTitulo').textContent='Reconectando con el ESP32...';$('estDetalle').textContent='Si tu celular se desconecto de TRACEMIN-ESP32, vuelve a conectarte.';}
}
function pintarEstado(e){
 const w=e.wifi;let cls='bad',tit='Sin internet',det='Elige una red Wi-Fi abajo para conectar';
 if(w.estado==='conectado'){cls='ok';tit='Conectado a "'+w.ssid+'"';det='IP '+w.ip+' \u00b7 este panel tambien abre en http://'+w.ip;}
 else if(w.estado==='conectando'){cls='warn';tit='Conectando a "'+w.intento+'"...';det='Puede tardar hasta 15 segundos';}
 else if(w.estado==='buscando'){cls='warn';tit='Buscando redes guardadas...';det='Se conectara a la de mejor senal';}
 else if(w.estado==='espera'){tit='Ninguna red guardada en rango';det='Reintento automatico en '+w.reintento_s+' s';}
 else if(w.estado==='pausado'){tit='Reconexion automatica en pausa';det='Modo configuracion (boton BOOT). Elige una red abajo.';}
 else if(w.estado==='sin_redes'){tit='Sin redes guardadas';det='Toca una red Wi-Fi abajo para darle internet';}
 $('dot').className='dot '+cls;$('estTitulo').textContent=tit;$('estDetalle').textContent=det;
 const con=w.estado==='conectado';
 $('kvRed').textContent=con?w.ssid:'\u2014';
 $('kvSenal').textContent=con?(calidad(w.rssi)+' ('+w.rssi+' dBm)'):'\u2014';
 $('kvServidor').textContent=e.servidor.host+(e.servidor.https?' \ud83d\udd12':'');
 $('kvTx').textContent=e.paquetes+' \u00b7 '+e.estado_tx;
 $('estError').textContent=(!con&&w.error)?('\u26a0\ufe0f '+w.error):'';
 $('infoDisp').innerHTML='Camion: <b>'+esc(e.dispositivo)+'</b> \u00b7 Temp ESP32: '+Number(e.temp).toFixed(1)+'\u00b0C \u00b7 Ultrasonico: '+(e.distancia>0?Number(e.distancia).toFixed(1)+' cm':'\u2014')+' \u00b7 GPS: '+(e.gps_fix?'FIX satelital':'via celular')+'<br>Red de configuracion: <b>'+esc(e.ap.ssid)+'</b> ('+e.ap.ip+') \u00b7 Firmware <b>'+esc(e.firmware)+'</b>'+(e.ota_msg?' \u00b7 '+esc(e.ota_msg):'');
 if(!servidorCargado){$('sHost').value=e.servidor.host;$('sPuerto').value=e.servidor.puerto;$('sDisp').value=e.dispositivo;$('sPuente').value=e.puente;servidorCargado=true;marcarPreset();}
 if(esperando){
  const dt=Date.now()-esperando.t;
  if(con&&w.ssid===esperando.ssid){toast('\u2705 Conectado a "'+w.ssid+'"'+(esperando.guardar?' y guardada en memoria':''),5000);esperando=null;cargarGuardadas();escanear(false);}
  else if(dt>3000&&w.estado!=='conectando'&&w.error){toast('\u274c '+w.error,7000);esperando=null;}
  else if(dt>45000){toast('\u26a0\ufe0f No se confirmo la conexion. Revisa la contrasena e intenta otra vez.',6000);esperando=null;}
 }
}

async function escanear(forzar){
 clearTimeout(timerScan);timerScan=null;
 const b=$('btnBuscar');b.disabled=true;b.innerHTML='<span class="spin"></span>';
 let seguir=0,forzarSig=false;
 try{
  const j=await api('/api/scan'+(forzar?'?nuevo=1':''));
  if(j.redes&&(j.redes.length||!j.escaneando)){redes=j.redes;pintarRedes();pintarGuardadas();}
  if(j.escaneando){if(!redes.length)$('listaRedes').innerHTML='<div class="vacio"><span class="spin"></span> Buscando redes Wi-Fi cercanas...</div>';seguir=1500;}
  else if(j.ocupado&&forzar&&reintentosScan<3){reintentosScan++;seguir=4000;forzarSig=true;toast('El ESP32 se esta conectando; repetire la busqueda en unos segundos.');}
  else reintentosScan=0;
 }catch(e){seguir=3000;}
 if(seguir){timerScan=setTimeout(()=>escanear(forzarSig),seguir);}
 else{b.disabled=false;b.innerHTML='&#128260; Buscar';}
}

function pintarRedes(){
 const cont=$('listaRedes');
 const pwPrev=$('pwRed')?$('pwRed').value:'';
 if(!redes.length){cont.innerHTML='<div class="vacio">No se encontraron redes.<br>Activa el hotspot de tu celular o acercate al router y pulsa &#128260; Buscar.</div>';return;}
 let h='';
 redes.forEach((r,i)=>{
  const ab=abierta===r.ssid;
  h+='<div class="red'+(r.conectada?' activa':'')+(ab?' abierta':'')+'" onclick="abrir('+i+')">'+barras(r.rssi)+'<div class="n"><div class="nom">'+esc(r.ssid)+'</div><div class="small">'+(r.seguro?'\ud83d\udd12 Protegida':'\ud83d\udd13 Abierta')+' \u00b7 '+calidad(r.rssi)+(r.conectada?'<span class="badge b-g">CONECTADA</span>':'')+(r.guardada&&!r.conectada?'<span class="badge b-b">GUARDADA</span>':'')+'</div></div><div class="small">'+(ab?'\u25b4':'\u25be')+'</div></div>';
  if(ab){
   h+='<div class="panel">';
   if(r.guardada){
    h+='<div class="small">\u2705 Contrasena guardada en memoria. <a class="link" href="#" onclick="cambiarClave(event)">Cambiar contrasena</a></div><div id="cambioClave" style="display:none"><label>Nueva contrasena</label><div class="pw"><input type="password" id="pwRed" placeholder="Nueva contrasena"><button type="button" onclick="verClave(\'pwRed\')">&#128065;</button></div></div>';
   }else if(r.seguro){
    h+='<label>Contrasena de "'+esc(r.ssid)+'"</label><div class="pw"><input type="password" id="pwRed" placeholder="Contrasena Wi-Fi" onkeydown="if(event.key===\'Enter\')conectar('+i+')"><button type="button" onclick="verClave(\'pwRed\')">&#128065;</button></div>';
   }else{
    h+='<div class="small">Red abierta: no necesita contrasena.</div>';
   }
   h+='<label class="check"><input type="checkbox" id="chkGuardar" checked> Recordar esta red</label>';
   h+='<button class="btn btn-p full" onclick="conectar('+i+')">'+(r.conectada?'Reconectar':'Conectar')+'</button></div>';
  }
 });
 cont.innerHTML=h;
 if(pwPrev&&$('pwRed'))$('pwRed').value=pwPrev;
}
function abrir(i){
 const r=redes[i];if(!r)return;
 abierta=abierta===r.ssid?null:r.ssid;pintarRedes();
 const p=$('pwRed');if(p&&!r.guardada)setTimeout(()=>p.focus(),50);
}
function cambiarClave(ev){ev.preventDefault();$('cambioClave').style.display='block';$('pwRed').focus();}
async function conectar(i){
 const r=redes[i];if(!r)return;
 const pw=$('pwRed'),cc=$('cambioClave');
 const nueva=(pw&&(!cc||cc.style.display!=='none'))?pw.value:'';
 const usarGuardada=r.guardada&&!nueva;
 if(r.seguro&&!usarGuardada&&nueva.length<8){toast('La contrasena Wi-Fi debe tener al menos 8 caracteres');if(pw)pw.focus();return;}
 const chk=$('chkGuardar');
 await enviarConexion({ssid:r.ssid,clave:usarGuardada?'':nueva,guardar:chk?chk.checked:true,usar_guardada:usarGuardada});
}
async function enviarConexion(body){
 try{
  await api('/api/wifi/conectar',body);
  esperando={ssid:body.ssid,t:Date.now(),guardar:body.guardar};abierta=null;pintarRedes();
  toast('\u23f3 Conectando a "'+body.ssid+'"... Si tu celular se sale de TRACEMIN-ESP32, vuelve a entrar.',7000);
 }catch(e){toast('\u274c '+e.message,5000);}
}

async function cargarGuardadas(){
 try{const j=await api('/api/wifi/guardadas');guardadas=j.redes||[];$('cntGuardadas').textContent='('+guardadas.length+'/'+j.max+')';pintarGuardadas();}catch(e){}
}
function pintarGuardadas(){
 const c=$('listaGuardadas');
 if(!guardadas.length){c.innerHTML='<div class="vacio">Aun no hay redes guardadas.<br>Conectate a una red arriba y quedara registrada aqui.</div>';return;}
 c.innerHTML=guardadas.map((g,i)=>{
  const vis=redes.find(r=>r.ssid===g.ssid);
  const est=g.conectada?'\ud83d\udfe2 Conectada ahora':(vis?('\ud83d\udcf6 En rango \u00b7 '+calidad(vis.rssi)):'\u26aa Fuera de alcance');
  return '<div class="red'+(g.conectada?' activa':'')+'" style="cursor:default"><div class="num">'+(i+1)+'</div><div class="n"><div class="nom">'+esc(g.ssid)+'</div><div class="small">'+est+'</div></div>'+(g.conectada?'':'<button class="btn btn-s btn-g" onclick="usarGuardada('+i+')">Usar</button>')+'<button class="btn btn-s btn-ghost" onclick="olvidar('+i+')">\ud83d\uddd1</button></div>';
 }).join('');
}
async function usarGuardada(i){const g=guardadas[i];if(!g)return;await enviarConexion({ssid:g.ssid,clave:'',guardar:true,usar_guardada:true});}
async function olvidar(i){
 const g=guardadas[i];if(!g)return;
 if(!confirm('\u00bfOlvidar la red "'+g.ssid+'"?\nEl ESP32 ya no se conectara a ella automaticamente.'))return;
 try{await api('/api/wifi/olvidar',{ssid:g.ssid});toast('\ud83d\uddd1 "'+g.ssid+'" eliminada de la memoria');cargarGuardadas();escanear(false);}catch(e){toast('\u274c '+e.message);}
}
function toggleManual(v){const f=$('formManual');const mostrar=(v===undefined)?(f.style.display==='none'):v;f.style.display=mostrar?'block':'none';if(mostrar)$('mSsid').focus();}
async function guardarManual(conectarYa){
 const ssid=$('mSsid').value.trim(),clave=$('mClave').value;
 if(!ssid){toast('Escribe el nombre de la red');return;}
 if(clave&&clave.length<8){toast('La contrasena debe tener al menos 8 caracteres');return;}
 if(conectarYa){await enviarConexion({ssid:ssid,clave:clave,guardar:true,usar_guardada:false});}
 else{try{await api('/api/wifi/guardar',{ssid:ssid,clave:clave});toast('\ud83d\udcbe "'+ssid+'" guardada. Se conectara sola cuando este en rango.',5000);cargarGuardadas();}catch(e){toast('\u274c '+e.message);return;}}
 $('mSsid').value='';$('mClave').value='';toggleManual(false);
}

function marcarPreset(){document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('sel',b.dataset.h===$('sHost').value.trim()&&b.dataset.p===String($('sPuerto').value).trim()));}
document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',()=>{$('sHost').value=b.dataset.h;$('sPuerto').value=b.dataset.p;marcarPreset();}));
['sHost','sPuerto'].forEach(id=>$(id).addEventListener('input',marcarPreset));
async function guardarServidor(){
 const body={host:$('sHost').value.trim(),puerto:String($('sPuerto').value).trim(),disp:$('sDisp').value.trim(),puente:$('sPuente').value.trim()};
 if(!body.host){toast('Escribe el servidor o dominio');return;}
 try{const j=await api('/api/servidor',body);toast('\u2705 Servidor guardado: '+j.url,5000);}catch(e){toast('\u274c '+e.message);}
}
async function buscarOta(){
 try{const j=await api('/api/ota/buscar',{});toast('\ud83d\udd04 '+j.mensaje,5000);}catch(e){toast('\u274c '+e.message,5000);}
}

cargarEstado();cargarGuardadas();escanear(false);
setInterval(cargarEstado,2000);
setInterval(cargarGuardadas,8000);
setInterval(()=>{if(!abierta&&!timerScan&&!esperando)escanear(false);},20000);
</script></body></html>)PORTAL";
