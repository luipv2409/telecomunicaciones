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
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

// =============================================================================
//  CONFIGURACION RAPIDA: MODIFICA AQUI PARA TU ENTORNO
// =============================================================================
#define FIRMWARE_VERSION "3.0-nube"

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
//  PORTAL WEB DE CONFIGURACION (HTML + JS SERVIDO DESDE FLASH)
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
 <a class="link" href="/sensor">&#128241; Abrir transmisor directo del celular</a>
 <div id="infoDisp" style="margin-top:8px;line-height:1.6"></div>
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
 $('infoDisp').innerHTML='Camion: <b>'+esc(e.dispositivo)+'</b> \u00b7 Temp ESP32: '+Number(e.temp).toFixed(1)+'\u00b0C \u00b7 Ultrasonico: '+(e.distancia>0?Number(e.distancia).toFixed(1)+' cm':'\u2014')+' \u00b7 GPS: '+(e.gps_fix?'FIX satelital':'via celular')+'<br>Red de configuracion: <b>'+esc(e.ap.ssid)+'</b> ('+e.ap.ip+') \u00b7 Firmware '+esc(e.firmware);
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

cargarEstado();cargarGuardadas();escanear(false);
setInterval(cargarEstado,2000);
setInterval(cargarGuardadas,8000);
setInterval(()=>{if(!abierta&&!timerScan&&!esperando)escanear(false);},20000);
</script></body></html>)PORTAL";

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
//  CONSULTA AL PUENTE CELULAR Y TRANSMISION A LA BASE DE DATOS
// =============================================================================
bool iniciarHttp(HTTPClient &http, const String &url, bool https) {
  http.setReuse(true); // Mantener viva la conexion TLS entre envios
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  bool ok = https ? http.begin(clienteSeguro, url)
                  : http.begin(clientePlano, url);
  if (ok) {
    http.addHeader("ngrok-skip-browser-warning", "true");
    http.addHeader("User-Agent", "TraceMin-ESP32S3/3.0");
  }
  return ok;
}

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

  // Sensores adicionales fisicos (Ultrasonico y estado de puerta)
  JsonObject extra = salida["sensores_extra"].to<JsonObject>();
  extra["distancia_cm"] =
      (telemetria.distancia_cm > 0.0f) ? telemetria.distancia_cm : 0.0f;
  extra["puerta_abierta"] = telemetria.puerta_abierta;
  extra["gps_hardware"] = neoGpsValido;
  extra["puente_celular"] = telemetria.fuente_celular_activa;

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
  if (resultado > 0)
    envio.getString(); // Vaciar respuesta para reutilizar la conexion
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
