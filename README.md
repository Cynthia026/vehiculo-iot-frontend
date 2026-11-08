# Vehículo IoT - Interfaz de Control

Aplicación web frontend (**Mobile First**) para el control remoto y telemetría de un vehículo IoT. Este proyecto consume una API REST alojada en **AWS (FastAPI)**, mantiene comunicación bidireccional en tiempo real mediante **WebSockets (WSS)** e incorpora gráficos espaciales animados y síntesis de audio nativos del navegador.

🔗 **Demo desplegada:** [https://cynthia026.github.io/vehiculo-iot-frontend/](https://cynthia026.github.io/vehiculo-iot-frontend/)

---

## 🚀 Tecnologías y APIs del Navegador Utilizadas

* **Frontend Base:** HTML5, CSS3 (Variables CSS, CSS Grid, Flexbox, unidades dinámicas `dvh`), Bootstrap 5, Bootstrap Icons y tipografía *Outfit* (Google Fonts).
* **Arquitectura JS:** JavaScript Vanilla modular (**ES6 Modules** `import`/`export`).
* **Fetch API + `AbortController`:** Comunicación HTTP asíncrona con el backend en AWS; cancela automáticamente peticiones en vuelo si el usuario envía un nuevo movimiento antes de que termine el anterior para evitar saturación.
* **WebSocket API (`WSS`):** Canal bidireccional en tiempo real con lógica de reconexión automática progresiva.
* **Pointer Events API (`pointerdown`, `pointermove`, `pointerup`):** Control unificado de pantalla táctil y ratón con captura de puntero individual (`setPointerCapture`) para operar dos joysticks independientes (*Movimiento* y *Brazo y motores*).
* **HTML5 Canvas 2D API (`requestAnimationFrame`):** Renderizado de un **fondo astronómico animado** a pantalla completa con mezcla luminosa (`mix-blend-mode: screen`), 3 capas de estrellas con efecto paralaje y centelleo, nebulosas cósmicas flotantes y estrellas fugaces.
* **Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`):** Síntesis de sonido en tiempo real directamente en el navegador (sin archivos `.mp3` externos) con efectos diferenciados para cada acción:
  * **Velocidad:** Barrido ascendente de aceleración.
  * **Sonido / Claxon:** Doble tono armónico de bocina.
  * **Luz:** Pulso agudo de interruptor.
  * **Detener:** Tono descendente de frenado.
  * **Iniciar / Cancelar DEMO:** Tonos musicales de confirmación o cancelación.
  * **Joysticks:** Pulso digital suave al cambiar de dirección.
* **Vibration API (`navigator.vibrate`):** Respuesta háptica en teléfonos móviles al accionar controles y cambiar la dirección de los joysticks.

---

## 📁 Estructura del Proyecto

El proyecto sigue una arquitectura modular con separación de responsabilidades:

```text
vehiculo-iot-frontend/
├── assets/
│   ├── Favicon_Iot_vehiculo.png  # Icono circular con fondo transparente (pestaña y encabezado)
│   ├── Favicon_Iot_vehiculo.jpg  # Imagen fuente original del icono
│   └── favicon.ico               # Icono estándar para navegadores
├── css/
│   └── styles.css                # Estilos responsivos (1 sola pantalla en móvil), joysticks tipo dial y tema espacial
├── data/
│   └── .gitkeep                  # Directorio reservado para catálogos estáticos futuros
├── js/
│   ├── config.js                 # Constantes globales (URLs de API REST, WSS e ID del vehículo)
│   ├── api.js                    # Cliente HTTP (Fetch + AbortController) hacia AWS
│   ├── websocket.js              # Gestión de conexión y reconexión automática de WebSockets
│   ├── joystick.js               # Clase Joystick: trigonometría, zona muerta, límites y retorno al centro
│   ├── ui.js                     # Control del DOM, fondo espacial Canvas 2D, sonidos Web Audio API y modo offline
│   └── app.js                    # Orquestador principal, verificación de RDS, reintentos y enlace de eventos
├── index.html                    # Estructura principal, panel de conectividad, doble joystick, accesorios y demos
└── README.md                     # Documentación técnica del proyecto
```

---

## ⚙️ ¿Cómo Funciona la Aplicación?

1. **Inicialización Inmediata y Modo Sin Conexión (`app.js` y `ui.js`):**
   * Al abrir la aplicación, se dibuja de inmediato toda la interfaz (los 2 joysticks, el botón *Detener*, los botones base de *Velocidad*, *Sonido* y *Luz*, y el panel de *Secuencias demo*).
   * Mientras el servidor de AWS no responda, la interfaz entra en modo `is-offline`: todos los controles conservan su diseño visual pero permanecen bloqueados (`disabled`) y el sistema reintenta conectarse automáticamente cada **8 segundos**.
2. **Panel de Conectividad en Tiempo Real:**
   * **WSS:** Muestra el estado del WebSocket (`Conectando...`, `En línea`, `Reconectando...` o `Desconectado`).
   * **AWS:** Se actualiza a `Disponible` o `No disponible` según la respuesta de la API REST.
   * **RDS:** Consulta el endpoint `/api/health` al iniciar para verificar la conexión con la base de datos **Amazon RDS**.
3. **Doble Joystick Tipo Dial (`joystick.js`):**
   * **Joystick 1 (Movimiento):** Calcula el ángulo con `Math.atan2(dy, dx)` y traduce las 4 direcciones a `AVANZAR`, `RETROCEDER`, `GIRAR_IZQUIERDA` y `GIRAR_DERECHA`.
   * **Joystick 2 (Brazo y motores):** Traduce las direcciones a `SUBIR_BRAZO`, `BAJAR_BRAZO`, `MOTOR_IZQUIERDA` y `MOTOR_DERECHA`.
   * Ambos cuentan con **zona muerta** (20 px) para evitar envíos accidentales, iluminación del cuadrante activo (`data-dir`), envío único por cambio de dirección y **retorno automático al centro** enviando el comando `Detener` al soltar.
4. **Catálogo Dinámico de Accesorios y Secuencias DEMO:**
   * Los comandos que no pertenecen a los joysticks ni al botón *Detener* se generan dinámicamente como tarjetas interactivas en la sección **Accesorios**, asignándoles un icono y un efecto de sonido acorde a su nombre.
   * Las **Secuencias DEMO** se cargan desde la base de datos en el selector desplegable, permitiendo iniciarlas o cancelarlas en cualquier momento.
5. **Diseño Responsivo en Una Sola Pantalla (Móvil y Escritorio):**
   * En teléfonos celulares (`max-width: 767px`), las dimensiones de los joysticks, botones y textos se escalan proporcionalmente a la altura de la pantalla (`100dvh`) y los 3 accesorios se alinean en una sola fila para operar todo el vehículo **sin necesidad de hacer scroll vertical**.

---

## 🔌 Puntos de Integración (API REST y WSS)

La aplicación se conecta con los siguientes servicios en AWS:

* **Base URL (REST):** `https://api-vehiculo-iot.duckdns.org`
* **WebSocket (WSS):** `wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1`
* **Salud del Servidor y Amazon RDS:** `GET /api/health`
* **Catálogo de Comandos:** `GET /api/comandos/vehiculo/1`
* **Ejecución de Movimiento / Accesorios:** `POST /api/telemetria/movimiento?id_vehiculo=1&id_comando={id}&origen=API_POST`
* **Catálogo de Secuencias DEMO:** `GET /api/demos/vehiculo/1`
* **Iniciar Secuencia DEMO:** `POST /api/demos/{id_demo}/ejecutar?id_vehiculo=1`
* **Cancelar Secuencia DEMO:** `POST /api/demos/vehiculo/1/cancelar`

---

## 💻 Ejecución Local

1. Clonar este repositorio:
   ```bash
   git clone https://github.com/Cynthia026/vehiculo-iot-frontend.git
   ```
2. Abrir la carpeta `vehiculo-iot-frontend` en **Visual Studio Code**.
3. Debido al uso nativo de **ES6 Modules** (`type="module"`), es necesario servir los archivos mediante un servidor HTTP local (por ejemplo, con la extensión **Live Server** de VS Code).
4. Hacer clic derecho sobre `index.html` y seleccionar **"Open with Live Server"**.

---

Desarrollado por **Cynthia Martínez García** · 2026
