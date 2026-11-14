// assets/js/admin.js
import { api } from './api.js?v=15';
import { CONFIG } from './config.js?v=15';
import { ui, normalizar } from './ui.js?v=15';

const SESSION_TOKEN_KEY = 'vehiculo_iot_jwt_session';

// Limpiar cualquier estado antiguo que se haya guardado en localStorage en versiones previas
try {
    localStorage.removeItem('vehiculo_iot_admin_state_v1');
} catch (_) {}

// Estado base en memoria (con soporte_autorizado = false en Unidad #1 para cumplir el Caso de Prueba 4 -> 403)
function crearEstadoInicialMemoria() {
    return {
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
        clientes: [],
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
                soporte_autorizado: false,
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
        reservaInvitado: null,
        auditoria: []
    };
}

class AdminManager {
    constructor() {
        this.state = crearEstadoInicialMemoria();
        // Sin sesión fingida al arrancar: se restaura desde sessionStorage si hay un JWT real o pide iniciar sesión
        this.sesion = null;
        this.unidadesRds = [];
        this.comandosUnidadAdmin = [];
        this.demosUnidadEditor = [];
        this.movimientosDemoActual = [];
        this.idUnidadComandosSel = 1;
        this.idDemoSeleccionada = null;
        this.guestInterval = null;
        this.onUnitChanged = null;
        this.onStopVehicle = null;
    }

    async init(callbacks = {}) {
        this.onUnitChanged = callbacks.onUnitChanged || null;
        this.onStopVehicle = callbacks.onStopVehicle || null;
        this._bindEvents();

        // Si existe un JWT en sessionStorage, validarlo de verdad contra GET /api/auth/me
        const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (savedToken) {
            CONFIG.setAuthToken(savedToken);
            try {
                const me = await api.obtenerPerfilActual();
                if (me && me.usuario) {
                    this.sesion = me.usuario;
                    if (Array.isArray(me.unidades) && me.unidades.length > 0) {
                        this.unidadesRds = me.unidades;
                    }
                    if (this.sesion.rol === 'INVITADO' && me.usuario.segundos_restantes) {
                        this.state.reservaInvitado = {
                            id_vehiculo: me.usuario.id_vehiculo_reservado || 2,
                            nombre_vehiculo: me.unidades?.[0]?.nombre || 'Unidad Exhibición',
                            operador: me.usuario.nombre,
                            expira_ts: Date.now() + Number(me.usuario.segundos_restantes) * 1000,
                            activa: true
                        };
                        this._iniciarRelojInvitado();
                    }
                }
            } catch (_) {
                sessionStorage.removeItem(SESSION_TOKEN_KEY);
                CONFIG.setAuthToken(null);
                this.sesion = null;
            }
        }

        this.actualizarBadgeSesionCabecera();
    }

    // Valida permisos tanto antes de enviar como recibiendo el rechazo real del servidor FastAPI
    verificarPermisoOperacion(idVehiculo = CONFIG.VEHICULO_ID, silencioso = false) {
        const unidad = this.obtenerUnidadEnriquecida(idVehiculo);

        if (!this.sesion) {
            // Si aún no ha iniciado sesión en Administración, permitimos operar Control básico si el backend lo acepta,
            // o avisamos si intenta operar una unidad restringida.
            return { ok: true, codigo: 200 };
        }

        const rol = this.sesion.rol;

        if (rol === 'USUARIO') {
            if (unidad.id_propietario && Number(unidad.id_propietario) !== Number(this.sesion.id_usuario)) {
                if (!silencioso) {
                    ui.showFeedback(`403 Bloqueado (BOLA): La unidad #${idVehiculo} no pertenece a tu cuenta`, 'danger', 4000);
                }
                return { ok: false, codigo: 403, motivo: 'Esta unidad pertenece a otro comprador (BOLA/IDOR).' };
            }
            return { ok: true, codigo: 200 };
        }

        if (rol === 'INVITADO') {
            if (unidad.estado_comercial !== 'EXHIBICION') {
                if (!silencioso) {
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
            estado_comercial: idVehiculo === 1 ? 'VENDIDO' : 'DISPONIBLE',
            id_propietario: idVehiculo === 1 ? 2 : null,
            soporte_autorizado: false
        };
        const propietario = this.state.clientes.find(c => Number(c.id_usuario) === Number(meta.id_propietario));
        const modeloObj = this.state.modelos.find(m => Number(m.id_modelo) === Number(base.id_modelo || meta.id_modelo || 1));

        return {
            ...base,
            id_modelo: base.id_modelo ?? meta.id_modelo ?? 1,
            codigo_modelo: modeloObj?.codigo_modelo || 'EXC-IOT-V1',
            numero_serie: base.numero_serie || meta.numero_serie || `SN-IOT-000${idVehiculo}`,
            estado_comercial: base.estado_comercial || meta.estado_comercial || 'DISPONIBLE',
            id_propietario: base.id_propietario !== undefined ? base.id_propietario : meta.id_propietario,
            nombre_propietario: base.nombre_propietario || propietario?.nombre || null,
            email_propietario: base.email_propietario || propietario?.email || null,
            soporte_autorizado: Boolean(
                base.soporte_autorizado !== undefined ? base.soporte_autorizado : meta.soporte_autorizado
            )
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
        if (!this.sesion) {
            return todas.filter(u => u.id_vehiculo === 1 || u.estado_comercial === 'EXHIBICION');
        }
        if (this.sesion.rol === 'ADMIN') {
            return todas;
        }
        if (this.sesion.rol === 'USUARIO') {
            return todas.filter(u => Number(u.id_propietario) === Number(this.sesion.id_usuario));
        }
        return todas.filter(u => u.estado_comercial === 'EXHIBICION');
    }

    async sincronizarDesdeRds() {
        try {
            if (this.sesion && this.sesion.rol === 'ADMIN' && CONFIG.AUTH_TOKEN) {
                try {
                    const dash = await api.obtenerDashboardAdmin();
                    if (dash) {
                        if (Array.isArray(dash.unidades)) {
                            this.unidadesRds = dash.unidades;
                            dash.unidades.forEach(u => {
                                this.state.metaUnidades[u.id_vehiculo] = {
                                    id_modelo: u.id_modelo || 1,
                                    numero_serie: u.numero_serie,
                                    estado_comercial: u.estado_comercial,
                                    id_propietario: u.id_propietario,
                                    soporte_autorizado: Boolean(u.soporte_autorizado),
                                    soporte_expira_en: u.soporte_expira_en
                                };
                            });
                        }
                        if (Array.isArray(dash.modelos) && dash.modelos.length) this.state.modelos = dash.modelos;
                        if (Array.isArray(dash.clientes)) this.state.clientes = dash.clientes;
                        if (Array.isArray(dash.auditoria)) this.state.auditoria = dash.auditoria;
                        this.renderizarTodo();
                        return;
                    }
                } catch (e) {
                    console.warn('Endpoint /api/admin/dashboard pendiente de actualizar en EC2:', e.message);
                }
            }

            if (this.sesion && this.sesion.rol === 'USUARIO' && CONFIG.AUTH_TOKEN) {
                try {
                    const mis = await api.obtenerMisVehiculos();
                    if (Array.isArray(mis)) {
                        this.unidadesRds = mis;
                        mis.forEach(u => {
                            this.state.metaUnidades[u.id_vehiculo] = {
                                id_modelo: u.id_modelo || 1,
                                numero_serie: u.numero_serie,
                                estado_comercial: u.estado_comercial || 'VENDIDO',
                                id_propietario: this.sesion.id_usuario,
                                soporte_autorizado: Boolean(u.soporte_autorizado),
                                soporte_expira_en: u.soporte_expira_en
                            };
                        });
                        this.renderizarTodo();
                        return;
                    }
                } catch (_) {}
            }

            try {
                const cat = await api.obtenerCatalogoPublico();
                if (cat && Array.isArray(cat.modelos) && cat.modelos.length) {
                    this.state.modelos = cat.modelos;
                }
            } catch (_) {}

            const listaRds = await api.obtenerVehiculos();
            if (Array.isArray(listaRds) && listaRds.length > 0) {
                this.unidadesRds = listaRds;
            }
        } catch (err) {
            console.warn('Error sincronizando con RDS:', err.message);
        }

        this.renderizarTodo();
    }

    // Autenticación real contra POST /api/auth/login (sin contraseñas hardcodeadas en el código)
    async iniciarSesionConCredenciales(email, password) {
        const res = await api.login(email, password);
        CONFIG.setAuthToken(res.access_token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, res.access_token);

        this.sesion = res.usuario;
        if (Array.isArray(res.unidades) && res.unidades.length > 0) {
            this.unidadesRds = res.unidades;
            res.unidades.forEach(u => {
                this.state.metaUnidades[u.id_vehiculo] = {
                    id_modelo: u.id_modelo || 1,
                    numero_serie: u.numero_serie,
                    estado_comercial: u.estado_comercial,
                    id_propietario: u.id_propietario ?? (this.sesion.rol === 'USUARIO' ? this.sesion.id_usuario : null),
                    soporte_autorizado: Boolean(u.soporte_autorizado)
                };
            });
            await this.seleccionarUnidadActiva(res.unidades[0].id_vehiculo, false);
        }

        await this.sincronizarDesdeRds();
        this.actualizarBadgeSesionCabecera();
        ui.playSound('start');
        ui.showFeedback(`Bienvenido, ${this.sesion.nombre} (${this.sesion.rol})`, 'success', 2800);
    }

    // Sesión temporal real de Invitado contra POST /api/auth/invitado
    async iniciarSesionInvitadoReal(nombreVisitante = 'Visitante Showroom') {
        const res = await api.iniciarSesionInvitado(nombreVisitante);
        CONFIG.setAuthToken(res.access_token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, res.access_token);

        this.sesion = res.usuario;
        const idExh = res.reserva?.id_vehiculo || 2;
        const segRestantes = Number(res.reserva?.segundos_restantes || res.expires_in || 180);

        this.state.reservaInvitado = {
            id_vehiculo: idExh,
            nombre_vehiculo: res.reserva?.nombre_vehiculo || 'Unidad 2 - Showroom',
            operador: nombreVisitante,
            expira_ts: Date.now() + segRestantes * 1000,
            activa: true
        };

        if (Array.isArray(res.unidades) && res.unidades.length > 0) {
            this.unidadesRds = res.unidades;
        }

        this._iniciarRelojInvitado();
        await this.seleccionarUnidadActiva(idExh, false);
        this.actualizarBadgeSesionCabecera();
        this.renderizarTodo();
        ui.playSound('start');
        ui.showFeedback(`Reserva exclusiva de exhibición iniciada (3 min)`, 'success', 3000);
    }

    async cerrarSesionActual() {
        clearInterval(this.guestInterval);
        try {
            if (CONFIG.AUTH_TOKEN) {
                await api.logout();
            }
        } catch (_) {}

        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        CONFIG.setAuthToken(null);
        this.sesion = null;
        this.state.reservaInvitado = null;
        this.actualizarBadgeSesionCabecera();
        this.renderizarTodo();
        ui.playSound('cancel');
        ui.showFeedback('Sesión cerrada correctamente', 'info', 2200);
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
            if (headerRole && this.sesion?.rol === 'INVITADO') {
                headerRole.textContent = `INVITADO (${min}:${seg})`;
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
            if (this.onStopVehicle) {
                try { await this.onStopVehicle(); } catch (_) {}
            }
            try { await api.logout(); } catch (_) {}
            sessionStorage.removeItem(SESSION_TOKEN_KEY);
            CONFIG.setAuthToken(null);
            this.sesion = null;

            ui.showFeedback(
                porExpiracion
                    ? 'Sesión de Invitado expirada: vehículo detenido de forma segura'
                    : 'Reserva de exhibición liberada y vehículo detenido',
                'warning',
                3800
            );
        }
        this.actualizarBadgeSesionCabecera();
        this.renderizarTodo();
    }

    async seleccionarUnidadActiva(idVehiculo, mostrarAviso = true) {
        const numId = Number(idVehiculo) || 1;
        const unidad = this.obtenerUnidadEnriquecida(numId);

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
            roleBadge.textContent = this.sesion
                ? `${this.sesion.rol}: ${this.sesion.nombre.split(' ')[0]}`
                : 'Iniciar Sesión';
        }
        if (roleBtn) {
            roleBtn.dataset.role = this.sesion ? this.sesion.rol : 'NONE';
        }

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

        const loginBox = document.getElementById('admin-auth-login-box');
        const loggedBox = document.getElementById('admin-auth-logged-box');
        const secAdmin = document.getElementById('admin-role-section-admin');
        const secUser = document.getElementById('admin-role-section-usuario');
        const secGuest = document.getElementById('admin-role-section-invitado');
        const secEditor = document.getElementById('panel-editor-demos');

        const autenticado = Boolean(this.sesion && CONFIG.AUTH_TOKEN);

        if (loginBox) loginBox.classList.toggle('d-none', autenticado);
        if (loggedBox) loggedBox.classList.toggle('d-none', !autenticado);

        if (!autenticado) {
            // Si no ha iniciado sesión, mostramos el catálogo de exhibición público y el formulario de login
            if (secAdmin) secAdmin.classList.add('d-none');
            if (secUser) secUser.classList.add('d-none');
            if (secGuest) secGuest.classList.remove('d-none');
            if (secEditor) secEditor.classList.add('d-none');
            this.renderPanelInvitado();
            return;
        }

        const rol = this.sesion.rol;
        if (secAdmin) secAdmin.classList.toggle('d-none', rol !== 'ADMIN');
        if (secUser) secUser.classList.toggle('d-none', rol !== 'USUARIO');
        if (secGuest) secGuest.classList.toggle('d-none', rol !== 'INVITADO');
        if (secEditor) secEditor.classList.toggle('d-none', rol === 'INVITADO');

        const bannerRol = document.getElementById('admin-current-session-banner');
        if (bannerRol) {
            const unidades = this.obtenerUnidadesVisiblesPorRol();
            bannerRol.innerHTML = `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge role-pill role-${rol.toLowerCase()} me-2">${rol}</span>
                        <strong>${this.sesion.nombre}</strong>
                        <span class="text-secondary ms-1">(${this.sesion.email})</span>
                        <span class="badge bg-success ms-2"><i class="bi bi-key-fill"></i> JWT Verificado</span>
                    </div>
                    <div class="d-flex align-items-center gap-3">
                        <span class="small text-info">
                            <i class="bi bi-shield-lock-fill"></i> Unidades autorizadas: <strong>${unidades.length}</strong>
                        </span>
                        <button type="button" id="btn-logout-session" class="btn btn-sm btn-outline-danger py-0 px-2">
                            <i class="bi bi-box-arrow-right"></i> Cerrar Sesión
                        </button>
                    </div>
                </div>
            `;
        }

        if (rol === 'ADMIN') {
            this.renderMetricas();
            this.renderTablaModelos();
            this.renderTablaUnidades();
            this.renderTablaClientes();
            this.renderComandosUnidadAdmin(this.idUnidadComandosSel);
            this.renderAuditoria();
            this.cargarDemosParaEditor(this.idUnidadComandosSel);
        } else if (rol === 'USUARIO') {
            this.renderMisVehiculosUsuario();
            const misUnidades = this.obtenerUnidadesVisiblesPorRol();
            if (misUnidades.length > 0) {
                this.cargarDemosParaEditor(misUnidades[0].id_vehiculo);
            }
        } else if (rol === 'INVITADO') {
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
                <small class="metric-sub">En catálogo RDS</small>
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
                <small class="metric-sub">${this.state.auditoria.length} eventos en bitácora RDS</small>
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
                                <button type="button" class="btn btn-sm btn-outline-info py-0 px-2" data-action="intentar-operar-admin" data-id="${u.id_vehiculo}" title="Intentar operar en Control">
                                    <i class="bi bi-controller"></i> Operar
                                </button>
                                ${u.id_propietario ? `
                                    <button type="button" class="btn btn-sm btn-outline-warning py-0 px-2" data-action="revocar-unidad" data-id="${u.id_vehiculo}" title="Revocar asignación">
                                        <i class="bi bi-person-dash"></i> Liberar
                                    </button>
                                ` : `
                                    <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" data-action="cambiar-exhibicion" data-id="${u.id_vehiculo}" title="Alternar Exhibición/Disponible">
                                        <i class="bi bi-display"></i> ${u.estado_comercial === 'EXHIBICION' ? 'A Disponible' : 'A Exhibición'}
                                    </button>
                                `}
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
            if (this.state.clientes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center text-secondary py-2">Sin clientes cargados.</td></tr>`;
            } else {
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
                        </tr>
                    `;
                }).join('');
            }
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
            const comandos = await api.obtenerComandos(this.idUnidadComandosSel);
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
        if (!this.state.auditoria || this.state.auditoria.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-secondary py-2">Sin eventos registrados aún en RDS.</td></tr>`;
            return;
        }
        tbody.innerHTML = this.state.auditoria.slice(0, 20).map(ev => {
            const { fecha, hora } = ui.formatearFechaHora(ev.fecha_hora);
            const isAlert = /BLOQUEADO|SIN_SOPORTE/.test(ev.accion);
            return `
                <tr class="${isAlert ? 'table-danger-row' : ''}">
                    <td><span class="badge ${isAlert ? 'bg-danger' : 'bg-secondary'}">${ev.accion}</span></td>
                    <td><strong>${ev.actor || 'Usuario'}</strong> <small class="text-secondary">(${ev.rol})</small></td>
                    <td>${ev.detalle || ''}</td>
                    <td class="text-nowrap small">${fecha} ${hora}</td>
                </tr>
            `;
        }).join('');
    }

    renderMisVehiculosUsuario() {
        const cont = document.getElementById('usuario-mis-vehiculos-grid');
        if (!cont) return;

        const misUnidades = this.obtenerUnidadesVisiblesPorRol();
        if (misUnidades.length === 0) {
            cont.innerHTML = `
                <div class="admin-empty-state">
                    <i class="bi bi-car-front fs-2 text-secondary"></i>
                    <p class="mb-0 mt-2">Aún no tienes unidades asignadas a tu cuenta de comprador en RDS.</p>
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
                                ? '<span class="text-warning"><i class="bi bi-unlock-fill"></i> El Administrador tiene permiso temporal en RDS para probar tu unidad.</span>'
                                : '<span class="text-success"><i class="bi bi-shield-lock-fill"></i> Control privado: ni el Administrador ni otros usuarios pueden mover tu vehículo (403).</span>'}
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

    async cargarDemosParaEditor(idVehiculo = 1) {
        const contDemos = document.getElementById('editor-demos-lista');
        const selectCmdPaso = document.getElementById('step-form-comando');
        if (!contDemos) return;

        try {
            const [demos, comandos] = await Promise.all([
                api.obtenerDemos(idVehiculo),
                api.obtenerComandos(idVehiculo)
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
                const tipo = d.tipo_demo || (d.id_demo === 1 ? 'EMPRESA' : 'PRIVADA');
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
                        <span class="badge bg-success me-2"><i class="bi bi-broadcast-pin"></i> RESERVA EXCLUSIVA ACTIVA EN RDS</span>
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
                        <span class="badge bg-secondary me-2">MODO VISITANTE / PROSPECTO</span>
                        <span>Puedes consultar el catálogo público o iniciar una reserva temporal exclusiva de 3 minutos en la unidad de exhibición.</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-success fw-bold" data-action="renovar-reserva-invitado">
                        <i class="bi bi-play-circle-fill"></i> Solicitar Reserva de Exhibición (3 min)
                    </button>
                </div>
            `;
        }
    }

    _bindEvents() {
        const selHeader = document.getElementById('header-unit-select');
        if (selHeader) {
            selHeader.addEventListener('change', (e) => {
                this.seleccionarUnidadActiva(Number(e.target.value), true);
            });
        }

        const btnRole = document.getElementById('btn-role-switcher');
        if (btnRole) {
            btnRole.addEventListener('click', () => {
                document.getElementById('btn-tab-admin')?.click();
            });
        }

        // Botones para rellenar únicamente el correo de prueba (NUNCA la contraseña)
        document.querySelectorAll('[data-fill-email]').forEach(btn => {
            btn.addEventListener('click', () => {
                const emailInput = document.getElementById('auth-login-email');
                const passInput = document.getElementById('auth-login-password');
                if (emailInput) {
                    emailInput.value = btn.getAttribute('data-fill-email') || '';
                }
                if (passInput) {
                    passInput.focus();
                }
            });
        });

        const vistaAdmin = document.getElementById('vista-admin');
        if (!vistaAdmin) return;

        vistaAdmin.addEventListener('click', async (e) => {
            if (e.target.closest('#btn-logout-session')) {
                await this.cerrarSesionActual();
                return;
            }

            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.getAttribute('data-action');
            const id = Number(actionEl.getAttribute('data-id'));

            if (action === 'intentar-operar-admin') {
                // Valida en el servidor FastAPI enviando una consulta/operación sobre la unidad
                const check = this.verificarPermisoOperacion(id, false);
                if (!check.ok) {
                    // También disparamos petición real al backend para que quede registrada en bitacora_auditoria de RDS
                    try { await api.ejecutarMovimiento(1, id); } catch (_) {}
                    await this.sincronizarDesdeRds();
                    return;
                }
                await this.seleccionarUnidadActiva(id, true);
                document.getElementById('btn-tab-control')?.click();
            }

            if (action === 'revocar-unidad') {
                try {
                    await api.revocarAsignacion(id, 'DISPONIBLE');
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Unidad #${id} liberada a estado DISPONIBLE en RDS`, 'warning', 2500);
                } catch (err) {
                    ui.showFeedback(`Error al liberar unidad: ${err.message}`, 'danger');
                }
            }

            if (action === 'cambiar-exhibicion') {
                const unidad = this.obtenerUnidadEnriquecida(id);
                const nuevo = unidad.estado_comercial === 'EXHIBICION' ? 'DISPONIBLE' : 'EXHIBICION';
                try {
                    await api.revocarAsignacion(id, nuevo);
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Unidad #${id} cambiada a ${nuevo} en RDS`, 'info', 2500);
                } catch (err) {
                    ui.showFeedback(`Error al cambiar estado comercial: ${err.message}`, 'danger');
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
                const inputVis = document.getElementById('guest-login-name');
                const nombreVis = inputVis?.value?.trim() || 'Visitante Showroom';
                try {
                    await this.iniciarSesionInvitadoReal(nombreVis);
                } catch (err) {
                    ui.showFeedback(err.message || 'No fue posible reservar la unidad de exhibición', 'danger', 4000);
                }
            }

            // Pruebas de Autorización ejecutadas contra el servidor FastAPI (devuelven 401/403 reales desde RDS)
            if (action === 'test-bola-cruzado') {
                const idAjeno = this.sesion?.id_usuario === 3 ? 1 : 3;
                try {
                    await api.ejecutarMovimiento(1, idAjeno);
                    this._mostrarResultadoPruebaSeguridad(`Respuesta inesperada: la petición sobre Unidad #${idAjeno} fue aceptada.`);
                } catch (err) {
                    this._mostrarResultadoPruebaSeguridad(
                        `[BACKEND HTTP ${err.status || 403}] ${err.message}`
                    );
                    await this.sincronizarDesdeRds();
                }
            }

            if (action === 'test-admin-sin-soporte') {
                try {
                    await api.ejecutarMovimiento(1, 1);
                    this._mostrarResultadoPruebaSeguridad(`La Unidad #1 tiene actualmente el soporte técnico autorizado por el propietario.`);
                } catch (err) {
                    this._mostrarResultadoPruebaSeguridad(
                        `[BACKEND HTTP ${err.status || 403}] ${err.message}`
                    );
                    await this.sincronizarDesdeRds();
                }
            }

            if (action === 'test-invitado-unidad-vendida') {
                try {
                    await api.ejecutarMovimiento(1, 1);
                    this._mostrarResultadoPruebaSeguridad(`Respuesta inesperada en unidad #1.`);
                } catch (err) {
                    this._mostrarResultadoPruebaSeguridad(
                        `[BACKEND HTTP ${err.status || 403}] ${err.message}`
                    );
                }
            }
        });

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
                try {
                    await api.configurarSoporte(id, autorizado, 30);
                    if (!this.state.metaUnidades[id]) this.state.metaUnidades[id] = {};
                    this.state.metaUnidades[id].soporte_autorizado = autorizado;
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(
                        autorizado
                            ? 'Soporte técnico autorizado al Administrador en RDS por 30 min'
                            : 'Soporte técnico revocado en RDS: control exclusivo privado activado',
                        autorizado ? 'warning' : 'success',
                        3000
                    );
                } catch (err) {
                    target.checked = !autorizado;
                    ui.showFeedback(`Error al actualizar soporte en RDS: ${err.message}`, 'danger');
                }
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
                    ui.showFeedback(`Comando ${cmd.nombre}: ${nuevoActivo ? 'Habilitado' : 'Deshabilitado'}`, 'info', 2200);
                    await this.renderComandosUnidadAdmin(this.idUnidadComandosSel);
                    if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
                } catch (err) {
                    target.checked = !nuevoActivo;
                    ui.showFeedback(`Error al actualizar comando: ${err.message}`, 'danger');
                }
            }
        });

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
        // 0. Formulario de Inicio de Sesión Real (sin contraseñas en código)
        const formLogin = document.getElementById('form-auth-login');
        if (formLogin) {
            formLogin.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('auth-login-email').value.trim();
                const password = document.getElementById('auth-login-password').value;
                if (!email || !password) return;
                try {
                    await this.iniciarSesionConCredenciales(email, password);
                    formLogin.reset();
                } catch (err) {
                    ui.playSound('cancel');
                    ui.showFeedback(err.message || 'Credenciales inválidas', 'danger', 3500);
                }
            });
        }

        // 0.b Formulario de Acceso Invitado Temporal
        const formGuest = document.getElementById('form-auth-guest');
        if (formGuest) {
            formGuest.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombreVis = document.getElementById('guest-login-name')?.value?.trim() || 'Visitante Showroom';
                try {
                    await this.iniciarSesionInvitadoReal(nombreVis);
                } catch (err) {
                    ui.playSound('cancel');
                    ui.showFeedback(err.message || 'No se pudo iniciar la sesión de exhibición', 'danger', 3800);
                }
            });
        }

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

                try {
                    await api.crearModeloComercial({
                        codigo_modelo: codigo,
                        nombre,
                        descripcion: 'Modelo comercial registrado desde Administración',
                        microcontrolador_default: micro,
                        tiene_brazo: brazo,
                        tiene_motores_giro: true
                    });
                    formModelo.reset();
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Modelo comercial ${codigo} registrado en RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al registrar modelo: ${err.message}`, 'danger');
                }
            });
        }

        // 2. Alta de Unidad Física en RDS
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
                    await api.crearUnidadAdmin({
                        nombre,
                        id_modelo: idModelo,
                        modelo: modeloObj.nombre,
                        numero_serie: serie,
                        descripcion: `Serie: ${serie} · Estado: ${estadoCom}`,
                        microcontrolador: modeloObj.microcontrolador_default || 'ESP8266',
                        estado_comercial: estadoCom
                    });
                    formUnidad.reset();
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Unidad '${nombre}' (${serie}) registrada en Amazon RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al registrar unidad: ${err.message}`, 'danger');
                }
            });
        }

        // 3. Alta de Cliente Comprador en RDS
        const formCliente = document.getElementById('form-admin-cliente');
        if (formCliente) {
            formCliente.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombre = document.getElementById('cli-form-nombre').value.trim();
                const email = document.getElementById('cli-form-email').value.trim().toLowerCase();
                const password = document.getElementById('cli-form-pass').value;
                if (!nombre || !email || !password) return;

                try {
                    await api.registrarCliente({ nombre, email, password });
                    formCliente.reset();
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Cliente ${nombre} registrado en RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al registrar cliente: ${err.message}`, 'danger');
                }
            });
        }

        // 4. Asignación de Unidad Física a Cliente Comprador en RDS
        const formAsig = document.getElementById('form-admin-asignacion');
        if (formAsig) {
            formAsig.addEventListener('submit', async (e) => {
                e.preventDefault();
                const idVehiculo = Number(document.getElementById('asig-form-vehiculo').value);
                const idUsuario = Number(document.getElementById('asig-form-cliente').value);
                try {
                    await api.asignarUnidad({ id_vehiculo: idVehiculo, id_usuario: idUsuario });
                    await this.sincronizarDesdeRds();
                    ui.showFeedback(`Unidad #${idVehiculo} asignada en RDS`, 'success');
                } catch (err) {
                    ui.showFeedback(`Error al asignar unidad: ${err.message}`, 'danger');
                }
            });
        }

        // 5. Crear nueva Secuencia DEMO en RDS
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
                        descripcion: desc || `Creada por ${this.sesion?.nombre || 'Usuario'}`
                    });
                    if (creada?.id_demo) {
                        this.idDemoSeleccionada = creada.id_demo;
                    }
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
