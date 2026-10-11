#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

#define PIN_BOTON_BOOT 0
#define PIN_LED_ESTADO 2
#define PUERTO_DNS 53
#define WDT_TIMEOUT_S 20

static const char* SSID_PORTAL = "TRACEMIN-ESP32";
static const char* CLAVE_PORTAL = "tracemin123";
static const uint32_t INTERVALO_CONSULTA_MS = 3000;
static const uint32_t EDAD_MAXIMA_GPS_MS = 15000;

struct Configuracion {
    String ssid;
    String clave;
    String host;
    String puerto;
    String dispositivo;
    String puente;
    bool modo_puente;
};

Preferences memoria;
WebServer servidor(80);
DNSServer dnsServer;
Configuracion cfg;

bool portalForzado = false;
String ultimoTimestamp = "";
String estadoServidor = "Inicializando...";
uint32_t paquetesEnviados = 0;
uint32_t ultimaConsulta = 0;
uint32_t ultimoIntentoWifi = 0;
uint32_t tiempoReintentoWifiMs = 3000;
uint32_t tiempoPresionBoot = 0;

void parpadearLed(uint32_t intervaloMs) {
    static uint32_t ultimoCambio = 0;
    static bool estado = false;
    if (millis() - ultimoCambio >= intervaloMs) {
        ultimoCambio = millis();
        estado = !estado;
        digitalWrite(PIN_LED_ESTADO, estado ? HIGH : LOW);
    }
}

void cargarConfiguracion() {
    memoria.begin("tracemin", true);
    cfg.ssid = memoria.getString("ssid", "");
    cfg.clave = memoria.getString("clave", "");
    cfg.host = memoria.getString("host", "chummy-conductor-wilt.ngrok-free.dev/teleco");
    cfg.puerto = memoria.getString("puerto", "");
    cfg.dispositivo = memoria.getString("disp", "ESP32-Camion-01");
    cfg.puente = memoria.getString("puente", "celular-1");
    cfg.modo_puente = memoria.getBool("puente_on", true);
    memoria.end();
}

void guardarConfiguracion() {
    memoria.begin("tracemin", false);
    memoria.putString("ssid", cfg.ssid);
    memoria.putString("clave", cfg.clave);
    memoria.putString("host", cfg.host);
    memoria.putString("puerto", cfg.puerto);
    memoria.putString("disp", cfg.dispositivo);
    memoria.putString("puente", cfg.puente);
    memoria.putBool("puente_on", cfg.modo_puente);
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

String estadoJson() {
    JsonDocument doc;
    doc["conectado_wifi"] = (WiFi.status() == WL_CONNECTED);
    doc["ip"] = WiFi.localIP().toString();
    doc["ssid"] = cfg.ssid;
    doc["host"] = cfg.host;
    doc["puerto"] = cfg.puerto;
    doc["url_completa"] = urlBase();
    doc["dispositivo"] = cfg.dispositivo;
    doc["puente"] = cfg.puente;
    doc["modo_puente"] = cfg.modo_puente;
    doc["estado"] = estadoServidor;
    doc["paquetes"] = paquetesEnviados;
    doc["https"] = esConexionHttps();
    doc["temperatura_esp32"] = temperatureRead();
    String salida;
    serializeJson(doc, salida);
    return salida;
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
    html += "<title>TRACE-MIN ESP32 Resiliente</title><style>";
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
    html += "</style><script>";
    html += "function setPre(h,p){document.getElementById('inHost').value=h;document.getElementById('inPuerto').value=p;}";
    html += "</script></head><body><div class=\"caja\">";
    html += "<h1><span>🚛</span> TRACE-MIN ESP32 Resiliente</h1>";
    html += "<p>Configuración de red local, Tailscale o Internet permanente.</p>";
    html += "<div class=\"estado\">";
    html += "WiFi: " + String(WiFi.status() == WL_CONNECTED ? "ONLINE (" + WiFi.localIP().toString() + ")" : "OFFLINE") + "<br>";
    html += "URL Activa: " + urlBase() + "<br>";
    html += "Estado: " + escaparHtml(estadoServidor) + "<br>";
    html += "Paquetes: " + String(paquetesEnviados) + " | Temp: " + String(temperatureRead(), 1) + "&deg;C";
    html += "</div>";
    html += "<div class=\"presets\">";
    html += "<button type=\"button\" class=\"btn-pre\" style=\"border-color:#10b981;color:#6ee7b7\" onclick=\"setPre('chummy-conductor-wilt.ngrok-free.dev/teleco','')\">🚀 Internet Ngrok</button>";
    html += "<button type=\"button\" class=\"btn-pre\" style=\"border-color:#38bdf8;color:#7dd3fc\" onclick=\"setPre('100.96.196.41','3001')\">🌐 Tailscale</button>";
    html += "<button type=\"button\" class=\"btn-pre\" onclick=\"setPre('192.168.1.50','3001')\">💻 Local PC (3001)</button>";
    html += "<button type=\"button\" class=\"btn-pre\" onclick=\"setPre('192.168.1.50','8080')\">🐳 Docker (8080)</button>";
    html += "</div>";
    html += "<form method=\"POST\" action=\"/guardar\"><datalist id=\"redes\">" + opciones + "</datalist>";
    html += "<label>Red Wi-Fi (SSID)</label><input name=\"ssid\" list=\"redes\" value=\"" + escaparHtml(cfg.ssid) + "\" placeholder=\"Nombre de red Wi-Fi\">";
    html += "<label>Contraseña Wi-Fi</label><input name=\"clave\" type=\"password\" value=\"" + escaparHtml(cfg.clave) + "\" placeholder=\"Clave Wi-Fi\">";
    html += "<label>Servidor / Host</label><input id=\"inHost\" name=\"host\" value=\"" + escaparHtml(cfg.host) + "\" placeholder=\"ej. chummy-conductor-wilt.ngrok-free.dev/teleco\">";
    html += "<label>Puerto (dejar vacio para Ngrok / 443)</label><input id=\"inPuerto\" name=\"puerto\" value=\"" + escaparHtml(cfg.puerto) + "\" placeholder=\"vacio o 3001\">";
    html += "<label>Identificador del Camion</label><input name=\"disp\" value=\"" + escaparHtml(cfg.dispositivo) + "\">";
    html += "<label>ID Puente Celular (GPS APK)</label><input name=\"puente\" value=\"" + escaparHtml(cfg.puente) + "\">";
    html += "<button type=\"submit\" class=\"submit\">Guardar y Conectar</button></form></div></body></html>";
    servidor.send(200, "text/html; charset=utf-8", html);
}

void aplicarConfiguracionDesdeArgumentos(const String& ssid, const String& clave, const String& host,
                                         const String& puerto, const String& disp, const String& puente) {
    if (ssid.length() > 0) cfg.ssid = ssid;
    if (clave.length() > 0 || ssid.length() > 0) cfg.clave = clave;
    if (host.length() > 0) cfg.host = host;
    cfg.puerto = puerto;
    if (disp.length() > 0) cfg.dispositivo = disp;
    if (puente.length() > 0) cfg.puente = puente;

    cfg.host.trim();
    while (cfg.host.endsWith("/")) cfg.host.remove(cfg.host.length() - 1);
    guardarConfiguracion();
    Serial.println("[CONFIG] Nueva configuración guardada en NVS.");
}

void rutaGuardarFormulario() {
    aplicarConfiguracionDesdeArgumentos(servidor.arg("ssid"), servidor.arg("clave"), servidor.arg("host"),
                                        servidor.arg("puerto"), servidor.arg("disp"), servidor.arg("puente"));
    servidor.send(200, "text/html; charset=utf-8",
                  "<html><body style=\"font-family:sans-serif;background:#09090b;color:#fff;padding:24px;text-align:center\">"
                  "<h2 style=\"color:#22c55e\">&#10003; Configuracion guardada con exito</h2>"
                  "<p>Reiniciando ESP32 para conectar a " + urlBase() + "...</p></body></html>");
    delay(1500);
    ESP.restart();
}

void rutaConfigJson() {
    enviarCabecerasCors();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, servidor.arg("plain"));
    if (error) {
        servidor.send(400, "application/json", "{\"estado\":\"error\",\"mensaje\":\"JSON invalido\"}");
        return;
    }
    aplicarConfiguracionDesdeArgumentos(doc["ssid"] | "", doc["clave"] | "", doc["host"] | "",
                                        doc["puerto"] | "", doc["dispositivo"] | "", doc["puente"] | "");
    servidor.send(200, "application/json", "{\"estado\":\"ok\",\"url\": \"" + urlBase() + "\"}");
    delay(1000);
    ESP.restart();
}

void rutaEstado() {
    enviarCabecerasCors();
    servidor.send(200, "application/json", estadoJson());
}

void rutaOpciones() {
    enviarCabecerasCors();
    servidor.send(204);
}

void iniciarPortal() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(SSID_PORTAL, CLAVE_PORTAL);
    dnsServer.start(PUERTO_DNS, "*", WiFi.softAPIP());

    Serial.printf("[PORTAL] SoftAP activo: '%s' (clave: '%s')\n", SSID_PORTAL, CLAVE_PORTAL);
    Serial.printf("[PORTAL] Abre en tu navegador: http://%s\n", WiFi.softAPIP().toString().c_str());

    servidor.on("/", HTTP_GET, paginaPrincipal);
    servidor.on("/guardar", HTTP_POST, rutaGuardarFormulario);
    servidor.on("/config", HTTP_POST, rutaConfigJson);
    servidor.on("/config", HTTP_OPTIONS, rutaOpciones);
    servidor.on("/estado", HTTP_GET, rutaEstado);

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
    double latitud = -17.3935;
    double longitud = -66.1570;
    float velocidad = 45.0;
    float rumbo = 120.0;
    float altitud = 2570.0;
    float bateria = 90.0;
    String marca = "";

    // 1. Consultar puente GPS si esta configurado
    if (cfg.puente.length() > 0) {
        WiFiClientSecure secureGps;
        WiFiClient plainGps;
        if (https) {
            secureGps.setInsecure();
            secureGps.setTimeout(4000);
        } else {
            plainGps.setTimeout(4000);
        }

        HTTPClient http;
        http.setTimeout(4000);
        String urlGps = urlBase() + "/api/puente/gps?id=" + cfg.puente;
        bool inicioOk = https ? http.begin(secureGps, urlGps) : http.begin(plainGps, urlGps);

        if (inicioOk) {
            http.addHeader("ngrok-skip-browser-warning", "true");
            http.addHeader("User-Agent", "TraceMin-ESP32-S3/1.0");

            int codigo = http.GET();
            if (codigo == 200) {
                String respuesta = http.getString();
                JsonDocument entrada;
                if (!deserializeJson(entrada, respuesta)) {
                    uint32_t edad = entrada["edad_ms"] | 0;
                    if (edad <= EDAD_MAXIMA_GPS_MS) {
                        latitud = entrada["latitud"] | latitud;
                        longitud = entrada["longitud"] | longitud;
                        velocidad = entrada["velocidad"] | velocidad;
                        rumbo = entrada["rumbo"] | rumbo;
                        altitud = entrada["altitud"] | altitud;
                        bateria = entrada["bateria"] | bateria;
                        marca = entrada["timestamp"] | "";
                    }
                }
            } else if (codigo == 404) {
                estadoServidor = "Esperando GPS de APK celular";
            }
            http.end();
        }
        if (https) secureGps.stop();
    }

    if (marca.length() > 0 && marca == ultimoTimestamp) {
        return;
    }
    if (marca.length() > 0) {
        ultimoTimestamp = marca;
    }

    // 2. Preparar paquete de telemetria
    JsonDocument salida;
    salida["dispositivo_id"] = cfg.dispositivo;
    salida["latitud"] = latitud;
    salida["longitud"] = longitud;
    salida["velocidad"] = velocidad;
    salida["rumbo"] = rumbo;
    salida["altitud"] = altitud;
    salida["temperatura"] = temperatureRead();
    salida["voltaje"] = 3.85;
    salida["bateria"] = bateria;
    salida["vibracion"] = 1.1;
    salida["aceleracion_x"] = 0.05;
    salida["aceleracion_y"] = -0.02;
    salida["aceleracion_z"] = 9.81;

    String cuerpo;
    serializeJson(salida, cuerpo);

    // 3. Enviar telemetria con cliente SSL fresco
    WiFiClientSecure secureEnvio;
    WiFiClient plainEnvio;
    if (https) {
        secureEnvio.setInsecure();
        secureEnvio.setTimeout(5000);
    } else {
        plainEnvio.setTimeout(5000);
    }

    HTTPClient envio;
    envio.setTimeout(5000);
    String urlTelemetria = urlBase() + "/api/telemetria";
    bool envioOk = https ? envio.begin(secureEnvio, urlTelemetria) : envio.begin(plainEnvio, urlTelemetria);

    if (!envioOk) {
        estadoServidor = "Fallo al conectar endpoint telemetría";
        if (https) secureEnvio.stop();
        return;
    }

    envio.addHeader("Content-Type", "application/json");
    envio.addHeader("ngrok-skip-browser-warning", "true");
    envio.addHeader("User-Agent", "TraceMin-ESP32-S3/1.0");

    int resultado = envio.POST(cuerpo);
    envio.end();
    if (https) secureEnvio.stop();

    if (resultado == 200) {
        paquetesEnviados++;
        estadoServidor = "Transmitiendo OK (" + String(https ? "HTTPS" : "HTTP") + ")";
        digitalWrite(PIN_LED_ESTADO, HIGH);
        delay(30);
        digitalWrite(PIN_LED_ESTADO, LOW);
        Serial.printf("[TELEMETRIA] Paquete #%u enviado: %s a %s\n", paquetesEnviados, cfg.dispositivo.c_str(), urlTelemetria.c_str());
    } else {
        estadoServidor = "Error al enviar (" + String(resultado) + ")";
        Serial.printf("[ERROR] Respuesta HTTP: %d desde %s\n", resultado, urlTelemetria.c_str());
    }
}

void setup() {
    // Reducir frecuencia de 240MHz a 160MHz para enfriar el chip drásticamente (ahorra 40% de energía)
    setCpuFrequencyMhz(160);

    Serial.begin(115200);
    delay(300);

    pinMode(PIN_BOTON_BOOT, INPUT_PULLUP);
    pinMode(PIN_LED_ESTADO, OUTPUT);
    digitalWrite(PIN_LED_ESTADO, LOW);

    Serial.println("\n==========================================");
    Serial.println("  TRACE-MIN — ESP32 Telemetria Resiliente");
    Serial.println("  Modo Eco / Control Termico Activo");
    Serial.println("==========================================");

    cargarConfiguracion();
    iniciarPortal();

    if (configuracionCompleta()) {
        conectarWifi();
    } else {
        Serial.println("[AVISO] Sin red configurada. Conecta tu movil a 'TRACEMIN-ESP32'.");
    }

#if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT_S * 1000,
        .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
        .trigger_panic = true
    };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
#else
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(NULL);
#endif
    Serial.println("[WDT] Hardware Watchdog iniciado (20s).");
}

void loop() {
    esp_task_wdt_reset();

    dnsServer.processNextRequest();
    servidor.handleClient();

    if (digitalRead(PIN_BOTON_BOOT) == LOW) {
        if (tiempoPresionBoot == 0) {
            tiempoPresionBoot = millis();
        } else if (millis() - tiempoPresionBoot > 3000) {
            Serial.println("[BOOT] Boton presionado 3s: Forzando modo portal...");
            portalForzado = true;
            WiFi.disconnect();
            for (int i = 0; i < 5; i++) {
                digitalWrite(PIN_LED_ESTADO, HIGH); delay(80);
                digitalWrite(PIN_LED_ESTADO, LOW); delay(80);
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
            Serial.printf("[WIFI] Reintentando conexion (backoff %u s)...\n", tiempoReintentoWifiMs / 1000);
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

    // Ceder CPU a FreeRTOS IDLE Task: reduce el uso de CPU de 100% a 2% y enfria el chip
    delay(10);
}
