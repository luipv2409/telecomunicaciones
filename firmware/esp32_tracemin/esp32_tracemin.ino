/*
  =============================================================================
  PROYECTO: TRACE-MIN / TELEMETRIA VEHICULAR RESILIENTE
  PLACA:    ESP32-S3 N16R8 (YD-ESP32-S3 USB-C)
  VERSION:  3.0 - NUBE (trace.cybersec7.xyz) + GESTOR MULTI-RED WI-FI
  =============================================================================

  DESCRIPCION DEL SISTEMA:
  1. Sensores Fisicos Montados:
     - Ultrasonico HC-SR04: TRIG = GPIO 6, ECHO = GPIO 7 (VCC a 5V, GND comun)
     - GPS NEO-6M:          RX = GPIO 16, TX = GPIO 17 (Serial1 a 9600 baud)
     - MPU-6050 (Montado):  SDA = GPIO 4, SCL = GPIO 5 (Presencia estetica)
     - LED Estado:          GPIO 2 (parpadeo segun conexion y envios)
     - Boton BOOT:          GPIO 0 (mantener 3 seg = pausar reconexion 5 min)

  2. Puente de Sensores del Celular (GPS + Acelerometro + Giroscopo):
     - El ESP32 consulta al servidor (/api/puente/gps?id=celular-1) o recibe
       directo en http://<IP_ESP32>/api/sensor los datos del smartphone.
     - Empaqueta todo y lo envia via POST /api/telemetria.

  3. Destino por defecto: https://trace.cybersec7.xyz (HTTPS, puerto 443)
     publicado por Cloudflare Tunnel en japon-server.

  4. GESTOR MULTI-RED WI-FI (NUEVO):
     - Guarda hasta 8 redes Wi-Fi en memoria flash (NVS).
     - Al encender o al perder la conexion, escanea y se conecta sola a la
       red guardada con MEJOR SENAL que este en rango.
     - Portal web intuitivo siempre disponible:
         a) Conectate a la red Wi-Fi "TRACEMIN-ESP32" (clave: tracemin123).
            El celular abrira el portal solo (o entra a http://192.168.4.1).
         b) Si el ESP32 ya tiene internet, tambien puedes abrir
            http://<IP_DEL_ESP32> desde la misma red.
     - Desde el portal: ver redes cercanas con su senal, conectar, guardar
       redes para despues, olvidar redes y cambiar el servidor.
  =============================================================================
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>
#include "portal_html.h"

// =============================================================================
//  CONFIGURACION RAPIDA: MODIFICA AQUI PARA TU ENTORNO
// =============================================================================
#define FIRMWARE_VERSION "3.1-ota"

// Marca embebida en el binario .bin para que el servidor detecte la version sola
extern const char MARCA_BINARIO_OTA[] __attribute__((used)) = "TRACEMIN_FW:" FIRMWARE_VERSION "|";

// Cada vez que cambies CONFIG_VERSION, el ESP32 reemplaza la configuracion del
// SERVIDOR guardada en flash por los valores DEFAULT de abajo (una sola vez).
// Las redes Wi-Fi guardadas NO se borran.
#define CONFIG_VERSION 3

// 'true' = SIEMPRE usar los valores DEFAULT del servidor en cada arranque
// (ignora lo que configures desde el portal). Recomendado: false.
#define FORZAR_CONFIG_POR_DEFECTO false

// Red Wi-Fi inicial que se agrega a la lista de redes guardadas
#define DEFAULT_SSID        "Xiaomi"              // Hotspot de tu celular
#define DEFAULT_CLAVE       "12345678"            // Contrasena del hotspot

// Servidor de telemetria (Cloudflare Tunnel -> japon-server)
#define DEFAULT_HOST        "trace.cybersec7.xyz" // Dominio publico TRACE-MIN
#define DEFAULT_PUERTO      "443"                 // 443 = HTTPS
#define DEFAULT_DISPOSITIVO "Camion-1"            // ID del vehiculo en la BD
#define DEFAULT_PUENTE      "celular-1"           // ID del puente en /simulador

// =============================================================================
//  ASIGNACION DE PINES DE HARDWARE
// =============================================================================
#define PIN_LED_ESTADO 2 // LED indicador de estado
#define PIN_BOTON_BOOT 0 // Boton BOOT

// Sensor Ultrasonico HC-SR04
#define PIN_TRIG 6
#define PIN_ECHO 7

// Sensor GPS NEO-6M (UART Hardware Serial1)
#define PIN_GPS_RX 16 // Conectado al pin TX del modulo NEO-6M
#define PIN_GPS_TX 17 // Conectado al pin RX del modulo NEO-6M
#define GPS_BAUDRATE 9600

// Parametros de Red y Tiempos
#define PUERTO_DNS 53
#define WDT_TIMEOUT_S 30
#define MAX_REDES_GUARDADAS 8
#define MAX_REDES_VISIBLES 25
static const char *SSID_PORTAL = "TRACEMIN-ESP32";
static const char *CLAVE_PORTAL = "tracemin123";
static const uint32_t INTERVALO_CONSULTA_MS = 2000; // Envio cada 2 segundos
static const uint32_t EDAD_MAXIMA_GPS_MS = 60000;
static const uint32_t TIMEOUT_CONEXION_WIFI_MS = 15000;
static const uint32_t ESPERA_MIN_REINTENTO_MS = 10000;
static const uint32_t ESPERA_MAX_REINTENTO_MS = 60000;
static const uint32_t PAUSA_BOTON_BOOT_MS = 300000; // 5 minutos

// Configuracion del servidor guardada en NVS
struct Configuracion {
  String host;
  String puerto;
  String dispositivo;
  String puente;
};

// Red Wi-Fi guardada en NVS
struct RedGuardada {
  String ssid;
  String clave;
};

// Red Wi-Fi detectada en el ultimo escaneo
struct RedVisible {
  String ssid;
  int32_t rssi;
  bool segura;
  uint8_t canal;
};

// Estados del gestor de conexion Wi-Fi
enum EstadoWifi : uint8_t {
  WF_INACTIVO,
  WF_ESCANEANDO,
  WF_INTENTANDO,
  WF_CONECTADO,
  WF_ESPERA
};

// =============================================================================
//  ESTRUCTURA DE DATOS UNIFICADA DE TELEMETRIA
// =============================================================================
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

// Variables Globales
Preferences memoria;     // Namespace "tracemin"  (servidor)
Preferences memoriaWifi; // Namespace "trace_wifi" (redes guardadas)
WebServer servidor(80);
DNSServer dnsServer;
Configuracion cfg;
TelemetriaData telemetria;

HardwareSerial gpsSerial(1);

// Clientes HTTP persistentes (reutilizan la conexion TLS con Cloudflare)
WiFiClientSecure clienteSeguro;
WiFiClient clientePlano;

String ultimoTimestampPuente = "";
String estadoSistema = "Iniciando...";
uint32_t paquetesEnviados = 0;
uint32_t ultimaConsulta = 0;
uint32_t tiempoPresionBoot = 0;

// Estado de actualizacion remota OTA
String sketchMd5Actual = "";
bool otaEnCurso = false;
bool pendienteConfirmarOta = false;
bool solicitudCheckOtaPortal = false;
String ultimoMensajeOta = "Listo para OTA (" FIRMWARE_VERSION ")";
String ultimoMd5Fallido = "";
uint32_t tsUltimoFalloOta = 0;

// Redes guardadas
RedGuardada redesGuardadas[MAX_REDES_GUARDADAS];
uint8_t numGuardadas = 0;

// Resultado del ultimo escaneo
RedVisible redesVisibles[MAX_REDES_VISIBLES];
uint8_t numVisibles = 0;
uint32_t tsUltimoEscaneo = 0;
uint32_t inicioEscaneo = 0;
bool escaneoEnCurso = false;

// Gestor de conexion
EstadoWifi estadoWifi = WF_INACTIVO;
String ssidIntento = "";
String claveIntento = "";
bool intentoManual = false;
bool guardarTrasConectar = false;
uint32_t inicioIntento = 0;
uint32_t proximoIntentoAuto = 0;
uint32_t esperaActualMs = ESPERA_MIN_REINTENTO_MS;
int8_t candidatos[MAX_REDES_GUARDADAS];
uint8_t numCandidatos = 0;
uint8_t idxCandidato = 0;
String ultimoErrorWifi = "";
volatile uint16_t razonDesconexion = 0;
bool pausaAuto = false;
uint32_t pausaAutoHasta = 0;

// Solicitud de conexion manual desde el portal
bool solicitudManual = false;
String ssidManual = "";
String claveManual = "";
bool guardarManualFlag = true;

// Buffer para lectura de NMEA del NEO-6M
String lineaNMEA = "";
bool neoGpsValido = false;
double neoLat = 0.0;
double neoLon = 0.0;
float neoVel = 0.0;

// =============================================================================
//  FUNCIONES DE HARDWARE: ULTRASONICO HC-SR04
// =============================================================================
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

  // Timeout de 25000us (~4.2 metros maximo) para que NUNCA bloquee el loop
  unsigned long duracion = pulseIn(PIN_ECHO, HIGH, 25000);
  if (duracion == 0) {
    return -1.0f; // Fuera de rango o no conectado
  }

  float distancia = (float)duracion * 0.0343f / 2.0f;
  if (distancia < 2.0f || distancia > 400.0f) {
    return -1.0f;
  }
  return distancia;
}

// =============================================================================
//  FUNCIONES DE HARDWARE: GPS NEO-6M (SERIAL1 NO BLOQUEANTE)
// =============================================================================
void iniciarGPS() {
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
}

void procesarNMEA(const String &nmea) {
  // Parsea sentencias basicas $GPRMC o $GNRMC
  if (nmea.startsWith("$GPRMC") || nmea.startsWith("$GNRMC")) {
    int idx = 0;
    int campo = 0;
    String campos[13];
    int start = 0;
    while (idx < (int)nmea.length() && campo < 13) {
      int coma = nmea.indexOf(',', start);
      if (coma == -1) {
        campos[campo++] = nmea.substring(start);
        break;
      }
      campos[campo++] = nmea.substring(start, coma);
      start = coma + 1;
      idx = start;
    }

    // campos[2] es 'A' (valido) o 'V' (sin fix)
    if (campo >= 8 && campos[2] == "A") {
      // Latitud: ddmm.mmmm
      double rawLat = campos[3].toDouble();
      int degLat = (int)(rawLat / 100);
      double minLat = rawLat - (degLat * 100);
      double decLat = degLat + (minLat / 60.0);
      if (campos[4] == "S")
        decLat = -decLat;

      // Longitud: dddmm.mmmm
      double rawLon = campos[5].toDouble();
      int degLon = (int)(rawLon / 100);
      double minLon = rawLon - (degLon * 100);
      double decLon = degLon + (minLon / 60.0);
      if (campos[6] == "W")
        decLon = -decLon;

      // Velocidad en nudos a km/h
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

// =============================================================================
//  REDES WI-FI GUARDADAS (NVS "trace_wifi")
// =============================================================================
void persistirRedes() {
  memoriaWifi.begin("trace_wifi", false);
  memoriaWifi.putUChar("n", numGuardadas);
  for (uint8_t i = 0; i < MAX_REDES_GUARDADAS; i++) {
    String ks = "s" + String(i);
    String kp = "p" + String(i);
    if (i < numGuardadas) {
      memoriaWifi.putString(ks.c_str(), redesGuardadas[i].ssid);
      memoriaWifi.putString(kp.c_str(), redesGuardadas[i].clave);
    } else {
      if (memoriaWifi.isKey(ks.c_str()))
        memoriaWifi.remove(ks.c_str());
      if (memoriaWifi.isKey(kp.c_str()))
        memoriaWifi.remove(kp.c_str());
    }
  }
  memoriaWifi.end();
}

void cargarRedesGuardadas() {
  memoriaWifi.begin("trace_wifi", false);
  uint8_t n = memoriaWifi.getUChar("n", 0);
  if (n > MAX_REDES_GUARDADAS)
    n = MAX_REDES_GUARDADAS;
  numGuardadas = 0;
  for (uint8_t i = 0; i < n; i++) {
    String ks = "s" + String(i);
    String kp = "p" + String(i);
    String s = memoriaWifi.getString(ks.c_str(), "");
    if (s.length() == 0)
      continue;
    redesGuardadas[numGuardadas].ssid = s;
    redesGuardadas[numGuardadas].clave = memoriaWifi.getString(kp.c_str(), "");
    numGuardadas++;
  }
  memoriaWifi.end();
}

int buscarRedGuardada(const String &ssid) {
  for (uint8_t i = 0; i < numGuardadas; i++) {
    if (redesGuardadas[i].ssid == ssid)
      return i;
  }
  return -1;
}

// Guarda (o actualiza) una red. alInicio=true la deja como la mas reciente.
void guardarRed(const String &ssid, const String &clave, bool alInicio = true) {
  if (ssid.length() == 0)
    return;
  int existente = buscarRedGuardada(ssid);
  if (existente >= 0) {
    // Quitarla de su posicion actual
    for (int i = existente; i < numGuardadas - 1; i++)
      redesGuardadas[i] = redesGuardadas[i + 1];
    numGuardadas--;
  }
  if (numGuardadas >= MAX_REDES_GUARDADAS) {
    // Lista llena: se descarta la mas antigua (la ultima)
    numGuardadas = MAX_REDES_GUARDADAS - 1;
  }
  if (alInicio) {
    for (int i = numGuardadas; i > 0; i--)
      redesGuardadas[i] = redesGuardadas[i - 1];
    redesGuardadas[0].ssid = ssid;
    redesGuardadas[0].clave = clave;
  } else {
    redesGuardadas[numGuardadas].ssid = ssid;
    redesGuardadas[numGuardadas].clave = clave;
  }
  numGuardadas++;
  persistirRedes();
  Serial.printf("[WIFI] Red guardada en memoria: '%s' (%u/%u)\n", ssid.c_str(),
                numGuardadas, MAX_REDES_GUARDADAS);
}

void moverRedAlInicio(int idx) {
  if (idx <= 0 || idx >= numGuardadas)
    return;
  RedGuardada r = redesGuardadas[idx];
  for (int i = idx; i > 0; i--)
    redesGuardadas[i] = redesGuardadas[i - 1];
  redesGuardadas[0] = r;
  persistirRedes();
}

bool olvidarRed(const String &ssid) {
  int idx = buscarRedGuardada(ssid);
  if (idx < 0)
    return false;
  for (int i = idx; i < numGuardadas - 1; i++)
    redesGuardadas[i] = redesGuardadas[i + 1];
  numGuardadas--;
  redesGuardadas[numGuardadas].ssid = "";
  redesGuardadas[numGuardadas].clave = "";
  persistirRedes();
  Serial.printf("[WIFI] Red olvidada: '%s'\n", ssid.c_str());
  return true;
}

int buscarRedVisible(const String &ssid) {
  for (uint8_t i = 0; i < numVisibles; i++) {
    if (redesVisibles[i].ssid == ssid)
      return i;
  }
  return -1;
}

// =============================================================================
//  CONFIGURACION DEL SERVIDOR (NVS "tracemin")
// =============================================================================
void guardarConfiguracion() {
  memoria.begin("tracemin", false);
  memoria.putString("host", cfg.host);
  memoria.putString("puerto", cfg.puerto);
  memoria.putString("disp", cfg.dispositivo);
  memoria.putString("puente", cfg.puente);
  memoria.putUChar("ver", CONFIG_VERSION);
  memoria.end();
}

void cargarConfiguracion() {
  cargarRedesGuardadas();

  memoria.begin("tracemin", false);
  uint8_t ver = memoria.getUChar("ver", 0);

  // Migracion: el firmware anterior guardaba una sola red en "ssid"/"clave"
  String ssidAntiguo = "";
  String claveAntigua = "";
  if (memoria.isKey("ssid")) {
    ssidAntiguo = memoria.getString("ssid", "");
    memoria.remove("ssid");
  }
  if (memoria.isKey("clave")) {
    claveAntigua = memoria.getString("clave", "");
    memoria.remove("clave");
  }

  bool reescribir = FORZAR_CONFIG_POR_DEFECTO || ver != CONFIG_VERSION;
  if (reescribir) {
    cfg.host = DEFAULT_HOST;
    cfg.puerto = DEFAULT_PUERTO;
    cfg.dispositivo = DEFAULT_DISPOSITIVO;
    cfg.puente = DEFAULT_PUENTE;
    memoria.putString("host", cfg.host);
    memoria.putString("puerto", cfg.puerto);
    memoria.putString("disp", cfg.dispositivo);
    memoria.putString("puente", cfg.puente);
    memoria.putUChar("ver", CONFIG_VERSION);
    Serial.println("[CONFIG] Servidor actualizado a los valores DEFAULT.");
  } else {
    cfg.host = memoria.getString("host", DEFAULT_HOST);
    cfg.puerto = memoria.getString("puerto", DEFAULT_PUERTO);
    cfg.dispositivo = memoria.getString("disp", DEFAULT_DISPOSITIVO);
    cfg.puente = memoria.getString("puente", DEFAULT_PUENTE);
  }
  memoria.end();

  if (ssidAntiguo.length() > 0 && buscarRedGuardada(ssidAntiguo) < 0) {
    guardarRed(ssidAntiguo, claveAntigua, false);
  }
  if (reescribir && strlen(DEFAULT_SSID) > 0 &&
      buscarRedGuardada(DEFAULT_SSID) < 0) {
    guardarRed(DEFAULT_SSID, DEFAULT_CLAVE, false);
  }

  Serial.printf("[CONFIG ACTIVA] Servidor: %s:%s | Disp: %s | Puente: %s\n",
                cfg.host.c_str(), cfg.puerto.c_str(), cfg.dispositivo.c_str(),
                cfg.puente.c_str());
  Serial.printf("[CONFIG ACTIVA] Redes Wi-Fi guardadas: %u\n", numGuardadas);
  for (uint8_t i = 0; i < numGuardadas; i++) {
    Serial.printf("   %u. %s\n", i + 1, redesGuardadas[i].ssid.c_str());
  }

  // Valores por defecto para la simulacion inercial inicial
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

bool configuracionCompleta() { return cfg.host.length() > 0; }

bool esConexionHttps() {
  String h = cfg.host;
  h.toLowerCase();
  return h.startsWith("https://") || h.indexOf("ngrok") >= 0 ||
         cfg.puerto == "443";
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

void cerrarClientesHttp() {
  clienteSeguro.stop();
  clientePlano.stop();
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

// =============================================================================
//  GESTOR DE CONEXION WI-FI (NO BLOQUEANTE, MULTI-RED)
// =============================================================================
void alEventoWifi(WiFiEvent_t evento, WiFiEventInfo_t info) {
  if (evento == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    uint16_t r = info.wifi_sta_disconnected.reason;
    if (r != 8) { // 8 = ASSOC_LEAVE (desconexion solicitada por nosotros)
      razonDesconexion = r;
    }
  }
}

String describirRazon(uint16_t r) {
  switch (r) {
  case 2:
  case 14:
  case 15:
  case 202:
  case 204:
    return "Contrasena incorrecta";
  case 201:
  case 210:
  case 211:
  case 212:
    return "Red no encontrada o fuera de alcance";
  case 203:
    return "El router rechazo la conexion";
  case 200:
    return "Senal perdida (muy debil)";
  case 205:
    return "Fallo de conexion con el router";
  default:
    return "Error de conexion (codigo " + String(r) + ")";
  }
}

bool iniciarEscaneo() {
  if (escaneoEnCurso)
    return true;
  if (estadoWifi == WF_INTENTANDO)
    return false; // No escanear mientras se negocia una conexion
  WiFi.scanDelete();
  int16_t r = WiFi.scanNetworks(true, false);
  if (r == WIFI_SCAN_FAILED) {
    Serial.println("[WIFI] No se pudo iniciar el escaneo.");
    return false;
  }
  escaneoEnCurso = true;
  inicioEscaneo = millis();
  return true;
}

void revisarEscaneo() {
  if (!escaneoEnCurso)
    return;
  int16_t n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) {
    if (millis() - inicioEscaneo > 15000) {
      WiFi.scanDelete();
      escaneoEnCurso = false;
    }
    return;
  }
  escaneoEnCurso = false;
  if (n < 0)
    return;

  numVisibles = 0;
  for (int i = 0; i < n; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0)
      continue; // Redes ocultas
    int32_t rssi = WiFi.RSSI(i);
    bool segura = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    uint8_t canal = (uint8_t)WiFi.channel(i);

    int existente = buscarRedVisible(s);
    if (existente >= 0) {
      if (rssi > redesVisibles[existente].rssi) {
        redesVisibles[existente].rssi = rssi;
        redesVisibles[existente].canal = canal;
      }
      continue;
    }
    if (numVisibles >= MAX_REDES_VISIBLES) {
      int peor = 0;
      for (int j = 1; j < numVisibles; j++)
        if (redesVisibles[j].rssi < redesVisibles[peor].rssi)
          peor = j;
      if (rssi > redesVisibles[peor].rssi) {
        redesVisibles[peor] = {s, rssi, segura, canal};
      }
      continue;
    }
    redesVisibles[numVisibles++] = {s, rssi, segura, canal};
  }
  WiFi.scanDelete();

  // Ordenar por senal (mejor primero)
  for (int i = 1; i < numVisibles; i++) {
    RedVisible clave = redesVisibles[i];
    int j = i - 1;
    while (j >= 0 && redesVisibles[j].rssi < clave.rssi) {
      redesVisibles[j + 1] = redesVisibles[j];
      j--;
    }
    redesVisibles[j + 1] = clave;
  }
  tsUltimoEscaneo = millis();
  Serial.printf("[WIFI] Escaneo completo: %u redes visibles.\n", numVisibles);
}

void construirCandidatos() {
  numCandidatos = 0;
  int32_t rssiCand[MAX_REDES_GUARDADAS];
  for (uint8_t i = 0; i < numGuardadas; i++) {
    int v = buscarRedVisible(redesGuardadas[i].ssid);
    if (v < 0)
      continue;
    // Insercion ordenada por RSSI descendente
    int pos = numCandidatos;
    while (pos > 0 && rssiCand[pos - 1] < redesVisibles[v].rssi) {
      candidatos[pos] = candidatos[pos - 1];
      rssiCand[pos] = rssiCand[pos - 1];
      pos--;
    }
    candidatos[pos] = i;
    rssiCand[pos] = redesVisibles[v].rssi;
    numCandidatos++;
  }
}

void iniciarIntento(const String &ssid, const String &clave, bool manual,
                    bool guardar) {
  WiFi.disconnect(false);
  delay(50);
  razonDesconexion = 0;
  ssidIntento = ssid;
  claveIntento = clave;
  intentoManual = manual;
  guardarTrasConectar = guardar;
  if (manual)
    ultimoErrorWifi = "";
  if (clave.length() > 0) {
    WiFi.begin(ssid.c_str(), clave.c_str());
  } else {
    WiFi.begin(ssid.c_str());
  }
  inicioIntento = millis();
  estadoWifi = WF_INTENTANDO;
  estadoSistema = "Conectando a '" + ssid + "'...";
  Serial.printf("[WIFI] Conectando a '%s'%s...\n", ssid.c_str(),
                manual ? " (solicitado desde el portal)" : "");
}

void programarEspera() {
  estadoWifi = WF_ESPERA;
  uint32_t espera = esperaActualMs;
  // Si alguien esta usando el portal, escanear menos seguido para no molestar
  if (WiFi.softAPgetStationNum() > 0 && espera < 30000)
    espera = 30000;
  proximoIntentoAuto = millis() + espera;
  esperaActualMs *= 2;
  if (esperaActualMs > ESPERA_MAX_REINTENTO_MS)
    esperaActualMs = ESPERA_MAX_REINTENTO_MS;
}

void siguienteCandidatoOEspera() {
  idxCandidato++;
  if (idxCandidato < numCandidatos) {
    int i = candidatos[idxCandidato];
    iniciarIntento(redesGuardadas[i].ssid, redesGuardadas[i].clave, false,
                   false);
    return;
  }
  programarEspera();
}

void gestionarWifi() {
  revisarEscaneo();
  uint32_t ahora = millis();

  // 1. Solicitud manual desde el portal (prioridad maxima)
  if (solicitudManual) {
    solicitudManual = false;
    pausaAuto = false;
    iniciarIntento(ssidManual, claveManual, true, guardarManualFlag);
    return;
  }

  wl_status_t st = WiFi.status();

  // 2. Conexion establecida
  bool conectadoValido = (st == WL_CONNECTED);
  if (conectadoValido && estadoWifi == WF_INTENTANDO &&
      (ahora - inicioIntento < 800 || WiFi.SSID() != ssidIntento)) {
    conectadoValido = false; // Aun reporta la red anterior
  }
  if (conectadoValido) {
    if (estadoWifi != WF_CONECTADO) {
      String ssidActual = WiFi.SSID();
      estadoWifi = WF_CONECTADO;
      ultimoErrorWifi = "";
      esperaActualMs = ESPERA_MIN_REINTENTO_MS;
      if (intentoManual && guardarTrasConectar) {
        guardarRed(ssidActual, claveIntento, true);
      } else {
        int i = buscarRedGuardada(ssidActual);
        if (i > 0)
          moverRedAlInicio(i);
      }
      intentoManual = false;
      cerrarClientesHttp();
      estadoSistema = "Conectado a internet via '" + ssidActual + "'";
      Serial.printf("[WIFI OK] Conectado a '%s' | IP: %s | Senal: %d dBm\n",
                    ssidActual.c_str(), WiFi.localIP().toString().c_str(),
                    (int)WiFi.RSSI());
    }
    return;
  }

  // 3. Se perdio la conexion
  if (estadoWifi == WF_CONECTADO) {
    estadoWifi = WF_INACTIVO;
    cerrarClientesHttp();
    estadoSistema = "Conexion perdida, buscando redes guardadas...";
    Serial.println("[WIFI] Conexion perdida. Buscando redes guardadas...");
  }

  switch (estadoWifi) {
  case WF_INACTIVO:
    if (numGuardadas == 0)
      return; // Esperando que el usuario configure una red en el portal
    if (pausaAuto) {
      if ((int32_t)(ahora - pausaAutoHasta) < 0)
        return;
      pausaAuto = false;
    }
    if (iniciarEscaneo()) {
      estadoWifi = WF_ESCANEANDO;
    } else {
      programarEspera();
    }
    return;

  case WF_ESCANEANDO:
    if (escaneoEnCurso)
      return;
    construirCandidatos();
    if (numCandidatos == 0) {
      ultimoErrorWifi = "Ninguna red guardada esta en rango";
      programarEspera();
      return;
    }
    idxCandidato = 0;
    iniciarIntento(redesGuardadas[candidatos[0]].ssid,
                   redesGuardadas[candidatos[0]].clave, false, false);
    return;

  case WF_INTENTANDO: {
    uint32_t t = ahora - inicioIntento;
    bool fallo = false;
    if (t > TIMEOUT_CONEXION_WIFI_MS)
      fallo = true;
    else if (t > 2500 && razonDesconexion != 0)
      fallo = true;
    else if (t > 2500 && (st == WL_CONNECT_FAILED || st == WL_NO_SSID_AVAIL))
      fallo = true;
    if (!fallo)
      return;

    String motivo;
    if (razonDesconexion != 0)
      motivo = describirRazon(razonDesconexion);
    else if (st == WL_NO_SSID_AVAIL)
      motivo = "Red no encontrada o fuera de alcance";
    else
      motivo = "Tiempo de espera agotado";
    ultimoErrorWifi = "No se pudo conectar a '" + ssidIntento + "': " + motivo;
    Serial.printf("[WIFI] %s\n", ultimoErrorWifi.c_str());
    WiFi.disconnect(false);

    if (intentoManual) {
      // Volver al modo automatico (reconecta a las redes guardadas)
      intentoManual = false;
      estadoWifi = WF_INACTIVO;
      return;
    }
    siguienteCandidatoOEspera();
    return;
  }

  case WF_ESPERA:
    if ((int32_t)(ahora - proximoIntentoAuto) >= 0)
      estadoWifi = WF_INACTIVO;
    return;

  default:
    return;
  }
}

// =============================================================================
//  WEB SERVER: API JSON DEL PORTAL
// =============================================================================
void enviarCabecerasCors() {
  servidor.sendHeader("Access-Control-Allow-Origin", "*");
  servidor.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  servidor.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void responderJson(int codigo, JsonDocument &doc) {
  enviarCabecerasCors();
  servidor.sendHeader("Cache-Control", "no-store");
  String salida;
  serializeJson(doc, salida);
  servidor.send(codigo, "application/json", salida);
}

void responderError(int codigo, const String &mensaje) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = mensaje;
  responderJson(codigo, doc);
}

bool leerCuerpoJson(JsonDocument &doc) {
  if (!servidor.hasArg("plain") ||
      deserializeJson(doc, servidor.arg("plain"))) {
    responderError(400, "JSON invalido");
    return false;
  }
  return true;
}

void paginaPortal() {
  servidor.sendHeader("Cache-Control", "no-store");
  servidor.send_P(200, "text/html; charset=utf-8", PAGINA_PORTAL);
}

void rutaApiEstado() {
  JsonDocument doc;
  bool conectado = (estadoWifi == WF_CONECTADO && WiFi.status() == WL_CONNECTED);

  const char *est;
  switch (estadoWifi) {
  case WF_CONECTADO:
    est = "conectado";
    break;
  case WF_INTENTANDO:
    est = "conectando";
    break;
  case WF_ESCANEANDO:
    est = "buscando";
    break;
  case WF_ESPERA:
    est = "espera";
    break;
  default:
    est = (numGuardadas > 0) ? "buscando" : "sin_redes";
    break;
  }
  if (pausaAuto && estadoWifi == WF_INACTIVO)
    est = "pausado";

  JsonObject w = doc["wifi"].to<JsonObject>();
  w["estado"] = est;
  w["ssid"] = conectado ? WiFi.SSID() : String("");
  w["ip"] = conectado ? WiFi.localIP().toString() : String("");
  w["rssi"] = conectado ? (int)WiFi.RSSI() : 0;
  w["intento"] = ssidIntento;
  w["error"] = ultimoErrorWifi;
  int32_t restante = (int32_t)(proximoIntentoAuto - millis());
  w["reintento_s"] =
      (estadoWifi == WF_ESPERA && restante > 0) ? (restante / 1000) : 0;
  w["guardadas"] = numGuardadas;

  JsonObject s = doc["servidor"].to<JsonObject>();
  s["host"] = cfg.host;
  s["puerto"] = cfg.puerto;
  s["url"] = urlBase();
  s["https"] = esConexionHttps();

  doc["dispositivo"] = cfg.dispositivo;
  doc["puente"] = cfg.puente;
  doc["paquetes"] = paquetesEnviados;
  doc["estado_tx"] = estadoSistema;
  doc["temp"] = temperatureRead();
  doc["distancia"] = telemetria.distancia_cm;
  doc["gps_fix"] = neoGpsValido;
  doc["celular"] = telemetria.fuente_celular_activa;

  JsonObject ap = doc["ap"].to<JsonObject>();
  ap["ssid"] = SSID_PORTAL;
  ap["ip"] = WiFi.softAPIP().toString();
  ap["clientes"] = WiFi.softAPgetStationNum();

  doc["uptime_s"] = millis() / 1000;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["sketch_md5"] = sketchMd5Actual;
  doc["ota_msg"] = ultimoMensajeOta;
  responderJson(200, doc);
}

void rutaApiOtaBuscar() {
  if (WiFi.status() != WL_CONNECTED) {
    responderError(400, "El ESP32 necesita estar conectado a internet primero");
    return;
  }
  solicitudCheckOtaPortal = true;
  JsonDocument doc;
  doc["ok"] = true;
  doc["mensaje"] = "Consultando servidor OTA en la nube...";
  responderJson(200, doc);
}

void rutaApiScan() {
  bool nuevo = servidor.hasArg("nuevo") && servidor.arg("nuevo") == "1";
  bool ocupado = false;
  if (!escaneoEnCurso &&
      (nuevo || tsUltimoEscaneo == 0 || millis() - tsUltimoEscaneo > 60000)) {
    if (!iniciarEscaneo())
      ocupado = true;
  }

  JsonDocument doc;
  doc["escaneando"] = escaneoEnCurso;
  doc["ocupado"] = ocupado;
  doc["edad_s"] =
      tsUltimoEscaneo ? (long)((millis() - tsUltimoEscaneo) / 1000) : -1L;
  bool conectado = (WiFi.status() == WL_CONNECTED);
  String actual = conectado ? WiFi.SSID() : String("");
  JsonArray arr = doc["redes"].to<JsonArray>();
  for (uint8_t i = 0; i < numVisibles; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = redesVisibles[i].ssid;
    o["rssi"] = redesVisibles[i].rssi;
    o["seguro"] = redesVisibles[i].segura;
    o["canal"] = redesVisibles[i].canal;
    o["guardada"] = buscarRedGuardada(redesVisibles[i].ssid) >= 0;
    o["conectada"] = conectado && redesVisibles[i].ssid == actual;
  }
  responderJson(200, doc);
}

void rutaApiGuardadas() {
  JsonDocument doc;
  doc["max"] = MAX_REDES_GUARDADAS;
  bool conectado = (WiFi.status() == WL_CONNECTED);
  String actual = conectado ? WiFi.SSID() : String("");
  JsonArray arr = doc["redes"].to<JsonArray>();
  for (uint8_t i = 0; i < numGuardadas; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = redesGuardadas[i].ssid;
    o["tiene_clave"] = redesGuardadas[i].clave.length() > 0;
    o["conectada"] = conectado && redesGuardadas[i].ssid == actual;
    int v = buscarRedVisible(redesGuardadas[i].ssid);
    o["en_rango"] = v >= 0;
    o["rssi"] = v >= 0 ? redesVisibles[v].rssi : 0;
  }
  responderJson(200, doc);
}

bool validarCredenciales(const String &ssid, const String &clave) {
  if (ssid.length() == 0 || ssid.length() > 32) {
    responderError(400, "Nombre de red invalido (1 a 32 caracteres)");
    return false;
  }
  if (clave.length() > 0 && (clave.length() < 8 || clave.length() > 63)) {
    responderError(400, "La contrasena debe tener entre 8 y 63 caracteres");
    return false;
  }
  return true;
}

void rutaApiConectar() {
  JsonDocument entrada;
  if (!leerCuerpoJson(entrada))
    return;
  String ssid = entrada["ssid"] | "";
  String clave = entrada["clave"] | "";
  bool guardar = entrada["guardar"] | true;
  bool usarGuardada = entrada["usar_guardada"] | false;

  if (usarGuardada) {
    int i = buscarRedGuardada(ssid);
    if (i < 0) {
      responderError(404, "Esa red no esta guardada");
      return;
    }
    clave = redesGuardadas[i].clave;
  }
  if (!validarCredenciales(ssid, clave))
    return;

  ssidManual = ssid;
  claveManual = clave;
  guardarManualFlag = guardar;
  solicitudManual = true;

  JsonDocument doc;
  doc["ok"] = true;
  doc["mensaje"] = "Conectando a " + ssid;
  responderJson(200, doc);
}

void rutaApiGuardarRed() {
  JsonDocument entrada;
  if (!leerCuerpoJson(entrada))
    return;
  String ssid = entrada["ssid"] | "";
  String clave = entrada["clave"] | "";
  if (!validarCredenciales(ssid, clave))
    return;
  guardarRed(ssid, clave, true);

  // Si estaba esperando sin redes en rango, reintentar enseguida
  if (estadoWifi == WF_ESPERA || estadoWifi == WF_INACTIVO) {
    estadoWifi = WF_INACTIVO;
    esperaActualMs = ESPERA_MIN_REINTENTO_MS;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["guardadas"] = numGuardadas;
  responderJson(200, doc);
}

void rutaApiOlvidar() {
  JsonDocument entrada;
  if (!leerCuerpoJson(entrada))
    return;
  String ssid = entrada["ssid"] | "";
  if (!olvidarRed(ssid)) {
    responderError(404, "Esa red no esta guardada");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["guardadas"] = numGuardadas;
  responderJson(200, doc);
}

void rutaApiServidor() {
  JsonDocument entrada;
  if (!leerCuerpoJson(entrada))
    return;
  String host = entrada["host"] | "";
  String puerto = entrada["puerto"] | "";
  String disp = entrada["disp"] | "";
  String puente = entrada["puente"] | "";

  host.trim();
  puerto.trim();
  disp.trim();
  puente.trim();
  while (host.endsWith("/"))
    host.remove(host.length() - 1);
  if (host.length() == 0) {
    responderError(400, "El servidor no puede estar vacio");
    return;
  }
  if (puerto.length() == 0 && host.startsWith("https://"))
    puerto = "443";

  cfg.host = host;
  cfg.puerto = puerto;
  if (disp.length() > 0)
    cfg.dispositivo = disp;
  cfg.puente = puente; // Vacio = no consultar el puente del celular
  guardarConfiguracion();
  cerrarClientesHttp();
  Serial.printf("[CONFIG] Nuevo servidor: %s\n", urlBase().c_str());

  JsonDocument doc;
  doc["ok"] = true;
  doc["url"] = urlBase();
  responderJson(200, doc);
}

// Pagina web servida directamente por el ESP32 para transmision directa
// desde el celular
void paginaSensorCelular() {
  enviarCabecerasCors();
  String html = F(
      "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>Puente Celular &rarr; ESP32</title>"
      "<style>"
      "body{background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;"
      "margin:0;padding:20px;text-align:center}"
      ".card{max-width:400px;margin:0 auto;background:#18181b;border:1px solid "
      "#27272a;border-radius:16px;padding:20px;box-shadow:0 10px 25px "
      "rgba(0,0,0,0.5)}"
      "h1{color:#ef4444;font-size:20px;margin-bottom:8px}"
      "p{color:#a1a1aa;font-size:12px;margin-bottom:16px}"
      ".btn{display:block;width:100%;box-sizing:border-box;background:#22c55e;"
      "color:#000;font-weight:700;padding:14px;border:none;border-radius:12px;"
      "cursor:pointer;font-size:15px;margin-top:10px}"
      ".btn-stop{background:#ef4444;color:#fff}"
      ".box{background:#000;border:1px solid "
      "#27272a;border-radius:10px;padding:12px;margin-top:12px;font-family:"
      "monospace;font-size:11px;text-align:left;color:#38bdf8;line-height:1.6}"
      "a{color:#38bdf8;font-size:12px;display:block;margin-top:14px}"
      "</style></head><body><div class='card'>"
      "<h1>&#128241; Transmisor Sensor Celular</h1>"
      "<p>Transmite el GPS, giroscopio y acelerometro de tu smartphone "
      "directamente al ESP32.</p>"
      "<button id='btnTx' class='btn' onclick='toggleTransmision()'>&#9654; "
      "INICIAR TRANSMISION</button>"
      "<div class='box' id='log'>Estado: En espera de inicio...</div>"
      "<a href='/'>&larr; Volver a la configuracion</a>"
      "</div>"
      "<script>"
      "let activo=false,watchId=null,intervalo=null;"
      "let "
      "s={lat:0,lon:0,vel:0,alt:0,rumbo:0,ax:0,ay:0,az:9.8,vib:1.0,pitch:0,"
      "roll:0};"
      "function log(txt){document.getElementById('log').innerHTML=txt;}"
      "async function toggleTransmision(){"
      "  activo=!activo;"
      "  const b=document.getElementById('btnTx');"
      "  if(activo){"
      "    b.textContent='\u25A0 DETENER TRANSMISION'; b.className='btn "
      "btn-stop';"
      "    if(typeof DeviceMotionEvent!=='undefined'&&typeof "
      "DeviceMotionEvent.requestPermission==='function'){"
      "      try{await DeviceMotionEvent.requestPermission();}catch(e){}"
      "    }"
      "    if(typeof DeviceOrientationEvent!=='undefined'&&typeof "
      "DeviceOrientationEvent.requestPermission==='function'){"
      "      try{await DeviceOrientationEvent.requestPermission();}catch(e){}"
      "    }"
      "    window.addEventListener('devicemotion',e=>{"
      "      const a=e.accelerationIncludingGravity||e.acceleration;"
      "      "
      "if(a){s.ax=parseFloat((a.x||0).toFixed(2));s.ay=parseFloat((a.y||0)."
      "toFixed(2));s.az=parseFloat((a.z||0).toFixed(2));"
      "      "
      "s.vib=parseFloat((Math.sqrt(s.ax*s.ax+s.ay*s.ay+s.az*s.az)/"
      "9.81).toFixed(2));}"
      "    });"
      "    window.addEventListener('deviceorientation',e=>{"
      "      if(e.beta!==null) s.pitch=parseFloat(e.beta.toFixed(1));"
      "      if(e.gamma!==null) s.roll=parseFloat(e.gamma.toFixed(1));"
      "      if(e.alpha!==null) s.rumbo=parseFloat(e.alpha.toFixed(1));"
      "    });"
      "    if(navigator.geolocation){"
      "      watchId=navigator.geolocation.watchPosition(p=>{"
      "        s.lat=p.coords.latitude; s.lon=p.coords.longitude;"
      "        "
      "s.vel=p.coords.speed?parseFloat((p.coords.speed*3.6).toFixed(1)):0;"
      "        "
      "s.alt=p.coords.altitude?parseFloat(p.coords.altitude.toFixed(1)):2570;"
      "      },err=>console.warn(err),{enableHighAccuracy:true});"
      "    }"
      "    intervalo=setInterval(enviar,1000);"
      "    log('Transmitiendo sensores cada 1s al ESP32...');"
      "  }else{"
      "    b.textContent='\u25B6 INICIAR TRANSMISION'; b.className='btn';"
      "    if(watchId) navigator.geolocation.clearWatch(watchId);"
      "    if(intervalo) clearInterval(intervalo);"
      "    log('Transmision detenida.');"
      "  }"
      "}"
      "function enviar(){"
      "  fetch('/api/sensor',{"
      "    method:'POST',headers:{'Content-Type':'application/json'},"
      "    "
      "body:JSON.stringify({latitud:s.lat,longitud:s.lon,velocidad:s.vel,"
      "altitud:s.alt,rumbo:s.rumbo,"
      "      "
      "aceleracion_x:s.ax,aceleracion_y:s.ay,aceleracion_z:s.az,vibracion:s."
      "vib,pitch:s.pitch,roll:s.roll})"
      "  }).then(r=>{"
      "    log('GPS: '+s.lat.toFixed(5)+', '+s.lon.toFixed(5)+'<br>'+"
      "        'Pitch: '+s.pitch+'&deg; | Roll: '+s.roll+'&deg;<br>'+"
      "        'Vib: '+s.vib+'G | Envio directo OK');"
      "  }).catch(e=>log('Error envio directo: '+e));"
      "}"
      "</script></body></html>");
  servidor.send(200, "text/html; charset=utf-8", html);
}

// Endpoint directo /api/sensor en el propio ESP32
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

  servidor.send(
      200, "application/json",
      "{\"estado\":\"ok\",\"mensaje\":\"Sensores recibidos en ESP32\"}");
}

void rutaOpciones() {
  enviarCabecerasCors();
  servidor.send(204);
}

void iniciarPortal() {
  WiFi.softAP(SSID_PORTAL, CLAVE_PORTAL);
  dnsServer.start(PUERTO_DNS, "*", WiFi.softAPIP());

  Serial.printf("[PORTAL] Red de configuracion: '%s' (clave: '%s')\n",
                SSID_PORTAL, CLAVE_PORTAL);
  Serial.printf("[PORTAL] Abre en tu navegador: http://%s\n",
                WiFi.softAPIP().toString().c_str());

  servidor.on("/", HTTP_GET, paginaPortal);
  servidor.on("/api/estado", HTTP_GET, rutaApiEstado);
  servidor.on("/estado", HTTP_GET, rutaApiEstado); // Compatibilidad
  servidor.on("/api/scan", HTTP_GET, rutaApiScan);
  servidor.on("/api/wifi/guardadas", HTTP_GET, rutaApiGuardadas);
  servidor.on("/api/wifi/conectar", HTTP_POST, rutaApiConectar);
  servidor.on("/api/wifi/guardar", HTTP_POST, rutaApiGuardarRed);
  servidor.on("/api/wifi/olvidar", HTTP_POST, rutaApiOlvidar);
  servidor.on("/api/servidor", HTTP_POST, rutaApiServidor);
  servidor.on("/api/ota/buscar", HTTP_POST, rutaApiOtaBuscar);
  servidor.on("/sensor", HTTP_GET, paginaSensorCelular);
  servidor.on("/api/sensor", HTTP_POST, rutaApiSensorDirecto);
  servidor.on("/api/sensor", HTTP_OPTIONS, rutaOpciones);

  // Portal cautivo: cualquier otra URL redirige al panel
  servidor.onNotFound([]() {
    String host = servidor.hostHeader();
    String ipAp = WiFi.softAPIP().toString();
    String ipSta = WiFi.localIP().toString();
    if (host != ipAp && host != ipSta) {
      servidor.sendHeader("Location", String("http://") + ipAp + "/", true);
      servidor.send(302, "text/plain", "");
      return;
    }
    servidor.send(404, "text/plain", "No encontrado");
  });

  servidor.begin();
}

// =============================================================================
//  MOTOR DE ACTUALIZACION REMOTA DE FIRMWARE (HTTPS OTA)
// =============================================================================
bool iniciarHttp(HTTPClient &http, const String &url, bool https) {
  http.setReuse(true); // Mantener viva la conexion TLS entre envios
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  bool ok = https ? http.begin(clienteSeguro, url)
                  : http.begin(clientePlano, url);
  if (ok) {
    http.addHeader("ngrok-skip-browser-warning", "true");
    http.addHeader("User-Agent", "TraceMin-ESP32S3/" FIRMWARE_VERSION);
  }
  return ok;
}

void reportarEstadoOta(const char *estado, int progreso, const String &mensaje) {
  ultimoMensajeOta = mensaje;
  if (WiFi.status() != WL_CONNECTED || cfg.host.length() == 0)
    return;

  bool https = esConexionHttps();
  WiFiClientSecure tlsRep;
  WiFiClient tcpRep;
  if (https) {
    tlsRep.setInsecure();
    tlsRep.setHandshakeTimeout(8);
  }
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  String url = urlBase() + "/api/ota/reporte";
  if (https ? http.begin(tlsRep, url) : http.begin(tcpRep, url)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "TraceMin-ESP32S3/" FIRMWARE_VERSION);
    JsonDocument doc;
    doc["dispositivo_id"] = cfg.dispositivo;
    doc["estado"] = estado;
    doc["progreso"] = progreso;
    doc["mensaje"] = mensaje;
    doc["version"] = FIRMWARE_VERSION;
    doc["md5"] = sketchMd5Actual;
    String cuerpo;
    serializeJson(doc, cuerpo);
    http.POST(cuerpo);
    http.end();
  }
}

bool ejecutarActualizacionOta(const String &rutaUrl, const String &nuevaVersion,
                              const String &md5Esperado, bool forzar) {
  if (otaEnCurso || WiFi.status() != WL_CONNECTED || cfg.host.length() == 0)
    return false;

  if (!forzar && md5Esperado.length() == 32 &&
      sketchMd5Actual.equalsIgnoreCase(md5Esperado)) {
    ultimoMensajeOta = "Ya tiene instalado este binario (MD5 identico)";
    return false;
  }

  if (!forzar && md5Esperado.length() > 0 && md5Esperado == ultimoMd5Fallido &&
      (millis() - tsUltimoFalloOta < 300000UL)) {
    return false;
  }

  otaEnCurso = true;
  estadoSistema = "Actualizando firmware OTA a v" + nuevaVersion + "...";
  Serial.println("\n=======================================================");
  Serial.printf("[OTA] Iniciando actualizacion remota -> v%s\n",
                nuevaVersion.c_str());
  Serial.printf("[OTA] MD5 esperado: %s\n",
                md5Esperado.length() ? md5Esperado.c_str() : "(sin especificar)");
  Serial.println("=======================================================");

  // Liberar buffers TLS persistentes para disponer del maximo de RAM libre
  cerrarClientesHttp();
  esp_task_wdt_reset();

  reportarEstadoOta("descargando", 10,
                    "Iniciando descarga en ESP32 (v" + nuevaVersion + ")...");

  String urlCompleta = rutaUrl;
  if (!urlCompleta.startsWith("http://") && !urlCompleta.startsWith("https://")) {
    if (!urlCompleta.startsWith("/"))
      urlCompleta = "/" + urlCompleta;
    urlCompleta = urlBase() + urlCompleta;
  }

  bool https = urlCompleta.startsWith("https://");
  WiFiClientSecure tlsOta;
  WiFiClient tcpOta;
  if (https) {
    tlsOta.setInsecure();
    tlsOta.setHandshakeTimeout(12);
  }

  HTTPClient httpOta;
  httpOta.setConnectTimeout(10000);
  httpOta.setTimeout(20000);
  httpOta.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  const char *cabecerasInteres[] = {"X-MD5", "X-Firmware-Version"};
  httpOta.collectHeaders(cabecerasInteres, 2);

  bool okBegin = https ? httpOta.begin(tlsOta, urlCompleta)
                       : httpOta.begin(tcpOta, urlCompleta);
  if (!okBegin) {
    String msg = "No se pudo abrir conexion a " + urlCompleta;
    Serial.printf("[OTA ERROR] %s\n", msg.c_str());
    reportarEstadoOta("error", 0, msg);
    otaEnCurso = false;
    return false;
  }

  httpOta.addHeader("ngrok-skip-browser-warning", "true");
  httpOta.addHeader("User-Agent", "TraceMin-ESP32S3/" FIRMWARE_VERSION);

  esp_task_wdt_reset();
  int codigo = httpOta.GET();
  if (codigo != 200) {
    String msg = "Servidor OTA respondio HTTP " + String(codigo);
    Serial.printf("[OTA ERROR] %s\n", msg.c_str());
    httpOta.end();
    ultimoMd5Fallido = md5Esperado;
    tsUltimoFalloOta = millis();
    reportarEstadoOta("error", 0, msg);
    otaEnCurso = false;
    return false;
  }

  int totalBytes = httpOta.getSize();
  String md5Final = md5Esperado;
  if (md5Final.length() != 32 && httpOta.hasHeader("X-MD5")) {
    md5Final = httpOta.header("X-MD5");
    md5Final.trim();
  }

  if (totalBytes < 65536 || totalBytes > 3145728) {
    String msg = "Tamano de binario invalido (" + String(totalBytes) + " bytes)";
    Serial.printf("[OTA ERROR] %s\n", msg.c_str());
    httpOta.end();
    ultimoMd5Fallido = md5Final;
    tsUltimoFalloOta = millis();
    reportarEstadoOta("error", 0, msg);
    otaEnCurso = false;
    return false;
  }

  if (!Update.begin((size_t)totalBytes, U_FLASH, PIN_LED_ESTADO, HIGH)) {
    String msg = String("No se pudo iniciar particion OTA: ") + Update.errorString();
    Serial.printf("[OTA ERROR] %s\n", msg.c_str());
    httpOta.end();
    ultimoMd5Fallido = md5Final;
    tsUltimoFalloOta = millis();
    reportarEstadoOta("error", 0, msg);
    otaEnCurso = false;
    return false;
  }

  // IMPORTANTE: setMD5 debe llamarse DESPUES de Update.begin()
  if (md5Final.length() == 32) {
    Update.setMD5(md5Final.c_str());
  }
  Update.onProgress([](size_t progreso, size_t total) {
    (void)progreso;
    (void)total;
    esp_task_wdt_reset();
  });

  WiFiClient *stream = httpOta.getStreamPtr();
  uint8_t buf[2048];
  size_t escritos = 0;
  int ultimoPctLog = 0;
  bool reportadoMitad = false;
  uint32_t ultimoDatoMs = millis();
  uint32_t inicioDescargaMs = millis();
  String errorStream = "";

  while (escritos < (size_t)totalBytes) {
    esp_task_wdt_reset();
    if (millis() - inicioDescargaMs > 180000UL ||
        millis() - ultimoDatoMs > 20000UL) {
      errorStream = "Tiempo de espera agotado descargando el binario";
      break;
    }

    size_t disp = stream->available();
    if (disp > 0) {
      size_t leer = disp > sizeof(buf) ? sizeof(buf) : disp;
      int leidos = stream->readBytes(buf, leer);
      if (leidos > 0) {
        ultimoDatoMs = millis();
        if (Update.write(buf, (size_t)leidos) != (size_t)leidos) {
          errorStream =
              String("Fallo grabando flash: ") + Update.errorString();
          break;
        }
        escritos += (size_t)leidos;
        int pct = (int)((escritos * 100ULL) / (size_t)totalBytes);
        if (pct >= ultimoPctLog + 20) {
          ultimoPctLog = pct;
          Serial.printf("[OTA] Progreso flash: %d%% (%u / %d bytes)\n", pct,
                        (unsigned)escritos, totalBytes);
        }
        if (!reportadoMitad && pct >= 55) {
          reportadoMitad = true;
          estadoSistema = "Grabando flash OTA (" + String(pct) + "%)...";
        }
      }
    } else {
      if (!httpOta.connected() && escritos < (size_t)totalBytes) {
        errorStream = "Conexion interrumpida durante la descarga OTA";
        break;
      }
      delay(5);
    }
  }
  httpOta.end();
  esp_task_wdt_reset();

  if (errorStream.length() > 0) {
    Update.abort();
    Serial.printf("[OTA ERROR] %s\n", errorStream.c_str());
    ultimoMd5Fallido = md5Final;
    tsUltimoFalloOta = millis();
    reportarEstadoOta("error", 0, errorStream);
    estadoSistema = "Error OTA: " + errorStream;
    otaEnCurso = false;
    return false;
  }

  if (!Update.end(true) || !Update.isFinished()) {
    String msg =
        String("Verificacion MD5/Flash fallida: ") + Update.errorString();
    Update.abort();
    Serial.printf("[OTA ERROR] %s\n", msg.c_str());
    ultimoMd5Fallido = md5Final;
    tsUltimoFalloOta = millis();
    reportarEstadoOta("error", 0, msg);
    estadoSistema = "Error OTA: " + msg;
    otaEnCurso = false;
    return false;
  }

  // Guardar MD5 previo para confirmar el exito en el siguiente arranque
  memoria.begin("tracemin", false);
  memoria.putString("ota_prev", sketchMd5Actual);
  memoria.end();

  Serial.printf("[OTA EXITO] Firmware v%s verificado y grabado! Reiniciando...\n",
                nuevaVersion.c_str());
  reportarEstadoOta("reiniciando", 100,
                    "Flash verificada OK (MD5). Reiniciando ESP32 a v" +
                        nuevaVersion + "...");
  delay(600);
  ESP.restart();
  return true;
}

void verificarOtaDesdePortal() {
  if (WiFi.status() != WL_CONNECTED || cfg.host.length() == 0)
    return;

  bool https = esConexionHttps();
  HTTPClient http;
  String url = urlBase() + "/api/ota/check?dispositivo_id=" + cfg.dispositivo +
               "&version=" + String(FIRMWARE_VERSION) +
               "&md5=" + sketchMd5Actual + "&manual=1";
  if (!iniciarHttp(http, url, https)) {
    ultimoMensajeOta = "No se pudo conectar al servidor OTA";
    return;
  }
  int codigo = http.GET();
  if (codigo == 200) {
    String resp = http.getString();
    http.end();
    JsonDocument doc;
    if (!deserializeJson(doc, resp)) {
      bool disponible = doc["disponible"] | false;
      bool actualizar = doc["actualizar"] | false;
      String ver = doc["version"] | "";
      String md5 = doc["md5"] | "";
      String ruta = doc["url"] | "/api/ota/download";
      if (!disponible) {
        ultimoMensajeOta = "No hay binarios publicados en el servidor";
      } else if (actualizar) {
        ejecutarActualizacionOta(ruta, ver, md5, false);
      } else {
        ultimoMensajeOta = "Ya estas en la ultima version (v" + ver + ")";
      }
    }
  } else {
    if (codigo > 0)
      http.getString();
    http.end();
    ultimoMensajeOta = "Servidor OTA respondio HTTP " + String(codigo);
  }
}

// =============================================================================
//  CONSULTA AL PUENTE CELULAR Y TRANSMISION A LA BASE DE DATOS
// =============================================================================

void consultarYReenviar() {
  if (WiFi.status() != WL_CONNECTED || estadoWifi != WF_CONECTADO ||
      cfg.host.length() == 0)
    return;

  bool https = esConexionHttps();

  // 1. Consultar el puente de datos del celular en el backend
  if (cfg.puente.length() > 0) {
    HTTPClient httpPuente;
    String urlPuente = urlBase() + "/api/puente/gps?id=" + cfg.puente;
    if (iniciarHttp(httpPuente, urlPuente, https)) {
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

            // Lecturas inerciales del acelerometro y giroscopo del smartphone
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
      } else if (codigo > 0) {
        httpPuente.getString(); // Vaciar el cuerpo para reutilizar conexion
        if (codigo == 404)
          estadoSistema = "Esperando celular en /simulador (" + cfg.puente + ")";
      } else {
        cerrarClientesHttp(); // Conexion rota: abrir una nueva la proxima vez
      }
      httpPuente.end();
    }
  }

  esp_task_wdt_reset();

  // 2. Si el GPS NEO-6M tiene fix satelital real, actualizar coordenadas
  if (neoGpsValido) {
    telemetria.latitud = neoLat;
    telemetria.longitud = neoLon;
    telemetria.velocidad = neoVel;
  }

  // 3. Leer distancia del sensor ultrasonico fisico HC-SR04
  float distancia = leerDistanciaUltrasonico();
  telemetria.distancia_cm = distancia;
  if (distancia > 0.0f) {
    telemetria.puerta_abierta = (distancia > 15.0f);
  }

  // 4. Leer temperatura interna real del silicio del ESP32-S3
  telemetria.temperatura = temperatureRead();

  // 5. Construir paquete final de telemetria para la base de datos
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

  // Sensores inerciales (horizonte artificial e inclinometro)
  salida["vibracion"] = telemetria.vibracion;
  salida["pitch"] = telemetria.pitch;
  salida["roll"] = telemetria.roll;
  salida["aceleracion_x"] = telemetria.acel_x;
  salida["aceleracion_y"] = telemetria.acel_y;
  salida["aceleracion_z"] = telemetria.acel_z;

  // Metadatos de version y red para gestion remota OTA
  salida["firmware_version"] = FIRMWARE_VERSION;
  salida["sketch_md5"] = sketchMd5Actual;

  // Sensores adicionales fisicos (Ultrasonico, estado de puerta y red)
  JsonObject extra = salida["sensores_extra"].to<JsonObject>();
  extra["distancia_cm"] =
      (telemetria.distancia_cm > 0.0f) ? telemetria.distancia_cm : 0.0f;
  extra["puerta_abierta"] = telemetria.puerta_abierta;
  extra["gps_hardware"] = neoGpsValido;
  extra["puente_celular"] = telemetria.fuente_celular_activa;
  extra["firmware"] = FIRMWARE_VERSION;
  extra["wifi_ssid"] = WiFi.SSID();
  extra["wifi_rssi"] = (int)WiFi.RSSI();
  extra["ip_local"] = WiFi.localIP().toString();
  extra["uptime_s"] = millis() / 1000;

  String cuerpo;
  serializeJson(salida, cuerpo);

  // 6. Enviar paquete a /api/telemetria
  HTTPClient envio;
  String urlTelemetria = urlBase() + "/api/telemetria";
  if (!iniciarHttp(envio, urlTelemetria, https)) {
    estadoSistema = "Fallo conexion a /api/telemetria";
    cerrarClientesHttp();
    return;
  }
  envio.addHeader("Content-Type", "application/json");

  int resultado = envio.POST(cuerpo);
  String respuestaServidor = "";
  if (resultado > 0)
    respuestaServidor = envio.getString(); // Leer respuesta y mantener conexion viva
  envio.end();

  if (resultado >= 200 && resultado < 300) {
    paquetesEnviados++;
    estadoSistema = "Transmitiendo OK #" + String(paquetesEnviados);
    digitalWrite(PIN_LED_ESTADO, HIGH);
    delay(40);
    digitalWrite(PIN_LED_ESTADO, LOW);
    Serial.printf("[TELEMETRIA #%u] %s | Lat: %.5f, Lon: %.5f | Pitch: %.1f, "
                  "Roll: %.1f | Vib: %.2fG | Dist: %.1fcm\n",
                  paquetesEnviados, cfg.dispositivo.c_str(), telemetria.latitud,
                  telemetria.longitud, telemetria.pitch, telemetria.roll,
                  telemetria.vibracion, telemetria.distancia_cm);

    // Si acaba de arrancar tras una actualizacion OTA exitosa, confirmarlo
    if (pendienteConfirmarOta) {
      pendienteConfirmarOta = false;
      esp_ota_mark_app_valid_cancel_rollback();
      reportarEstadoOta("completado", 100,
                        String("Firmware v") + FIRMWARE_VERSION +
                            " activo y verificado en linea");
    }

    // Revisar si el servidor envio una orden de actualizacion OTA en este latido
    if (respuestaServidor.indexOf("\"ota\"") >= 0) {
      JsonDocument respDoc;
      if (!deserializeJson(respDoc, respuestaServidor)) {
        JsonObject otaObj = respDoc["ota"];
        if (!otaObj.isNull() && (otaObj["actualizar"] | false)) {
          String verNueva = otaObj["version"] | "nueva";
          String md5Nuevo = otaObj["md5"] | "";
          String urlDescarga = otaObj["url"] | "/api/ota/download";
          bool forzarOta = otaObj["forzar"] | false;
          ejecutarActualizacionOta(urlDescarga, verNueva, md5Nuevo, forzarOta);
        }
      }
    }
  } else {
    if (resultado <= 0)
      cerrarClientesHttp();
    estadoSistema = "Error HTTP " + String(resultado);
    Serial.printf("[ERROR] HTTP %d al enviar telemetria a %s\n", resultado,
                  urlTelemetria.c_str());
  }
}

// =============================================================================
//  SETUP Y LOOP PRINCIPAL
// =============================================================================
void setup() {
  // Frecuencia a 160MHz para maxima estabilidad y control termico
  setCpuFrequencyMhz(160);

  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_BOTON_BOOT, INPUT_PULLUP);
  pinMode(PIN_LED_ESTADO, OUTPUT);
  digitalWrite(PIN_LED_ESTADO, LOW);

  iniciarUltrasonico();
  iniciarGPS();

  Serial.println("\n=======================================================");
  Serial.println("  TRACE-MIN - ESP32-S3 Firmware " FIRMWARE_VERSION);
  Serial.println("  Hardware: HC-SR04 (Ultrasonico) + NEO-6M (GPS UART)");
  Serial.println("  Inercial: Puente Celular (Pitch, Roll, Acel, Vib)");
  Serial.println("  Destino : " DEFAULT_HOST " (HTTPS)");
  Serial.println("=======================================================");

  cargarConfiguracion();

  // Calcular MD5 de la particion activa una sola vez y conservar marca en el .bin
  sketchMd5Actual = ESP.getSketchMD5();
  Serial.printf("[OTA] %s | MD5: %s\n", MARCA_BINARIO_OTA,
                sketchMd5Actual.c_str());

  // Comprobar si venimos de completar una actualizacion remota OTA
  memoria.begin("tracemin", false);
  String otaPrevMd5 = memoria.getString("ota_prev", "");
  if (otaPrevMd5.length() > 0) {
    memoria.remove("ota_prev");
    if (sketchMd5Actual.length() > 0 && sketchMd5Actual != otaPrevMd5) {
      pendienteConfirmarOta = true;
      ultimoMensajeOta = "Actualizado con exito a " FIRMWARE_VERSION;
      Serial.println("[OTA] Nuevo firmware arrancado tras actualizacion OTA!");
    }
  }
  memoria.end();

  // Cliente TLS: Cloudflare usa certificados validos; se omite la validacion
  // para no depender de la fecha/hora ni de certificados raiz en el ESP32.
  clienteSeguro.setInsecure();
  clienteSeguro.setHandshakeTimeout(8);

  WiFi.persistent(false);       // Las credenciales las gestiona este firmware
  WiFi.setHostname("tracemin-esp32");
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(false); // La reconexion la hace gestionarWifi()
  WiFi.setSleep(false);         // Portal y envios mas fluidos
  WiFi.onEvent(alEventoWifi);

  iniciarPortal();

  if (numGuardadas == 0) {
    Serial.println("[AVISO] No hay redes guardadas. Conectate a "
                   "'TRACEMIN-ESP32' y abre http://192.168.4.1");
  }

#if ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t wdt_config = {.timeout_ms = WDT_TIMEOUT_S * 1000,
                                      .idle_core_mask =
                                          (1 << portNUM_PROCESSORS) - 1,
                                      .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);
#endif
  Serial.printf("[WDT] Watchdog configurado a %ds.\n", WDT_TIMEOUT_S);
}

void loop() {
  esp_task_wdt_reset();

  dnsServer.processNextRequest();
  servidor.handleClient();

  // Procesar tramas serie del GPS de hardware
  revisarGPSHardware();

  // Gestor de conexion multi-red (no bloqueante)
  gestionarWifi();

  // Boton BOOT 3 segundos: pausar reconexion automatica 5 min (modo config)
  if (digitalRead(PIN_BOTON_BOOT) == LOW) {
    if (tiempoPresionBoot == 0) {
      tiempoPresionBoot = millis();
    } else if (millis() - tiempoPresionBoot > 3000) {
      Serial.println("[BOOT] Modo configuracion: reconexion automatica en "
                     "pausa por 5 minutos.");
      pausaAuto = true;
      pausaAutoHasta = millis() + PAUSA_BOTON_BOOT_MS;
      WiFi.disconnect(false);
      estadoWifi = WF_INACTIVO;
      for (int i = 0; i < 6; i++) {
        digitalWrite(PIN_LED_ESTADO, HIGH);
        delay(60);
        digitalWrite(PIN_LED_ESTADO, LOW);
        delay(60);
      }
      tiempoPresionBoot = 0;
    }
  } else {
    tiempoPresionBoot = 0;
  }

  // LED: lento = conectado, rapido = conectando/buscando, medio = sin redes
  if (estadoWifi == WF_CONECTADO) {
    parpadearLed(1000);
  } else if (estadoWifi == WF_INTENTANDO || estadoWifi == WF_ESCANEANDO) {
    parpadearLed(150);
  } else {
    parpadearLed(500);
  }

  // Solicitud manual de revision OTA desde el portal local (192.168.4.1)
  if (solicitudCheckOtaPortal) {
    solicitudCheckOtaPortal = false;
    verificarOtaDesdePortal();
  }

  // Ciclo de telemetria cada INTERVALO_CONSULTA_MS
  uint32_t ahora = millis();
  if (ahora - ultimaConsulta >= INTERVALO_CONSULTA_MS) {
    ultimaConsulta = ahora;
    if (configuracionCompleta()) {
      consultarYReenviar();
    }
  }

  delay(5); // Ceder tiempo a tareas de FreeRTOS
}
