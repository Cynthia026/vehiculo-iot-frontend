# Vehículo IoT - Plataforma de Control y Monitoreo

Aplicación web frontend (**SPA / Mobile First**) para el **Control remoto (Práctica 4.1)** y el **Monitoreo en tiempo real (Práctica 4.2)** de un vehículo IoT. Este proyecto consume servicios REST alojados en **AWS (FastAPI)** con persistencia en **Amazon RDS (MySQL)**, mantiene comunicación bidireccional en tiempo real mediante **WebSockets (WSS)** e incorpora gráficos espaciales animados y síntesis de audio nativos del navegador.

🔗 **Demo desplegada:** [https://cynthia026.github.io/vehiculo-iot-frontend/](https://cynthia026.github.io/vehiculo-iot-frontend/)

---

## 🚀 Tecnologías y APIs del Navegador Utilizadas

* **Frontend Base:** HTML5, CSS3 (Variables CSS, CSS Grid, Flexbox, unidades dinámicas `dvh`), Bootstrap 5, Bootstrap Icons y tipografía *Outfit* (Google Fonts).
* **Arquitectura JS:** JavaScript Vanilla modular (**ES6 Modules** `import`/`export`) con navegación de vistas tipo **SPA** (*Control* y *Monitoreo*).
* **Fetch API + `AbortController`:** Comunicación HTTP asíncrona con el backend en AWS; cancela automáticamente peticiones en vuelo si el usuario envía un nuevo movimiento antes de que termine el anterior para evitar saturación.
* **WebSocket API (`WSS`):** Canal de eventos en tiempo real con reconexión automática y callback desacoplado (`wsManager.onMessage`) para actualizar tanto la interfaz de Control como el módulo de Monitoreo.
* **Pointer Events API (`pointerdown`, `pointermove`, `pointerup`):** Control unificado de pantalla táctil y ratón con captura de puntero individual (`setPointerCapture`) para operar dos joysticks independientes (*Movimiento* y *Brazo y motores*).
* **HTML5 Canvas 2D API (`requestAnimationFrame`):** Renderizado de un **fondo astronómico animado** a pantalla completa con mezcla luminosa (`mix-blend-mode: screen`), 3 capas de estrellas con efecto paralaje y centelleo, nebulosas cósmicas flotantes y estrellas fugaces.
* **Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`):** Síntesis de sonido en tiempo real directamente en el navegador (sin archivos `.mp3` externos) con efectos diferenciados para cada acción:
  * **Velocidad:** Barrido ascendente de aceleración.
  * **Sonido / Claxon:** Doble tono armónico de bocina.
  * **Luz:** Pulso agudo de interruptor.
  * **Detener:** Tono descendente de frenado.
  * **Iniciar / Cancelar DEMO:** Tonos musicales de confirmación o cancelación.
  * **Joysticks y Pestañas:** Pulso digital suave al cambiar de dirección o de vista.
* **Vibration API (`navigator.vibrate`):** Respuesta háptica en teléfonos móviles al accionar controles y cambiar la dirección de los joysticks.

---

## 📁 Estructura del Proyecto

El proyecto sigue una arquitectura modular con separación de responsabilidades dentro de la carpeta `assets/`:

```text
vehiculo-iot-frontend/
├── assets/
│   ├── Favicon_Iot_vehiculo.png  # Icono circular con fondo transparente (pestaña y encabezado)
│   ├── Favicon_Iot_vehiculo.jpg  # Imagen fuente original del icono
│   ├── favicon.ico               # Icono estándar para navegadores
│   ├── css/
│   │   └── styles.css            # Estilos responsivos (1 sola pantalla en laptop y móvil vertical/horizontal), joysticks, monitoreo y tema espacial
│   ├── data/
│   │   └── .gitkeep              # Directorio reservado para catálogos estáticos futuros
│   └── js/
│       ├── config.js             # Constantes globales (URLs de API REST, WSS e ID del vehículo)
│       ├── api.js                # Cliente HTTP (Fetch + AbortController) para Control y Monitoreo
│       ├── websocket.js          # Gestión de conexión WSS, reconexión y callback en tiempo real (onMessage)
│       ├── joystick.js           # Clase Joystick: trigonometría, zona muerta, límites y retorno al centro
│       ├── ui.js                 # Control del DOM, vistas SPA, tabla/tarjeta de Monitoreo, conversión horaria UTC a local, Canvas 2D y Web Audio API
│       └── app.js                # Orquestador principal, reconciliación REST + WSS, verificación de RDS y enlace de eventos
├── index.html                    # Estructura principal con pestañas Control / Monitoreo, indicadores de estado y vistas modulares
└── README.md                     # Documentación técnica del proyecto
```

---

## ⚙️ ¿Cómo Funciona la Aplicación?

### 1. Pantalla de Inicio (Splash Screen), Conectividad e Inicialización (`app.js` y `ui.js`)
* **Splash Screen Animada (`#splash-screen`):** Al abrir la aplicación se presenta una pantalla de bienvenida espacial con resplandor radial, el logotipo oficial del vehículo con animación flotante, tipografía espaciada (`VEHÍCULO IOT · CONTROL EXCAVADORA IOT`) y una barra de progreso animada antes de dar paso a la vista de **Control**.
* **Indicadores Independientes en Cabecera:**
  * **WSS:** Estado en vivo del WebSocket (`Conectando...`, `En línea`, `Reconectando...` o `Desconectado`).
  * **AWS:** Estado del servidor FastAPI (`Disponible` o `No disponible`).
  * **RDS:** Consulta el endpoint `/api/health` para verificar la conexión con **Amazon RDS (MySQL)**.
* **Modo Sin Conexión (`is-offline`):** Al abrir la aplicación se dibuja de inmediato toda la interfaz. Si AWS no está disponible, los controles permanecen visibles pero deshabilitados y el sistema reintenta conectarse automáticamente cada **8 segundos**.

### 2. Módulo de Control (Práctica 4.1)
* **Doble Joystick Tipo Dial (`joystick.js`):**
  * **Joystick 1 (Movimiento):** Calcula el ángulo con `Math.atan2(dy, dx)` y traduce las 4 direcciones a `AVANZAR`, `RETROCEDER`, `GIRAR_IZQUIERDA` y `GIRAR_DERECHA`.
  * **Joystick 2 (Brazo y motores):** Traduce las direcciones a `SUBIR_BRAZO`, `BAJAR_BRAZO`, `MOTOR_IZQUIERDA` y `MOTOR_DERECHA`.
  * Ambos incluyen zona muerta (20 px), iluminación del cuadrante activo (`data-dir`) y retorno automático al centro enviando `Detener` al soltar.
* **Accesorios y Secuencias DEMO en Tiempo Real:**
  * Los comandos de accesorios (*Velocidad*, *Sonido*, *Luz*) se renderizan dinámicamente con iconos y efectos de sonido propios.
  * Durante la ejecución de una **Secuencia DEMO**, el cliente escucha los eventos `movimiento_demo` del WebSocket, traduce el `comando_en_ejecucion` al nombre del movimiento, muestra en pantalla `Enviando: <MOVIMIENTO>` e ilumina en tiempo real la dirección correspondiente en el joystick.

### 3. Módulo de Monitoreo en Tiempo Real (Práctica 4.2)
* **Navegación SPA (`Control` | `Monitoreo`):** Permite alternar entre la vista de operación y la vista de telemetría sin recargar la página.
* **Tarjeta de Último Movimiento:** Muestra el comando más reciente con icono dinámico, código de color semántico (verde para avance/luz, ámbar para retroceso/velocidad, cian para giros/brazo/motores, rojo para detener) y sello de registro en RDS.
* **Tabla de Últimos 10 Movimientos:** Presenta el historial reciente (`#`, `Movimiento`, `Fecha`, `Hora`) almacenado en **Amazon RDS**.
* **Reconciliación Híbrida REST + WebSocket (`procesarMensajeWSS`):**
  * Al abrir la pestaña **Monitoreo**, se consultan en paralelo `GET /api/telemetria/estado/1` y `GET /api/telemetria/historial/1`.
  * Cuando llega un evento `movimiento_individual` por WebSocket, la tarjeta de **Último movimiento** se actualiza de forma instantánea y, tras una breve espera de `600 ms` (para asegurar el `COMMIT` en MySQL RDS), se refresca automáticamente la tabla de los últimos 10 movimientos.
  * Cuando llega un evento `movimiento_demo`, se actualiza en vivo la tarjeta de **Último movimiento** indicando `(DEMO)` sin recargar la tabla de historial individual.
* **Conversión Automática de Zona Horaria (UTC → Hora Local):** Las marcas de tiempo enviadas en UTC por AWS/RDS se normalizan en el cliente para mostrar siempre la fecha (`DD/MM/YYYY`) y hora (`HH:MM:SS`) en el huso horario local del usuario.

### 4. Diseño Responsivo en Una Sola Pantalla (Laptop y Móvil Vertical/Horizontal)
* El diseño se adapta automáticamente a pantallas de **escritorio/laptop**, **móvil vertical** y **móvil horizontal (`orientation: landscape`)**, manteniendo toda la aplicación contenida en una sola pantalla (`100dvh`) sin desplazamiento vertical.

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
* **Último Estado del Vehículo (Monitoreo):** `GET /api/telemetria/estado/1`
* **Historial de Últimos 10 Movimientos (Monitoreo):** `GET /api/telemetria/historial/1`

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
