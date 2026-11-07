// js/ui.js
const ICONOS = [
    [/LUZ|LUCES/, 'lightbulb-fill'],
    [/CLAXON|BOCINA/, 'megaphone-fill'],
    [/ACELER|RAPID|TURBO/, 'speedometer2'],
    [/LENT|FRENAR/, 'hourglass-split'],
    [/360|GIRO|VUELTA/, 'arrow-repeat'],
    [/ZIG/, 'bezier2']
];
const iconoPara = (n) => (ICONOS.find(([re]) => re.test(n.toUpperCase())) || [,'lightning-charge-fill'])[1];
const etiqueta = (n) => { const t = n.replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

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
        const type = text === 'Disponible' ? 'success' : (text === 'Comprobando...' ? 'warning' : 'danger');
        this.statusAws.className = `badge bg-${type} status-badge`;
        this.statusAws.innerHTML = `<i class="bi bi-cloud-check"></i> AWS: ${text}`;
    }

    showFeedback(message, type = 'info') {
        clearTimeout(this._timer);
        this.feedback.textContent = message;
        this.feedback.className = `alert alert-${type}`;
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
        const excluidos = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'Detener', 'DETENER', 'STOP'];
        
        comandos.forEach(cmd => {
            const nombreCmd = cmd.nombre || cmd.comando;
            if (nombreCmd && !excluidos.includes(nombreCmd)) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'cmd-btn';
                btn.innerHTML = `<i class="bi bi-${iconoPara(nombreCmd)}"></i><span>${etiqueta(nombreCmd)}</span>`;
                btn.onclick = () => { this.vibrar(); onCommandClick(cmd.id_comando, nombreCmd); };
                container.appendChild(btn);
            }
        });
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
        
        document.getElementById('btn-demo-start').disabled = false;
        document.getElementById('btn-demo-cancel').disabled = false;
    }
}

export const ui = new UIController();
export const UI = ui;
