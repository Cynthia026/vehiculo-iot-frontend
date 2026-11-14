# Vehículo IoT - Plataforma Integral de Control, Monitoreo y Administración

Aplicación web frontend (**SPA / Mobile First**) y plataforma comercial multiusuario que integra **Control remoto (Práctica 4.1)**, **Monitoreo en tiempo real (Práctica 4.2)** y **Administración Comercial con RBAC y Propiedad por Recurso (Práctica 4.3)**. Consume servicios REST alojados en **AWS EC2 (FastAPI)** con persistencia en **Amazon RDS (MySQL)**, comunicación bidireccional mediante **WebSockets (WSS)**, gráficos espaciales animados y síntesis de audio nativos del navegador.

🔗 **Demo desplegada:** [https://cynthia026.github.io/vehiculo-iot-frontend/](https://cynthia026.github.io/vehiculo-iot-frontend/)

---

## 🏢 Modelo de Negocio, Roles y Seguridad por Recurso (RBAC + Anti-BOLA)

La plataforma simula la operación real de una empresa comercializadora de vehículos IoT conectados a Internet con **3 roles diferenciados** y validación de propiedad por unidad física:

1. **Administrador (`ADMIN` — Empresa Propietaria):**
   * Gestiona el **Catálogo de Modelos Comerciales** (`EXC-IOT-V1`, `ROV-IOT-V1`), el **Inventario de Unidades Físicas** (con número de serie único y estado comercial `DISPONIBLE`, `EXHIBICION`, `VENDIDO`, `MANTENIMIENTO`), las cuentas de **Clientes Compradores**, las **Asignaciones de Propiedad**, los comandos habilitados por unidad, las demos de fábrica y la **Bitácora de Auditoría**.
   * **Regla de Privacidad del Comprador:** El Administrador **no puede entrar al control operativo** de una unidad vendida a un cliente salvo que el propietario active explícitamente el interruptor **"Autorizar soporte técnico al Administrador (30 min)"** desde su vista *Mis Vehículos*.
2. **Usuario Comprador (`USUARIO` — Cliente Propietario):**
   * Accede exclusivamente a **Mis Vehículos** asignados a su cuenta, su panel de **Control**, su **Monitoreo** en tiempo real, su historial y su **Editor de Demos propias**.
   * **Protección Anti-BOLA / Anti-IDOR:** Un comprador (`Usuario A`) no puede consultar ni mover vehículos de otro comprador (`Usuario B`) cambiando el `id_vehiculo` (`HTTP 403 Forbidden`).
3. **Invitado (`INVITADO` — Cliente Potencial / Showroom):**
   * Explora el **Catálogo Público de Modelos Comerciales** y solicita una **Reserva Temporal Exclusiva (3 minutos)** sobre una unidad en estado **`EXHIBICION`**.
   * Al agotarse el tiempo o cerrar sesión, la plataforma envía automáticamente el comando prioritario **`Detener`** y libera la reserva. Jamás puede controlar unidades de clientes compradores.

---

## 🚀 Tecnologías y APIs Utilizadas

* **Frontend Base:** HTML5 Semántico, CSS3 (Variables CSS, CSS Grid, Flexbox, unidades dinámicas `dvh`), Bootstrap 5, Bootstrap Icons y tipografía *Outfit* (Google Fonts).
* **Arquitectura JS:** JavaScript Vanilla modular (**ES6 Modules** `import`/`export`) con navegación SPA (`Control` | `Monitoreo` | `Administración`).
* **Backend y Base de Datos:** Python 3 + **FastAPI**, **PyMySQL**, 21 **Stored Procedures** + consultas parametrizadas seguras en **Amazon RDS (MySQL 8.0)**, autenticación **JWT (`HS256`)** y WebSockets por sala de vehículo (`id_vehiculo`).
* **HTML5 Canvas 2D API + Web Audio API + Vibration API:** Fondo astronómico animado y efectos de sonido sintetizados en tiempo real para cada acción y joystick.

---

## 📁 Estructura del Proyecto

### Frontend (`vehiculo-iot-frontend`)
```text
vehiculo-iot-frontend/
├── assets/
│   ├── Favicon_Iot_vehiculo.png  # Icono oficial (pestaña, encabezado y Splash Screen)
│   ├── css/
│   │   └── styles.css            # Estilos responsivos (1 pantalla en Control/Monitoreo y panel Admin)
│   ├── data/
│   │   └── .gitkeep
│   └── js/
│       ├── config.js             # Configuración dinámica de unidad activa, URLs REST/WSS y token JWT
│       ├── api.js                # Cliente HTTP (Fetch + AbortController + Bearer JWT) para 4.1, 4.2 y 4.3
│       ├── websocket.js          # Gestor WSS por unidad con reconexión y callback en tiempo real
│       ├── joystick.js           # Clase Joystick: trigonometría, zona muerta y retorno con Detener
│       ├── ui.js                 # Control del DOM, Splash Screen, vistas SPA, Canvas 2D y Web Audio API
│       ├── admin.js              # Controlador de Administración (RBAC, BOLA, inventario, demos y auditoría)
│       └── app.js                # Orquestador principal, reconciliación REST + WSS y prioridad de Detener
├── index.html                    # Aplicación SPA con las 3 vistas: Control, Monitoreo y Administración
└── README.md                     # Documentación técnica y matriz de pruebas
```

### Backend y Migraciones SQL (`vehiculo-iot-api`)
```text
vehiculo-iot-api/
├── app/
│   ├── config.py                 # Variables de entorno (.env) para Amazon RDS
│   ├── database.py               # Ejecución de los 21 Stored Procedures y consultas parametrizadas
│   ├── security.py               # JWT HS256, hash SHA-256, RBAC y guardia anti-BOLA (verificar_acceso_vehiculo)
│   ├── routers/
│   │   ├── auth.py               # Login, sesión temporal de Invitado (3 min), perfil y logout seguro
│   │   ├── administracion.py     # Dashboard, modelos comerciales, unidades, clientes, asignaciones y auditoría
│   │   ├── mis_vehiculos.py      # Mis vehículos del comprador, switch de soporte y catálogo de exhibición
│   │   ├── vehiculos.py          # CRUD base de vehículos (SPs originales + autorización)
│   │   ├── comandos.py           # Catálogo y activación de comandos por vehículo
│   │   ├── telemetria.py         # Estado, historial (máx. 10) y ejecución de movimiento con prioridad Detener
│   │   └── demos.py              # CRUD de demos, pasos ordenados, ejecución asíncrona, cancelación y WSS
│   └── schemas/                  # Esquemas Pydantic de validación
├── migrations/
│   ├── 00_precheck_and_counts.sql        # Conteo e inventario previo en RDS
│   ├── V001__4_3_administracion_up.sql   # Migración incremental no destructiva (tablas, columnas y semilla)
│   ├── V001__4_3_administracion_down.sql # Script de reversión para entornos de prueba
│   └── 02_postcheck_validation.sql       # Verificación post-migración de conteos y Stored Procedures
└── main.py                       # Punto de entrada FastAPI, CORS, /api/health y Swagger UI personalizado
```

---

## 🧪 Matriz de Casos de Prueba Verificables (Rúbrica 4.3)

| Caso de Prueba | Rol Activo | Acción a Realizar | Resultado Esperado |
| :--- | :--- | :--- | :--- |
| **1. Alta y asignación de unidad** | `ADMIN` | En *Administración*, registrar una unidad física con número de serie y asignarla a un comprador. | La unidad se guarda en RDS, cambia a estado `VENDIDO` y se registra en la Bitácora de Auditoría. |
| **2. Operación del propietario** | `USUARIO` (Cynthia) | Seleccionar *Unidad #1* en *Mis Vehículos* y enviar movimientos desde *Control*. | Movimiento aceptado (`200 OK`), reflejado por WSS en *Monitoreo* y persistido en los últimos 10 de RDS. |
| **3. Bloqueo de acceso cruzado (BOLA/IDOR)** | `USUARIO` (Cynthia) | Pulsar *"Probar BOLA: Usuario A → Unidad Ajena (#3)"* o intentar operar la unidad de Carlos. | Bloqueado con `403 Forbidden` y alerta registrada en la Bitácora de Auditoría. |
| **4. Protección de unidad vendida ante Admin** | `ADMIN` | Intentar operar *Unidad #1 (VENDIDO)* cuando `soporte_autorizado = OFF`. | Bloqueado con `403 Forbidden` hasta que la propietaria active *"Autorizar soporte técnico (30 min)"*. |
| **5. Sesión temporal de Invitado y paro seguro** | `INVITADO` | Iniciar reserva de exhibición (3 min), probar la unidad *Showroom* y finalizar o dejar expirar el reloj. | El invitado sólo ve la unidad `EXHIBICION`; al finalizar/expirar se envía `Detener` automáticamente. |
| **6. Editor de Demos y prioridad de Detener** | `USUARIO` / `ADMIN` | Crear demo, agregar pasos (`100–10,000 ms`), reordenar con `↑`/`↓`, ejecutar en *Control* y pulsar **Detener**. | Los pasos persisten en RDS (`demo_movimientos`) y **Detener** cancela de inmediato la rutina en curso. |

---

Desarrollado por **Cynthia Martínez García** · 2026
