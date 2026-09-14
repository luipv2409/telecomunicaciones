#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/adc.h"
#include "esp_adc_cal.h"
#include "esp_spiffs.h"

struct DatosTelemetria {
    int64_t marca_tiempo;
    double latitud;
    double longitud;
    float temperatura;
    float vibracion;
    float voltaje;
};

#define CAPACIDAD_BUFFER 2000

class BufferCircular {
private:
    DatosTelemetria buffer[CAPACIDAD_BUFFER];
    size_t cabeza = 0;
    size_t cola = 0;
    bool lleno = false;
public:
    void insertar(const DatosTelemetria& datos) {
        if (lleno) {
            // Persistencia en caso de buffer lleno (señal caída mucho tiempo)
            FILE* f = fopen("/spiffs/respaldo.bin", "a");
            if (f) {
                fwrite(&buffer[cola], sizeof(DatosTelemetria), 1, f);
                fclose(f);
            }
            cola = (cola + 1) % CAPACIDAD_BUFFER;
        }
        buffer[cabeza] = datos;
        cabeza = (cabeza + 1) % CAPACIDAD_BUFFER;
        lleno = cabeza == cola;
    }

    bool extraer(DatosTelemetria& datos) {
        if (!lleno && cabeza == cola) {
            return false;
        }
        datos = buffer[cola];
        lleno = false;
        cola = (cola + 1) % CAPACIDAD_BUFFER;
        return true;
    }
};

BufferCircular buffer_telemetria;

#define UART_GNSS_NUM UART_NUM_1
#define PIN_TX_GNSS 17
#define PIN_RX_GNSS 16
#define TAMANO_BUFFER_UART 1024

#define CANAL_ADC_TEMP ADC1_CHANNEL_4
#define CANAL_ADC_VIB ADC1_CHANNEL_5
#define CANAL_ADC_VOLT ADC1_CHANNEL_6
#define MUESTRAS_SOBREMUESTREO 64

static esp_adc_cal_characteristics_t caracteristicas_adc;

void inicializar_uart_gnss() {
    uart_config_t config_uart = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 0,
        .source_clk = UART_SCLK_APB,
    };
    uart_param_config(UART_GNSS_NUM, &config_uart);
    uart_set_pin(UART_GNSS_NUM, PIN_TX_GNSS, PIN_RX_GNSS, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    uart_driver_install(UART_GNSS_NUM, TAMANO_BUFFER_UART * 2, 0, 0, NULL, 0);
}

void inicializar_adc() {
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(CANAL_ADC_TEMP, ADC_ATTEN_DB_11);
    adc1_config_channel_atten(CANAL_ADC_VIB, ADC_ATTEN_DB_11);
    adc1_config_channel_atten(CANAL_ADC_VOLT, ADC_ATTEN_DB_11);
    esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 0, &caracteristicas_adc);
}

float leer_adc_promediado(adc1_channel_t canal) {
    uint32_t lectura_acumulada = 0;
    for (int i = 0; i < MUESTRAS_SOBREMUESTREO; i++) {
        lectura_acumulada += adc1_get_raw(canal);
    }
    uint32_t voltaje_mv = esp_adc_cal_raw_to_voltage(lectura_acumulada / MUESTRAS_SOBREMUESTREO, &caracteristicas_adc);
    return (float)voltaje_mv;
}

double calcular_distancia(double lat1, double lon1, double lat2, double lon2) {
    const double R = 6371e3; 
    const double pi = 3.14159265358979323846;
    double phi1 = lat1 * pi / 180.0;
    double phi2 = lat2 * pi / 180.0;
    double delta_phi = (lat2 - lat1) * pi / 180.0;
    double delta_lambda = (lon2 - lon1) * pi / 180.0;

    double a = sin(delta_phi/2) * sin(delta_phi/2) +
               cos(phi1) * cos(phi2) *
               sin(delta_lambda/2) * sin(delta_lambda/2);
    double c = 2 * atan2(sqrt(a), sqrt(1-a));
    return R * c; 
}

void tarea_adquisicion_sensores(void *parametros) {
    inicializar_uart_gnss();
    inicializar_adc();

    uint8_t datos_uart[TAMANO_BUFFER_UART];
    
    double ult_lat = 0.0, ult_lon = 0.0;
    float ult_temp = 0.0;
    int64_t ult_tiempo_envio = 0;

    while (1) {
        int longitud = uart_read_bytes(UART_GNSS_NUM, datos_uart, TAMANO_BUFFER_UART - 1, 20 / portTICK_PERIOD_MS);
        if (longitud > 0) {
            datos_uart[longitud] = '\0';
        }

        DatosTelemetria nueva_lectura;
        nueva_lectura.marca_tiempo = xTaskGetTickCount(); 
        
        // Simulación de movimiento/lectura
        nueva_lectura.latitud = -17.3822 + (esp_random() % 100) * 0.00001; 
        nueva_lectura.longitud = -66.1518 + (esp_random() % 100) * 0.00001;
        
        nueva_lectura.temperatura = leer_adc_promediado(CANAL_ADC_TEMP);
        nueva_lectura.vibracion = leer_adc_promediado(CANAL_ADC_VIB);
        nueva_lectura.voltaje = leer_adc_promediado(CANAL_ADC_VOLT);

        bool enviar = false;
        double distancia = calcular_distancia(ult_lat, ult_lon, nueva_lectura.latitud, nueva_lectura.longitud);
        
        if (distancia > 50.0) enviar = true; // Movimiento > 50m
        if (fabs(nueva_lectura.temperatura - ult_temp) > 2.0) enviar = true; // Delta Temp > 2°C
        if (nueva_lectura.vibracion > 1.5) enviar = true; // Impacto detectado
        if (nueva_lectura.marca_tiempo - ult_tiempo_envio > pdMS_TO_TICKS(300000)) enviar = true; // Heartbeat 5 min

        // Si se cumple alguna condición o es la primera lectura
        if (enviar || ult_tiempo_envio == 0) {
            buffer_telemetria.insertar(nueva_lectura);
            ult_lat = nueva_lectura.latitud;
            ult_lon = nueva_lectura.longitud;
            ult_temp = nueva_lectura.temperatura;
            ult_tiempo_envio = nueva_lectura.marca_tiempo;
        }

        vTaskDelay(pdMS_TO_TICKS(500)); // Muestreo relajado
    }
}

#define UART_MODEM_NUM UART_NUM_2
#define PIN_TX_MODEM 4
#define PIN_RX_MODEM 5
#define TAMANO_BUFFER_MODEM 2048

void inicializar_uart_modem() {
    uart_config_t config_uart = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 0,
        .source_clk = UART_SCLK_APB,
    };
    uart_param_config(UART_MODEM_NUM, &config_uart);
    uart_set_pin(UART_MODEM_NUM, PIN_TX_MODEM, PIN_RX_MODEM, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    uart_driver_install(UART_MODEM_NUM, TAMANO_BUFFER_MODEM * 2, 0, 0, NULL, 0);
}

void enviar_comando_at(const char* comando) {
    uart_write_bytes(UART_MODEM_NUM, comando, strlen(comando));
    uart_write_bytes(UART_MODEM_NUM, "\r\n", 2);
    vTaskDelay(pdMS_TO_TICKS(500));
}

void tarea_transmision_celular(void *parametros) {
    inicializar_uart_modem();
    
    enviar_comando_at("AT");
    enviar_comando_at("AT+CGATT=1");
    enviar_comando_at("AT+CGACT=1,1");
    enviar_comando_at("AT+CMQTTSTART");
    enviar_comando_at("AT+CMQTTACCQ=0,\"cliente_camion_1\"");
    enviar_comando_at("AT+CMQTTCONNECT=0,\"tcp://servidor_telemetria:1883\",60,1");

    while (1) {
        DatosTelemetria lectura;
        if (buffer_telemetria.extraer(lectura)) {
            char carga_util[256];
            snprintf(carga_util, sizeof(carga_util), 
                     "{\"t\":%lld,\"d\":\"camion_1\",\"la\":%f,\"lo\":%f,\"te\":%.2f,\"vi\":%.2f,\"vo\":%.2f}",
                     lectura.marca_tiempo, lectura.latitud, lectura.longitud, 
                     lectura.temperatura, lectura.vibracion, lectura.voltaje);

            char comando_tema[64];
            snprintf(comando_tema, sizeof(comando_tema), "AT+CMQTTTOPIC=0,%d", 10);
            enviar_comando_at(comando_tema);
            enviar_comando_at("telemetria");

            char comando_carga[64];
            snprintf(comando_carga, sizeof(comando_carga), "AT+CMQTTPAYLOAD=0,%d", strlen(carga_util));
            enviar_comando_at(comando_carga);
            enviar_comando_at(carga_util);

            enviar_comando_at("AT+CMQTTPUB=0,1,60");
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

extern "C" void app_main() {
    xTaskCreatePinnedToCore(
        tarea_adquisicion_sensores,
        "tarea_sensores",
        4096,
        NULL,
        5,
        NULL,
        0 
    );
    xTaskCreatePinnedToCore(
        tarea_transmision_celular,
        "tarea_celular",
        4096,
        NULL,
        5,
        NULL,
        1
    );
}
