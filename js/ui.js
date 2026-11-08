// js/ui.js
const ICONOS = [
    [/SONIDO|AUDIO|VOLUM/, 'volume-up-fill'],
    [/MOTOR/, 'gear-fill'],
    [/LUZ|LUCES/, 'lightbulb-fill'],
    [/CLAXON|BOCINA/, 'megaphone-fill'],
    [/VELOC|ACELER|RAPID|TURBO/, 'speedometer2'],
    [/LENT|FRENAR/, 'hourglass-split'],
    [/360|GIRO|VUELTA/, 'arrow-repeat'],
    [/ZIG/, 'bezier2']
];

// Normaliza nombres: sin acentos, mayúsculas y con guion bajo ("Subir brazo" -> SUBIR_BRAZO)
export const normalizar = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().replace(/[\s-]+/g, '_');

const iconoPara = (nombre) => {
    const hit = ICONOS.find(([re]) => re.test(nombre.toUpperCase()));
    return hit ? hit[1] : 'lightning-charge-fill';
};

const etiqueta = (nombre) => {
    const t = nombre.replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
};
// Accesorios que se muestran (deshabilitados) mientras AWS no responde
const ACCESORIOS_BASE = ['Velocidad', 'Sonido', 'Luz'];

class UIController {
    constructor() {
        this.feedback = document.getElementById('action-feedback');
        this.statusWss = document.getElementById('status-wss');
        this.statusAws = document.getElementById('status-aws');
        this._timer = null;
    }

    vibrar(ms = 12) {
        if (navigator.vibrate) navigator.vibrate(ms);
    }

    updateWssStatus(text, type) {
        this.statusWss.className = `badge bg-${type} status-badge`;
        this.statusWss.innerHTML = `<i class="bi bi-broadcast"></i> WSS: ${text}`;
    }

    updateAwsStatus(text) {
        let type = 'secondary';
        if (text === 'Disponible') type = 'success';
        else if (text === 'Comprobando...') type = 'warning';
        else type = 'danger';

        this.statusAws.className = `badge bg-${type} status-badge`;
        this.statusAws.innerHTML = `<i class="bi bi-cloud-check"></i> AWS: ${text}`;
    }

    // Alias de compatibilidad
    updateAws(isAvailable) {
        this.updateAwsStatus(isAvailable ? 'Disponible' : 'No disponible');
    }

    updateWss(state, type) {
        this.updateWssStatus(state, type);
    }

    showFeedback(message, type = 'info') {
        clearTimeout(this._timer);
        this.feedback.textContent = message;
        this.feedback.className = `alert alert-${type}`;

        // Ocultar después de 2 segundos si no es un error
        if (type !== 'danger') {
            this._timer = setTimeout(() => this.feedback.classList.add('d-none'), 2000);
        }
    }

    renderComandos(comandos, onCommandClick) {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = ''; // Limpiar

        const btnStop = document.getElementById('btn-stop');
        if (btnStop) btnStop.disabled = false;
        
        // Excluimos los comandos que ya controla el joystick y el botón rojo
        const excluidos = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'DETENER', 'STOP',
                          'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA']; // los controlan los joysticks
        
        comandos.forEach(cmd => {
            const nombreCmd = cmd.nombre || cmd.comando;
            if (nombreCmd && !excluidos.includes(normalizar(nombreCmd))) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'cmd-btn';
                btn.innerHTML = `<span class="cmd-ico"><i class="bi bi-${iconoPara(nombreCmd)}"></i></span><span>${etiqueta(nombreCmd)}</span>`;
                btn.onclick = () => {
                    this.vibrar();
                    btn.classList.add('sent');
                    setTimeout(() => btn.classList.remove('sent'), 250);
                    onCommandClick(cmd.id_comando, nombreCmd);
                };
                container.appendChild(btn);
            }
        });
    }

    renderComandosPlaceholder() {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = '';
        ACCESORIOS_BASE.forEach(nombre => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cmd-btn';
            btn.disabled = true;
            btn.innerHTML = `<span class="cmd-ico"><i class="bi bi-${iconoPara(nombre)}"></i></span><span>${nombre}</span>`;
            container.appendChild(btn);
        });
    }

    // Modo sin conexión: todo visible pero opaco y sin interacción
    setOffline(off) {
        document.body.classList.toggle('is-offline', off);
        const stop = document.getElementById('btn-stop');
        if (stop) stop.disabled = off;
        if (off) {
            const select = document.getElementById('demo-select');
            select.innerHTML = '<option value="">Demos no disponibles</option>';
            select.disabled = true;
            document.getElementById('btn-demo-start').disabled = true;
            document.getElementById('btn-demo-cancel').disabled = true;
        }
    }

    renderDemos(demos) {
        const select = document.getElementById('demo-select');
        select.innerHTML = '<option value="">Selecciona una DEMO</option>';
        demos.forEach(demo => {
            const option = document.createElement('option');
            option.value = demo.id_demo;
            option.textContent = demo.nombre;
            select.appendChild(option);
        });
        
        select.disabled = false;
        document.getElementById('btn-demo-start').disabled = false;
        document.getElementById('btn-demo-cancel').disabled = false;
    }
}

export const ui = new UIController();
export const UI = ui;
