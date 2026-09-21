/**
 * ui-feedback.js - Sistema Universal de Toasts e Diálogos Visuais In-App
 * Substitui alerts e confirms nativos bloqueados por iframes, garantindo
 * fluidez, acessibilidade e design consistente em toda a aplicação.
 */

(function () {
    // 1. Container de Toasts
    let toastContainer = null;

    function getToastContainer() {
        if (!toastContainer || !document.body.contains(toastContainer)) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'uiToastContainer';
            toastContainer.className = 'ui-toast-container';
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    /**
     * Exibe notificação flutuante elegante (Toast)
     * @param {string} message 
     * @param {'success'|'error'|'warning'|'info'} type 
     * @param {number} duration 
     */
    function showToast(message, type = 'info', duration = 3500) {
        const container = getToastContainer();
        const toast = document.createElement('div');
        toast.className = `ui-toast ui-toast-${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span class="ui-toast-icon">${icons[type] || 'ℹ️'}</span>
            <span class="ui-toast-msg">${message}</span>
            <button type="button" class="ui-toast-close" aria-label="Fechar">&times;</button>
        `;

        const closeBtn = toast.querySelector('.ui-toast-close');
        closeBtn.onclick = () => removeToast(toast);

        container.appendChild(toast);

        // Auto remove
        const timer = setTimeout(() => {
            removeToast(toast);
        }, duration);

        toast.onmouseenter = () => clearTimeout(timer);
    }

    function removeToast(toast) {
        if (!toast) return;
        toast.classList.add('ui-toast-leaving');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 220);
    }

    /**
     * Exibe Modal de Confirmação In-App que retorna uma Promise<boolean>
     * Substitui o window.confirm() nativo que é bloqueado por navegadores em iframes.
     */
    function showConfirmDialog(options = {}) {
        const {
            title = 'Confirmação',
            message = 'Deseja realmente prosseguir com esta ação?',
            confirmText = 'Confirmar',
            cancelText = 'Cancelar',
            danger = false,
            icon = danger ? '⚠️' : '❓'
        } = typeof options === 'string' ? { message: options } : options;

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay open ui-dialog-overlay';
            overlay.style.zIndex = '10000';

            const confirmBtnClass = danger ? 'btn btn-danger' : 'btn btn-primary';
            const confirmBtnStyle = danger ? 'background:#dc2626; color:#fff; border:none;' : '';

            overlay.innerHTML = `
                <div class="modal-card ui-dialog-card" style="max-width: 460px; transform: scale(1);">
                    <div class="modal-header">
                        <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:1.1rem; color:var(--text-main);">
                            <span>${icon}</span>
                            <span>${title}</span>
                        </h3>
                        <button type="button" class="modal-close-btn ui-dialog-close">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:18px 20px; font-size:0.95rem; color:var(--text-main); line-height:1.5;">
                        ${message}
                    </div>
                    <div class="modal-footer" style="padding:14px 20px; display:flex; justify-content:flex-end; gap:10px; background:var(--bg-surface); border-top:1px solid var(--border-color);">
                        <button type="button" class="btn btn-secondary ui-dialog-cancel">${cancelText}</button>
                        <button type="button" class="${confirmBtnClass} ui-dialog-confirm" style="${confirmBtnStyle}">${confirmText}</button>
                    </div>
                </div>
            `;

            function cleanup(result) {
                overlay.classList.remove('open');
                setTimeout(() => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }, 150);
                resolve(result);
            }

            overlay.querySelector('.ui-dialog-close').onclick = () => cleanup(false);
            overlay.querySelector('.ui-dialog-cancel').onclick = () => cleanup(false);
            overlay.querySelector('.ui-dialog-confirm').onclick = () => cleanup(true);

            // Clicar fora fecha
            overlay.onclick = (e) => {
                if (e.target === overlay) cleanup(false);
            };

            // Teclado
            const keyHandler = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', keyHandler);
                    cleanup(false);
                } else if (e.key === 'Enter') {
                    document.removeEventListener('keydown', keyHandler);
                    cleanup(true);
                }
            };
            document.addEventListener('keydown', keyHandler);

            document.body.appendChild(overlay);

            // Focus no botão de confirmar ou cancelar
            const confirmBtn = overlay.querySelector('.ui-dialog-confirm');
            if (confirmBtn) confirmBtn.focus();
        });
    }

    /**
     * Exibe Modal Informativo In-App
     * Substitui o window.alert() nativo.
     */
    function showAlertModal(message, title = 'Aviso') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay open ui-dialog-overlay';
            overlay.style.zIndex = '10000';

            overlay.innerHTML = `
                <div class="modal-card ui-dialog-card" style="max-width: 440px; transform: scale(1);">
                    <div class="modal-header">
                        <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:1.1rem; color:var(--text-main);">
                            <span>ℹ️</span>
                            <span>${title}</span>
                        </h3>
                        <button type="button" class="modal-close-btn ui-dialog-close">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:18px 20px; font-size:0.95rem; color:var(--text-main); line-height:1.5;">
                        ${message}
                    </div>
                    <div class="modal-footer" style="padding:14px 20px; display:flex; justify-content:flex-end; background:var(--bg-surface); border-top:1px solid var(--border-color);">
                        <button type="button" class="btn btn-primary ui-dialog-ok">Entendi</button>
                    </div>
                </div>
            `;

            function cleanup() {
                overlay.classList.remove('open');
                setTimeout(() => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }, 150);
                resolve();
            }

            overlay.querySelector('.ui-dialog-close').onclick = cleanup;
            overlay.querySelector('.ui-dialog-ok').onclick = cleanup;
            overlay.onclick = (e) => {
                if (e.target === overlay) cleanup();
            };

            document.body.appendChild(overlay);
            const okBtn = overlay.querySelector('.ui-dialog-ok');
            if (okBtn) okBtn.focus();
        });
    }

    // Expor globalmente
    window.showToast = showToast;
    window.showConfirmDialog = showConfirmDialog;
    window.showAlertModal = showAlertModal;
    window.UI = {
        toast: showToast,
        confirm: showConfirmDialog,
        alert: showAlertModal
    };
})();
