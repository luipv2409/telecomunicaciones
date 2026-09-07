#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/adc.h"
#include "esp_adc_cal.h"

struct DatosTelemetria {
    int64_t marca_tiempo;
    double latitud;
    double longitud;
    float temperatura;
    float vibracion;
    float voltaje;
};

#define CAPACIDAD_BUFFER 100

class BufferCircular {
private:
    DatosTelemetria buffer[CAPACIDAD_BUFFER];
    size_t cabeza = 0;
    size_t cola = 0;
    bool lleno = false;
public:
    void insertar(const DatosTelemetria& datos) {
        buffer[cabeza] = datos;
        if (lleno) {
            cola = (cola + 1) % CAPACIDAD_BUFFER;
        }
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

void tarea_adquisicion_sensores(void *parametros) {
    inicializar_uart_gnss();
    inicializar_adc();

    uint8_t datos_uart[TAMANO_BUFFER_UART];

    while (1) {
        int longitud = uart_read_bytes(UART_GNSS_NUM, datos_uart, TAMANO_BUFFER_UART - 1, 20 / portTICK_PERIOD_MS);
        if (longitud > 0) {
            datos_uart[longitud] = '\0';
        }

        DatosTelemetria nueva_lectura;
        nueva_lectura.marca_tiempo = xTaskGetTickCount(); 
        nueva_lectura.latitud = -12.0464; 
        nueva_lectura.longitud = -77.0428;
        
        nueva_lectura.temperatura = leer_adc_promediado(CANAL_ADC_TEMP);
        nueva_lectura.vibracion = leer_adc_promediado(CANAL_ADC_VIB);
        nueva_lectura.voltaje = leer_adc_promediado(CANAL_ADC_VOLT);

        buffer_telemetria.insertar(nueva_lectura);

        vTaskDelay(pdMS_TO_TICKS(100));
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
