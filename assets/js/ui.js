// assets/js/ui.js
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
export const normalizar = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().replace(/[\s-]+/g, '_');

const iconoPara = (nombre) => {
    const hit = ICONOS.find(([re]) => re.test(String(nombre || '').toUpperCase()));
    return hit ? hit[1] : 'lightning-charge-fill';
};

const etiqueta = (nombre) => {
    const t = String(nombre || '').replace(/_/g, ' ').toLowerCase();
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
        this._audioCtx = null;
        this.onSwitchToMonitoreo = null;
        this.initSpaceBackground();
    }

    // --- NAVEGACIÓN DE VISTAS (Control / Monitoreo) ---
    switchView(viewName) {
        this.playSound('tap');
        this.vibrar(10);

        const vistaControl = document.getElementById('vista-control');
        const vistaMonitoreo = document.getElementById('vista-monitoreo');
        const btnControl = document.getElementById('btn-tab-control');
        const btnMonitoreo = document.getElementById('btn-tab-monitoreo');

        if (!vistaControl || !vistaMonitoreo) return;

        if (viewName === 'control') {
            vistaControl.classList.remove('d-none');
            vistaMonitoreo.classList.add('d-none');
            btnControl?.classList.add('active');
            btnMonitoreo?.classList.remove('active');
        } else {
            vistaControl.classList.add('d-none');
            vistaMonitoreo.classList.remove('d-none');
            btnControl?.classList.remove('active');
            btnMonitoreo?.classList.add('active');
            if (this.onSwitchToMonitoreo) {
                this.onSwitchToMonitoreo();
            }
        }
    }

    // --- FORMATO FECHAS (DD/MM/YYYY y HH:MM:SS) ---
    formatearFechaHora(fechaIso) {
        if (!fechaIso) return { fecha: '--/--/----', hora: '--:--:--' };
        const date = new Date(fechaIso);
        if (isNaN(date.getTime())) return { fecha: '--/--/----', hora: '--:--:--' };

        const dia = String(date.getDate()).padStart(2, '0');
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const anio = date.getFullYear();
        const horas = String(date.getHours()).padStart(2, '0');
        const minutos = String(date.getMinutes()).padStart(2, '0');
        const segundos = String(date.getSeconds()).padStart(2, '0');
        return {
            fecha: `${dia}/${mes}/${anio}`,
            hora: `${horas}:${minutos}:${segundos}`
        };
    }

    // Icono y tema de color según el nombre del movimiento
    _configVisualMovimiento(comandoStr) {
        const norm = normalizar(comandoStr);
        if (norm === 'DETENER' || norm === 'STOP') {
            return { icon: 'bi-stop-circle-fill', stateClass: 'state-danger' };
        }
        if (norm.includes('RETROCEDER') || norm.includes('ATRAS') || norm.includes('BAJAR')) {
            return { icon: 'bi-arrow-down-circle-fill', stateClass: 'state-warn' };
        }
        if (norm.includes('IZQUIERDA')) {
            return { icon: 'bi-arrow-left-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('DERECHA')) {
            return { icon: 'bi-arrow-right-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('SUBIR')) {
            return { icon: 'bi-arrow-up-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('VELOC')) {
            return { icon: 'bi-speedometer2', stateClass: 'state-warn' };
        }
        if (norm.includes('SONIDO') || norm.includes('CLAXON')) {
            return { icon: 'bi-volume-up-fill', stateClass: 'state-info' };
        }
        if (norm.includes('LUZ')) {
            return { icon: 'bi-lightbulb-fill', stateClass: 'state-ok' };
        }
        return { icon: 'bi-arrow-up-circle-fill', stateClass: 'state-ok' };
    }

    // --- RENDERIZADO MONITOREO ---
    renderUltimoEstado(datos) {
        if (!datos) return;
        const item = Array.isArray(datos) ? datos[0] : (datos.datos || datos);
        if (!item) return;

        const nombreCmd = item.comando || item.nombre_comando || item.nombre || item.movimiento || 'Sin registro';
        const fechaRaw = item.fecha_actualizacion || item.fecha_hora || item.fecha || item.timestamp || item.created_at;
        const { fecha, hora } = this.formatearFechaHora(fechaRaw);

        const cmdEl = document.getElementById('monitoreo-comando');
        const fechaEl = document.getElementById('monitoreo-fecha');
        const horaEl = document.getElementById('monitoreo-hora');
        const iconEl = document.getElementById('monitoreo-icono');
        const cardEl = document.getElementById('monitoreo-card');

        if (cmdEl) cmdEl.textContent = nombreCmd;
        if (fechaEl) fechaEl.textContent = `Fecha: ${fecha}`;
        if (horaEl) horaEl.textContent = `Hora: ${hora}`;

        const { icon, stateClass } = this._configVisualMovimiento(nombreCmd);
        if (iconEl) iconEl.innerHTML = `<i class="bi ${icon}"></i>`;
        if (cardEl) {
            cardEl.classList.remove('state-ok', 'state-danger', 'state-warn', 'state-info');
            cardEl.classList.add(stateClass);
        }
    }

    renderHistorial(registros) {
        const tbody = document.getElementById('tabla-historial');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!registros || registros.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="monitor-empty">Sin registros de movimientos</td></tr>';
            return;
        }

        registros.slice(0, 10).forEach((reg, index) => {
            const tr = document.createElement('tr');
            const nombreCmd = reg.comando || reg.nombre_comando || reg.nombre || reg.movimiento || 'Desconocido';
            const fechaRaw = reg.fecha_hora || reg.fecha_actualizacion || reg.fecha || reg.timestamp || reg.created_at;
            const { fecha, hora } = this.formatearFechaHora(fechaRaw);
            const { icon } = this._configVisualMovimiento(nombreCmd);

            tr.innerHTML = `
                <td><span class="monitor-row-num">${index + 1}</span></td>
                <td><span class="monitor-cmd-badge"><i class="bi ${icon}"></i> ${nombreCmd}</span></td>
                <td>${fecha}</td>
                <td>${hora}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- SONIDOS WEB AUDIO API ---
    _getAudioCtx() {
        if (!this._audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this._audioCtx = new AudioCtx();
        }
        if (this._audioCtx && this._audioCtx.state === 'suspended') {
            this._audioCtx.resume();
        }
        return this._audioCtx;
    }

    playSound(tipo = 'tap') {
        try {
            const ctx = this._getAudioCtx();
            if (!ctx) return;
            const now = ctx.currentTime;

            const tone = (freq, endFreq, duration, wave = 'sine', vol = 0.14, delay = 0) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(freq, now + delay);
                if (endFreq && endFreq !== freq) {
                    osc.frequency.exponentialRampToValueAtTime(endFreq, now + delay + duration);
                }
                gain.gain.setValueAtTime(0.001, now + delay);
                gain.gain.linearRampToValueAtTime(vol, now + delay + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + delay);
                osc.stop(now + delay + duration);
            };

            if (tipo === 'stop') {
                tone(440, 180, 0.22, 'triangle', 0.2);
                tone(320, 130, 0.22, 'sawtooth', 0.08);
            } else if (tipo === 'start') {
                tone(523.25, 523.25, 0.1, 'sine', 0.16, 0);
                tone(659.25, 783.99, 0.18, 'sine', 0.18, 0.09);
            } else if (tipo === 'cancel') {
                tone(520, 440, 0.1, 'triangle', 0.15, 0);
                tone(380, 260, 0.18, 'triangle', 0.15, 0.09);
            } else if (tipo === 'horn') {
                tone(480, 480, 0.2, 'sawtooth', 0.12, 0);
                tone(600, 600, 0.2, 'triangle', 0.14, 0);
            } else if (tipo === 'speed') {
                tone(320, 880, 0.18, 'sine', 0.16, 0);
            } else if (tipo === 'light') {
                tone(880, 1174, 0.1, 'sine', 0.14, 0);
            } else if (tipo === 'joy') {
                tone(420, 560, 0.06, 'sine', 0.09, 0);
            } else {
                tone(620, 820, 0.08, 'sine', 0.14, 0);
            }
        } catch (e) {
            // Ignorar si el navegador bloquea audio
        }
    }

    // --- FONDO ESPACIAL EN MOVIMIENTO ---
    initSpaceBackground() {
        const canvas = document.getElementById('space-bg');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let w = 0, h = 0;
        let stars = [];
        let nebulae = [];
        let shootingStars = [];

        const starColors = ['#ffffff', '#dce8ff', '#b6d4ff', '#ffe9c4', '#a8f0ff'];

        const resize = () => {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
            const count = Math.min(280, Math.max(130, Math.floor((w * h) / 4500)));
            stars = Array.from({ length: count }, () => {
                const layer = Math.random() < 0.55 ? 1 : (Math.random() < 0.82 ? 2 : 3);
                return {
                    x: Math.random() * w,
                    y: Math.random() * h,
                    r: layer === 1 ? Math.random() * 1.0 + 0.4 : (layer === 2 ? Math.random() * 1.5 + 0.9 : Math.random() * 2.1 + 1.3),
                    vx: (Math.random() - 0.5) * 0.12 * layer,
                    vy: - (0.08 + Math.random() * 0.14) * layer,
                    alpha: Math.random() * 0.65 + 0.35,
                    twinkleSpeed: 0.012 + Math.random() * 0.03,
                    twinklePhase: Math.random() * Math.PI * 2,
                    color: starColors[Math.floor(Math.random() * starColors.length)],
                    layer
                };
            });

            nebulae = [
                { x: w * 0.2, y: h * 0.25, r: Math.max(w, h) * 0.42, color: 'rgba(48, 88, 185, 0.16)', vx: 0.12, vy: 0.06 },
                { x: w * 0.8, y: h * 0.35, r: Math.max(w, h) * 0.38, color: 'rgba(110, 48, 165, 0.14)', vx: -0.10, vy: 0.07 },
                { x: w * 0.5, y: h * 0.8,  r: Math.max(w, h) * 0.44, color: 'rgba(25, 115, 165, 0.14)', vx: 0.08, vy: -0.06 }
            ];
        };

        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('orientationchange', () => setTimeout(resize, 120));
        window.visualViewport?.addEventListener('resize', resize);

        const spawnShootingStar = () => {
            if (shootingStars.length < 2 && Math.random() < 0.012) {
                const startX = Math.random() * w * 0.85 + w * 0.1;
                const startY = Math.random() * h * 0.45;
                const angle = (Math.PI / 4) + (Math.random() * 0.25 - 0.12);
                const speed = 7 + Math.random() * 5;
                shootingStars.push({
                    x: startX,
                    y: startY,
                    vx: -Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    len: 70 + Math.random() * 55,
                    life: 1
                });
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, w, h);

            for (const n of nebulae) {
                n.x += n.vx;
                n.y += n.vy;
                if (n.x < 0 || n.x > w) n.vx *= -1;
                if (n.y < 0 || n.y > h) n.vy *= -1;

                const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
                grad.addColorStop(0, n.color);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fill();
            }

            for (const s of stars) {
                s.x += s.vx;
                s.y += s.vy;
                s.twinklePhase += s.twinkleSpeed;

                if (s.y < -4) s.y = h + 4;
                if (s.y > h + 4) s.y = -4;
                if (s.x < -4) s.x = w + 4;
                if (s.x > w + 4) s.x = -4;

                const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.twinklePhase));
                ctx.globalAlpha = s.alpha * twinkle;
                ctx.fillStyle = s.color;

                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();

                if (s.layer === 3 && twinkle > 0.75) {
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = s.color;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
            ctx.globalAlpha = 1;

            spawnShootingStar();
            for (let i = shootingStars.length - 1; i >= 0; i--) {
                const st = shootingStars[i];
                st.x += st.vx;
                st.y += st.vy;
                st.life -= 0.022;

                if (st.life <= 0 || st.x < -100 || st.y > h + 100) {
                    shootingStars.splice(i, 1);
                    continue;
                }

                const tailX = st.x - (st.vx / Math.hypot(st.vx, st.vy)) * st.len;
                const tailY = st.y - (st.vy / Math.hypot(st.vx, st.vy)) * st.len;
                const grad = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
                grad.addColorStop(0, `rgba(255, 255, 255, ${st.life})`);
                grad.addColorStop(0.3, `rgba(140, 210, 255, ${st.life * 0.6})`);
                grad.addColorStop(1, 'rgba(140, 210, 255, 0)');

                ctx.strokeStyle = grad;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(st.x, st.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();
            }

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
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

    showFeedback(message, type = 'info', duration = 2000) {
        clearTimeout(this._timer);
        this.feedback.textContent = message;
        this.feedback.className = `alert alert-${type}`;

        if (type !== 'danger' && duration > 0) {
            this._timer = setTimeout(() => this.feedback.classList.add('d-none'), duration);
        }
    }

    limpiarResaltadoDemo() {
        const z1 = document.getElementById('joystick-zone');
        const k1 = document.getElementById('joystick-knob');
        const z2 = document.getElementById('joystick-zone-arm');
        const k2 = document.getElementById('joystick-knob-arm');
        if (z1) delete z1.dataset.dir;
        if (k1) { k1.classList.add('returning'); k1.style.transform = 'translate(0px, 0px)'; }
        if (z2) delete z2.dataset.dir;
        if (k2) { k2.classList.add('returning'); k2.style.transform = 'translate(0px, 0px)'; }
        document.querySelectorAll('.cmd-btn.sent').forEach(b => b.classList.remove('sent'));
    }

    resaltarMovimientoDemo(nombreComando) {
        this.limpiarResaltadoDemo();
        const norm = normalizar(String(nombreComando || ''));
        if (!norm || norm === 'DETENER' || norm === 'STOP') return;

        const offset = 22;
        const mapaJoy1 = {
            'AVANZAR':         { dir: 'ADELANTE',  dx: 0,       dy: -offset },
            'ADELANTE':        { dir: 'ADELANTE',  dx: 0,       dy: -offset },
            'RETROCEDER':      { dir: 'ATRAS',     dx: 0,       dy: offset },
            'ATRAS':           { dir: 'ATRAS',     dx: 0,       dy: offset },
            'GIRAR_IZQUIERDA': { dir: 'IZQUIERDA', dx: -offset, dy: 0 },
            'IZQUIERDA':       { dir: 'IZQUIERDA', dx: -offset, dy: 0 },
            'GIRAR_DERECHA':   { dir: 'DERECHA',   dx: offset,  dy: 0 },
            'DERECHA':         { dir: 'DERECHA',   dx: offset,  dy: 0 }
        };
        const mapaJoy2 = {
            'SUBIR_BRAZO':     { dir: 'ADELANTE',  dx: 0,       dy: -offset },
            'BAJAR_BRAZO':     { dir: 'ATRAS',     dx: 0,       dy: offset },
            'MOTOR_IZQUIERDA': { dir: 'IZQUIERDA', dx: -offset, dy: 0 },
            'MOTOR_DERECHA':   { dir: 'DERECHA',   dx: offset,  dy: 0 }
        };

        if (mapaJoy1[norm]) {
            const z = document.getElementById('joystick-zone');
            const k = document.getElementById('joystick-knob');
            if (z) z.dataset.dir = mapaJoy1[norm].dir;
            if (k) {
                k.classList.add('returning');
                k.style.transform = `translate(${mapaJoy1[norm].dx}px, ${mapaJoy1[norm].dy}px)`;
            }
            return;
        }
        if (mapaJoy2[norm]) {
            const z = document.getElementById('joystick-zone-arm');
            const k = document.getElementById('joystick-knob-arm');
            if (z) z.dataset.dir = mapaJoy2[norm].dir;
            if (k) {
                k.classList.add('returning');
                k.style.transform = `translate(${mapaJoy2[norm].dx}px, ${mapaJoy2[norm].dy}px)`;
            }
            return;
        }

        document.querySelectorAll('.cmd-btn').forEach(btn => {
            if (normalizar(btn.textContent || '') === norm) {
                btn.classList.add('sent');
                setTimeout(() => btn.classList.remove('sent'), 600);
            }
        });
    }

    renderComandos(comandos, onCommandClick) {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = '';

        const btnStop = document.getElementById('btn-stop');
        if (btnStop) btnStop.disabled = false;
        
        const excluidos = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'DETENER', 'STOP',
                          'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA'];
        
        comandos.forEach(cmd => {
            const nombreCmd = cmd.nombre || cmd.comando;
            if (nombreCmd && !excluidos.includes(normalizar(nombreCmd))) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'cmd-btn';
                btn.innerHTML = `<span class="cmd-ico"><i class="bi bi-${iconoPara(nombreCmd)}"></i></span><span>${etiqueta(nombreCmd)}</span>`;
                btn.onclick = () => {
                    this.vibrar();
                    const norm = normalizar(nombreCmd);
                    if (/SONIDO|CLAXON|BOCINA|AUDIO/.test(norm)) this.playSound('horn');
                    else if (/VELOC|ACELER|TURBO|RAPID/.test(norm)) this.playSound('speed');
                    else if (/LUZ|LUCES/.test(norm)) this.playSound('light');
                    else this.playSound('tap');
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
window.ui = ui;
