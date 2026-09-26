// ==========================================================================
// ErrorGuard: Proteção global contra erros de serialização circular (JSON)
// e SyntaxError decorrentes de respostas HTML inesperadas.
// ==========================================================================

(function() {
    // 1. Proteção de JSON.stringify contra estruturas circulares
    const originalStringify = JSON.stringify;
    JSON.stringify = function(value, replacer, space) {
        const seen = new WeakSet();

        const safeReplacer = function(key, val) {
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) {
                    return '[Circular]';
                }
                seen.add(val);
            }
            if (typeof replacer === 'function') {
                return replacer.call(this, key, val);
            }
            return val;
        };

        if (Array.isArray(replacer)) {
            return originalStringify.call(this, value, function(k, v) {
                if (k !== '' && !replacer.includes(k)) return undefined;
                if (typeof v === 'object' && v !== null) {
                    if (seen.has(v)) return '[Circular]';
                    seen.add(v);
                }
                return v;
            }, space);
        }

        try {
            return originalStringify.call(this, value, safeReplacer, space);
        } catch (err) {
            return '"[Unserializable]"';
        }
    };

    // 2. Proteção de JSON.parse contra retornos HTML inesperados (ex: <!DOCTYPE html>)
    const originalParse = JSON.parse;
    JSON.parse = function(text, reviver) {
        if (typeof text === 'string') {
            const trimmed = text.trim();
            if (trimmed.startsWith('<')) {
                // Conteúdo HTML recebido em vez de JSON válido
                return null;
            }
        }
        try {
            return originalParse.call(this, text, reviver);
        } catch (err) {
            if (typeof text === 'string' && (text.includes('<') || err.message.includes("Unexpected token '<'"))) {
                return null;
            }
            throw err;
        }
    };

    // 3. Sanitização do console para prevenir que erros do Firestore / WebChannel quebrem o iframe bridge
    function sanitizeLogArg(arg) {
        if (arg === null || arg === undefined || typeof arg !== 'object') {
            return arg;
        }
        if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}`;
        }
        // Se for um nó DOM ou Window
        if (arg.nodeType || arg === window || arg === document) {
            return String(arg);
        }
        return arg;
    }

    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.warn = function(...args) {
        try {
            origWarn(...args.map(sanitizeLogArg));
        } catch (e) {
            origWarn('[ConsoleWarn Sanitized]');
        }
    };

    console.error = function(...args) {
        try {
            origError(...args.map(sanitizeLogArg));
        } catch (e) {
            origError('[ConsoleError Sanitized]');
        }
    };

    // 4. Captura global de erros não tratados para prevenir loops de alerta no iframe
    window.addEventListener('error', function(event) {
        if (event.message && (
            event.message.includes('circular structure') || 
            event.message.includes("Unexpected token '<'")
        )) {
            if (event.preventDefault) event.preventDefault();
            console.warn('[ErrorGuard] Erro interceptado e tratado com segurança:', event.message);
        }
    });

    window.addEventListener('unhandledrejection', function(event) {
        if (event.reason && typeof event.reason === 'object') {
            const msg = event.reason.message || String(event.reason);
            if (msg.includes('circular structure') || msg.includes("Unexpected token '<'")) {
                if (event.preventDefault) event.preventDefault();
                console.warn('[ErrorGuard] Promessa rejeitada interceptada com segurança:', msg);
            }
        }
    });

    // 5. Função de escape estrito contra injeção de HTML / XSS em saídas dinâmicas
    window.escapeHTML = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
})();
