#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>

static const char* SSID_PORTAL = "TRACEMIN-ESP32";
static const char* CLAVE_PORTAL = "tracemin123";
static const uint32_t INTERVALO_CONSULTA_MS = 1000;
static const uint32_t EDAD_MAXIMA_GPS_MS = 10000;
static const uint32_t REINTENTO_WIFI_MS = 15000;

struct Configuracion {
    String ssid;
    String clave;
    String host;
    String puerto;
    String dispositivo;
    String puente;
};

Preferences memoria;
WebServer servidor(80);
Configuracion cfg;

String ultimoTimestamp = "";
String estadoServidor = "Sin configurar";
uint32_t paquetesEnviados = 0;
uint32_t ultimaConsulta = 0;
uint32_t ultimoIntentoWifi = 0;

void cargarConfiguracion() {
    memoria.begin("tracemin", true);
    cfg.ssid = memoria.getString("ssid", "");
    cfg.clave = memoria.getString("clave", "");
    cfg.host = memoria.getString("host", "");
    cfg.puerto = memoria.getString("puerto", "3001");
    cfg.dispositivo = memoria.getString("disp", "ESP32-Camion-01");
    cfg.puente = memoria.getString("puente", "celular-1");
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
    memoria.end();
}

bool configuracionCompleta() {
    return cfg.ssid.length() > 0 && cfg.host.length() > 0;
}

void conectarWifi() {
    if (cfg.ssid.length() == 0) return;
    WiFi.begin(cfg.ssid.c_str(), cfg.clave.c_str());
    ultimoIntentoWifi = millis();
    Serial.printf("Conectando a la red %s\n", cfg.ssid.c_str());
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
    doc["conectado_wifi"] = WiFi.status() == WL_CONNECTED;
    doc["ip"] = WiFi.localIP().toString();
    doc["ssid"] = cfg.ssid;
    doc["host"] = cfg.host;
    doc["puerto"] = cfg.puerto;
    doc["dispositivo"] = cfg.dispositivo;
    doc["puente"] = cfg.puente;
    doc["estado"] = estadoServidor;
    doc["paquetes"] = paquetesEnviados;
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
    html += "<title>TRACE-MIN ESP32</title><style>";
    html += "body{font-family:system-ui,sans-serif;background:#09090b;color:#fafafa;margin:0;padding:16px}";
    html += ".caja{max-width:420px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:16px;padding:20px}";
    html += "h1{color:#ef4444;font-size:22px;margin:0 0 4px}p{color:#a1a1aa;font-size:13px;margin:0 0 16px}";
    html += "label{display:block;font-size:12px;color:#a1a1aa;margin:12px 0 4px}";
    html += "input{width:100%;box-sizing:border-box;background:#09090b;border:1px solid #3f3f46;border-radius:10px;";
    html += "padding:10px;color:#fff;font-size:15px}button{width:100%;margin-top:20px;background:#dc2626;color:#fff;";
    html += "border:0;border-radius:12px;padding:14px;font-size:15px;font-weight:700}";
    html += ".estado{background:#09090b;border-radius:10px;padding:10px;font-size:12px;font-family:monospace;color:#34d399}";
    html += "</style></head><body><div class=\"caja\"><h1>TRACE-MIN ESP32</h1>";
    html += "<p>Configura la red del hotspot y la direccion del servidor.</p>";
    html += "<div class=\"estado\">WiFi: " + String(WiFi.status() == WL_CONNECTED ? "conectado " + WiFi.localIP().toString() : "sin conexion");
    html += "<br>Servidor: " + escaparHtml(estadoServidor) + "<br>Paquetes: " + String(paquetesEnviados) + "</div>";
    html += "<form method=\"POST\" action=\"/guardar\"><datalist id=\"redes\">" + opciones + "</datalist>";
    html += "<label>WiFi del hotspot (SSID)</label><input name=\"ssid\" list=\"redes\" value=\"" + escaparHtml(cfg.ssid) + "\">";
    html += "<label>Clave del WiFi</label><input name=\"clave\" type=\"password\" value=\"" + escaparHtml(cfg.clave) + "\">";
    html += "<label>IP o host del servidor</label><input name=\"host\" value=\"" + escaparHtml(cfg.host) + "\">";
    html += "<label>Puerto</label><input name=\"puerto\" value=\"" + escaparHtml(cfg.puerto) + "\">";
    html += "<label>ID del vehiculo</label><input name=\"disp\" value=\"" + escaparHtml(cfg.dispositivo) + "\">";
    html += "<label>ID del puente (celular)</label><input name=\"puente\" value=\"" + escaparHtml(cfg.puente) + "\">";
    html += "<button type=\"submit\">Guardar y reiniciar</button></form></div></body></html>";
    servidor.send(200, "text/html; charset=utf-8", html);
}

void aplicarConfiguracionDesdeArgumentos(const String& ssid, const String& clave, const String& host,
                                         const String& puerto, const String& disp, const String& puente) {
    if (ssid.length() > 0) cfg.ssid = ssid;
    if (clave.length() > 0 || ssid.length() > 0) cfg.clave = clave;
    if (host.length() > 0) cfg.host = host;
    if (puerto.length() > 0) cfg.puerto = puerto;
    if (disp.length() > 0) cfg.dispositivo = disp;
    if (puente.length() > 0) cfg.puente = puente;
    cfg.host.trim();
    cfg.host.replace("http://", "");
    cfg.host.replace("https://", "");
    while (cfg.host.endsWith("/")) cfg.host.remove(cfg.host.length() - 1);
    guardarConfiguracion();
}

void rutaGuardarFormulario() {
    aplicarConfiguracionDesdeArgumentos(servidor.arg("ssid"), servidor.arg("clave"), servidor.arg("host"),
                                        servidor.arg("puerto"), servidor.arg("disp"), servidor.arg("puente"));
    servidor.send(200, "text/html; charset=utf-8",
                  "<html><body style=\"font-family:sans-serif;background:#09090b;color:#fff;padding:24px\">"
                  "<h2>Configuracion guardada</h2><p>El ESP32 se reiniciara en 2 segundos.</p></body></html>");
    delay(2000);
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
    servidor.send(200, "application/json", "{\"estado\":\"ok\"}");
    delay(1500);
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
    Serial.printf("Portal activo: red %s clave %s en http://%s\n", SSID_PORTAL, CLAVE_PORTAL,
                  WiFi.softAPIP().toString().c_str());
    servidor.on("/", HTTP_GET, paginaPrincipal);
    servidor.on("/guardar", HTTP_POST, rutaGuardarFormulario);
    servidor.on("/config", HTTP_POST, rutaConfigJson);
    servidor.on("/config", HTTP_OPTIONS, rutaOpciones);
    servidor.on("/estado", HTTP_GET, rutaEstado);
    servidor.onNotFound([]() { servidor.send(404, "text/plain", "No encontrado"); });
    servidor.begin();
}

String urlBase() {
    return "http://" + cfg.host + ":" + cfg.puerto;
}

void consultarYReenviar() {
    if (WiFi.status() != WL_CONNECTED || cfg.host.length() == 0) return;

    HTTPClient http;
    http.setTimeout(4000);
    String urlGps = urlBase() + "/api/puente/gps?id=" + cfg.puente;
    if (!http.begin(urlGps)) {
        estadoServidor = "URL invalida";
        return;
    }

    int codigo = http.GET();
    if (codigo == 404) {
        estadoServidor = "Esperando GPS del celular";
        http.end();
        return;
    }
    if (codigo != 200) {
        estadoServidor = "Servidor sin respuesta (" + String(codigo) + ")";
        http.end();
        return;
    }

    String respuesta = http.getString();
    http.end();

    JsonDocument entrada;
    if (deserializeJson(entrada, respuesta)) {
        estadoServidor = "Respuesta invalida";
        return;
    }

    uint32_t edad = entrada["edad_ms"] | 0;
    if (edad > EDAD_MAXIMA_GPS_MS) {
        estadoServidor = "GPS del celular desactualizado";
        return;
    }

    String marca = entrada["timestamp"] | "";
    if (marca.length() > 0 && marca == ultimoTimestamp) return;
    ultimoTimestamp = marca;

    JsonDocument salida;
    salida["dispositivo_id"] = cfg.dispositivo;
    salida["timestamp"] = marca;
    salida["latitud"] = entrada["latitud"];
    salida["longitud"] = entrada["longitud"];
    const char* campos[] = {"velocidad", "altitud", "rumbo", "bateria", "voltaje", "pitch", "roll",
                            "vibracion", "aceleracion_x", "aceleracion_y", "aceleracion_z"};
    for (const char* campo : campos) {
        if (!entrada[campo].isNull()) salida[campo] = entrada[campo];
    }
    salida["temperatura"] = temperatureRead();

    String cuerpo;
    serializeJson(salida, cuerpo);

    HTTPClient envio;
    envio.setTimeout(4000);
    if (!envio.begin(urlBase() + "/api/telemetria")) {
        estadoServidor = "URL invalida";
        return;
    }
    envio.addHeader("Content-Type", "application/json");
    int resultado = envio.POST(cuerpo);
    envio.end();

    if (resultado == 200) {
        paquetesEnviados++;
        estadoServidor = "Transmitiendo";
        Serial.printf("Paquete %u enviado\n", paquetesEnviados);
    } else {
        estadoServidor = "Error al enviar (" + String(resultado) + ")";
    }
}

void setup() {
    Serial.begin(115200);
    delay(500);
    cargarConfiguracion();
    iniciarPortal();
    if (configuracionCompleta()) {
        conectarWifi();
    } else {
        Serial.println("Sin configurar: conecta tu celular a la red TRACEMIN-ESP32 y abre http://192.168.4.1");
    }
}

void loop() {
    servidor.handleClient();

    uint32_t ahora = millis();

    if (configuracionCompleta() && WiFi.status() != WL_CONNECTED && ahora - ultimoIntentoWifi > REINTENTO_WIFI_MS) {
        WiFi.disconnect();
        conectarWifi();
    }

    if (ahora - ultimaConsulta >= INTERVALO_CONSULTA_MS) {
        ultimaConsulta = ahora;
        if (configuracionCompleta()) consultarYReenviar();
    }
}
