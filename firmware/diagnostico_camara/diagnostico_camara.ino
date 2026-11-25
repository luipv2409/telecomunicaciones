/*
 * DIAGNOSTICO REAL DE CAMARA - ESP32-S3 CAM (N16R8) + OV5640
 *
 * Que hace:
 *  1. Identifica el sensor por driver (PID) Y por lectura directa de registros (0x300A/0x300B).
 *  2. Prueba cada resolucion de QVGA a QSXGA (5MP): captura 3 fotos por modo.
 *  3. Valida que cada foto sea JPEG completo (cabecera FFD8 y final FFD9).
 *  4. Compara resolucion esperada vs obtenida y mide ms por foto.
 *  5. Da un veredicto final.
 *
 * Sin Wi-Fi, sin servidor web: termina en ~10-15 segundos.
 *
 * Arduino IDE: ESP32S3 Dev Module | PSRAM: OPI PSRAM | Flash 16MB QIO 80MHz | Core 3.x
 * Monitor serie: 115200
 */

#include <Arduino.h>
#include "esp_camera.h"

// ---------------------------------------------------------------------------
// Pinouts (el A ya funciono en tu placa; B y C quedan de respaldo)
// ---------------------------------------------------------------------------
struct PinProfile {
  const char* name;
  int xclk, sda, scl;
  int d0, d1, d2, d3, d4, d5, d6, d7;
  int vsync, href, pclk;
};

const PinProfile profiles[] = {
  {"A) Freenove / ESP32-S3-EYE", 15, 4, 5,   11, 9, 8, 10, 12, 18, 17, 16,   6, 7, 13},
  {"B) ESP32-S3-CAM LCD",        40, 17, 18, 13, 47, 14, 3, 12, 42, 41, 39,  21, 38, 11},
  {"C) Estilo XIAO ESP32S3",     10, 40, 39, 15, 17, 18, 16, 14, 12, 11, 48, 38, 47, 13},
};
const int NUM_PROFILES = sizeof(profiles) / sizeof(profiles[0]);

// ---------------------------------------------------------------------------
// Resoluciones a probar (ancho/alto esperados segun el driver esp32-camera)
// ---------------------------------------------------------------------------
struct Modo {
  framesize_t fs;
  const char* nombre;
  uint16_t w, h;
};

const Modo modos[] = {
  {FRAMESIZE_QVGA,  "QVGA ", 320,  240},
  {FRAMESIZE_VGA,   "VGA  ", 640,  480},
  {FRAMESIZE_SVGA,  "SVGA ", 800,  600},
  {FRAMESIZE_XGA,   "XGA  ", 1024, 768},
  {FRAMESIZE_HD,    "HD   ", 1280, 720},
  {FRAMESIZE_SXGA,  "SXGA ", 1280, 1024},
  {FRAMESIZE_UXGA,  "UXGA ", 1600, 1200},
  {FRAMESIZE_FHD,   "FHD  ", 1920, 1080},
  {FRAMESIZE_QXGA,  "QXGA ", 2048, 1536},
  {FRAMESIZE_QSXGA, "QSXGA", 2560, 1920},   // 5MP real del OV5640
};
const int NUM_MODOS = sizeof(modos) / sizeof(modos[0]);

const int FOTOS_POR_MODO = 3;

struct Resultado {
  bool     probado = false;
  bool     dimOK   = false;
  bool     jpgOK   = false;
  uint16_t w = 0, h = 0;
  uint32_t bytes = 0;
  uint32_t msPorFoto = 0;
  int      fotosOK = 0;
};

esp_err_t iniciarCamara(const PinProfile& p, framesize_t size) {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = p.d0; c.pin_d1 = p.d1; c.pin_d2 = p.d2; c.pin_d3 = p.d3;
  c.pin_d4 = p.d4; c.pin_d5 = p.d5; c.pin_d6 = p.d6; c.pin_d7 = p.d7;
  c.pin_xclk  = p.xclk;
  c.pin_pclk  = p.pclk;
  c.pin_vsync = p.vsync;
  c.pin_href  = p.href;
  c.pin_sccb_sda = p.sda;
  c.pin_sccb_scl = p.scl;
  c.pin_pwdn  = -1;
  c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size   = size;
  c.jpeg_quality = 12;
  c.fb_count     = 1;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  return esp_camera_init(&c);
}

const char* nombreSensor(uint16_t pid) {
  switch (pid) {
    case OV5640_PID: return "OV5640 (5MP)";
    case OV3660_PID: return "OV3660 (3MP)";
    case OV2640_PID: return "OV2640 (2MP)";
    case OV7725_PID: return "OV7725 (VGA)";
    default:         return "DESCONOCIDO";
  }
}

// JPEG valido = empieza con FF D8 y termina con FF D9
bool jpegValido(const camera_fb_t* fb) {
  if (!fb || fb->len < 4) return false;
  return fb->buf[0] == 0xFF && fb->buf[1] == 0xD8 &&
         fb->buf[fb->len - 2] == 0xFF && fb->buf[fb->len - 1] == 0xD9;
}

Resultado probarModo(const PinProfile& p, const Modo& m) {
  Resultado r;
  r.probado = true;

  esp_camera_deinit();
  delay(100);
  if (iniciarCamara(p, m.fs) != ESP_OK) {
    return r;
  }
  delay(200);

  // Descartar 2 fotos: las primeras tras arrancar pueden salir incompletas
  for (int i = 0; i < 2; i++) {
    camera_fb_t* d = esp_camera_fb_get();
    if (d) esp_camera_fb_return(d);
  }

  bool todasJpgOK = true;
  uint32_t t0 = millis();
  for (int i = 0; i < FOTOS_POR_MODO; i++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { todasJpgOK = false; continue; }
    r.fotosOK++;
    r.w = fb->width;
    r.h = fb->height;
    r.bytes = fb->len;
    if (!jpegValido(fb)) todasJpgOK = false;
    esp_camera_fb_return(fb);
  }
  if (r.fotosOK > 0) r.msPorFoto = (millis() - t0) / r.fotosOK;

  r.jpgOK = (r.fotosOK == FOTOS_POR_MODO) && todasJpgOK;
  r.dimOK = (r.w == m.w && r.h == m.h);
  return r;
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("   DIAGNOSTICO REAL DE CAMARA (OV5640)");
  Serial.println("==========================================");

  // --- Requisito: PSRAM ---
  if (!psramFound()) {
    Serial.println("ERROR: PSRAM no detectada.");
    Serial.println("Arduino IDE -> Tools -> PSRAM -> 'OPI PSRAM'");
    return;
  }
  Serial.printf("PSRAM: %u bytes (libre %u)\n", ESP.getPsramSize(), ESP.getFreePsram());

  // --- Paso 1: encontrar el pinout que responde ---
  int perfil = -1;
  for (int i = 0; i < NUM_PROFILES; i++) {
    Serial.printf("\nProbando pinout %s ...\n", profiles[i].name);
    esp_err_t err = iniciarCamara(profiles[i], FRAMESIZE_QVGA);
    if (err == ESP_OK) { perfil = i; Serial.println("  Camara inicializada."); break; }
    Serial.printf("  Fallo 0x%X%s\n", err,
      err == ESP_ERR_NOT_FOUND ? " (sensor no responde)" : "");
    esp_camera_deinit();
  }
  if (perfil < 0) {
    Serial.println("\nNINGUN PINOUT FUNCIONO.");
    Serial.println("Revisa el cable flex y el pinout de tu placa.");
    return;
  }

  // --- Paso 2: identificar el sensor (dos metodos independientes) ---
  sensor_t* s = esp_camera_sensor_get();
  uint16_t pid = s->id.PID;

  Serial.println("\n1. IDENTIFICACION DEL SENSOR");
  Serial.println("------------------------------------------");
  Serial.printf("Pinout usado : %s\n", profiles[perfil].name);
  Serial.printf("PID (driver) : 0x%04X -> %s\n", pid, nombreSensor(pid));

  bool regOK = false;
  if (pid == OV5640_PID || pid == OV3660_PID) {
    int hi = s->get_reg(s, 0x300A, 0xFF);   // Chip ID alto
    int lo = s->get_reg(s, 0x300B, 0xFF);   // Chip ID bajo
    Serial.printf("Registro 0x300A/0x300B (lectura directa SCCB): 0x%02X 0x%02X\n", hi, lo);
    regOK = (hi >= 0 && lo >= 0 && (((hi << 8) | lo) == pid));
    Serial.println(regOK ? "Coincide con el PID del driver: sensor CONFIRMADO."
                         : "NO coincide con el driver: resultado dudoso.");
  } else {
    Serial.println("(Lectura directa de registros solo aplicada a OV5640/OV3660)");
  }

  // --- Paso 3: probar todas las resoluciones ---
  Serial.println("\n2. PRUEBA DE RESOLUCIONES (3 fotos por modo)");
  Serial.println("------------------------------------------");

  Resultado res[NUM_MODOS];
  int idxMaxOK = -1;

  for (int i = 0; i < NUM_MODOS; i++) {
    res[i] = probarModo(profiles[perfil], modos[i]);
    const Resultado& r = res[i];

    const char* estado = (r.fotosOK == 0)       ? "SIN CAPTURA"
                       : (!r.jpgOK)             ? "JPEG CORRUPTO"
                       : (!r.dimOK)             ? "DIMENSION DISTINTA"
                                                : "OK";
    Serial.printf("%s esperado %4ux%-4u | obtenido %4ux%-4u | %6u B | %4lu ms/foto | %s\n",
      modos[i].nombre, modos[i].w, modos[i].h, r.w, r.h,
      (unsigned)r.bytes, (unsigned long)r.msPorFoto, estado);

    if (r.jpgOK && r.dimOK) idxMaxOK = i;
  }

  // --- Paso 4: veredicto ---
  Serial.println("\n3. VEREDICTO");
  Serial.println("------------------------------------------");

  const int idxQSXGA = NUM_MODOS - 1;
  bool llega5MP = res[idxQSXGA].jpgOK && res[idxQSXGA].dimOK;

  Serial.printf("Sensor              : %s\n", nombreSensor(pid));
  if (idxMaxOK >= 0) {
    Serial.printf("Resolucion maxima OK: %s (%ux%u = %.1f MP)\n",
      modos[idxMaxOK].nombre, modos[idxMaxOK].w, modos[idxMaxOK].h,
      modos[idxMaxOK].w * (float)modos[idxMaxOK].h / 1e6f);
  } else {
    Serial.println("Resolucion maxima OK: ninguna");
  }

  if (pid == OV5640_PID && regOK && llega5MP) {
    Serial.println("\n>>> OV5640 REAL Y 5MP FUNCIONAL. El hardware esta bien.");
    Serial.println("    Si antes se veia limitado a HD, el limite era el codigo/ejemplo.");
    if (res[idxQSXGA].msPorFoto > 1500)
      Serial.println("    Aviso: captura lenta; revisa la alimentacion USB.");
  } else if (pid == OV5640_PID && !llega5MP) {
    Serial.println("\n>>> Es OV5640 pero NO completa 5MP incluso con inicio limpio.");
    Serial.println("    Prueba otro cable/puerto USB (o alimenta a 5V externos) y");
    Serial.println("    confirma PSRAM en 'OPI PSRAM'. Si ya lo hiciste, pega esta salida.");
  } else if (pid != OV5640_PID) {
    Serial.println("\n>>> El sensor NO es OV5640. Su maximo es el de ese modelo.");
  }

  Serial.println("\n==========================================");
  Serial.println("             FIN DEL DIAGNOSTICO");
  Serial.println("==========================================");

  esp_camera_deinit();
}

void loop() {}
