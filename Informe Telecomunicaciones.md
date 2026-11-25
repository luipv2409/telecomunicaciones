**UNIVERSIDAD LATINOAMERICANA “ULAT”**

**FACULTAD DE CIENCIAS Y TECNOLOGÍA**

**INGENIERÍA DE SISTEMAS**

**![Logo Ulat | PDF](data:image/jpeg;base64...)**

**INFORME DE AVANCE DE PROYECTO**

**TRACE-SECURE TELECOM**

**Aplicación de fundamentos de Telecomunicaciones a un sistema de telemetría para camiones blindados de transporte de valores**

**Asignatura:** Telecomunicaciones

**Semestre:** Octavo Semestre.

**Docente:** Ing. Roberto Carlos Cadima Montaño.

**Estudiante(s):** Paredes Mollo Wilfredo.

Pecho Vallejos Gunar Ludwing.

**Gestión: 2026**

Contenido<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<z

[Resumen ejecutivo 3](#_Toc243555650)

[1. Introducción 4](#_Toc243555651)

[2. Objetivos del avance 4](#_Toc243555652)

[2.1. Objetivo general 4](#_Toc243555653)

[2.2. Objetivos específicos 4](#_Toc243555654)

[3. Fundamentos de Telecomunicaciones 5](#_Toc243555655)

[3.1. Señales eléctricas 5](#_Toc243555656)

[3.2. Teorema de Nyquist 6](#_Toc243555657)

[4. Aplicación del Teorema de Nyquist 7](#_Toc243555658)

[5. Propuesta de señales, ultra-ahorro de energía y adquisición de datos 8](#_Toc243555659)

[6. Redes de comunicaciones para el sistema 10](#_Toc243555660)

[6.1. Infraestructura 10](#_Toc243555661)

[6.2. Topología 10](#_Toc243555662)

[6.3. Red de transporte 10](#_Toc243555663)

[7. Medios de transmisión y antenas 11](#_Toc243555664)

[7.1. Criterios de selección e integración de antenas 12](#_Toc243555665)

[7.2. Antena Wi-Fi/Bluetooth de 2.4 GHz 14](#_Toc243555666)

[7.3. Evaluación y descarte de enlaces celulares (4G/LTE) y LoRa 14](#_Toc243555667)

[7.4. Antena GNSS cerámica tipo patch (Módulo NEO-6M) 14](#_Toc243555668)

[7.5. Configuración recomendada por fases para el prototipo 15](#_Toc243555669)

[8. Arquitectura propuesta de telemetría y recorrido de datos 15](#_Toc243555670)

[8.1. Recorrido extremo a extremo de los datos 16](#_Toc243555671)

[9. Propuesta de hardware, armado electrónico y energía 16](#_Toc243555672)

[Materiales adicionales necesarios para el armado (Guía práctica para conexión en Protoboard) 18](#_Toc243555673)

[9.1. Dispositivos para la transmisión y recepción 19](#_Toc243555674)

[10. Plan inicial de pruebas y validación 20](#_Toc243555675)

[10.1. Validación experimental de antenas, enlaces y ahorro energético 21](#_Toc243555676)

[11. Resultados esperados, viabilidad y limitaciones 21](#_Toc243555677)

[11.1. Evaluación de viabilidad 22](#_Toc243555678)

[11.2. Limitaciones, efectos térmicos y adaptación a prototipo industrial 22](#_Toc243555679)

[12. Conclusiones 25](#_Toc243555680)

[Referencias 25](#_Toc243555681)

# Resumen ejecutivo

Este informe unificado presenta la relación entre los fundamentos de Telecomunicaciones y nuestro proyecto de telemetría vehicular, reenfocado hacia el seguimiento y seguridad de camiones blindados de transporte de valores (tipo Brinks), permitiendo registrar la posición en un mapa de la ciudad en tiempo real, monitorear variables de seguridad física, evaluar la calidad del enlace y generar evidencia para respuesta ante incidentes. Además de señales, muestreo, redes y medios de transmisión, se incorpora la especificación de las antenas y de los dispositivos que permiten transportar la información desde el nodo instalado en el vehículo hasta el servidor y dashboard de monitoreo.

La propuesta técnica se divide en dos etapas. En esta **Fase 1 (Prototipo de Laboratorio)** se utiliza un nodo de adquisición basado en el microcontrolador **ESP32-S3 N16R8**, un sensor acelerómetro y giroscopio **MPU6050** (encargado tanto de detectar movimientos bruscos como de gestionar un estado de ultra-ahorro de energía cuando el camión está apagado), un sensor ultrasónico **HC-SR04** (para supervisar la apertura de puertas o bóveda interior) y un receptor GPS **UBLOX NEO-6M (GY-NEO6MV2)** con antena cerámica tipo patch. Para la comunicación hacia nuestro servidor se emplea la conectividad Wi-Fi de 2.4 GHz integrada en el ESP32-S3, descartando en esta fase el uso de un módulo 4G/LTE debido a su alto costo(pero es recomendable un módulo para una fase implementaria) y descartando tecnologías como LoRa por su bajo ancho de banda para seguimiento continuo en tiempo real. En esta primera fase no se utilizarán baterías: el ESP32-S3 se alimentará mediante su puerto USB-C y los sensores recibirán energía regulada a través de una **fuente de poder Dimax de 12V y 2A** acoplada a un **módulo de fuente para protoboard XD-42 (5V/3.3V)**. Para una futura **Fase 2 (Adaptación a Prototipo Industrial)**, se proyecta el diseño de una placa PCB perforada, el uso del regulador **DC-DC XL4015 (5A 75W)** y la incorporación “teórica” de una batería Li-Ion de respaldo.

Como aplicación directa del Teorema de Nyquist, se mantiene la señal de prueba sin\_ruido como una señal senoidal de 5 Hz muestreada a 40 Hz. Luego de la adquisición, cada lectura se encapsulará con identificación, tiempo, unidad, calidad y secuencia, y viajará por Wi-Fi mediante el protocolo MQTT o HTTP sobre TCP/IP hacia nuestro servidor web para visualizar el camión en tiempo real sobre el mapa de la ciudad. La viabilidad preliminar es favorable para nuestro prototipo académico, y se confirmará con mediciones de cobertura, latencia, pérdida de paquetes, consumo energético y recuperación ante cortes de enlace.

# 1. Introducción

Las telecomunicaciones permiten transportar información desde un punto de medición hasta un punto de supervisión. En un sistema de monitoreo para camiones blindados de transporte de caudales, el problema no consiste únicamente en leer un sensor de movimiento o un GPS, sino en conservar el significado y la integridad del dato durante todo su recorrido: qué unidad blindada lo generó, en qué instante exacto, en qué coordenada de la ciudad, con qué calidad de enlace y si llegó correctamente al centro de control.

Por esta razón, los fundamentos de la materia se aplican de manera gradual. Primero se estudia la señal eléctrica y su frecuencia; después se elige una frecuencia de muestreo adecuada que evite la pérdida de información; a continuación, se implementa una lógica de ahorro energético para que el sistema solo transmita activamente cuando el vehículo entra en operación o sufre una alteración; posteriormente se encapsulan los datos en mensajes digitales; y finalmente se envían por una red de comunicaciones inalámbrica hacia el servidor del mapa en tiempo real. El diseño considera movilidad, cobertura, presupuesto disponible, consumo energético, efectos de la temperatura, latencia, pérdida de paquetes y continuidad ante cortes de enlace.

# 2. Objetivos del avance

## 2.1. Objetivo general

Diseñar la base conceptual y técnica del sistema de telemetría para camiones blindados aplicando los fundamentos de señales, muestreo, redes y medios de transmisión para construir un prototipo funcional con sensores de seguridad (MPU6050 y HC-SR04), microcontrolador ESP32-S3 N16R8, posicionamiento GPS NEO-6M y comunicación inalámbrica Wi-Fi hacia un servidor de monitoreo en tiempo real.

## 2.2. Objetivos específicos

* Explicar la diferencia entre señales analógicas y digitales y relacionarla con la captura de variables físicas de seguridad en el camión blindado.
* Aplicar el Teorema de Nyquist a la señal de prueba sin\_ruido y definir una frecuencia de muestreo verificable para los sensores del proyecto.
* Implementar un mecanismo de ultra-ahorro de energía y seguridad mediante el acelerómetro MPU6050, manteniendo el sistema en reposo cuando el camión está apagado y activando las lecturas ante cualquier vibración.
* Identificar la infraestructura, topología y red de transporte necesarias para llevar la telemetría desde el ESP32-S3 hasta el mapa en tiempo real alojado en nuestro servidor.
* Comparar los medios de transmisión guiados y no guiados, justificando técnica y económicamente el uso de Wi-Fi frente al descarte de módulos 4G/LTE (por presupuesto) y LoRa (por limitaciones de ancho de banda).
* Proponer una arquitectura de hardware y energía dividida por fases: una Fase 1 de laboratorio alimentada por puerto USB-C, fuente Dimax 12V 2A y módulo protoboard XD-42, y una proyección a Fase 2 industrial con regulación XL4015, placa PCB y respaldo teórico de litio.
* Definir pruebas iniciales para evaluar reconstrucción de señal, calidad de enlace, pérdida, latencia, activación por vibración y desempeño de las antenas.

# 3. Fundamentos de Telecomunicaciones

## 3.1. Señales eléctricas

Una señal eléctrica es una variación de una magnitud física, como voltaje o corriente, que representa información. Una señal analógica puede tomar valores continuos en el tiempo, mientras que una señal digital utiliza niveles discretos y se procesa como una secuencia de bits. En nuestro prototipo para camiones blindados, la aceleración e inclinación medidas por el sensor MPU6050 nacen como variaciones físicas continuas que su conversor analógico-digital (ADC) interno de 16 bits transforma en datos digitales enviados por el bus I2C; de igual forma, el sensor ultrasónico HC-SR04 traduce la distancia hacia la puerta de la bóveda en un pulso eléctrico cuya duración es medida digitalmente por el ESP32-S3.

|  |  |
| --- | --- |
| **Concepto** | **Aplicación en el sistema de telemetría blindado** |
| **Onda** | Representación temporal de la variación de una señal medida (vibración del chasis o pulso ultrasónico). |
| **Señal analógica** | Respuesta física continua del acelerómetro antes de su conversión interna o señal de prueba sin\_ruido antes del ADC. |
| **Señal digital** | Muestras cuantificadas de 16 bits (MPU6050) y tramas seriales (GPS NEO-6M) que el ESP32-S3 almacena y transmite. |
| **Frecuencia** | Número de ciclos por segundo; permite seleccionar la velocidad de muestreo de vibraciones y analizar su periodicidad. |
| **Amplitud** | Magnitud instantánea asociada a la fuerza G de un impacto (2g, 4g, 8g, 16g) o al nivel de voltaje lógico (3.3V / 5V). |
| **Ruido** | Perturbación eléctrica o térmica que altera la medición; se debe separar de sin\_ruido para evaluar la reconstrucción. |

## 3.2. Teorema de Nyquist

El Teorema de Nyquist–Shannon establece que una señal continua limitada en banda puede reconstruirse sin pérdida de información a partir de sus muestras si la frecuencia de muestreo es estrictamente mayor que el doble de su máxima frecuencia significativa: (MathWorks, s.f.). Si se muestrea por debajo de este límite aparece el fenómeno de *aliasing*, en el que componentes de frecuencia diferentes aparentan una frecuencia más baja y producen una reconstrucción falsa o incompleta del evento físico (MathWorks, s.f.).

En una implementación real también se debe considerar el filtrado pasa-bajos anti-aliasing antes de la conversión digital para limitar el contenido de alta frecuencia (como el ruido mecánico del motor del camión) que podría plegarse dentro de la banda útil. La frecuencia de muestreo no se elige solo por la velocidad máxima del ESP32-S3: se define a partir de la dinámica del sensor, la rapidez del evento de seguridad que se quiere detectar, la memoria disponible y el ancho de banda de la comunicación Wi-Fi.

# 4. Aplicación del Teorema de Nyquist

La primera práctica de laboratorio utilizará una señal de referencia denominada sin\_ruido. Para hacer visible la reconstrucción sin distorsión, se propone una onda senoidal de frecuencia y amplitud unitaria. La condición mínima teórica sería ; sin embargo, se selecciona para disponer de ocho muestras por cada ciclo completo, reducir el riesgo de error de fase y facilitar la visualización gráfica.

|  |  |  |
| --- | --- | --- |
| **Parámetro** | **Valor inicial** | **Interpretación** |
| **Señal** | sin\_ruido | Señal limpia de referencia para validar el algoritmo de captura. |
| **Frecuencia de la señal ()** | 5 Hz | La señal completa cinco ciclos por segundo. |
| **Frecuencia máxima considerada ()** | 5 Hz | Valor máximo que se desea preservar en la práctica de laboratorio. |
| **Frecuencia de muestreo ()** | 40 Hz | Cumple holgadamente y aporta margen experimental. |
| **Periodo de muestreo ()** | 0,025 s (25 ms) | Tiempo exacto entre dos muestras consecutivas tomadas por el ESP32-S3. |
| **Muestras por ciclo** | 8 | Resolución temporal inicial de la prueba. |

El procedimiento experimental consiste en generar o leer la señal sin\_ruido, aplicar el muestreo periódico mediante un temporizador interno del ESP32-S3 cada 25 ms, almacenar el par de tiempo y amplitud, reconstruir la forma de onda mediante interpolación, comparar la señal original frente a la estimada, y finalmente repetir la prueba con frecuencias de muestreo menores a 10 Hz para demostrar visualmente el efecto del *aliasing*.

En el prototipo enfocado al camión blindado, este mismo principio gobierna la lectura de los sensores reales:

* **Vibración y movimiento (MPU6050):** Si deseamos detectar sacudidas bruscas, impactos en el blindaje o el arranque del motor cuyas componentes útiles de vibración rondan los 20 Hz a 50 Hz, el muestreo configurado en el bus I2C debe superar al menos los 100 Hz (por ejemplo, leyendo el sensor cada 5 ms o 10 ms).
* **Apertura de compartimiento (HC-SR04):** Dado que el movimiento físico de una puerta de bóveda o de un operador dentro de la cabina es un evento mecánico lento (alrededor de 1 Hz a 2 Hz), una frecuencia de muestreo de 5 Hz a 10 Hz es completamente suficiente y evita saturar el microcontrolador.
* **Posicionamiento GPS (NEO-6M):** La posición geográfica del camión en el mapa de la ciudad varía de forma gradual, por lo que una tasa de actualización estándar de 1 Hz (una lectura cada segundo) cumple perfectamente con la necesidad de seguimiento urbano.

# 5. Propuesta de señales, ultra-ahorro de energía y adquisición de datos

El sistema separa el proceso físico de medición del proceso digital de transmisión hacia el servidor. Además, incorpora una **lógica de seguridad y ultra-ahorro de energía gobernada por el acelerómetro MPU6050**:

1. **Estado de Reposo (Camión Apagado):** Cuando el vehículo blindado se encuentra estacionado y apagado, el sistema entra en modo de bajo consumo (*Deep Sleep* / espera activa mínima). Las lecturas constantes de distancia y el envío continuo de datos se suspenden para ahorrar energía y no saturar el servidor con coordenadas repetidas.
2. **Activación por Vibración (Wake-Up):** El sensor MPU6050 permanece vigilando la aceleración en sus 3 ejes. En el instante en que siente una vibración (ya sea por el encendido del motor, un intento de remolque no autorizado o un golpe en la carrocería), dispara una alerta que despierta la rutina principal del ESP32-S3.
3. **Captura y Transmisión Activa:** Una vez activo, el ESP32-S3 solicita las lecturas de los sensores principales (coordenadas del GPS NEO-6M, distancia de seguridad del HC-SR04 e inclinación/impacto del propio MPU6050), les agrega marca de tiempo, identificación y calidad de señal, y las transmite por Wi-Fi hacia el servidor.

|  |  |  |  |
| --- | --- | --- | --- |
| **Variable medida** | **Sensor / Origen** | **Tipo de señal e Interfaz** | **Uso en la telemetría del camión blindado** |
| **Aceleración y Giro (6 ejes)** | MPU6050 | Digital vía bus I2C (ADC interno de 16 bits) | **Disparador del modo de ultra-ahorro de energía** al detectar vibración; detección de choques, volcaduras o inclinación anormal. |
| **Distancia interior / Puerta** | Ultrasonido HC-SR04 | Pulso digital ( pines Trigger y Echo) | Detección de apertura de puertas de la bóveda o presencia dentro del compartimiento de carga (rango de 2 cm a 400 cm). |
| **Posición y Velocidad GNSS** | UBLOX NEO-6M | Digital serial UART; tramas NMEA 0183 | Ubicación en tiempo real del camión en el mapa de la ciudad (latitud, longitud, velocidad y hora UTC). |
| **Calidad del enlace inalámbrico** | Radio Wi-Fi ESP32-S3 | Digital calculada por firmware | Medición de nivel de señal (RSSI), latencia, pérdida de paquetes y número de secuencia para auditar la conexión. |

La información del módulo GPS UBLOX NEO-6M se recibe mediante mensajes bajo el estándar **NMEA 0183** a través del puerto serial UART. En estos mensajes, cada sentencia comienza con el símbolo $, los campos de datos están separados por comas y finalizan con una suma de verificación (*checksum*) para detectar errores de transmisión en el cable. Es importante recalcar que el módulo GPS solo **recibe** la señal de los satélites para calcular su posición, pero no transmite datos hacia nuestro servidor; es el enlace Wi-Fi del ESP32-S3 el que transporta esa coordenada hasta el mapa en tiempo real.

# 6. Redes de comunicaciones para el sistema

## 6.1. Infraestructura

La infraestructura del proyecto está compuesta por el nodo de sensores instalado en el prototipo (MPU6050 y HC-SR04), el microcontrolador **ESP32-S3 N16R8**, el módulo de posicionamiento **UBLOX NEO-6M**, el sistema de alimentación de laboratorio (fuente Dimax 12V 2A + módulo regulador XD-42 + conexión USB-C), el punto de acceso inalámbrico (router Wi-Fi local o zona portátil en el vehículo), la red de transporte IP, el servidor backend y el dashboard web con el mapa de la ciudad en tiempo real.

## 6.2. Topología

Para el prototipo se implementa una topología en **estrella / punto a punto**, en la cual el nodo central (ESP32-S3) concentra las señales de todos los sensores locales mediante buses cableados cortos (I2C, UART y GPIO) y envía la telemetría unificada de forma inalámbrica hacia un único punto de acceso (router o gateway Wi-Fi), el cual encamina los paquetes hacia nuestro servidor central.

## 6.3. Red de transporte

La red de transporte es la encargada de llevar los paquetes de datos desde el punto de acceso Wi-Fi hasta nuestro servidor donde se aloja el mapa. La arquitectura utiliza el protocolo **TCP/IP** empleando mensajería ligera (como MQTT o peticiones HTTP/WebSockets sobre TLS). Cada paquete enviado incluye identificador del camión (source\_id), marca temporal (timestamp), coordenadas (lat, lon), estado de los sensores, nivel de señal (quality) y número de secuencia (sequence) para detectar paquetes perdidos o desordenados y actualizar el ícono del camión blindado sobre el mapa de la ciudad en tiempo real.

# 7. Medios de transmisión y antenas

En telecomunicaciones, los medios se dividen en guiados (cables físicos) y no guiados (radiofrecuencia por el aire). La siguiente tabla resume su evaluación dentro del proyecto:

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Medio de transmisión** | **Tipo** | **Fortalezas** | **Limitaciones** | **Papel en nuestro proyecto** |
| **Cables Jumper / Cobre** | Guiado | Bajo costo, conexión directa en protoboard y nula latencia. | Distancia muy corta (centímetros) y sensible a vibraciones si no se suelda. | Conectar el ESP32-S3 con el MPU6050 (I2C), NEO-6M (UART) y HC-SR04 en la protoboard. |
| **Cable USB-C** | Guiado | Suministra 5V estables y canal de programación/monitoreo serial. | Requiere conexión física a una computadora o adaptador fijo. | Alimentación exclusiva del ESP32-S3 y depuración durante la Fase 1. |
| **Wi-Fi (2.4 GHz)** | No guiado | Integrado gratis en el ESP32-S3, buen ancho de banda y compatibilidad directa con servidores IP. | Cobertura local dependiente de un router o punto de acceso cercano. | **Medio principal seleccionado** para enviar las coordenadas y alertas al servidor del mapa en tiempo real. |
| **Bluetooth / BLE** | No guiado | Integrado en el ESP32-S3 y muy bajo consumo energético. | Alcance muy corto (pocos metros) y no conecta directo a Internet. | Uso auxiliar para diagnóstico cercano desde un teléfono móvil. |
| **Red Celular (4G/LTE)** | No guiado | Cobertura amplia en toda la ciudad y movilidad autónoma. | **Alto costo del módulo hardware** y gasto recurrente en planes de datos (SIM). | **Descartado en Fase 1 por presupuesto**; se reemplaza conectando el ESP32-S3 por Wi-Fi a un hotspot móvil. |
| **RF / LoRaWAN** | No guiado | Largo alcance (kilómetros) y capacidad de operar con SNR negativo. | **Ancho de banda extremadamente bajo** y tiempos de espera entre envíos. | **Descartado técnicamente** porque no soporta el flujo continuo de monitoreo en tiempo real requerido. |

## 7.1. Criterios de selección e integración de antenas

Una antena es el elemento transductor que permite transferir energía electromagnética entre el circuito electrónico y el espacio libre. En nuestro prototipo conviven dos subsistemas de radiofrecuencia que operan en bandas distintas y cumplen funciones diferentes:

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Subsistema** | **Tipo de antena en el prototipo** | **Banda de operación** | **Propósito** | **Regla de integración física** | **Métrica de verificación** |
| **Wi-Fi / Bluetooth (ESP32-S3)** | Antena PCB integrada en la placa | 2.4 GHz (Banda ISM) | Transmitir paquetes IP hacia el router/servidor para mostrar el camión en el mapa. | Dejar libre el extremo de la antena del ESP32-S3; no cubrir con metal ni pegar cables encima. | Nivel RSSI (dBm), latencia en milisegundos y porcentaje de paquetes recibidos. |
| **Receptor GPS (UBLOX NEO-6M)** | Antena cerámica tipo *patch* (conectada por cable corto u.FL) | 1575.42 MHz (Banda L1 GPS) | Recibir las señales desde los satélites para obtener ubicación y hora exacta. | Colocar la cara cerámica mirando hacia el cielo; en un camión blindado real debe ir fuera del blindaje metálico. | Tiempo de enganche (*Fix*), cantidad de satélites visibles y precisión (HDOP). |

## 7.2. Antena Wi-Fi/Bluetooth de 2.4 GHz

El microcontrolador **ESP32-S3 N16R8** integra conectividad Wi-Fi (802.11 b/g/n) y Bluetooth Low Energy en la banda de 2.4 GHz, incluyendo en su propio encapsulado los conmutadores de antena, el balun de radiofrecuencia, el amplificador de potencia y los filtros necesarios para operar (Systems, s.f.). Para mantener el proyecto dentro del presupuesto y simplificar el armado en protoboard, se utiliza la antena impresa en PCB del propio módulo ESP32-S3.

A través de esta antena, el ESP32-S3 se conecta a una red Wi-Fi (ya sea el router del laboratorio o un punto de acceso Wi-Fi compartido dentro de la cabina del camión) y transmite los datos directamente hacia nuestro servidor web. Para evitar pérdidas de señal, el extremo superior del ESP32-S3 donde reside la antena debe sobresalir ligeramente o mantenerse despejado de los puentes de alambre y del chasis metálico.

## 7.3. Evaluación y descarte de enlaces celulares (4G/LTE) y LoRa

En el diseño de ingeniería de telecomunicaciones es fundamental justificar por qué se eligen ciertas tecnologías y por qué se descartan otras:

1. **Justificación del descarte de un módulo 4G/LTE dedicado (Criterio Económico):** En el planteamiento teórico inicial se contemplaba el uso de un módulo celular independiente (como la familia SIM7600) con antena externa multibanda. Sin embargo, adquirir un módulo LTE Cat 1 junto con sus accesorios eleva excesivamente el costo del prototipo y escapa de las posibilidades económicas actuales del grupo. Al contar ya con el chip **ESP32-S3 N16R8**, aprovechamos su radio Wi-Fi nativo (costo cero adicional) para conectarnos a Internet a través de un punto de acceso existente (como el hotspot de un teléfono celular o el router interno del vehículo), logrando exactamente el mismo objetivo funcional: enviar las coordenadas en vivo a nuestro servidor y visualizar el camión en el mapa de la ciudad.

## 7.4. Antena GNSS cerámica tipo patch (Módulo NEO-6M)

El módulo **UBLOX NEO-6M (GY-NEO6MV2)** incluye una antena cerámica tipo *patch* diseñada para captar las señales de radiofrecuencia sumamente débiles que provienen de los satélites GPS a más de 20,000 km de altura. Este módulo cuenta además con una memoria **EEPROM** para guardar los datos de configuración cuando se apaga y una **batería de respaldo integrada (MS621FE)** que mantiene los datos de almanaque satelital, permitiendo un arranque rápido (*Hot Start*) cuando el camión vuelve a encenderse.

Para que la antena cerámica funcione correctamente, su superficie plana metálica/cerámica debe orientarse mirando hacia el cielo y con la menor obstrucción posible. En un camión blindado real, el acero del blindaje actúa como una Jaula de Faraday que bloquea las ondas de radio; por ello, la antena cerámica nunca debe quedar encerrada dentro de la bóveda metálica, sino ubicarse en el exterior del techo protegida por una cubierta plástica (radomo) que permita el paso de la señal satelital.

## 7.5. Configuración recomendada por fases para el prototipo

Para garantizar el éxito en la defensa práctica sin arriesgar los componentes ni el presupuesto, la implementación se divide en dos fases claras:

* **Fase 1 (Demostración actual en Laboratorio):** Armado sobre protoboard MB102 utilizando el ESP32-S3 N16R8 alimentado por USB-C, sensores MPU6050, HC-SR04 y GPS NEO-6M alimentados por la fuente Dimax 12V 2A reducida mediante el módulo XD-42, y transmisión real por Wi-Fi hacia nuestro servidor web de mapas.
* **Fase 2 (Proyección a Prototipo Industrial en Vehículo):** Reemplazo de la protoboard por una placa soldada (PCB), uso del regulador **XL4015 (5A 75W)** conectado al sistema eléctrico del camión y adición de una batería Li-Ion de respaldo con gestión térmica.

# 8. Arquitectura propuesta de telemetría y recorrido de datos

La arquitectura sigue un flujo extremo a extremo desde el entorno físico del camión blindado hasta la pantalla del operador en la central de monitoreo. Los sensores (MPU6050 y HC-SR04) y el receptor GPS (NEO-6M) entregan sus señales al **ESP32-S3 N16R8**. El microcontrolador gestiona el modo de ultra-ahorro de energía, realiza la adquisición, valida los datos, arma el paquete digital y lo transmite por Wi-Fi hacia el servidor. Si el enlace inalámbrico sufre un microcorte en ruta, el ESP32-S3 aprovecha su amplia memoria (16 MB Flash / 8 MB PSRAM en la versión N16R8) para guardar temporalmente las lecturas en un *buffer* local y reenviarlas en cuanto se restablece la conexión.

## 8.1. Recorrido extremo a extremo de los datos

El recorrido paso a paso de la información ocurre de la siguiente manera:

1. **Vigilancia y Despertar (Ultra-Ahorro):** Con el camión detenido y apagado, el sistema permanece en reposo. Cuando el acelerómetro **MPU6050** detecta una vibración física que supera el umbral configurado, envía un pulso por el bus digital hacia el ESP32-S3 para iniciar el ciclo activo de monitoreo.
2. **Adquisición y Conversión:**
   * El **MPU6050** convierte las fuerzas de aceleración (en rangos configurables de ) y giro () mediante su conversor AD de 16 bits y las entrega por el protocolo **I2C**.
   * El sensor **HC-SR04** emite un pulso ultrasónico y mide el tiempo que tarda en rebotar contra la puerta o paredes internas (con precisión de 3 mm a 5 mm), entregando un pulso digital proporcional a la distancia.
   * El módulo **UBLOX NEO-6M** capta las señales satelitales y envía las tramas ASCII **NMEA 0183** por el puerto serial **UART**.
3. **Empaquetado con Contexto:** El firmware del ESP32-S3 une estas lecturas en un mensaje estructurado (formato JSON) con los campos: {source\_id, timestamp, latitude, longitude, vibration\_g, door\_distance\_cm, rssi\_quality, sequence}.
4. **Transmisión Inalámbrica y Visualización:** El ESP32-S3 envía el paquete por su antena Wi-Fi de 2.4 GHz hacia el router/hotspot y este lo encamina a nuestro servidor. El servidor almacena el registro en la base de datos y actualiza inmediatamente la posición del camión blindado sobre el mapa de la ciudad en el navegador web, mostrando alertas visuales si la puerta se abre (variación en el HC-SR04) o si ocurre un impacto (pico en el MPU6050).

# 9. Propuesta de hardware, armado electrónico y energía

Dado que en esta primera fase buscamos estabilidad total en las pruebas de mesa sin usar baterías, hemos diseñado un esquema de alimentación segmentado y seguro que protege al microcontrolador y facilita el armado.

|  |  |  |
| --- | --- | --- |
| **Componente** | **Función en el proyecto** | **Especificaciones clave de trabajo** |
| **ESP32-S3 N16R8** | Cerebro del sistema, control de ultra-ahorro, lectura de sensores y transmisión Wi-Fi. | Alimentación por puerto USB-C (5V); lógica de pines a **3.3V**; 16 MB Flash y 8 MB PSRAM; Wi-Fi 2.4 GHz integrado. |
| **Fuente de poder Dimax 12V 2A** | Fuente principal de pared para alimentar la etapa de sensores en el laboratorio. | Entrada universal 100-240 VAC (50/60 Hz); salida continua estable de **12V DC y hasta 2A**. |
| **Módulo Fuente Protoboard XD-42** | Reductor de voltaje acoplado directamente a la protoboard MB102 para alimentar los sensores. | Recibe los 12V DC de la fuente Dimax y entrega dos rieles seleccionables por jumper: **5V y 3.3V** (corriente máx. ). |
| **Módulo GPS UBLOX NEO-6M (GY-NEO6MV2)** | Obtención de coordenadas geográficas y tiempo satelital. | Alimentación de 3V a 5V; comunicación Serial UART; incluye EEPROM, batería MS621FE y antena cerámica. |
| **Sensor MPU6050** | Acelerómetro de 3 ejes y giroscopio de 3 ejes (6 DoF) para despertar el sistema y detectar impactos. | Operación de 3V a 5V; comunicación **I2C** (pines SDA, SCL y pin INT para despertar al ESP32); ADC de 16 bits. |
| **Sensor Ultrasónico HC-SR04** | Medición de distancia interior (2 cm a 400 cm) para control de apertura de bóveda/puertas. | Voltaje de operación **5V DC**; consumo muy bajo (); ángulo de medida de 15 grados. |
| **Módulo Regulador DC-DC XL4015 (5A 75W)** | Regulador Step-Down de alta eficiencia reservado para pruebas de potencia y transición a Fase 2. | Entrada de 4V a 38V DC; salida ajustable de 1.25V a 36V DC; soporta hasta **5A (75W)** con eficiencia de hasta **96%**. |

### Materiales adicionales necesarios para el armado (Guía práctica para conexión en Protoboard)

Para armar el circuito sin necesidad de soldar y sin riesgo de quemar ningún componente, se incluyen en la lista de materiales los siguientes elementos básicos de electrónica pasiva:

1. **1 Protoboard MB102 de 830 puntos:** Donde se encaja directamente el módulo de fuente **XD-42** y los sensores.
2. **Cables Jumper DuPont (1 paquete de Macho-Macho y 1 paquete de Macho-Hembra):** Para unir los pines del ESP32-S3, el GPS, el acelerómetro y el ultrasonido con la protoboard.
3. **2 Resistencias para proteger el ESP32-S3 con el sensor HC-SR04 (1 resistencia de y 1 resistencia de o ):**
   * *¿Por qué son necesarias?* El sensor ultrasónico HC-SR04 funciona a **5V**, por lo que su pin de respuesta (Echo) devuelve una señal de **5V**. Sin embargo, los pines de datos del **ESP32-S3 N16R8** solo soportan **3.3V**. Si conectas el pin Echo directo al ESP32-S3, podrías dañar el pin con el tiempo. Colocando estas dos simples resistencias en la protoboard (formando un divisor de tensión básico), los 5V del sensor bajan automáticamente a **3.3V seguros** para el ESP32-S3. (El módulo GPS NEO-6M y el MPU6050 no tienen este problema porque sus líneas de datos ya trabajan a niveles seguros de 3.3V).
4. **Regla de Oro del Armado (Tierra Común / GND Común):** Como el ESP32-S3 recibirá energía desde el cable **USB-C** de la computadora y los sensores recibirán energía desde el módulo **XD-42** en la protoboard, es **obligatorio conectar un cable jumper desde un pin GND del ESP32-S3 hacia el riel negativo (GND / -) de la protoboard**. Esto iguala la referencia eléctrica de ambos lados para que los datos fluyan sin errores.

## 9.1. Dispositivos para la transmisión y recepción

La arquitectura distingue claramente entre la captura de señales en el vehículo y la recepción en el servidor central:

|  |  |  |  |
| --- | --- | --- | --- |
| **Dispositivo** | **Función dentro del enlace** | **Interfaz o tecnología** | **Criterio de selección en el proyecto** |
| **ESP32-S3 N16R8** | Adquisición de sensores, gestión de ahorro de energía, empaquetado y envío Wi-Fi. | GPIO, I2C, UART y Wi-Fi 2.4 GHz integrado. | Gran capacidad de memoria, doble núcleo, bajo costo y radio Wi-Fi nativo sin requerir módulos caros. |
| **Sensores (MPU6050 + HC-SR04)** | Captura de vibración, inclinación y apertura de puertas. | Bus I2C y pulsos digitales. | Alta precisión, consumo menor a 20 mA en conjunto y respuesta inmediata para seguridad. |
| **Receptor GPS NEO-6M** | Recepción satelital de posición y tiempo. | UART Serial (NMEA 0183). | Confiable, incluye batería para arranque rápido y antena cerámica lista para usar. |
| **Router / Hotspot Wi-Fi** | Punto de acceso local que recibe la señal del ESP32-S3 y le da salida a Internet. | Wi-Fi 2.4 GHz (802.11n) hacia red IP. | Reemplaza el gasto de comprar un módulo 4G dedicado, permitiendo usar cualquier red disponible. |
| **Servidor Backend y Mapa Web** | Recepción de paquetes, guardado en base de datos y dibujo del camión en el mapa de la ciudad. | API Web / MQTT sobre TCP/IP y navegador web. | Permite visualizar en tiempo real el recorrido del blindado y el historial de alertas. |

# 10. Plan inicial de pruebas y validación

Para comprobar el funcionamiento antes de la defensa final, se ejecutará el siguiente plan de pruebas en laboratorio:

|  |  |  |
| --- | --- | --- |
| **Prueba** | **Procedimiento experimental** | **Métrica o evidencia esperada** |
| **Muestreo sin\_ruido y Aliasing** | Generar la señal senoidal de 5 Hz, muestrearla a 40 Hz y luego por debajo de 10 Hz. | Gráfica comparativa de reconstrucción correcta vs. distorsión por *aliasing*. |
| **Despertar por vibración (Ultra-Ahorro)** | Dejar el prototipo en reposo (simulando camión apagado) y dar un pequeño golpe en la mesa junto al MPU6050. | Activación inmediata del ESP32-S3 y envío del primer paquete de alerta al servidor. |
| **Detección de apertura (HC-SR04)** | Acercar y alejar un obstáculo frente al sensor ultrasónico entre 5 cm y 100 cm. | Variación exacta de la distancia en centímetros reflejada en el panel del servidor. |
| **Posicionamiento GPS (NEO-6M)** | Ubicar la antena cerámica cerca de una ventana o exterior, leer tramas NMEA y enviar al servidor. | Obtención de *Fix* satelital y aparición del marcador en la ubicación real sobre el mapa de la ciudad. |
| **Calidad del enlace Wi-Fi** | Enviar paquetes continuos cada segundo a distintas distancias del router/hotspot. | Medición de potencia RSSI (dBm), latencia menor a 500 ms y pérdida menor al 1% en condiciones locales. |
| **Estabilidad energética y térmica** | Alimentar los sensores con la fuente Dimax 12V + XD-42 y el ESP32-S3 por USB-C durante 1 hora continua. | Voltajes estables en 5.0V y 3.3V sin reinicios ni calentamiento excesivo en el módulo XD-42. |

## 10.1. Validación experimental de antenas, enlaces y ahorro energético

La validación se realizará en cuatro pasos ordenados. Primero, se comprobará la captura matemática con la señal sin\_ruido (5 Hz muestreada a 40 Hz). Segundo, se verificará en protoboard que el acelerómetro MPU6050 mantenga el sistema en ahorro energético cuando no hay movimiento y reactive la lectura del HC-SR04 y del GPS NEO-6M apenas sienta una vibración. Tercero, se medirá el rendimiento de la antena Wi-Fi del ESP32-S3 registrando el nivel de señal (RSSI) y el tiempo que tarda la coordenada en actualizarse en el mapa de la ciudad. Cuarto, se desconectará temporalmente el Wi-Fi para comprobar que el ESP32-S3 guarde los datos en memoria y los reenvíe al recuperar la conexión sin perder el historial del recorrido.

# 11. Resultados esperados, viabilidad y limitaciones

Se espera demostrar un prototipo funcional capaz de detectar actividad mediante el acelerómetro, capturar variables de seguridad y posición geográfica, y proyectarlas en tiempo real sobre el mapa de la ciudad utilizando una arquitectura económica y bien fundamentada en telecomunicaciones.

## 11.1. Evaluación de viabilidad

|  |  |  |  |
| --- | --- | --- | --- |
| **Dimensión** | **Pregunta de evaluación** | **Evidencia en nuestro proyecto** | **Criterio preliminar de éxito** |
| **Técnica** | ¿El nodo despierta por vibración, mide y transmite al mapa web? | Lecturas válidas de MPU6050, HC-SR04 y NEO-6M en el servidor. | Actualización fluida de la posición y alertas en tiempo real. |
| **Radiofrecuencia** | ¿Las antenas Wi-Fi (2.4 GHz) y GPS (1.57 GHz) operan sin interferirse? | Nivel RSSI estable y enganche satelital (*Fix*) del NEO-6M. | Conectividad sostenida durante toda la demostración. |
| **Energética** | ¿La alimentación dividida (USB-C + Dimax 12V / XD-42) soporta la carga? | Consumo total de sensores inferior al límite de 700 mA del XD-42. | Operación continua en frío sin caídas de tensión ni reinicios. |
| **Económica** | ¿El presupuesto es accesible para los estudiantes? | Uso de Wi-Fi integrado del ESP32-S3 en lugar de comprar módulos 4G caros. | Cumplimiento del 100% de los objetivos con componentes de bajo costo. |

## 11.2. Limitaciones, efectos térmicos y adaptación a prototipo industrial

Para responder con rigor técnico a las exigencias de un entorno real de transporte de valores, se contemplan los siguientes factores físicos e industriales:

1. **Cómo afecta la temperatura al circuito electrónico y a las telecomunicaciones:**
   * **En la radiofrecuencia (Telecomunicaciones):** El aumento de temperatura incrementa la agitación de los electrones en los conductores, lo que se conoce como **ruido térmico** (Ruido de Johnson-Nyquist). Al subir el piso de ruido térmico en el receptor del ESP32-S3 o del GPS, disminuye la **Relación Señal a Ruido (SNR)**, reduciendo el alcance efectivo del Wi-Fi y dificultando la captura de satélites débiles.
   * **En los sensores y microcontrolador:** El calor excesivo provoca *deriva térmica (drift)* en el giroscopio y acelerómetro MPU6050 (alterando ligeramente su punto cero) y también modifica la velocidad del sonido en el aire, lo que afecta marginalmente el cálculo de distancia del ultrasonido HC-SR04.
2. **Cálculo y estimación de temperaturas que soporta nuestro circuito:**
   * **Rangos operativos de los chips:** El microcontrolador **ESP32-S3** y el módulo **GPS NEO-6M** soportan un rango de temperatura industrial de , mientras que el sensor **HC-SR04** opera de . Por lo tanto, la temperatura máxima segura del conjunto completo está limitada por el sensor ultrasónico a .

**Cálculo simple de disipación de calor en nuestra fuente XD-42 (Fase 1):** La fuente Dimax entrega a la entrada del módulo XD-42, el cual reduce ese voltaje a para alimentar los tres sensores. El consumo sumado de nuestros sensores es sumamente bajo: , muy por debajo del límite máximo de del XD-42. La potencia que el regulador disipa en forma de calor se calcula como:

* + Al ser menos de medio vatio (), el módulo XD-42 apenas se entibiará unos a por encima de la temperatura ambiente (por ejemplo, si el auto está a , el regulador trabajará a unos cómodos ).
  + **Eficiencia térmica con el módulo XL4015 (Fase 2):** Cuando el sistema completo (incluyendo los picos de Wi-Fi del ESP32-S3 de hasta ) se conecte a los del camión en la Fase 2, no se usará el XD-42 sino el regulador conmutado **DC-DC XL4015 (5A 75W)**. Al tener una **eficiencia de hasta el 96%**, solo el 4% de la energía se pierde en calor (menos de ), manteniendo el circuito completamente frío.

1. **Proyección teórica de la Batería Li-Ion y cómo le afectan las altas temperaturas (Fase 2):** En esta primera fase no usamos baterías para evitar riesgos en laboratorio, pero para la **Fase 2** se proyecta integrar una batería **Li-Ion (Iones de Litio)** para dar autonomía al prototipo si cortan los cables de la batería principal del camión. Desde el punto de vista técnico, las baterías Li-Ion son muy sensibles al calor: su rango óptimo de trabajo es de . Si un camión blindado permanece estacionado bajo el sol y su interior supera los , el electrolito interno de la batería de litio se degrada aceleradamente, pierde capacidad de carga de forma permanente, aumenta su resistencia interna y, en casos extremos sin un circuito de protección (BMS), puede sufrir **fuga térmica (*Thermal Runaway*)**, hinchándose o incendiándose. Por ello, en la Fase 2 la batería deberá ir en un compartimiento ventilado y con sensor de corte térmico.
2. **Cómo adaptamos nuestro proyecto a un Prototipo Industrial (Fase 2):** Un camión blindado en movimiento genera fuertes vibraciones mecánicas, polvo y cambios bruscos de temperatura. Para llevar nuestra Fase 1 (protoboard) a un prototipo industrial en la Fase 2, se realizarán cuatro cambios concretos:
   * **De Protoboard a Placa PCB:** Se eliminará la protoboard MB102 y los cables jumper sueltos (que se desconectan con las vibraciones del motor) y se diseñará una **placa de circuito impreso (PCB)** con todos los módulos soldados firmemente y borneras atornilladas.
   * **Reemplazo de fuente de pared por el regulador XL4015:** Se sustituirá la fuente Dimax 12V de pared y el módulo XD-42 por el **Módulo Regulador DC-DC XL4015**, el cual tomará los 12V/24V de la batería del camión y los reducirá con un 96% de eficiencia para alimentar todo el sistema.
   * **Antena GPS exterior:** Se extenderá la antena del módulo GPS hacia el exterior del techo metálico del blindado para garantizar línea de vista directa a los satélites en todo momento.

# 12. Conclusiones

Nuestro informe vincula la teoría de Telecomunicaciones con una implementación práctica, segura y ajustada a nuestro presupuesto. El Teorema de Nyquist fundamenta la captura correcta de las señales físicas; la lógica de ultra-ahorro de energía mediante el acelerómetro **MPU6050** optimiza el uso del sistema manteniendo el monitoreo en reposo cuando el camión está apagado; el sensor **HC-SR04** y el módulo GPS **UBLOX NEO-6M** aportan las variables de seguridad e identificación geográfica; y el enlace **Wi-Fi de 2.4 GHz del ESP32-S3 N16R8** resuelve el envío de datos en tiempo real hacia nuestro mapa de la ciudad sin incurrir en el alto costo de módulos 4G ni sufrir las limitaciones de velocidad de tecnologías como LoRa.

Asimismo, la división de la alimentación en esta Fase 1 (USB-C para el microcontrolador y fuente Dimax 12V 2A con módulo XD-42 para los sensores) garantiza una demostración de laboratorio térmicamente fría y libre de fallos eléctricos, dejando completamente estructurada la ruta de escalamiento hacia una Fase 2 industrial mediante el regulador **XL4015**, el diseño de una placa PCB y el respaldo controlado con baterías Li-Ion.

# Referencias

* Bagur, J. (31 de octubre de 2023). *GPS NMEA 0183 Messaging Protocol 101*. Obtenido de Arduino Documentation:

<https://docs.arduino.cc/learn/communication/gps-nmea-data-101/>

* MathWorks. (s.f.). *What Is the Nyquist Theorem?* Recuperado de MathWorks:

<https://www.mathworks.com/discovery/nyquist-theorem.html>

* OASIS. (7 de marzo de 2019). *MQTT Version 5.0*. OASIS. Obtenido de

<https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html>

* SIMCom. (21 de mayo de 2026). *SIM7600NA*. Obtenido de SIMCom Wireless Solutions: <https://www.simcom.com/product/SIM7600NAG.html>
* Systems, E. (s.f.). *ESP32 Series*. Obtenido de Espressif Systems: <https://www.espressif.com/en/products/socs/esp32>
* u-blox. (s.f.). *NEO-6 / NEO-M8 series*. Obtenido de u-blox:

<https://www.u-blox.com/en/product/neo-m8-series>