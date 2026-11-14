// assets/js/api.js
import { CONFIG } from './config.js?v=13';
import { ui } from './ui.js?v=13';

class ApiClient {
    constructor() {
        this.abortController = null;
    }

    _headers(extra = {}) {
        const h = { 'Accept': 'application/json', ...extra };
        if (CONFIG.AUTH_TOKEN) {
            h['Authorization'] = `Bearer ${CONFIG.AUTH_TOKEN}`;
        }
        return h;
    }

    async _parseError(response) {
        try {
            const errJson = await response.json();
            return errJson.detail || errJson.mensaje || `HTTP ${response.status}`;
        } catch (_) {
            return `HTTP error! status: ${response.status}`;
        }
    }

    async get(endpoint) {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
                headers: this._headers()
            });
            if (!response.ok) {
                const msg = await this._parseError(response);
                const err = new Error(msg);
                err.status = response.status;
                throw err;
            }
            ui.updateAwsStatus('Disponible');
            return await response.json();
        } catch (error) {
            console.error('Error GET:', error);
            if (!error.status) {
                ui.updateAwsStatus('No disponible');
            }
            throw error;
        }
    }

    async requestJson(method, endpoint, body = null) {
        const opts = {
            method,
            headers: this._headers(body ? { 'Content-Type': 'application/json' } : {})
        };
        if (body !== null) {
            opts.body = JSON.stringify(body);
        }
        const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, opts);
        if (!response.ok) {
            const msg = await this._parseError(response);
            const err = new Error(msg);
            err.status = response.status;
            throw err;
        }
        ui.updateAwsStatus('Disponible');
        if (response.status === 204) return null;
        return await response.json();
    }

    async postQuery(endpoint, params) {
        // Cancela la petición anterior si hay una en vuelo (evita saturación)
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        try {
            const queryString = new URLSearchParams(params).toString();
            const url = `${CONFIG.API_BASE_URL}${endpoint}?${queryString}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this._headers(),
                signal: this.abortController.signal
            });
            
            if (!response.ok) {
                const msg = await this._parseError(response);
                const err = new Error(msg);
                err.status = response.status;
                throw err;
            }
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Petición POST abortada (nueva orden en camino)');
            } else {
                console.error('Error POST:', error);
                ui.showFeedback(error.message || 'Error al enviar comando', 'danger');
            }
            throw error;
        }
    }

    // --- MÉTODOS DE CONTROL (Práctica 4.1) ---

    async obtenerComandos(idVehiculo = CONFIG.VEHICULO_ID) {
        return this.get(`/api/comandos/vehiculo/${idVehiculo}`);
    }

    async obtenerDemos(idVehiculo = CONFIG.VEHICULO_ID) {
        return this.get(`/api/demos/vehiculo/${idVehiculo}`);
    }

    async ejecutarMovimiento(idComando, idVehiculo = CONFIG.VEHICULO_ID) {
        return this.postQuery('/api/telemetria/movimiento', {
            id_vehiculo: idVehiculo,
            id_comando: idComando,
            origen: 'API_POST'
        });
    }

    async ejecutarDemo(idDemo, idVehiculo = CONFIG.VEHICULO_ID) {
        const url = `${CONFIG.API_BASE_URL}/api/demos/${idDemo}/ejecutar?id_vehiculo=${idVehiculo}`;
        const response = await fetch(url, { 
            method: 'POST',
            headers: this._headers()
        });
        if (!response.ok) {
            const msg = await this._parseError(response);
            throw new Error(msg);
        }
        return await response.json();
    }

    async cancelarDemo(idVehiculo = CONFIG.VEHICULO_ID) {
        return await fetch(`${CONFIG.API_BASE_URL}/api/demos/vehiculo/${idVehiculo}/cancelar`, {
            method: 'POST',
            headers: this._headers()
        });
    }

    // --- MÉTODOS DE MONITOREO (Práctica 4.2) ---

    async obtenerUltimoEstado(idVehiculo = CONFIG.VEHICULO_ID) {
        return this.get(`/api/telemetria/estado/${idVehiculo}`);
    }

    async obtenerHistorial(idVehiculo = CONFIG.VEHICULO_ID) {
        const historial = await this.get(`/api/telemetria/historial/${idVehiculo}`);
        const lista = Array.isArray(historial)
            ? historial
            : (historial?.historial || historial?.datos || historial?.data || []);
        return Array.isArray(lista) ? lista.slice(0, 10) : [];
    }

    // --- MÉTODOS DE ADMINISTRACIÓN, VEHÍCULOS Y EDITOR DE DEMOS (Práctica 4.3) ---

    async login(email, password) {
        return this.requestJson('POST', '/api/auth/login', { email, password });
    }

    async iniciarSesionInvitado(nombreVisitante = 'Visitante Showroom', idVehiculo = null) {
        return this.requestJson('POST', '/api/auth/invitado', {
            nombre_visitante: nombreVisitante,
            id_vehiculo: idVehiculo
        });
    }

    async logout() {
        return this.requestJson('POST', '/api/auth/logout');
    }

    async obtenerVehiculos() {
        return this.get('/api/vehiculos/');
    }

    async crearVehiculoBase(datos) {
        return this.requestJson('POST', '/api/vehiculos/', datos);
    }

    async actualizarVehiculoBase(idVehiculo, datos) {
        return this.requestJson('PUT', `/api/vehiculos/${idVehiculo}`, datos);
    }

    async actualizarComando(idComando, datos) {
        return this.requestJson('PUT', `/api/comandos/${idComando}`, datos);
    }

    async crearDemo(datos) {
        return this.requestJson('POST', '/api/demos/', datos);
    }

    async actualizarDemo(idDemo, datos) {
        return this.requestJson('PUT', `/api/demos/${idDemo}`, datos);
    }

    async eliminarDemo(idDemo) {
        return this.requestJson('DELETE', `/api/demos/${idDemo}`);
    }

    async obtenerMovimientosDemo(idDemo) {
        return this.get(`/api/demos/${idDemo}/movimientos`);
    }

    async agregarMovimientoDemo(idDemo, datos) {
        return this.requestJson('POST', `/api/demos/${idDemo}/movimientos`, {
            id_demo: Number(idDemo),
            ...datos
        });
    }

    async actualizarMovimientoDemo(idDemoMovimiento, datos) {
        return this.requestJson('PUT', `/api/demos/movimientos/${idDemoMovimiento}`, datos);
    }

    async eliminarMovimientoDemo(idDemoMovimiento) {
        return this.requestJson('DELETE', `/api/demos/movimientos/${idDemoMovimiento}`);
    }

    async obtenerDashboardAdmin() {
        return this.get('/api/admin/dashboard');
    }

    async crearModeloComercial(datos) {
        return this.requestJson('POST', '/api/admin/modelos', datos);
    }

    async crearUnidadAdmin(datos) {
        return this.requestJson('POST', '/api/admin/unidades', datos);
    }

    async registrarCliente(datos) {
        return this.requestJson('POST', '/api/admin/clientes', datos);
    }

    async asignarUnidad(datos) {
        return this.requestJson('POST', '/api/admin/asignaciones', datos);
    }

    async revocarAsignacion(idVehiculo, nuevoEstado = 'DISPONIBLE') {
        return this.requestJson('DELETE', `/api/admin/asignaciones/${idVehiculo}?nuevo_estado=${nuevoEstado}`);
    }

    async obtenerMisVehiculos() {
        return this.get('/api/mis-vehiculos');
    }

    async configurarSoporte(idVehiculo, autorizado, minutos = 30) {
        return this.requestJson('PATCH', `/api/mis-vehiculos/${idVehiculo}/soporte`, {
            autorizado: Boolean(autorizado),
            minutos: Number(minutos)
        });
    }

    async obtenerCatalogoPublico() {
        return this.get('/api/exhibicion/catalogo');
    }
}

export const api = new ApiClient();
export const API = api;
