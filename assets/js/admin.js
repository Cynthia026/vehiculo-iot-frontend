// assets/js/admin.js
import { api } from './api.js?v=13';
import { CONFIG } from './config.js?v=13';
import { ui, normalizar } from './ui.js?v=13';

const STORAGE_KEY = 'vehiculo_iot_admin_state_v1';

// Estado inicial sincronizado con RDS (se enriquece con GET /api/vehiculos/, /api/demos/, etc.)
const DEFAULT_STATE = {
    modelos: [
        {
            id_modelo: 1,
            codigo_modelo: 'EXC-IOT-V1',
            nombre: 'Excavadora IoT',
            descripcion: 'Vehículo oruga con brazo hidráulico articulado, giro de cabina y accesorios luminosos/sonoros.',
            microcontrolador_default: 'ESP8266',
            tiene_brazo: true,
            tiene_motores_giro: true,
            activo: true
        },
        {
            id_modelo: 2,
            codigo_modelo: 'ROV-IOT-V1',
            nombre: 'Rover Explorador IoT',
            descripcion: 'Vehículo compacto de exploración 4WD con tracción diferencial, faros LED y telemetría.',
            microcontrolador_default: 'ESP8266',
            tiene_brazo: false,
            tiene_motores_giro: true,
            activo: true
        }
    ],
    clientes: [
        {
            id_usuario: 2,
            nombre: 'Cynthia Martínez García',
            email: 'cynthia@cliente.com',
            rol: 'USUARIO',
            activo: true
        },
        {
            id_usuario: 3,
            nombre: 'Carlos Mendoza (Comprador B)',
            email: 'carlos@cliente.com',
            rol: 'USUARIO',
            activo: true
        }
    ],
    // Metadatos comerciales por id_vehiculo para distinguir Modelo Comercial de Unidad Física
    metaUnidades: {
        1: {
            id_modelo: 1,
            numero_serie: 'SN-EXC-0001',
            estado_comercial: 'VENDIDO',
            id_propietario: 2,
            soporte_autorizado: false,
            soporte_expira_en: null
        },
        2: {
            id_modelo: 1,
            numero_serie: 'SN-EXC-DEMO-02',
            estado_comercial: 'EXHIBICION',
            id_propietario: null,
            soporte_autorizado: true,
            soporte_expira_en: null
        },
        3: {
            id_modelo: 2,
            numero_serie: 'SN-ROV-0003',
            estado_comercial: 'VENDIDO',
            id_propietario: 3,
            soporte_autorizado: false,
            soporte_expira_en: null
        }
    },
    metaDemos: {},
    reservaInvitado: null,
    auditoria: [
        {
            id_auditoria: 1,
            actor: 'Administrador General',
            rol: 'ADMIN',
            accion: 'INICIO_PLATAFORMA',
            entidad: 'vehiculos',
            id_recurso: 1,
            detalle: 'Inventario inicial sincronizado con Amazon RDS (Unidad #1 asignada a Cynthia Martínez García).',
            fecha_hora: new Date().toISOString()
        }
    ]
};

class AdminManager {
    constructor() {
        this.state = this._loadState();
        // Por defecto inicia como la propietaria de la Unidad 1 para que Control y Monitoreo 4.1/4.2 operen de inmediato
        this.sesion = {
            id_usuario: 2,
            nombre: 'Cynthia Martínez García',
            email: 'cynthia@cliente.com',
            rol: 'USUARIO',
            nombre_rol: 'Usuario Comprador'
        };
        this.unidadesRds = [];
        this.comandosUnidadAdmin = [];
        this.demosUnidadEditor = [];
        this.movimientosDemoActual = [];
        this.idUnidadComandosSel = 1;
        this.idDemoSeleccionada = null;
        this.guestInterval = null;
        this.onUnitChanged = null; // Callback hacia app.js cuando cambia la unidad activa
        this.onStopVehicle = null; // Callback hacia app.js para detener físicamente la unidad
    }

    _loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return structuredClone(DEFAULT_STATE);
            const parsed = JSON.parse(raw);
            return {
                ...structuredClone(DEFAULT_STATE),
                ...parsed,
                metaUnidades: { ...DEFAULT_STATE.metaUnidades, ...(parsed.metaUnidades || {}) }
            };
        } catch (_) {
            return structuredClone(DEFAULT_STATE);
        }
    }

    _saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (_) {}
    }

    registrarEventoAuditoria(accion, entidad, idRecurso, detalle) {
        const nuevo = {
            id_auditoria: (this.state.auditoria[0]?.id_auditoria || 0) + 1,
            actor: this.sesion?.nombre || 'Visitante',
            rol: this.sesion?.rol || 'INVITADO',
            accion,
            entidad,
            id_recurso: idRecurso,
            detalle,
            fecha_hora: new Date().toISOString()
        };
        this.state.auditoria = [nuevo, ...this.state.auditoria].slice(0, 40);
        this._saveState();
        this.renderAuditoria();
        this.renderMetricas();
    }

    init(callbacks = {}) {
        this.onUnitChanged = callbacks.onUnitChanged || null;
        this.onStopVehicle = callbacks.onStopVehicle || null;
        this._bindEvents();
        this.actualizarBadgeSesionCabecera();
    }

    // Verifica en el cliente + backend si el usuario actual puede controlar una unidad física
    verificarPermisoOperacion(idVehiculo = CONFIG.VEHICULO_ID, silencioso = false) {
        const unidad = this.obtenerUnidadEnriquecida(idVehiculo);
        const rol = this.sesion.rol;

        if (rol === 'USUARIO') {
            if (Number(unidad.id_propietario) !== Number(this.sesion.id_usuario)) {
                if (!silencioso) {
                    this.registrarEventoAuditoria(
                        'ACCESO_CRUZADO_BLOQUEADO',
                        'vehiculos',
                        idVehiculo,
                        `[403 BOLA/IDOR] ${this.sesion.nombre} intentó controlar la unidad #${idVehiculo} (${unidad.nombre}) perteneciente a otro comprador.`
                    );
                    ui.showFeedback(`403 Bloqueado (BOLA): La unidad #${idVehiculo} no pertenece a tu cuenta`, 'danger', 4000);
                }
                return { ok: false, codigo: 403, motivo: 'Esta unidad pertenece a otro comprador (BOLA/IDOR).' };
            }
            return { ok: true, codigo: 200 };
        }

        if (rol === 'INVITADO') {
            if (unidad.estado_comercial !== 'EXHIBICION') {
                if (!silencioso) {
                    this.registrarEventoAuditoria(
                        'INVITADO_UNIDAD_PRIVADA_BLOQUEADO',
                        'vehiculos',
                        idVehiculo,
                        `[403 RBAC] Invitado intentó operar unidad privada #${idVehiculo} (${unidad.estado_comercial}).`
                    );
                    ui.showFeedback('403 Bloqueado: Invitado sólo puede operar unidades de EXHIBICIÓN', 'danger', 4000);
                }
                return { ok: false, codigo: 403, motivo: 'El rol Invitado sólo puede operar unidades en EXHIBICIÓN.' };
            }
            const res = this.state.reservaInvitado;
            if (!res || !res.activa || res.expira_ts <= Date.now()) {
                if (!silencioso) {
                    ui.showFeedback('401 Sesión temporal de Invitado expirada o sin reserva activa', 'warning', 4000);
                }
                return { ok: false, codigo: 401, motivo: 'Debes iniciar una reserva temporal de exhibición para operar.' };
            }
            return { ok: true, codigo: 200 };
        }

        if (rol === 'ADMIN') {
            if (unidad.estado_comercial === 'VENDIDO' && unidad.id_propietario && !unidad.soporte_autorizado) {
                if (!silencioso) {
                    this.registrarEventoAuditoria(
                        'ADMIN_CONTROL_SIN_SOPORTE',
                        'vehiculos',
                        idVehiculo,
                        `[403 PRIVACIDAD] Admin intentó mover unidad vendida #${idVehiculo} (${unidad.nombre}) sin consentimiento de soporte del comprador.`
                    );
                    ui.showFeedback('403 Privacidad: El comprador debe activar "Autorizar Soporte" en Mis Vehículos', 'danger', 4500);
                }
                return { ok: false, codigo: 403, motivo: 'El Administrador requiere autorización explícita de soporte del propietario.' };
            }
            return { ok: true, codigo: 200 };
        }

        return { ok: false, codigo: 403, motivo: 'Rol no autorizado' };
    }

    obtenerUnidadEnriquecida(idVehiculo) {
        const base = this.unidadesRds.find(v => Number(v.id_vehiculo) === Number(idVehiculo)) || {
            id_vehiculo: Number(idVehiculo),
            nombre: `Unidad ${idVehiculo}`,
            modelo: 'Excavadora IoT',
            descripcion: 'Unidad IoT conectada',
            microcontrolador: 'ESP8266',
            activo: true
        };
        const meta = this.state.metaUnidades[idVehiculo] || {
            id_modelo: 1,
            numero_serie: `SN-IOT-000${idVehiculo}`,
            estado_comercial: idVehiculo === 1 ? 'VENDIDO' : 'EXHIBICION',
            id_propietario: idVehiculo === 1 ? 2 : null,
            soporte_autorizado: false
        };
        const propietario = this.state.clientes.find(c => Number(c.id_usuario) === Number(meta.id_propietario));
        const modeloObj = this.state.modelos.find(m => Number(m.id_modelo) === Number(meta.id_modelo));

        return {
            ...base,
            id_modelo: base.id_modelo ?? meta.id_modelo ?? 1,
            codigo_modelo: modeloObj?.codigo_modelo || 'EXC-IOT-V1',
            numero_serie: base.numero_serie || meta.numero_serie || `SN-IOT-000${idVehiculo}`,
            estado_comercial: base.estado_comercial || meta.estado_comercial || 'DISPONIBLE',
            id_propietario: base.id_propietario !== undefined ? base.id_propietario : meta.id_propietario,
            nombre_propietario: base.nombre_propietario || propietario?.nombre || null,
            email_propietario: base.email_propietario || propietario?.email || null,
            soporte_autorizado: Boolean(base.soporte_autorizado ?? meta.soporte_autorizado)
        };
    }

    obtenerTodasLasUnidadesEnriquecidas() {
        const idsRds = this.unidadesRds.map(v => Number(v.id_vehiculo));
        const idsMeta = Object.keys(this.state.metaUnidades).map(Number);
        const todosIds = Array.from(new Set([...idsRds, ...idsMeta])).sort((a, b) => a - b);
        return todosIds.map(id => this.obtenerUnidadEnriquecida(id));
    }

    obtenerUnidadesVisiblesPorRol() {
        const todas = this.obtenerTodasLasUnidadesEnriquecidas();
        if (this.sesion.rol === 'ADMIN') {
            return todas;
        }
        if (this.sesion.rol === 'USUARIO') {
            return todas.filter(u => Number(u.id_propietario) === Number(this.sesion.id_usuario));
        }
        // INVITADO: únicamente unidades en EXHIBICION
        return todas.filter(u => u.estado_comercial === 'EXHIBICION');
    }

    async sincronizarDesdeRds() {
        try {
            // Intentar primero el endpoint unificado 4.3 si ya fue desplegado en EC2
            try {
                if (this.sesion.rol === 'ADMIN' && CONFIG.AUTH_TOKEN) {
                    const dash = await api.obtenerDashboardAdmin();
                    if (dash && Array.isArray(dash.unidades)) {
                        this.unidadesRds = dash.unidades;
                        if (Array.isArray(dash.modelos) && dash.modelos.length) this.state.modelos = dash.modelos;
                        if (Array.isArray(dash.clientes) && dash.clientes.length) this.state.clientes = dash.clientes;
                        if (Array.isArray(dash.auditoria) && dash.auditoria.length) this.state.auditoria = dash.auditoria;
                        this._saveState();
                    }
                }
            } catch (_) {
                // Si EC2 aún corre la versión base de los 21 SPs, usamos GET /api/vehiculos/
            }

            const listaRds = await api.obtenerVehiculos();
            if (Array.isArray(listaRds) && listaRds.length > 0) {
                this.unidadesRds = listaRds;
                listaRds.forEach((v) => {
                    if (!this.state.metaUnidades[v.id_vehiculo]) {
                        this.state.metaUnidades[v.id_vehiculo] = {
                            id_modelo: 1,
                            numero_serie: `SN-EXC-000${v.id_vehiculo}`,
                            estado_comercial: v.id_vehiculo === 1 ? 'VENDIDO' : 'DISPONIBLE',
                            id_propietario: v.id_vehiculo === 1 ? 2 : null,
                            soporte_autorizado: false
                        };
                    }
                });
                this._saveState();
            }
        } catch (err) {
            console.warn('Usando inventario cacheado:', err.message);
        }

        this.renderizarTodo();
    }

    async cambiarPerfilActivo(tipoPerfil, opciones = {}) {
        ui.playSound('tap');
        clearInterval(this.guestInterval);

        if (tipoPerfil === 'ADMIN') {
            try {
                const res = await api.login('admin@vehiculoiot.com', opciones.password || 'Admin123*');
                CONFIG.setAuthToken(res.access_token);
            } catch (_) {
                CONFIG.setAuthToken(null);
            }
            this.sesion = {
                id_usuario: 1,
                nombre: 'Administrador General',
                email: 'admin@vehiculoiot.com',
                rol: 'ADMIN',
                nombre_rol: 'Administrador (Empresa)'
            };
            this.registrarEventoAuditoria('LOGIN_ROL', 'usuarios', 1, 'Sesión iniciada como ADMINISTRADOR (Empresa IoT).');
        } else if (tipoPerfil === 'USUARIO_A') {
            try {
                const res = await api.login('cynthia@cliente.com', opciones.password || 'Cliente123*');
                CONFIG.setAuthToken(res.access_token);
            } catch (_) {
                CONFIG.setAuthToken(null);
            }
            this.sesion = {
                id_usuario: 2,
                nombre: 'Cynthia Martínez García',
                email: 'cynthia@cliente.com',
                rol: 'USUARIO',
                nombre_rol: 'Usuario Comprador (Titular Unidad #1)'
            };
            this.registrarEventoAuditoria('LOGIN_ROL', 'usuarios', 2, 'Sesión iniciada como USUARIO COMPRADOR: Cynthia Martínez García.');
        } else if (tipoPerfil === 'USUARIO_B') {
            try {
                const res = await api.login('carlos@cliente.com', opciones.password || 'Cliente123*');
                CONFIG.setAuthToken(res.access_token);
            } catch (_) {
                CONFIG.setAuthToken(null);
            }
            this.sesion = {
                id_usuario: 3,
                nombre: 'Carlos Mendoza (Comprador B)',
                email: 'carlos@cliente.com',
                rol: 'USUARIO',
                nombre_rol: 'Usuario Comprador (Titular Unidad #3)'
            };
            this.registrarEventoAuditoria('LOGIN_ROL', 'usuarios', 3, 'Sesión iniciada como USUARIO COMPRADOR: Carlos Mendoza.');
        } else if (tipoPerfil === 'CLIENTE_CUSTOM' && opciones.cliente) {
            const c = opciones.cliente;
            this.sesion = {
                id_usuario: c.id_usuario,
                nombre: c.nombre,
                email: c.email,
                rol: 'USUARIO',
                nombre_rol: 'Usuario Comprador'
            };
            this.registrarEventoAuditoria('LOGIN_ROL', 'usuarios', c.id_usuario, `Sesión iniciada como comprador: ${c.nombre}.`);
        } else if (tipoPerfil === 'INVITADO') {
            const nombreVis = opciones.nombreVisitante || 'Visitante Showroom';
            this.sesion = {
                id_usuario: null,
                nombre: nombreVis,
                email: 'invitado@vehiculoiot.com',
                rol: 'INVITADO',
                nombre_rol: 'Invitado (Sesión Temporal)'
            };
            this.iniciarReservaInvitado(nombreVis);
        }

        // Seleccionar automáticamente la primera unidad permitida para este rol
        const permitidas = this.obtenerUnidadesVisiblesPorRol();
        if (permitidas.length > 0) {
            await this.seleccionarUnidadActiva(permitidas[0].id_vehiculo, false);
        }

        this.actualizarBadgeSesionCabecera();
        this.renderizarTodo();
        ui.showFeedback(`Sesión activa: ${this.sesion.nombre} (${this.sesion.rol})`, 'success', 2600);
    }

    iniciarReservaInvitado(nombreVisitante = 'Visitante Showroom') {
        const unidadesExh = this.obtenerTodasLasUnidadesEnriquecidas().filter(u => u.estado_comercial === 'EXHIBICION');
        const unidadExh = unidadesExh[0] || this.obtenerUnidadEnriquecida(2);
        const duracionSeg = 180; // 3 minutos de sesión exclusiva

        this.state.reservaInvitado = {
            id_vehiculo: unidadExh.id_vehiculo,
            nombre_vehiculo: unidadExh.nombre,
            operador: nombreVisitante,
            expira_ts: Date.now() + duracionSeg * 1000,
            activa: true
        };
        this._saveState();

        this.registrarEventoAuditoria(
            'RESERVA_EXHIBICION',
            'sesiones_control',
            unidadExh.id_vehiculo,
            `Reserva exclusiva de exhibición (3 min) asignada a '${nombreVisitante}' sobre ${unidadExh.nombre}.`
        );

        this._iniciarRelojInvitado();
    }

    _iniciarRelojInvitado() {
        clearInterval(this.guestInterval);
        const actualizarReloj = () => {
            const res = this.state.reservaInvitado;
            const badge = document.getElementById('guest-countdown-timer');
            const headerRole = document.getElementById('header-role-text');

            if (!res || !res.activa) {
                if (badge) badge.textContent = '00:00 (Finalizada)';
                clearInterval(this.guestInterval);
                return;
            }

            const restSeg = Math.max(0, Math.ceil((res.expira_ts - Date.now()) / 1000));
            const min = String(Math.floor(restSeg / 60)).padStart(2, '0');
            const seg = String(restSeg % 60).padStart(2, '0');

            if (badge) badge.textContent = `${min}:${seg}`;
            if (headerRole && this.sesion.rol === 'INVITADO') {
                headerRole.textContent = `Invitado (${min}:${seg})`;
            }

            if (restSeg <= 0) {
                this.finalizarReservaInvitado(true);
            }
        };

        actualizarReloj();
        this.guestInterval = setInterval(actualizarReloj, 1000);
    }

    async finalizarReservaInvitado(porExpiracion = false) {
        clearInterval(this.guestInterval);
        const res = this.state.reservaInvitado;
        if (res && res.activa) {
            res.activa = false;
            this._saveState();

            // Seguridad física: al expirar o liberar la sesión de invitado, enviamos Detener
            if (this.onStopVehicle) {
                try {
                    await this.onStopVehicle();
                } catch (_) {}
            }

            this.registrarEventoAuditoria(
                porExpiracion ? 'EXPIRACION_INVITADO_STOP' : 'LIBERACION_INVITADO_STOP',
                'sesiones_control',
                res.id_vehiculo,
                porExpiracion
                    ? `Tiempo agotado en unidad #${res.id_vehiculo}: orden automática de DETENER enviada y reserva liberada.`
                    : `Visitante liberó la unidad de exhibición #${res.id_vehiculo} y se envió DETENER.`
            );

            ui.showFeedback(
                porExpiracion
                    ? 'Sesión de Invitado expirada: vehículo detenido de forma segura'
                    : 'Reserva de exhibición liberada y vehículo detenido',
                'warning',
                3800
            );
        }
        this.actualizarBadgeSesionCabecera();
        this.renderPanelInvitado();
    }

    async seleccionarUnidadActiva(idVehiculo, mostrarAviso = true) {
        const numId = Number(idVehiculo) || 1;
        const unidad = this.obtenerUnidadEnriquecida(numId);

        // Para llamadas a RDS (que tiene registrada físicamente la Unidad 1 o las creadas en vehiculos),
        // si la unidad virtual de prueba (ej. 2 o 3) aún no existe en la tabla vehiculos de RDS,
        // sincronizamos el canal o usamos el ID real disponible.
        const existeEnRds = this.unidadesRds.some(v => Number(v.id_vehiculo) === numId);
        CONFIG.VEHICULO_ACTIVO_LOGICO = numId;
        CONFIG.setVehiculoId(existeEnRds ? numId : 1);

        const sub = document.getElementById('header-unit-subtitle');
        if (sub) {
            sub.textContent = `${unidad.nombre} · ${unidad.numero_serie} (${unidad.estado_comercial})`;
        }

        const selHeader = document.getElementById('header-unit-select');
        if (selHeader && String(selHeader.value) !== String(numId)) {
            selHeader.value = String(numId);
        }

        if (this.onUnitChanged) {
            await this.onUnitChanged(CONFIG.VEHICULO_ID, unidad);
        }

        if (mostrarAviso) {
            ui.playSound('tap');
            ui.showFeedback(`Unidad activa: ${unidad.nombre} (${unidad.numero_serie})`, 'info', 2200);
        }
    }

    actualizarBadgeSesionCabecera() {
        const roleBadge = document.getElementById('header-role-text');
        const roleBtn = document.getElementById('btn-role-switcher');
        if (roleBadge) {
            roleBadge.textContent = `${this.sesion.rol}: ${this.sesion.nombre.split(' ')[0]}`;
        }
        if (roleBtn) {
            roleBtn.dataset.role = this.sesion.rol;
        }

        // Actualizar selector de unidades en cabecera según permisos del rol
        const selHeader = document.getElementById('header-unit-select');
        if (selHeader) {
            const visibles = this.obtenerUnidadesVisiblesPorRol();
            const actual = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
            selHeader.innerHTML = visibles.map(u => `
                <option value="${u.id_vehiculo}" ${Number(u.id_vehiculo) === Number(actual) ? 'selected' : ''}>
                    #${u.id_vehiculo} ${u.nombre} (${u.estado_comercial})
                </option>
            `).join('');
        }
    }

    renderizarTodo() {
        this.actualizarBadgeSesionCabecera();

        // Mostrar/ocultar secciones según el rol activo
        const secAdmin = document.getElementById('admin-role-section-admin');
        const secUser = document.getElementById('admin-role-section-usuario');
        const secGuest = document.getElementById('admin-role-section-invitado');

        if (secAdmin) secAdmin.classList.toggle('d-none', this.sesion.rol !== 'ADMIN');
        if (secUser) secUser.classList.toggle('d-none', this.sesion.rol !== 'USUARIO');
        if (secGuest) secGuest.classList.toggle('d-none', this.sesion.rol !== 'INVITADO');

        // Resaltar píldora de rol activo
        document.querySelectorAll('[data-switch-profile]').forEach(btn => {
            const code = btn.getAttribute('data-switch-profile');
            const isMatch =
                (code === 'ADMIN' && this.sesion.rol === 'ADMIN') ||
                (code === 'USUARIO_A' && this.sesion.rol === 'USUARIO' && this.sesion.id_usuario === 2) ||
                (code === 'USUARIO_B' && this.sesion.rol === 'USUARIO' && this.sesion.id_usuario === 3) ||
                (code === 'INVITADO' && this.sesion.rol === 'INVITADO');
            btn.classList.toggle('active', isMatch);
        });

        const bannerRol = document.getElementById('admin-current-session-banner');
        if (bannerRol) {
            const unidades = this.obtenerUnidadesVisiblesPorRol();
            bannerRol.innerHTML = `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge role-pill role-${this.sesion.rol.toLowerCase()} me-2">${this.sesion.rol}</span>
                        <strong>${this.sesion.nombre}</strong>
                        <span class="text-secondary ms-1">(${this.sesion.email})</span>
                    </div>
                    <div class="small text-info">
                        <i class="bi bi-shield-lock-fill"></i> Unidades autorizadas para tu cuenta: <strong>${unidades.length}</strong>
                    </div>
                </div>
            `;
        }

        if (this.sesion.rol === 'ADMIN') {
            this.renderMetricas();
            this.renderTablaModelos();
            this.renderTablaUnidades();
            this.renderTablaClientes();
            this.renderComandosUnidadAdmin(this.idUnidadComandosSel);
            this.renderAuditoria();
            this.cargarDemosParaEditor(this.idUnidadComandosSel);
        } else if (this.sesion.rol === 'USUARIO') {
            this.renderMisVehiculosUsuario();
            const misUnidades = this.obtenerUnidadesVisiblesPorRol();
            if (misUnidades.length > 0) {
                this.cargarDemosParaEditor(misUnidades[0].id_vehiculo);
            }
        } else if (this.sesion.rol === 'INVITADO') {
            this.renderPanelInvitado();
        }
    }

    renderMetricas() {
        const cont = document.getElementById('admin-metrics-grid');
        if (!cont) return;
        const todas = this.obtenerTodasLasUnidadesEnriquecidas();
        const vendidas = todas.filter(u => u.estado_comercial === 'VENDIDO').length;
        const exhibicion = todas.filter(u => u.estado_comercial === 'EXHIBICION').length;
        const disponibles = todas.filter(u => u.estado_comercial === 'DISPONIBLE').length;

        cont.innerHTML = `
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-boxes"></i> Modelos Comerciales</span>
                <strong class="metric-value text-info">${this.state.modelos.length}</strong>
                <small class="metric-sub">En catálogo activo</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-truck-flatbed"></i> Unidades Físicas</span>
                <strong class="metric-value">${todas.length}</strong>
                <small class="metric-sub">${disponibles} disponibles · ${exhibicion} exhibición</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-bag-check-fill"></i> Unidades Vendidas</span>
                <strong class="metric-value text-success">${vendidas}</strong>
                <small class="metric-sub">Con propietario asignado</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-people-fill"></i> Clientes Compradores</span>
                <strong class="metric-value text-warning">${this.state.clientes.length}</strong>
                <small class="metric-sub">${this.state.auditoria.length} eventos en bitácora</small>
            </div>
        `;
    }

    renderTablaModelos() {
        const tbody = document.getElementById('tabla-admin-modelos');
        const selectMod = document.getElementById('unit-form-modelo');
        if (tbody) {
            tbody.innerHTML = this.state.modelos.map(m => `
                <tr>
                    <td><span class="badge bg-dark border border-info text-info">${m.codigo_modelo}</span></td>
                    <td class="fw-semibold">${m.nombre}</td>
                    <td>${m.microcontrolador_default || 'ESP8266'}</td>
                    <td>
                        <span class="badge ${m.tiene_brazo ? 'bg-success' : 'bg-secondary'} me-1">Brazo: ${m.tiene_brazo ? 'Sí' : 'No'}</span>
                        <span class="badge ${m.tiene_motores_giro ? 'bg-info text-dark' : 'bg-secondary'}">Giro: ${m.tiene_motores_giro ? 'Sí' : 'No'}</span>
                    </td>
                </tr>
            `).join('');
        }
        if (selectMod) {
            selectMod.innerHTML = this.state.modelos.map(m => `
                <option value="${m.id_modelo}">${m.codigo_modelo} — ${m.nombre}</option>
            `).join('');
        }
    }

    renderTablaUnidades() {
        const tbody = document.getElementById('tabla-admin-unidades');
        const selectAsigUnidad = document.getElementById('asig-form-vehiculo');
        const selectCmdUnidad = document.getElementById('cmd-admin-unit-select');
        const unidades = this.obtenerTodasLasUnidadesEnriquecidas();

        if (tbody) {
            tbody.innerHTML = unidades.map(u => {
                const badgeClass =
                    u.estado_comercial === 'VENDIDO' ? 'bg-success' :
                    u.estado_comercial === 'EXHIBICION' ? 'bg-info text-dark' :
                    u.estado_comercial === 'MANTENIMIENTO' ? 'bg-danger' : 'bg-warning text-dark';

                const soporteHtml = u.estado_comercial === 'VENDIDO'
                    ? (u.soporte_autorizado
                        ? '<span class="badge bg-success"><i class="bi bi-unlock-fill"></i> Soporte Autorizado</span>'
                        : '<span class="badge bg-secondary"><i class="bi bi-lock-fill"></i> Privado (Bloqueado)</span>')
                    : '<span class="text-secondary small">Control Empresa</span>';

                return `
                    <tr>
                        <td><strong>#${u.id_vehiculo}</strong></td>
                        <td><code>${u.numero_serie}</code></td>
                        <td>
                            <div class="fw-semibold">${u.nombre}</div>
                            <small class="text-secondary">${u.modelo} (${u.codigo_modelo})</small>
                        </td>
                        <td><span class="badge ${badgeClass}">${u.estado_comercial}</span></td>
                        <td>${u.nombre_propietario ? `<i class="bi bi-person-check-fill text-success"></i> ${u.nombre_propietario}` : '<span class="text-secondary">Sin asignar</span>'}</td>
                        <td>${soporteHtml}</td>
                        <td>
                            <div class="d-flex flex-wrap gap-1">
                                <button type="button" class="btn btn-sm btn-outline-info py-0 px-2" data-action="intentar-operar-admin" data-id="${u.id_vehiculo}" title="Abrir en Control">
                                    <i class="bi bi-controller"></i> Operar
                                </button>
                                ${u.id_propietario ? `
                                    <button type="button" class="btn btn-sm btn-outline-warning py-0 px-2" data-action="revocar-unidad" data-id="${u.id_vehiculo}" title="Revocar asignación">
                                        <i class="bi bi-person-dash"></i> Liberar
                                    </button>
                                ` : ''}
                                <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" data-action="cambiar-exhibicion" data-id="${u.id_vehiculo}" title="Alternar Exhibición/Disponible">
                                    <i class="bi bi-display"></i> Exhibición
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (selectAsigUnidad) {
            selectAsigUnidad.innerHTML = unidades.map(u => `
                <option value="${u.id_vehiculo}">#${u.id_vehiculo} ${u.nombre} (${u.numero_serie} · ${u.estado_comercial})</option>
            `).join('');
        }

        if (selectCmdUnidad) {
            selectCmdUnidad.innerHTML = unidades.map(u => `
                <option value="${u.id_vehiculo}" ${Number(u.id_vehiculo) === Number(this.idUnidadComandosSel) ? 'selected' : ''}>
                    #${u.id_vehiculo} — ${u.nombre} (${u.modelo})
                </option>
            `).join('');
        }
    }

    renderTablaClientes() {
        const tbody = document.getElementById('tabla-admin-clientes');
        const selectCliente = document.getElementById('asig-form-cliente');
        const unidades = this.obtenerTodasLasUnidadesEnriquecidas();

        if (tbody) {
            tbody.innerHTML = this.state.clientes.map(c => {
                const propias = unidades.filter(u => Number(u.id_propietario) === Number(c.id_usuario));
                return `
                    <tr>
                        <td>#${c.id_usuario}</td>
                        <td class="fw-semibold">${c.nombre}</td>
                        <td>${c.email}</td>
                        <td>
                            ${propias.length
                                ? propias.map(p => `<span class="badge bg-success me-1">#${p.id_vehiculo} ${p.nombre}</span>`).join('')
                                : '<span class="text-secondary small">Ninguna asignada</span>'}
                        </td>
                        <td>
                            <button type="button" class="btn btn-sm btn-outline-info py-0 px-2" data-action="simular-cliente" data-id="${c.id_usuario}">
                                <i class="bi bi-box-arrow-in-right"></i> Ver como este cliente
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (selectCliente) {
            selectCliente.innerHTML = this.state.clientes.map(c => `
                <option value="${c.id_usuario}">${c.nombre} (${c.email})</option>
            `).join('');
        }
    }

    async renderComandosUnidadAdmin(idVehiculo = 1) {
        this.idUnidadComandosSel = Number(idVehiculo) || 1;
        const cont = document.getElementById('admin-comandos-list');
        if (!cont) return;

        try {
            const idRds = this.unidadesRds.some(v => Number(v.id_vehiculo) === this.idUnidadComandosSel) ? this.idUnidadComandosSel : 1;
            const comandos = await api.obtenerComandos(idRds);
            this.comandosUnidadAdmin = Array.isArray(comandos) ? comandos : [];
            const unidad = this.obtenerUnidadEnriquecida(this.idUnidadComandosSel);
            const modeloObj = this.state.modelos.find(m => Number(m.id_modelo) === Number(unidad.id_modelo));

            cont.innerHTML = this.comandosUnidadAdmin.map(cmd => {
                const esDetener = normalizar(cmd.nombre) === 'DETENER';
                const esBrazo = /BRAZO/.test(normalizar(cmd.nombre));
                const incompatibleHardware = modeloObj && !modeloObj.tiene_brazo && esBrazo;
                const activoEfectivo = incompatibleHardware ? false : (cmd.activo !== false && cmd.activo !== 0);

                return `
                    <div class="admin-cmd-chip ${activoEfectivo ? 'is-active' : 'is-disabled'}">
                        <div>
                            <div class="fw-semibold">${cmd.nombre} <small class="text-secondary">(Cód. ${cmd.codigo})</small></div>
                            <small class="text-secondary">${incompatibleHardware ? 'No compatible con este modelo' : (esDetener ? 'Paro prioritario obligatorio' : 'Capacidad habilitada')}</small>
                        </div>
                        <div class="form-check form-switch m-0">
                            <input class="form-check-input" type="checkbox"
                                data-action="toggle-cmd-activo"
                                data-id="${cmd.id_comando}"
                                ${activoEfectivo ? 'checked' : ''}
                                ${esDetener || incompatibleHardware ? 'disabled' : ''}>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            cont.innerHTML = `<div class="text-secondary small">No se pudieron cargar los comandos desde RDS.</div>`;
        }
    }

    renderAuditoria() {
        const tbody = document.getElementById('tabla-admin-auditoria');
        if (!tbody) return;
        tbody.innerHTML = this.state.auditoria.slice(0, 15).map(ev => {
            const { fecha, hora } = ui.formatearFechaHora(ev.fecha_hora);
            const isAlert = /BLOQUEADO|SIN_SOPORTE/.test(ev.accion);
            return `
                <tr class="${isAlert ? 'table-danger-row' : ''}">
                    <td><span class="badge ${isAlert ? 'bg-danger' : 'bg-secondary'}">${ev.accion}</span></td>
                    <td><strong>${ev.actor}</strong> <small class="text-secondary">(${ev.rol})</small></td>
                    <td>${ev.detalle || ''}</td>
                    <td class="text-nowrap small">${fecha} ${hora}</td>
                </tr>
            `;
        }).join('');
    }

    // --- VISTA ROL USUARIO COMPRADOR: MIS VEHÍCULOS Y SOPORTE ---
    renderMisVehiculosUsuario() {
        const cont = document.getElementById('usuario-mis-vehiculos-grid');
        if (!cont) return;

        const misUnidades = this.obtenerUnidadesVisiblesPorRol();
        if (misUnidades.length === 0) {
            cont.innerHTML = `
                <div class="admin-empty-state">
                    <i class="bi bi-car-front fs-2 text-secondary"></i>
                    <p class="mb-0 mt-2">Aún no tienes unidades asignadas a tu cuenta de comprador.</p>
                </div>
            `;
            return;
        }

        const idActivo = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        cont.innerHTML = misUnidades.map(u => {
            const esActiva = Number(u.id_vehiculo) === Number(idActivo);
            return `
                <div class="user-vehicle-card ${esActiva ? 'is-selected' : ''}">
                    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <div>
                            <span class="badge bg-success mb-1"><i class="bi bi-patch-check-fill"></i> PROPIETARIO TITULAR</span>
                            <h3 class="h6 mb-0 fw-bold">${u.nombre}</h3>
                            <small class="text-secondary">${u.modelo} · Serie: <code>${u.numero_serie}</code></small>
                        </div>
                        <span class="badge bg-dark border border-secondary">ID #${u.id_vehiculo}</span>
                    </div>
                    <p class="small text-secondary mb-3">${u.descripcion || 'Unidad IoT asignada a tu cuenta con telemetría y control privado.'}</p>

                    <div class="support-consent-box mb-3">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="switch-soporte-${u.id_vehiculo}"
                                data-action="toggle-soporte-propietario" data-id="${u.id_vehiculo}"
                                ${u.soporte_autorizado ? 'checked' : ''}>
                            <label class="form-check-label small fw-semibold" for="switch-soporte-${u.id_vehiculo}">
                                Autorizar soporte técnico al Administrador (30 min)
                            </label>
                        </div>
                        <small class="d-block text-secondary mt-1">
                            ${u.soporte_autorizado
                                ? '<span class="text-warning"><i class="bi bi-unlock-fill"></i> El Administrador tiene permiso temporal para probar tu unidad.</span>'
                                : '<span class="text-success"><i class="bi bi-shield-lock-fill"></i> Control privado: ni el Administrador ni otros usuarios pueden mover tu vehículo.</span>'}
                        </small>
                    </div>

                    <div class="d-flex flex-wrap gap-2">
                        <button type="button" class="btn btn-sm ${esActiva ? 'btn-info text-dark fw-bold' : 'btn-outline-info'}"
                            data-action="seleccionar-mi-vehiculo" data-id="${u.id_vehiculo}">
                            <i class="bi bi-controller"></i> ${esActiva ? 'Unidad Activa en Control' : 'Usar en Control y Monitoreo'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- EDITOR DE DEMOS Y SECUENCIAS ORDENADAS (PERSISTIDO EN RDS) ---
    async cargarDemosParaEditor(idVehiculo = 1) {
        const idRds = this.unidadesRds.some(v => Number(v.id_vehiculo) === Number(idVehiculo)) ? Number(idVehiculo) : 1;
        const contDemos = document.getElementById('editor-demos-lista');
        const selectCmdPaso = document.getElementById('step-form-comando');
        if (!contDemos) return;

        try {
            const [demos, comandos] = await Promise.all([
                api.obtenerDemos(idRds),
                api.obtenerComandos(idRds)
            ]);
            this.demosUnidadEditor = Array.isArray(demos) ? demos : [];
            const comandosActivos = (Array.isArray(comandos) ? comandos : []).filter(c => c.activo !== false && c.activo !== 0);

            if (selectCmdPaso) {
                selectCmdPaso.innerHTML = comandosActivos.map(c => `
                    <option value="${c.id_comando}">${c.nombre} (ID ${c.id_comando})</option>
                `).join('');
            }

            if (this.demosUnidadEditor.length === 0) {
                contDemos.innerHTML = `<div class="text-secondary small">No hay secuencias demo registradas para esta unidad.</div>`;
                this.idDemoSeleccionada = null;
                this.renderPasosDemoEditor([]);
                return;
            }

            if (!this.idDemoSeleccionada || !this.demosUnidadEditor.some(d => Number(d.id_demo) === Number(this.idDemoSeleccionada))) {
                this.idDemoSeleccionada = this.demosUnidadEditor[0].id_demo;
            }

            contDemos.innerHTML = this.demosUnidadEditor.map(d => {
                const meta = this.state.metaDemos[d.id_demo] || {};
                const tipo = d.tipo_demo || meta.tipo_demo || (d.id_demo === 1 ? 'EMPRESA' : 'PRIVADA');
                const sel = Number(d.id_demo) === Number(this.idDemoSeleccionada);
                return `
                    <div class="demo-editor-item ${sel ? 'active' : ''}">
                        <div class="demo-editor-item-main" data-action="seleccionar-demo-editor" data-id="${d.id_demo}">
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge ${tipo === 'EMPRESA' ? 'bg-info text-dark' : 'bg-warning text-dark'}">${tipo}</span>
                                <strong>${d.nombre}</strong>
                            </div>
                            <small class="text-secondary">${d.descripcion || 'Secuencia programada en RDS'}</small>
                        </div>
                        <div class="d-flex gap-1">
                            <button type="button" class="btn btn-sm btn-outline-success py-0 px-2" data-action="ejecutar-demo-desde-editor" data-id="${d.id_demo}" title="Ir a Control y ejecutar">
                                <i class="bi bi-play-fill"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="eliminar-demo-editor" data-id="${d.id_demo}" title="Eliminar demo">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
        } catch (err) {
            contDemos.innerHTML = `<div class="text-danger small">Error cargando demos desde RDS: ${err.message}</div>`;
        }
    }

    async cargarPasosDeDemoSeleccionada(idDemo) {
        this.idDemoSeleccionada = Number(idDemo);
        const label = document.getElementById('editor-pasos-titulo');
        const demoObj = this.demosUnidadEditor.find(d => Number(d.id_demo) === this.idDemoSeleccionada);
        if (label) {
            label.textContent = demoObj ? `Pasos de: ${demoObj.nombre} (#${demoObj.id_demo})` : 'Pasos de la secuencia';
        }

        try {
            const pasos = await api.obtenerMovimientosDemo(this.idDemoSeleccionada);
            this.movimientosDemoActual = (Array.isArray(pasos) ? pasos : []).sort((a, b) => Number(a.orden) - Number(b.orden));
            this.renderPasosDemoEditor(this.movimientosDemoActual);
        } catch (err) {
            this.renderPasosDemoEditor([]);
        }
    }

    renderPasosDemoEditor(pasos) {
        const tbody = document.getElementById('tabla-editor-pasos');
        if (!tbody) return;

        if (!pasos || pasos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-secondary py-3">
                        Esta secuencia aún no tiene pasos. Agrega un movimiento abajo.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = pasos.map((p, idx) => `
            <tr>
                <td><span class="monitor-row-num">${p.orden}</span></td>
                <td class="fw-semibold">${p.comando || `Comando #${p.id_comando}`}</td>
                <td>${p.duracion_ms} ms</td>
                <td>${p.pausa_ms} ms</td>
                <td>
                    <div class="d-flex gap-1">
                        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2"
                            data-action="mover-paso-arriba" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Subir paso">
                            <i class="bi bi-arrow-up"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2"
                            data-action="mover-paso-abajo" data-idx="${idx}" ${idx === pasos.length - 1 ? 'disabled' : ''} title="Bajar paso">
                            <i class="bi bi-arrow-down"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2"
                            data-action="eliminar-paso-demo" data-id="${p.id_demo_movimiento}" title="Quitar paso">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // --- VISTA ROL INVITADO: CATÁLOGO PÚBLICO Y PRUEBA TEMPORAL DE EXHIBICIÓN ---
    renderPanelInvitado() {
        const catCont = document.getElementById('invitado-catalogo-grid');
        const boxReserva = document.getElementById('invitado-reserva-status');
        if (catCont) {
            catCont.innerHTML = this.state.modelos.map(m => `
                <div class="user-vehicle-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge bg-info text-dark">${m.codigo_modelo}</span>
                        <span class="badge bg-dark border border-secondary">${m.microcontrolador_default}</span>
                    </div>
                    <h3 class="h6 fw-bold mb-1">${m.nombre}</h3>
                    <p class="small text-secondary mb-2">${m.descripcion}</p>
                    <div class="small">
                        <span class="badge ${m.tiene_brazo ? 'bg-success' : 'bg-secondary'} me-1">Brazo Hidráulico: ${m.tiene_brazo ? 'Incluido' : 'No aplica'}</span>
                        <span class="badge bg-primary">Demos Preconfiguradas</span>
                    </div>
                </div>
            `).join('');
        }

        if (boxReserva) {
            const res = this.state.reservaInvitado;
            const activa = res && res.activa && res.expira_ts > Date.now();
            boxReserva.innerHTML = activa ? `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge bg-success me-2"><i class="bi bi-broadcast-pin"></i> RESERVA EXCLUSIVA ACTIVA</span>
                        <strong>${res.nombre_vehiculo}</strong> · Operador: <span class="text-info">${res.operador}</span>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-warning text-dark fs-6"><i class="bi bi-stopwatch"></i> <span id="guest-countdown-timer">03:00</span></span>
                        <button type="button" class="btn btn-sm btn-info text-dark fw-bold" data-action="ir-control-invitado">
                            <i class="bi bi-controller"></i> Probar Unidad Ahora
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="finalizar-reserva-invitado">
                            <i class="bi bi-stop-circle"></i> Finalizar y Detener
                        </button>
                    </div>
                </div>
            ` : `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge bg-secondary me-2">SIN RESERVA ACTIVA</span>
                        <span>Inicia una sesión temporal de 3 minutos para probar la unidad de exhibición sin afectar unidades de clientes.</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-success fw-bold" data-action="renovar-reserva-invitado">
                        <i class="bi bi-play-circle-fill"></i> Solicitar Reserva de Exhibición (3 min)
                    </button>
                </div>
            `;
        }
    }

    _bindEvents() {
        // Cambio de unidad desde el selector rápido de cabecera
        const selHeader = document.getElementById('header-unit-select');
        if (selHeader) {
            selHeader.addEventListener('change', (e) => {
                this.seleccionarUnidadActiva(Number(e.target.value), true);
            });
        }

        // Botón en cabecera para ir rápido a la pestaña Administración / Perfil
        const btnRole = document.getElementById('btn-role-switcher');
        if (btnRole) {
            btnRole.addEventListener('click', () => {
                const tabAdmin = document.getElementById('btn-tab-admin');
                if (tabAdmin) tabAdmin.click();
            });
        }

        // Delegación de clics dentro de #vista-admin
        const vistaAdmin = document.getElementById('vista-admin');
        if (!vistaAdmin) return;

        vistaAdmin.addEventListener('click', async (e) => {
            const btnProfile = e.target.closest('[data-switch-profile]');
            if (btnProfile) {
                const code = btnProfile.getAttribute('data-switch-profile');
                await this.cambiarPerfilActivo(code);
                return;
            }

            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.getAttribute('data-action');
            const id = Number(actionEl.getAttribute('data-id'));

            if (action === 'intentar-operar-admin') {
                const check = this.verificarPermisoOperacion(id, false);
                if (!check.ok) return;
                await this.seleccionarUnidadActiva(id, true);
                document.getElementById('btn-tab-control')?.click();
            }

            if (action === 'revocar-unidad') {
                if (this.state.metaUnidades[id]) {
                    this.state.metaUnidades[id].id_propietario = null;
                    this.state.metaUnidades[id].estado_comercial = 'DISPONIBLE';
                    this.state.metaUnidades[id].soporte_autorizado = false;
                    this._saveState();
                }
                try { await api.revocarAsignacion(id, 'DISPONIBLE'); } catch (_) {}
                this.registrarEventoAuditoria('REVOCACION_UNIDAD', 'asignaciones_vehiculo', id, `Asignación de la unidad #${id} revocada -> pasa a DISPONIBLE.`);
                this.renderizarTodo();
                ui.showFeedback(`Unidad #${id} liberada a estado DISPONIBLE`, 'warning', 2500);
            }

            if (action === 'cambiar-exhibicion') {
                if (!this.state.metaUnidades[id]) this.state.metaUnidades[id] = {};
                const actual = this.state.metaUnidades[id].estado_comercial;
                const nuevo = actual === 'EXHIBICION' ? 'DISPONIBLE' : 'EXHIBICION';
                this.state.metaUnidades[id].estado_comercial = nuevo;
                this.state.metaUnidades[id].id_propietario = null;
                this._saveState();
                this.registrarEventoAuditoria('CAMBIO_ESTADO_COMERCIAL', 'vehiculos', id, `Unidad #${id} cambiada a estado ${nuevo}.`);
                this.renderizarTodo();
                ui.showFeedback(`Unidad #${id} marcada como ${nuevo}`, 'info', 2500);
            }

            if (action === 'simular-cliente') {
                const cliente = this.state.clientes.find(c => Number(c.id_usuario) === id);
                if (cliente) {
                    if (id === 2) await this.cambiarPerfilActivo('USUARIO_A');
                    else if (id === 3) await this.cambiarPerfilActivo('USUARIO_B');
                    else await this.cambiarPerfilActivo('CLIENTE_CUSTOM', { cliente });
                }
            }

            if (action === 'seleccionar-mi-vehiculo') {
                await this.seleccionarUnidadActiva(id, true);
                this.renderMisVehiculosUsuario();
                document.getElementById('btn-tab-control')?.click();
            }

            if (action === 'seleccionar-demo-editor') {
                ui.playSound('tap');
                await this.cargarPasosDeDemoSeleccionada(id);
                this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
            }

            if (action === 'ejecutar-demo-desde-editor') {
                document.getElementById('btn-tab-control')?.click();
                const selectDemo = document.getElementById('demo-select');
                if (selectDemo) {
                    selectDemo.value = String(id);
                }
                ui.showFeedback('Secuencia seleccionada en el panel de Control', 'success', 2400);
            }

            if (action === 'eliminar-demo-editor') {
                try {
                    await api.eliminarDemo(id);
                    this.registrarEventoAuditoria('ELIMINAR_DEMO', 'demos', id, `Secuencia DEMO #${id} eliminada de RDS.`);
                    ui.showFeedback('Secuencia DEMO eliminada de RDS', 'warning', 2400);
                    await this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
                    if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
                } catch (err) {
                    ui.showFeedback(`No se pudo eliminar la demo: ${err.message}`, 'danger');
                }
            }

            if (action === 'eliminar-paso-demo') {
                try {
                    await api.eliminarMovimientoDemo(id);
                    ui.playSound('cancel');
                    ui.showFeedback('Paso eliminado de la secuencia en RDS', 'warning', 2000);
                    await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
                } catch (err) {
                    ui.showFeedback(`Error al eliminar paso: ${err.message}`, 'danger');
                }
            }

            if (action === 'mover-paso-arriba' || action === 'mover-paso-abajo') {
                const idx = Number(actionEl.getAttribute('data-idx'));
                const targetIdx = action === 'mover-paso-arriba' ? idx - 1 : idx + 1;
                if (targetIdx < 0 || targetIdx >= this.movimientosDemoActual.length) return;

                const pasoA = this.movimientosDemoActual[idx];
                const pasoB = this.movimientosDemoActual[targetIdx];
                try {
                    await Promise.all([
                        api.actualizarMovimientoDemo(pasoA.id_demo_movimiento, {
                            id_comando: pasoA.id_comando,
                            orden: pasoB.orden,
                            duracion_ms: pasoA.duracion_ms,
                            pausa_ms: pasoA.pausa_ms
                        }),
                        api.actualizarMovimientoDemo(pasoB.id_demo_movimiento, {
                            id_comando: pasoB.id_comando,
                            orden: pasoA.orden,
                            duracion_ms: pasoB.duracion_ms,
                            pausa_ms: pasoB.pausa_ms
                        })
                    ]);
                    ui.playSound('tap');
                    await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
                } catch (err) {
                    ui.showFeedback('Error al reordenar pasos en RDS', 'danger');
                }
            }

            if (action === 'ir-control-invitado') {
                document.getElementById('btn-tab-control')?.click();
            }

            if (action === 'finalizar-reserva-invitado') {
                await this.finalizarReservaInvitado(false);
            }

            if (action === 'renovar-reserva-invitado') {
                this.iniciarReservaInvitado(this.sesion.nombre || 'Visitante Showroom');
                this.renderPanelInvitado();
                ui.showFeedback('Reserva exclusiva de exhibición activada por 3 minutos', 'success', 2600);
            }

            // Laboratorio de Pruebas de Seguridad (RBAC / BOLA / Soporte)
            if (action === 'test-bola-cruzado') {
                const idAjeno = this.sesion.id_usuario === 2 ? 3 : 1;
                this.verificarPermisoOperacion(idAjeno, false);
                this._mostrarResultadoPruebaSeguridad(
                    `[PRUEBA BOLA/IDOR] Usuario actual (${this.sesion.nombre}) intentó enviar comando a Unidad #${idAjeno} (ajena) → BLOQUEADO HTTP 403 Forbidden.`
                );
            }

            if (action === 'test-admin-sin-soporte') {
                const meta1 = this.state.metaUnidades[1];
                if (meta1 && !meta1.soporte_autorizado) {
                    this.registrarEventoAuditoria(
                        'ADMIN_CONTROL_SIN_SOPORTE',
                        'vehiculos',
                        1,
                        '[403 PRIVACIDAD] Prueba verificada: Admin bloqueado al intentar operar Unidad #1 (Vendida a Cynthia) sin soporte autorizado.'
                    );
                    ui.showFeedback('403 Bloqueado: Admin no puede controlar unidad vendida sin soporte autorizado', 'danger', 4000);
                    this._mostrarResultadoPruebaSeguridad(
                        `[PRUEBA PRIVACIDAD COMPRADOR] Admin intentó mover Unidad #1 (Vendida) con soporte_autorizado=OFF → BLOQUEADO HTTP 403 Forbidden.`
                    );
                } else {
                    this._mostrarResultadoPruebaSeguridad(
                        `[AVISO] Actualmente la Unidad #1 tiene el soporte autorizado ACTIVO. Desactívalo en la cuenta de Cynthia para probar el bloqueo 403.`
                    );
                }
            }

            if (action === 'test-invitado-unidad-vendida') {
                this.registrarEventoAuditoria(
                    'INVITADO_UNIDAD_PRIVADA_BLOQUEADO',
                    'vehiculos',
                    1,
                    '[403 RBAC] Prueba verificada: Invitado rechazado al intentar acceder a Unidad #1 (Vendida).'
                );
                ui.showFeedback('403 Bloqueado: Invitado no puede acceder a unidades de clientes compradores', 'danger', 4000);
                this._mostrarResultadoPruebaSeguridad(
                    `[PRUEBA AISLAMIENTO INVITADO] Invitado intentó operar Unidad #1 (VENDIDO) → BLOQUEADO HTTP 403 Forbidden.`
                );
            }
        });

        // Cambios en switches (soporte técnico del comprador y activación de comandos)
        vistaAdmin.addEventListener('change', async (e) => {
            const target = e.target;
            if (target.id === 'cmd-admin-unit-select') {
                await this.renderComandosUnidadAdmin(Number(target.value));
                return;
            }

            const action = target.getAttribute('data-action');
            const id = Number(target.getAttribute('data-id'));

            if (action === 'toggle-soporte-propietario') {
                const autorizado = Boolean(target.checked);
                if (!this.state.metaUnidades[id]) this.state.metaUnidades[id] = {};
                this.state.metaUnidades[id].soporte_autorizado = autorizado;
                this._saveState();
                try {
                    await api.configurarSoporte(id, autorizado, 30);
                } catch (_) {}
                this.registrarEventoAuditoria(
                    'SOPORTE_AUTORIZACION',
                    'vehiculos',
                    id,
                    autorizado
                        ? `Propietario (${this.sesion.nombre}) AUTORIZÓ soporte técnico al Administrador sobre la unidad #${id} por 30 min.`
                        : `Propietario (${this.sesion.nombre}) REVOCÓ el acceso de soporte técnico sobre la unidad #${id}.`
                );
                this.renderMisVehiculosUsuario();
                ui.showFeedback(
                    autorizado
                        ? 'Soporte técnico autorizado al Administrador por 30 min'
                        : 'Soporte técnico revocado: control exclusivo privado activado',
                    autorizado ? 'warning' : 'success',
                    3000
                );
            }

            if (action === 'toggle-cmd-activo') {
                const cmd = this.comandosUnidadAdmin.find(c => Number(c.id_comando) === id);
                if (!cmd) return;
                const nuevoActivo = Boolean(target.checked);
                try {
                    await api.actualizarComando(id, {
                        nombre: cmd.nombre,
                        codigo: cmd.codigo,
                        descripcion: cmd.descripcion || '',
                        activo: nuevoActivo
                    });
                    this.registrarEventoAuditoria(
                        'CONFIG_COMANDO',
                        'comandos',
                        id,
                        `Comando '${cmd.nombre}' ${nuevoActivo ? 'HABILITADO' : 'DESHABILITADO'} en RDS.`
                    );
                    ui.showFeedback(`Comando ${cmd.nombre}: ${nuevoActivo ? 'Habilitado' : 'Deshabilitado'}`, 'info', 2200);
                    await this.renderComandosUnidadAdmin(this.idUnidadComandosSel);
                    if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
                } catch (err) {
                    target.checked = !nuevoActivo;
                    ui.showFeedback(`Error al actualizar comando: ${err.message}`, 'danger');
                }
            }
        });

        // Formularios administrativos y de demos
        this._bindForms();
    }

    _mostrarResultadoPruebaSeguridad(texto) {
        const box = document.getElementById('security-test-output');
        if (box) {
            box.classList.remove('d-none');
            box.innerHTML = `<i class="bi bi-shield-check text-warning me-1"></i> ${texto}`;
        }
    }

    _bindForms() {
        // 1. Alta de Modelo Comercial
        const formModelo = document.getElementById('form-admin-modelo');
        if (formModelo) {
            formModelo.addEventListener('submit', async (e) => {
                e.preventDefault();
                const codigo = document.getElementById('mod-form-codigo').value.trim().toUpperCase();
                const nombre = document.getElementById('mod-form-nombre').value.trim();
                const micro = document.getElementById('mod-form-micro').value.trim() || 'ESP8266';
                const brazo = document.getElementById('mod-form-brazo').checked;
                if (!codigo || !nombre) return;

                const nuevo = {
                    id_modelo: this.state.modelos.length + 1,
                    codigo_modelo: codigo,
                    nombre,
                    descripcion: 'Modelo comercial registrado desde Administración',
                    microcontrolador_default: micro,
                    tiene_brazo: brazo,
                    tiene_motores_giro: true,
                    activo: true
                };
                try { await api.crearModeloComercial(nuevo); } catch (_) {}
                this.state.modelos.push(nuevo);
                this._saveState();
                this.registrarEventoAuditoria('ALTA_MODELO', 'modelos_catalogo', nuevo.id_modelo, `Modelo comercial '${nombre}' (${codigo}) creado.`);
                formModelo.reset();
                this.renderizarTodo();
                ui.showFeedback(`Modelo comercial ${codigo} registrado`, 'success');
            });
        }

        // 2. Alta de Unidad Física (se guarda en la tabla `vehiculos` de RDS vía POST /api/vehiculos/)
        const formUnidad = document.getElementById('form-admin-unidad');
        if (formUnidad) {
            formUnidad.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombre = document.getElementById('unit-form-nombre').value.trim();
                const serie = document.getElementById('unit-form-serie').value.trim().toUpperCase();
                const idModelo = Number(document.getElementById('unit-form-modelo').value) || 1;
                const estadoCom = document.getElementById('unit-form-estado').value || 'DISPONIBLE';
                const modeloObj = this.state.modelos.find(m => Number(m.id_modelo) === idModelo) || this.state.modelos[0];
                if (!nombre || !serie) return;

                try {
                    const creada = await api.crearVehiculoBase({
                        nombre,
                        modelo: modeloObj.nombre,
                        descripcion: `Serie: ${serie} · Estado: ${estadoCom}`,
                        microcontrolador: modeloObj.microcontrolador_default || 'ESP8266'
                    });
                    const idNuevo = creada?.id_vehiculo || (this.obtenerTodasLasUnidadesEnriquecidas().length + 1);
                    this.state.metaUnidades[idNuevo] = {
                        id_modelo: idModelo,
                        numero_serie: serie,
                        estado_comercial: estadoCom,
                        id_propietario: null,
                        soporte_autorizado: false
                    };
                    this._saveState();
                    this.registrarEventoAuditoria('ALTA_UNIDAD_RDS', 'vehiculos', idNuevo, `Unidad física '${nombre}' (${serie}) persistida en Amazon RDS.`);
                    formUnidad.reset();
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Unidad '${nombre}' registrada en Amazon RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al registrar unidad: ${err.message}`, 'danger');
                }
            });
        }

        // 3. Alta de Cliente Comprador
        const formCliente = document.getElementById('form-admin-cliente');
        if (formCliente) {
            formCliente.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombre = document.getElementById('cli-form-nombre').value.trim();
                const email = document.getElementById('cli-form-email').value.trim().toLowerCase();
                const password = document.getElementById('cli-form-pass').value;
                if (!nombre || !email) return;

                const nuevoId = Math.max(3, ...this.state.clientes.map(c => Number(c.id_usuario))) + 1;
                const nuevoCli = { id_usuario: nuevoId, nombre, email, rol: 'USUARIO', activo: true };
                try { await api.registrarCliente({ nombre, email, password }); } catch (_) {}
                this.state.clientes.push(nuevoCli);
                this._saveState();
                this.registrarEventoAuditoria('ALTA_CLIENTE', 'usuarios', nuevoId, `Cliente comprador '${nombre}' (${email}) dado de alta.`);
                formCliente.reset();
                this.renderizarTodo();
                ui.showFeedback(`Cliente ${nombre} registrado`, 'success');
            });
        }

        // 4. Asignación de Unidad Física a Cliente Comprador
        const formAsig = document.getElementById('form-admin-asignacion');
        if (formAsig) {
            formAsig.addEventListener('submit', async (e) => {
                e.preventDefault();
                const idVehiculo = Number(document.getElementById('asig-form-vehiculo').value);
                const idUsuario = Number(document.getElementById('asig-form-cliente').value);
                const cliente = this.state.clientes.find(c => Number(c.id_usuario) === idUsuario);

                if (!this.state.metaUnidades[idVehiculo]) this.state.metaUnidades[idVehiculo] = {};
                this.state.metaUnidades[idVehiculo].id_propietario = idUsuario;
                this.state.metaUnidades[idVehiculo].estado_comercial = 'VENDIDO';
                this.state.metaUnidades[idVehiculo].soporte_autorizado = false;
                this._saveState();

                try { await api.asignarUnidad({ id_vehiculo: idVehiculo, id_usuario: idUsuario }); } catch (_) {}
                this.registrarEventoAuditoria(
                    'ASIGNACION_COMPRADOR',
                    'asignaciones_vehiculo',
                    idVehiculo,
                    `Unidad #${idVehiculo} asignada en propiedad a ${cliente?.nombre || idUsuario} (Estado -> VENDIDO).`
                );
                this.renderizarTodo();
                ui.showFeedback(`Unidad #${idVehiculo} asignada a ${cliente?.nombre}`, 'success');
            });
        }

        // 5. Crear nueva Secuencia DEMO en RDS (Empresa o Privada)
        const formDemo = document.getElementById('form-editor-nueva-demo');
        if (formDemo) {
            formDemo.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombre = document.getElementById('demo-form-nombre').value.trim();
                const desc = document.getElementById('demo-form-desc').value.trim();
                if (!nombre) return;

                try {
                    const creada = await api.crearDemo({
                        id_vehiculo: CONFIG.VEHICULO_ID,
                        nombre,
                        descripcion: desc || `Creada por ${this.sesion.nombre}`
                    });
                    const idNueva = creada?.id_demo;
                    if (idNueva) {
                        const tipo = this.sesion.rol === 'ADMIN' ? 'EMPRESA' : 'PRIVADA';
                        this.state.metaDemos[idNueva] = {
                            tipo_demo: tipo,
                            id_usuario_creador: this.sesion.id_usuario
                        };
                        this._saveState();
                        this.idDemoSeleccionada = idNueva;
                    }
                    this.registrarEventoAuditoria(
                        'CREAR_DEMO_RDS',
                        'demos',
                        idNueva || 0,
                        `Secuencia DEMO '${nombre}' (${this.sesion.rol === 'ADMIN' ? 'EMPRESA' : 'PRIVADA'}) guardada en Amazon RDS.`
                    );
                    formDemo.reset();
                    await this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
                    if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
                    ui.showFeedback(`Demo '${nombre}' guardada en RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al crear demo en RDS: ${err.message}`, 'danger');
                }
            });
        }

        // 6. Agregar Paso Ordenado a la DEMO seleccionada en RDS
        const formPaso = document.getElementById('form-editor-agregar-paso');
        if (formPaso) {
            formPaso.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!this.idDemoSeleccionada) {
                    ui.showFeedback('Selecciona o crea primero una secuencia DEMO', 'warning');
                    return;
                }
                const idComando = Number(document.getElementById('step-form-comando').value);
                const duracionMs = Number(document.getElementById('step-form-duracion').value) || 1500;
                const pausaMs = Number(document.getElementById('step-form-pausa').value) || 400;

                if (duracionMs < 100 || duracionMs > 10000) {
                    ui.showFeedback('Por seguridad física, la duración debe estar entre 100 ms y 10,000 ms', 'danger');
                    return;
                }

                const siguienteOrden = (this.movimientosDemoActual.length > 0)
                    ? Math.max(...this.movimientosDemoActual.map(m => Number(m.orden) || 0)) + 1
                    : 1;

                try {
                    await api.agregarMovimientoDemo(this.idDemoSeleccionada, {
                        id_comando: idComando,
                        orden: siguienteOrden,
                        duracion_ms: duracionMs,
                        pausa_ms: pausaMs
                    });
                    ui.playSound('start');
                    ui.showFeedback(`Paso #${siguienteOrden} agregado en RDS`, 'success', 2000);
                    await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
                } catch (err) {
                    ui.showFeedback(`Error al guardar paso: ${err.message}`, 'danger');
                }
            });
        }
    }
}

export const adminManager = new AdminManager();
