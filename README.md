# Vehículo IoT - Interfaz de Control

Aplicación web frontend (Mobile First) para el control remoto de un vehículo IoT. Este proyecto consume una API REST alojada en AWS (FastAPI) y mantiene comunicación bidireccional en tiempo real mediante WebSockets.

## 🚀 Tecnologías Utilizadas
* **Frontend:** HTML5, CSS3, Bootstrap 5, JavaScript Vanilla (ES6 Modules).
* **Integración:** Fetch API (REST), WebSockets (WSS).
* **Despliegue:** GitHub Pages.

## 📁 Estructura del Proyecto
El proyecto sigue una arquitectura modular con una estricta separación de responsabilidades:

```text
vehiculo-iot-frontend/
├── assets/
│   ├── Favicon_Iot_vehiculo.jpg  # Imagen fuente del ícono
│   └── favicon.ico               # Ícono de la aplicación web
├── css/
│   └── styles.css                # Estilos personalizados (Joystick, Mobile First)
├── data/
│   └── .gitkeep                  # Directorio reservado para futuros catálogos locales
├── js/
│   ├── api.js                    # Cliente HTTP (Fetch) para comunicación con AWS
│   ├── app.js                    # Orquestador e inicializador principal de módulos
│   ├── config.js                 # Variables de entorno y URLs de la API
│   ├── joystick.js               # Lógica de Pointer Events y control táctil circular
│   ├── ui.js                     # Manipulación dinámica del DOM y renderizado
│   └── websocket.js              # Gestión de conexión y reconexión WSS
└── index.html                    # Estructura principal y Panel de Conectividad
```

## 🔌 Puntos de Integración (API y WSS)
La aplicación se integra con los siguientes recursos en AWS:

* **Base URL (REST):** `https://api-vehiculo-iot.duckdns.org`
* **WebSocket WSS:** `wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1`
* **Salud del Servidor y RDS:** `GET /api/health`
* **Catálogo de Comandos:** `GET /api/comandos/vehiculo/1`
* **Ejecución de Movimiento:** `POST /api/telemetria/movimiento?id_vehiculo=1&id_comando={id}`
* **Gestión de DEMOs:** `GET /api/demos/vehiculo/1` | `POST /api/demos/{id}/ejecutar` | `POST /api/demos/vehiculo/1/cancelar`

## ⚙️ Ejecución Local
1. Clonar el repositorio.
2. Abrir la carpeta del proyecto en Visual Studio Code.
3. Debido a las políticas de CORS y el uso nativo de ES6 Modules (`import`/`export`), es necesario ejecutar la aplicación mediante un servidor local. Se recomienda instalar la extensión **Live Server** en VS Code.
4. Hacer clic derecho sobre `index.html` y seleccionar **"Open with Live Server"**.

## ✅ Características Principales
* Panel de conectividad en tiempo real (WSS, AWS, Amazon RDS).
* Joystick virtual con zona muerta y retorno automático al centro.
* Mapeo dinámico de botones adicionales y secuencias DEMO según el catálogo de la API.
* Prevención de solicitudes POST saturadas (`AbortController`).

---
Desarrollado por **Cynthia Martínez García** · 2026
