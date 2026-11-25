/*
  =============================================================================
  PROYECTO: TRACE-MIN / TELEMETRIA VEHICULAR RESILIENTE
  PLACA:    ESP32-S3 N16R8 (YD-ESP32-S3 USB-C)
  MODO:     INTEGRACION TOTAL (SENSORES FISICOS + PUENTE DE DATOS CELULAR)
  =============================================================================
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#define DEFAULT_SSID        "TU_WIFI_O_HOTSPOT"
#define DEFAULT_CLAVE       "TU_PASSWORD"
#define DEFAULT_HOST        "192.168.1.129"
#define DEFAULT_PUERTO      "3001"
#define DEFAULT_DISPOSITIVO "Camion-1"
#define DEFAULT_PUENTE      "celular-1"

#define PIN_LED_ESTADO      2
#define PIN_BOTON_BOOT      0
#define PIN_TRIG            6
#define PIN_ECHO            7
#define PIN_GPS_RX          16
#define PIN_GPS_TX          17
#define GPS_BAUDRATE        9600

#define PUERTO_DNS          53
#define WDT_TIMEOUT_S       20
static const char* SSID_PORTAL  = "TRACEMIN-ESP32";
static const char* CLAVE_PORTAL = "tracemin123";
static const uint32_t INTERVALO_CONSULTA_MS = 2000;
static const uint32_t EDAD_MAXIMA_GPS_MS    = 60000;

struct Configuracion {
    String ssid;
    String clave;
    String host;
    String puerto;
    String dispositivo;
    String puente;
};

struct TelemetriaData {
    double latitud;
    double longitud;
    float velocidad;
    float altitud;
    float rumbo;
    float bateria;
    float voltaje;
    float temperatura;
    float vibracion;
    float pitch;
    float roll;
    float acel_x;
    float acel_y;
    float acel_z;
    float distancia_cm;
    bool puerta_abierta;
    String timestamp_origen;
    bool fuente_celular_activa;
};

Preferences memoria;
WebServer servidor(80);
DNSServer dnsServer;
Configuracion cfg;
TelemetriaData telemetria;
HardwareSerial gpsSerial(1);

bool portalForzado = false;
String ultimoTimestampPuente = "";
String estadoSistema = "Iniciando...";
uint32_t paquetesEnviados = 0;
uint32_t ultimaConsulta = 0;
uint32_t ultimoIntentoWifi = 0;
uint32_t tiempoReintentoWifiMs = 3000;
uint32_t tiempoPresionBoot = 0;

String lineaNMEA = "";
bool neoGpsValido = false;
double neoLat = 0.0;
double neoLon = 0.0;
float neoVel = 0.0;

void iniciarUltrasonico() {
    pinMode(PIN_TRIG, OUTPUT);
    pinMode(PIN_ECHO, INPUT);
    digitalWrite(PIN_TRIG, LOW);
}

float leerDistanciaUltrasonico() {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    unsigned long duracion = pulseIn(PIN_ECHO, HIGH, 25000);
    if (duracion == 0) return -1.0f;
    float distancia = (float)duracion * 0.0343f / 2.0f;
    if (distancia < 2.0f || distancia > 400.0f) return -1.0f;
    return distancia;
}

void iniciarGPS() {
    gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
}

void procesarNMEA(const String& nmea) {
    if (nmea.startsWith("$GPRMC") || nmea.startsWith("$GNRMC")) {
        int campo = 0;
        String campos[13];
        int start = 0;
        while (start < nmea.length() && campo < 13) {
            int coma = nmea.indexOf(',', start);
            if (coma == -1) {
                campos[campo++] = nmea.substring(start);
                break;
            }
            campos[campo++] = nmea.substring(start, coma);
            start = coma + 1;
        }

        if (campo >= 7 && campos[2] == "A") {
            double rawLat = campos[3].toDouble();
            int degLat = (int)(rawLat / 100);
            double minLat = rawLat - (degLat * 100);
            double decLat = degLat + (minLat / 60.0);
            if (campos[4] == "S") decLat = -decLat;

            double rawLon = campos[5].toDouble();
            int degLon = (int)(rawLon / 100);
            double minLon = rawLon - (degLon * 100);
            double decLon = degLon + (minLon / 60.0);
            if (campos[6] == "W") decLon = -decLon;

            float nudos = campos[7].toFloat();
            float kmh = nudos * 1.852f;

            neoLat = decLat;
            neoLon = decLon;
            neoVel = kmh;
            neoGpsValido = true;
        }
    }
}

void revisarGPSHardware() {
    while (gpsSerial.available() > 0) {
        char c = (char)gpsSerial.read();
        if (c == '\n' || c == '\r') {
            if (lineaNMEA.length() > 10) {
                procesarNMEA(lineaNMEA);
            }
            lineaNMEA = "";
        } else {
            if (lineaNMEA.length() < 120) {
                lineaNMEA += c;
            }
        }
    }
}

void cargarConfiguracion() {
    memoria.begin("tracemin", true);
    cfg.ssid = memoria.getString("ssid", DEFAULT_SSID);
    cfg.clave = memoria.getString("clave", DEFAULT_CLAVE);
    cfg.host = memoria.getString("host", DEFAULT_HOST);
    cfg.puerto = memoria.getString("puerto", DEFAULT_PUERTO);
    cfg.dispositivo = memoria.getString("disp", DEFAULT_DISPOSITIVO);
    cfg.puente = memoria.getString("puente", DEFAULT_PUENTE);
    memoria.end();

    telemetria.latitud = -17.3935;
    telemetria.longitud = -66.1570;
    telemetria.velocidad = 0.0;
    telemetria.altitud = 2570.0;
    telemetria.rumbo = 0.0;
    telemetria.bateria = 100.0;
    telemetria.voltaje = 3.85;
    telemetria.temperatura = 25.0;
    telemetria.vibracion = 1.0;
    telemetria.pitch = 0.0;
    telemetria.roll = 0.0;
    telemetria.acel_x = 0.0;
    telemetria.acel_y = 0.0;
    telemetria.acel_z = 9.81;
    telemetria.distancia_cm = -1.0;
    telemetria.puerta_abierta = false;
    telemetria.fuente_celular_activa = false;
}

void guardarConfiguracion() {
    memoria.begin("tracemin", false);
    memoria.putString("ssid", cfg.ssid);
    memoria.putString("clave", cfg.clave);
    memoria.putString("host", cfg.host);
    memoria.putString("puerto", cfg.puerto);
    memoria.putString("disp", cfg.dispositivo);
    memoria.putString("puente", cfg.puente);
    memoria.end();
}

bool configuracionCompleta() {
    return cfg.ssid.length() > 0 && cfg.host.length() > 0;
}

bool esConexionHttps() {
    String h = cfg.host;
    h.toLowerCase();
    return h.startsWith("https://") || h.indexOf("ngrok") >= 0 || cfg.puerto == "443";
}

String urlBase() {
    String h = cfg.host;
    h.trim();
    bool https = esConexionHttps();
    String proto = https ? "https://" : "http://";

    if (h.startsWith("https://")) {
        h = h.substring(8);
    } else if (h.startsWith("http://")) {
        h = h.substring(7);
    }

    int barraIdx = h.indexOf('/');
    String dominio = (barraIdx >= 0) ? h.substring(0, barraIdx) : h;
    String subruta = (barraIdx >= 0) ? h.substring(barraIdx) : "";

    String p = cfg.puerto;
    p.trim();
    String strPuerto = "";
    if (p.length() > 0 && p != "80" && p != "443") {
        strPuerto = ":" + p;
    }

    while (subruta.endsWith("/")) {
        subruta.remove(subruta.length() - 1);
    }

    return proto + dominio + strPuerto + subruta;
}

void conectarWifi() {
    if (cfg.ssid.length() == 0) return;
    WiFi.begin(cfg.ssid.c_str(), cfg.clave.c_str());
    ultimoIntentoWifi = millis();
    Serial.printf("[WIFI] Conectando a '%s'...\n", cfg.ssid.c_str());
}

void parpadearLed(uint32_t intervaloMs) {
    static uint32_t ultimoCambio = 0;
    static bool estado = false;
    if (millis() - ultimoCambio >= intervaloMs) {
        ultimoCambio = millis();
        estado = !estado;
        digitalWrite(PIN_LED_ESTADO, estado ? HIGH : LOW);
    }
}

void enviarCabecerasCors() {
    servidor.sendHeader("Access-Control-Allow-Origin", "*");
    servidor.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    servidor.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

String escaparHtml(const String& texto) {
    String salida = texto;
    salida.replace("&", "&amp;");
    salida.replace("\"", "&quot;");
    salida.replace("<", "&lt;");
    salida.replace(">", "&gt;");
    return salida;
}

void paginaSensorCelular() {
    enviarCabecerasCors();
    String html = F("<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Puente Celular &rarr; ESP32</title>"
        "<style>"
        "body{background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;margin:0;padding:20px;text-align:center}"
        ".card{max-width:400px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:16px;padding:20px;box-shadow:0 10px 25px rgba(0,0,0,0.5)}"
        "h1{color:#ef4444;font-size:20px;margin-bottom:8px}"
        "p{color:#a1a1aa;font-size:12px;margin-bottom:16px}"
        ".btn{display:block;width:100%;box-sizing:border-box;background:#22c55e;color:#000;font-weight:700;padding:14px;border:none;border-radius:12px;cursor:pointer;font-size:15px;margin-top:10px}"
        ".btn-stop{background:#ef4444;color:#fff}"
        ".box{background:#000;border:1px solid #27272a;border-radius:10px;padding:12px;margin-top:12px;font-family:monospace;font-size:11px;text-align:left;color:#38bdf8;line-height:1.6}"
        "</style></head><body><div class='card'>"
        "<h1>&#128241; Transmisor Sensor Celular</h1>"
        "<p>Transmite el GPS, giroscopio y acelerometro de tu smartphone directamente al ESP32.</p>"
        "<button id='btnTx' class='btn' onclick='toggleTransmision()'>&#9654; INICIAR TRANSMISION</button>"
        "<div class='box' id='log'>Estado: En espera de inicio...</div>"
        "</div>"
        "<script>"
        "let activo=false,watchId=null,intervalo=null;"
        "let s={lat:0,lon:0,vel:0,alt:0,rumbo:0,ax:0,ay:0,az:9.8,vib:1.0,pitch:0,roll:0};"
        "function log(txt){document.getElementById('log').innerHTML=txt;}"
        "async function toggleTransmision(){"
        "  activo=!activo;"
        "  const b=document.getElementById('btnTx');"
        "  if(activo){"
        "    b.textContent='&#9632; DETENER TRANSMISION'; b.className='btn btn-stop';"
        "    if(typeof DeviceMotionEvent!=='undefined'&&typeof DeviceMotionEvent.requestPermission==='function'){"
        "      try{await DeviceMotionEvent.requestPermission();}catch(e){}"
        "    }"
        "    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){"
        "      try{await DeviceOrientationEvent.requestPermission();}catch(e){}"
        "    }"
        "    window.addEventListener('devicemotion',e=>{"
        "      const a=e.accelerationIncludingGravity||e.acceleration;"
        "      if(a){s.ax=parseFloat((a.x||0).toFixed(2));s.ay=parseFloat((a.y||0).toFixed(2));s.az=parseFloat((a.z||0).toFixed(2));"
        "      s.vib=parseFloat((Math.sqrt(s.ax*s.ax+s.ay*s.ay+s.az*s.az)/9.81).toFixed(2));}"
        "    });"
        "    window.addEventListener('deviceorientation',e=>{"
        "      if(e.beta!==null) s.pitch=parseFloat(e.beta.toFixed(1));"
        "      if(e.gamma!==null) s.roll=parseFloat(e.gamma.toFixed(1));"
        "      if(e.alpha!==null) s.rumbo=parseFloat(e.alpha.toFixed(1));"
        "    });"
        "    if(navigator.geolocation){"
        "      watchId=navigator.geolocation.watchPosition(p=>{"
        "        s.lat=p.coords.latitude; s.lon=p.coords.longitude;"
        "        s.vel=p.coords.speed?parseFloat((p.coords.speed*3.6).toFixed(1)):0;"
        "        s.alt=p.coords.altitude?parseFloat(p.coords.altitude.toFixed(1)):2570;"
        "      },err=>console.warn(err),{enableHighAccuracy:true});"
        "    }"
        "    intervalo=setInterval(enviar,1000);"
        "    log('Transmitiendo sensores cada 1s al ESP32...');"
        "  }else{"
        "    b.textContent='&#9654; INICIAR TRANSMISION'; b.className='btn';"
        "    if(watchId) navigator.geolocation.clearWatch(watchId);"
        "    if(intervalo) clearInterval(intervalo);"
        "    log('Transmision detenida.');"
        "  }"
        "}"
        "function enviar(){"
        "  fetch('/api/sensor',{"
        "    method:'POST',headers:{'Content-Type':'application/json'},"
        "    body:JSON.stringify({latitud:s.lat,longitud:s.lon,velocidad:s.vel,altitud:s.alt,rumbo:s.rumbo,"
        "      aceleracion_x:s.ax,aceleracion_y:s.ay,aceleracion_z:s.az,vibracion:s.vib,pitch:s.pitch,roll:s.roll})"
        "  }).then(r=>{"
        "    log('GPS: '+s.lat.toFixed(5)+', '+s.lon.toFixed(5)+'<br>'+"
        "        'Pitch: '+s.pitch+'&deg; | Roll: '+s.roll+'&deg;<br>'+"
        "        'Vib: '+s.vib+'G | Envio directo OK');"
        "  }).catch(e=>log('Error envio directo: '+e));"
        "}"
        "</script></body></html>");
    servidor.send(200, "text/html", html);
}

void rutaApiSensorDirecto() {
    enviarCabecerasCors();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, servidor.arg("plain"));
    if (err) {
        servidor.send(400, "application/json", "{\"error\":\"JSON invalido\"}");
        return;
    }

    if (doc["latitud"].is<double>() && doc["longitud"].is<double>()) {
        double lat = doc["latitud"];
        double lon = doc["longitud"];
        if (lat != 0.0 && lon != 0.0) {
            telemetria.latitud = lat;
            telemetria.longitud = lon;
        }
    }

    telemetria.velocidad = doc["velocidad"] | telemetria.velocidad;
    telemetria.altitud = doc["altitud"] | telemetria.altitud;
    telemetria.rumbo = doc["rumbo"] | telemetria.rumbo;
    telemetria.vibracion = doc["vibracion"] | telemetria.vibracion;
    telemetria.pitch = doc["pitch"] | telemetria.pitch;
    telemetria.roll = doc["roll"] | telemetria.roll;
    telemetria.acel_x = doc["aceleracion_x"] | telemetria.acel_x;
    telemetria.acel_y = doc["aceleracion_y"] | telemetria.acel_y;
    telemetria.acel_z = doc["aceleracion_z"] | telemetria.acel_z;
    telemetria.fuente_celular_activa = true;

    servidor.send(200, "application/json", "{\"estado\":\"ok\",\"mensaje\":\"Sensores recibidos en ESP32\"}");
}

void paginaPrincipal() {
    int redes = WiFi.scanNetworks();
    String opciones = "";
    for (int i = 0; i < redes; i++) {
        opciones += "<option value=\"" + escaparHtml(WiFi.SSID(i)) + "\">";
    }
    WiFi.scanDelete();

    String html = "<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"utf-8\">";
    html += "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
    html += "<title>TRACE-MIN ESP32 Telemetria</title><style>";
    html += "body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#fafafa;margin:0;padding:16px}";
    html += ".caja{max-width:440px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,0.5)}";
    html += "h1{color:#ef4444;font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:8px}";
    html += "p{color:#a1a1aa;font-size:12px;margin:0 0 16px}";
    html += ".estado{background:#09090b;border:1px solid #27272a;border-radius:12px;padding:12px;font-size:11px;font-family:monospace;color:#34d399;line-height:1.6}";
    html += ".presets{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:14px 0}";
    html += ".btn-pre{background:#27272a;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px 6px;font-size:11px;cursor:pointer;font-weight:600}";
    html += ".btn-pre:hover{background:#3f3f46}";
    html += "label{display:block;font-size:11px;font-weight:600;color:#a1a1aa;margin:12px 0 4px;text-transform:uppercase;letter-spacing:0.5px}";
    html += "input{width:100%;box-sizing:border-box;background:#09090b;border:1px solid #3f3f46;border-radius:10px;padding:10px;color:#fff;font-size:14px;font-family:monospace}";
    html += "input:focus{outline:none;border-color:#ef4444}";
    html += "button.submit{width:100%;margin-top:20px;background:#dc2626;color:#fff;border:0;border-radius:12px;padding:14px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(220,38,38,0.4)}";
    html += ".link-sensor{display:block;margin-top:14px;color:#38bdf8;text-decoration:none;font-size:12px;text-align:center;font-weight:600}";
    html += "</style><script>";
    html += "function setPre(h,p){document.getElementById('inHost').value=h;document.getElementById('inPuerto').value=p;}";
    html += "</script></head><body><div class=\"caja\">";
    html += "<h1><span>🚛</span> TRACE-MIN ESP32 S3</h1>";
    html += "<p>Sistema de Telemetria y Puente de Sensores Inerciales.</p>";
    html += "<div class=\"estado\">";
    html += "WiFi: " + String(WiFi.status() == WL_CONNECTED ? "ONLINE (" + WiFi.localIP().toString() + ")" : "OFFLINE") + "<br>";
    html += "Destino API: " + urlBase() + "/api/telemetria<br>";
    html += "Estado: " + escaparHtml(estadoSistema) + "<br>";
    html += "Paquetes: " + String(paquetesEnviados) + " | Temp ESP32: " + String(temperatureRead(), 1) + "&deg;C<br>";
    html += "Sensor Celular: " + String(telemetria.fuente_celular_activa ? "<span style='color:#34d399'>ACTIVO</span>" : "<span style='color:#facc15'>EN ESPERA</span>") + "<br>";
    html += "Ultrasonico: " + String(telemetria.distancia_cm > 0 ? String(telemetria.distancia_cm, 1) + " cm" : "No detectado") + "<br>";
    html += "GPS NEO-6M: " + String(neoGpsValido ? "<span style='color:#34d399'>FIX SATELITAL</span>" : "Buscando satelites (Usando Celular)");
    html += "</div>";
    html += "<div class=\"presets\">";
    html += "<button type=\"button\" class=\"btn-pre\" style=\"border-color:#10b981;color:#6ee7b7\" onclick=\"setPre('192.168.1.129','3001')\">💻 PC Local (3001)</button>";
    html += "<button type=\"button\" class=\"btn-pre\" style=\"border-color:#38bdf8;color:#7dd3fc\" onclick=\"setPre('100.96.196.41','3001')\">🌐 Tailscale (3001)</button>";
    html += "<button type=\"button\" class=\"btn-pre\" onclick=\"setPre('192.168.1.129','8080')\">🐳 Docker Nginx (8080)</button>";
    html += "<button type=\"button\" class=\"btn-pre\" onclick=\"setPre('chummy-conductor-wilt.ngrok-free.dev/teleco','')\">🚀 Ngrok Publico</button>";
    html += "</div>";
    html += "<form method=\"POST\" action=\"/guardar\"><datalist id=\"redes\">" + opciones + "</datalist>";
    html += "<label>Red Wi-Fi (SSID)</label><input name=\"ssid\" list=\"redes\" value=\"" + escaparHtml(cfg.ssid) + "\" placeholder=\"Nombre de red Wi-Fi\">";
    html += "<label>Contraseña Wi-Fi</label><input name=\"clave\" type=\"password\" value=\"" + escaparHtml(cfg.clave) + "\" placeholder=\"Clave Wi-Fi\">";
    html += "<label>Servidor / Host (IP PC)</label><input id=\"inHost\" name=\"host\" value=\"" + escaparHtml(cfg.host) + "\" placeholder=\"192.168.1.129\">";
    html += "<label>Puerto Backend (3001)</label><input id=\"inPuerto\" name=\"puerto\" value=\"" + escaparHtml(cfg.puerto) + "\" placeholder=\"3001\">";
    html += "<label>ID del Camion en la BD</label><input name=\"disp\" value=\"" + escaparHtml(cfg.dispositivo) + "\">";
    html += "<label>ID Puente Celular (Simulador)</label><input name=\"puente\" value=\"" + escaparHtml(cfg.puente) + "\">";
    html += "<button type=\"submit\" class=\"submit\">Guardar y Conectar</button></form>";
    html += "<a href=\"/sensor\" class=\"link-sensor\">&#128241; Abrir Transmisor Directo del Celular</a>";
    html += "</div></body></html>";
    servidor.send(200, "text/html; charset=utf-8", html);
}

void rutaGuardarFormulario() {
    String nuevoSsid = servidor.arg("ssid");
    String nuevaClave = servidor.arg("clave");
    String nuevoHost = servidor.arg("host");
    String nuevoPuerto = servidor.arg("puerto");
    String nuevoDisp = servidor.arg("disp");
    String nuevoPuente = servidor.arg("puente");

    if (nuevoSsid.length() > 0) cfg.ssid = nuevoSsid;
    if (nuevaClave.length() > 0 || nuevoSsid.length() > 0) cfg.clave = nuevaClave;
    if (nuevoHost.length() > 0) cfg.host = nuevoHost;
    cfg.puerto = nuevoPuerto;
    if (nuevoDisp.length() > 0) cfg.dispositivo = nuevoDisp;
    if (nuevoPuente.length() > 0) cfg.puente = nuevoPuente;

    cfg.host.trim();
    while (cfg.host.endsWith("/")) cfg.host.remove(cfg.host.length() - 1);
    guardarConfiguracion();

    servidor.send(200, "text/html; charset=utf-8",
                  "<html><body style=\"font-family:sans-serif;background:#09090b;color:#fff;padding:24px;text-align:center\">"
                  "<h2 style=\"color:#22c55e\">&#10003; Configuracion guardada con exito</h2>"
                  "<p>Reiniciando ESP32 para conectar a " + urlBase() + "...</p></body></html>");
    delay(1500);
    ESP.restart();
}

void rutaEstadoJson() {
    enviarCabecerasCors();
    JsonDocument doc;
    doc["conectado_wifi"] = (WiFi.status() == WL_CONNECTED);
    doc["ip"] = WiFi.localIP().toString();
    doc["ssid"] = cfg.ssid;
    doc["host"] = cfg.host;
    doc["puerto"] = cfg.puerto;
    doc["url_completa"] = urlBase();
    doc["dispositivo"] = cfg.dispositivo;
    doc["puente"] = cfg.puente;
    doc["paquetes_enviados"] = paquetesEnviados;
    doc["estado"] = estadoSistema;
    doc["temperatura_esp32"] = temperatureRead();
    doc["distancia_ultrasonico_cm"] = telemetria.distancia_cm;
    doc["gps_neo_fix"] = neoGpsValido;
    doc["fuente_celular_activa"] = telemetria.fuente_celular_activa;
    String salida;
    serializeJson(doc, salida);
    servidor.send(200, "application/json", salida);
}

void rutaOpciones() {
    enviarCabecerasCors();
    servidor.send(204);
}

void iniciarPortal() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(SSID_PORTAL, CLAVE_PORTAL);
    dnsServer.start(PUERTO_DNS, "*", WiFi.softAPIP());

    Serial.printf("[PORTAL] Red SoftAP activa: '%s' (clave: '%s')\n", SSID_PORTAL, CLAVE_PORTAL);
    Serial.printf("[PORTAL] Accede en tu navegador a: http://%s\n", WiFi.softAPIP().toString().c_str());

    servidor.on("/", HTTP_GET, paginaPrincipal);
    servidor.on("/guardar", HTTP_POST, rutaGuardarFormulario);
    servidor.on("/estado", HTTP_GET, rutaEstadoJson);
    servidor.on("/sensor", HTTP_GET, paginaSensorCelular);
    servidor.on("/api/sensor", HTTP_POST, rutaApiSensorDirecto);
    servidor.on("/api/sensor", HTTP_OPTIONS, rutaOpciones);

    servidor.onNotFound([]() {
        if (servidor.hostHeader() != WiFi.softAPIP().toString()) {
            servidor.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
            servidor.send(302, "text/plain", "");
            return;
        }
        servidor.send(404, "text/plain", "No encontrado");
    });

    servidor.begin();
}

void consultarYReenviar() {
    if (WiFi.status() != WL_CONNECTED || cfg.host.length() == 0) return;

    bool https = esConexionHttps();

    if (cfg.puente.length() > 0) {
        WiFiClientSecure secureGps;
        WiFiClient plainGps;
        if (https) {
            secureGps.setInsecure();
            secureGps.setTimeout(3000);
        } else {
            plainGps.setTimeout(3000);
        }

        HTTPClient httpPuente;
        httpPuente.setTimeout(3000);
        String urlPuente = urlBase() + "/api/puente/gps?id=" + cfg.puente;
        bool inicioOk = https ? httpPuente.begin(secureGps, urlPuente) : httpPuente.begin(plainGps, urlPuente);

        if (inicioOk) {
            httpPuente.addHeader("ngrok-skip-browser-warning", "true");
            httpPuente.addHeader("User-Agent", "TraceMin-ESP32S3/2.0");

            int codigo = httpPuente.GET();
            if (codigo == 200) {
                String respuesta = httpPuente.getString();
                JsonDocument entrada;
                if (!deserializeJson(entrada, respuesta)) {
                    uint32_t edad = entrada["edad_ms"] | 0;
                    if (edad <= EDAD_MAXIMA_GPS_MS) {
                        double lat = entrada["latitud"] | 0.0;
                        double lon = entrada["longitud"] | 0.0;
                        if (lat != 0.0 && lon != 0.0) {
                            telemetria.latitud = lat;
                            telemetria.longitud = lon;
                        }
                        telemetria.velocidad = entrada["velocidad"] | telemetria.velocidad;
                        telemetria.altitud = entrada["altitud"] | telemetria.altitud;
                        telemetria.rumbo = entrada["rumbo"] | telemetria.rumbo;
                        telemetria.bateria = entrada["bateria"] | telemetria.bateria;
                        telemetria.voltaje = entrada["voltaje"] | telemetria.voltaje;

                        telemetria.pitch = entrada["pitch"] | telemetria.pitch;
                        telemetria.roll = entrada["roll"] | telemetria.roll;
                        telemetria.vibracion = entrada["vibracion"] | telemetria.vibracion;
                        telemetria.acel_x = entrada["aceleracion_x"] | telemetria.acel_x;
                        telemetria.acel_y = entrada["aceleracion_y"] | telemetria.acel_y;
                        telemetria.acel_z = entrada["aceleracion_z"] | telemetria.acel_z;

                        telemetria.timestamp_origen = entrada["timestamp"] | "";
                        telemetria.fuente_celular_activa = true;
                    }
                }
            } else if (codigo == 404) {
                estadoSistema = "Esperando celular en /simulador (" + cfg.puente + ")";
            }
            httpPuente.end();
        }
        if (https) secureGps.stop();
    }

    if (neoGpsValido) {
        telemetria.latitud = neoLat;
        telemetria.longitud = neoLon;
        telemetria.velocidad = neoVel;
    }

    float distancia = leerDistanciaUltrasonico();
    telemetria.distancia_cm = distancia;
    if (distancia > 0.0f) {
        telemetria.puerta_abierta = (distancia > 15.0f);
    }

    telemetria.temperatura = temperatureRead();

    JsonDocument salida;
    salida["dispositivo_id"] = cfg.dispositivo;
    salida["latitud"] = telemetria.latitud;
    salida["longitud"] = telemetria.longitud;
    salida["velocidad"] = telemetria.velocidad;
    salida["altitud"] = telemetria.altitud;
    salida["rumbo"] = telemetria.rumbo;
    salida["temperatura"] = telemetria.temperatura;
    salida["voltaje"] = telemetria.voltaje;
    salida["bateria"] = telemetria.bateria;

    salida["vibracion"] = telemetria.vibracion;
    salida["pitch"] = telemetria.pitch;
    salida["roll"] = telemetria.roll;
    salida["aceleracion_x"] = telemetria.acel_x;
    salida["aceleracion_y"] = telemetria.acel_y;
    salida["aceleracion_z"] = telemetria.acel_z;

    JsonObject extra = salida["sensores_extra"].to<JsonObject>();
    extra["distancia_cm"] = (telemetria.distancia_cm > 0.0f) ? telemetria.distancia_cm : 0.0f;
    extra["puerta_abierta"] = telemetria.puerta_abierta;
    extra["gps_hardware"] = neoGpsValido;
    extra["puente_celular"] = telemetria.fuente_celular_activa;

    String cuerpo;
    serializeJson(salida, cuerpo);

    WiFiClientSecure secureEnvio;
    WiFiClient plainEnvio;
    if (https) {
        secureEnvio.setInsecure();
        secureEnvio.setTimeout(4000);
    } else {
        plainEnvio.setTimeout(4000);
    }

    HTTPClient envio;
    envio.setTimeout(4000);
    String urlTelemetria = urlBase() + "/api/telemetria";
    bool envioOk = https ? envio.begin(secureEnvio, urlTelemetria) : envio.begin(plainEnvio, urlTelemetria);

    if (!envioOk) {
        estadoSistema = "Fallo conexion a /api/telemetria";
        if (https) secureEnvio.stop();
        return;
    }

    envio.addHeader("Content-Type", "application/json");
    envio.addHeader("ngrok-skip-browser-warning", "true");
    envio.addHeader("User-Agent", "TraceMin-ESP32S3/2.0");

    int resultado = envio.POST(cuerpo);
    envio.end();
    if (https) secureEnvio.stop();

    if (resultado == 200) {
        paquetesEnviados++;
        estadoSistema = "Transmitiendo OK #" + String(paquetesEnviados);
        digitalWrite(PIN_LED_ESTADO, HIGH);
        delay(40);
        digitalWrite(PIN_LED_ESTADO, LOW);
        Serial.printf("[TELEMETRIA #%u] %s | Lat: %.5f, Lon: %.5f | Pitch: %.1f, Roll: %.1f | Vib: %.2fG | Dist: %.1fcm\n",
                      paquetesEnviados, cfg.dispositivo.c_str(),
                      telemetria.latitud, telemetria.longitud,
                      telemetria.pitch, telemetria.roll,
                      telemetria.vibracion, telemetria.distancia_cm);
    } else {
        estadoSistema = "Error HTTP " + String(resultado);
        Serial.printf("[ERROR] HTTP %d al enviar telemetria a %s\n", resultado, urlTelemetria.c_str());
    }
}

void setup() {
    setCpuFrequencyMhz(160);

    Serial.begin(115200);
    delay(1000);

    pinMode(PIN_BOTON_BOOT, INPUT_PULLUP);
    pinMode(PIN_LED_ESTADO, OUTPUT);
    digitalWrite(PIN_LED_ESTADO, LOW);

    iniciarUltrasonico();
    iniciarGPS();

    Serial.println("\n=======================================================");
    Serial.println("  TRACE-MIN — ESP32-S3 Firmware Unificado");
    Serial.println("  Hardware: HC-SR04 (Ultrasonico) + NEO-6M (GPS UART)");
    Serial.println("  Inercial: Puente Celular (Pitch, Roll, Acel, Vib)");
    Serial.println("=======================================================");

    cargarConfiguracion();
    iniciarPortal();

    if (configuracionCompleta()) {
        conectarWifi();
    } else {
        Serial.println("[AVISO] Configura el Wi-Fi conectandote a 'TRACEMIN-ESP32'.");
    }

#if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT_S * 1000,
        .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
        .trigger_panic = true
    };
    esp_task_wdt_reconfigure(&wdt_config);
    esp_task_wdt_add(NULL);
#else
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(NULL);
#endif
    Serial.println("[WDT] Watchdog configurado a 20s.");
}

void loop() {
    esp_task_wdt_reset();

    dnsServer.processNextRequest();
    servidor.handleClient();

    revisarGPSHardware();

    if (digitalRead(PIN_BOTON_BOOT) == LOW) {
        if (tiempoPresionBoot == 0) {
            tiempoPresionBoot = millis();
        } else if (millis() - tiempoPresionBoot > 3000) {
            Serial.println("[BOOT] 3 segundos presionado: Forzando portal cautivo...");
            portalForzado = true;
            WiFi.disconnect();
            for (int i = 0; i < 6; i++) {
                digitalWrite(PIN_LED_ESTADO, HIGH); delay(60);
                digitalWrite(PIN_LED_ESTADO, LOW); delay(60);
            }
            tiempoPresionBoot = 0;
        }
    } else {
        tiempoPresionBoot = 0;
    }

    uint32_t ahora = millis();

    if (WiFi.status() == WL_CONNECTED) {
        tiempoReintentoWifiMs = 3000;
        parpadearLed(1000);
    } else {
        parpadearLed(150);
        if (configuracionCompleta() && !portalForzado && ahora - ultimoIntentoWifi > tiempoReintentoWifiMs) {
            Serial.printf("[WIFI] Reintentando conexion (%u s)...\n", tiempoReintentoWifiMs / 1000);
            conectarWifi();
            if (tiempoReintentoWifiMs < 60000) {
                tiempoReintentoWifiMs *= 2;
            }
        }
    }

    if (ahora - ultimaConsulta >= INTERVALO_CONSULTA_MS) {
        ultimaConsulta = ahora;
        if (configuracionCompleta()) {
            consultarYReenviar();
        }
    }

    delay(15);
}
