// assets/js/config.js
export const CONFIG = {
    API_BASE_URL: 'https://api-vehiculo-iot.duckdns.org',
    WS_BASE_URL: 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1',
    API_URL: 'https://api-vehiculo-iot.duckdns.org',
    WS_URL: 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1',
    VEHICULO_ID: 1,
    ORIGEN: 'API_POST',
    AUTH_TOKEN: null,
    setVehiculoId(id) {
        const num = Number(id) || 1;
        this.VEHICULO_ID = num;
        // Seguridad: El token JWT NUNCA se concatena en la URL del WebSocket para no exponerlo en logs del servidor
        const baseWs = 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/' + num;
        this.WS_BASE_URL = baseWs;
        this.WS_URL = baseWs;
    },
    setAuthToken(token) {
        this.AUTH_TOKEN = token || null;
    }
};
