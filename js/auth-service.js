import './error-guard.js';
import './ui-feedback.js';
import { initFirebase, db, auth, signInWithEmailAndPassword, signOut as fbSignOut, doc, getDoc, setDoc } from './firebase-init.js';
import './firebase-sync.js';
import './empresa-service.js';
import './pwa-install.js';

const AuthService = {
    MASTER_USER: 'admin',
    MASTER_HASH: 'cf3ba79fe53bf2417903fbde744a088e4e0ca0ca877ee76dcd174011ce5a43dd',

    /**
     * Validador de Força de Senha no Padrão da Internet:
     * - Mínimo 8 caracteres
     * - Pelo menos 1 letra maiúscula
     * - Pelo menos 1 número
     * - Pelo menos 1 caractere especial
     */
    validarForcaSenha(password) {
        if (!password || typeof password !== 'string') {
            return {
                valido: false,
                erros: ['A senha não foi informada.'],
                detalhes: { temMinimo: false, temMaiuscula: false, temNumero: false, temEspecial: false },
                mensagem: 'Por favor, digite uma senha.'
            };
        }

        const temMinimo = password.length >= 8;
        const temMaiuscula = /[A-Z]/.test(password);
        const temNumero = /[0-9]/.test(password);
        const temEspecial = /[^A-Za-z0-9]/.test(password);

        const erros = [];
        if (!temMinimo) erros.push('mínimo de 8 caracteres');
        if (!temMaiuscula) erros.push('pelo menos 1 letra maiúscula (A-Z)');
        if (!temNumero) erros.push('pelo menos 1 número (0-9)');
        if (!temEspecial) erros.push('pelo menos 1 caractere especial (!@#$%...)');

        return {
            valido: erros.length === 0,
            erros,
            detalhes: {
                temMinimo,
                temMaiuscula,
                temNumero,
                temEspecial
            },
            mensagem: erros.length === 0 
                ? 'Senha segura e válida.' 
                : `A senha deve conter: ${erros.join(', ')}.`
        };
    },

    /**
     * Criptografia da Senha:
     * Prioriza a API do servidor Node.js (/api/auth/hash) com PBKDF2 e Salt.
     * Caso o app esteja offline (PWA), utiliza a Web Crypto API nativa do navegador com PBKDF2 e Salt.
     */
    async hashPassword(password) {
        // 1. Tenta gerar via Servidor Node.js
        try {
            const resp = await fetch('/api/auth/hash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.hash) return data.hash;
            }
        } catch (e) {
            console.warn('API de hash no servidor indisponível, usando Web Crypto local:', e ? e.message : e);
        }

        // 2. Fallback offline seguro: Web Crypto PBKDF2 (100.000 iterações + Salt)
        try {
            if (window.crypto && window.crypto.subtle) {
                const salt = window.crypto.getRandomValues(new Uint8Array(16));
                const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
                const keyMaterial = await window.crypto.subtle.importKey(
                    'raw',
                    new TextEncoder().encode(password),
                    { name: 'PBKDF2' },
                    false,
                    ['deriveBits']
                );
                const derivedBits = await window.crypto.subtle.deriveBits(
                    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-512' },
                    keyMaterial,
                    512
                );
                const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
                return `pbkdf2$100000$${saltHex}$${hashHex}`;
            }
        } catch (e) {
            console.warn('Web Crypto PBKDF2 falhou, usando SHA-256 fallback:', e);
        }

        // Fallback básico SHA-256
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    getUsers() {
        return JSON.parse(localStorage.getItem('usuarios')) || [];
    },

    saveUsers(users) {
        localStorage.setItem('usuarios', JSON.stringify(users));
    },

    async addUser(nome, username, password, permissoes) {
        // Validação obrigatória da nova senha
        const check = this.validarForcaSenha(password);
        if (!check.valido) {
            throw new Error(check.mensagem);
        }

        const users = this.getUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Nome de usuário já existe');
        }
        const hash = await this.hashPassword(password);
        users.push({
            id: Date.now().toString(),
            nome,
            username,
            passwordHash: hash,
            permissoes: permissoes
        });
        this.saveUsers(users);
    },

    async updateUser(id, nome, username, password, permissoes) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.id === id);
        if (index === -1) throw new Error('Usuário não encontrado');
        
        if (users.find(u => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Nome de usuário já existe');
        }
        users[index].nome = nome;
        users[index].username = username;
        users[index].permissoes = permissoes;
        if (password && password.trim() !== '') {
            const check = this.validarForcaSenha(password);
            if (!check.valido) {
                throw new Error(check.mensagem);
            }
            users[index].passwordHash = await this.hashPassword(password);
        }
        this.saveUsers(users);
    },

    removerUser(id) {
        let users = this.getUsers();
        users = users.filter(u => u.id !== id);
        this.saveUsers(users);
    },

    async login(username, password) {
        const usernameNormalized = username.trim().toLowerCase();
        
        let activeEmpresa = localStorage.getItem('master_active_empresaId');
        if (!activeEmpresa) {
            try {
                const saved = JSON.parse(localStorage.getItem('empresas_cadastradas') || '[]');
                activeEmpresa = saved.length > 0 ? saved[0].id : '';
            } catch (e) {
                activeEmpresa = '';
            }
        }

        const localUsers = this.getUsers();
        const cloudUsers = [];

        // 1. Tenta carregar usuário do Firestore se existir conexão
        try {
            if (db) {
                const userDoc = await getDoc(doc(db, 'users', usernameNormalized));
                if (userDoc.exists()) {
                    cloudUsers.push(userDoc.data());
                }
            }
        } catch (err) {
            console.warn('Busca no Firestore em nuvem:', err ? (err.message || String(err)) : '');
        }

        // 2. Tenta autenticar pelo Servidor Node.js (/api/auth/login)
        try {
            const resp = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: usernameNormalized,
                    password,
                    localUsers,
                    cloudUsers,
                    activeEmpresaId: activeEmpresa
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data && data.success && data.user) {
                    if (data.token) {
                        localStorage.setItem('session_token', data.token);
                    }
                    localStorage.setItem('logged_in_user', JSON.stringify(data.user));
                    if (window.FirebaseSync) window.FirebaseSync.start();
                    return true;
                }
            } else if (resp.status === 401) {
                return false;
            }
        } catch (err) {
            console.warn('API de login do servidor inacessível, testando fallback local:', err);
        }

        // 3. FALLBACK LOCAL OFFLINE (Garante funcionamento se sem internet no PWA)
        const shaBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
        const shaHash = Array.from(new Uint8Array(shaBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        // Master local
        if (usernameNormalized === this.MASTER_USER.toLowerCase() && shaHash === this.MASTER_HASH) {
            const masterData = { 
                id: 'master', 
                nome: 'Administrador Master', 
                username: 'admin', 
                isMaster: true, 
                empresaId: activeEmpresa 
            };
            localStorage.setItem('logged_in_user', JSON.stringify(masterData));
            if (window.FirebaseSync) window.FirebaseSync.start();
            return true;
        }

        // Usuários Firestore ou Locais
        const allCandidates = [...cloudUsers, ...localUsers];
        for (const u of allCandidates) {
            if (u && u.username && u.username.toLowerCase().trim() === usernameNormalized) {
                let match = false;
                if (u.passwordHash === shaHash) {
                    match = true;
                } else if (u.passwordHash && u.passwordHash.startsWith('pbkdf2$')) {
                    // Verificação PBKDF2 local
                    try {
                        const parts = u.passwordHash.split('$');
                        if (parts.length === 4) {
                            const saltHex = parts[2];
                            const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                            const keyMaterial = await window.crypto.subtle.importKey(
                                'raw',
                                new TextEncoder().encode(password),
                                { name: 'PBKDF2' },
                                false,
                                ['deriveBits']
                            );
                            const derivedBits = await window.crypto.subtle.deriveBits(
                                { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-512' },
                                keyMaterial,
                                512
                            );
                            const testHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
                            match = (testHex === parts[3]);
                        }
                    } catch (e) {
                        console.error('Erro na checagem PBKDF2 local:', e);
                    }
                }

                if (match) {
                    const sessionData = {
                        id: u.id || usernameNormalized,
                        nome: u.nome || u.username,
                        username: usernameNormalized,
                        isMaster: !!u.isMaster,
                        empresaId: u.empresaId || activeEmpresa,
                        permissoes: u.permissoes || []
                    };
                    localStorage.setItem('logged_in_user', JSON.stringify(sessionData));
                    if (window.FirebaseSync) window.FirebaseSync.start();
                    return true;
                }
            }
        }

        return false;
    },

    async logout() {
        localStorage.removeItem('logged_in_user');
        localStorage.removeItem('session_token');
        if (window.FirebaseSync) window.FirebaseSync.stop();
        try {
            if (auth) await fbSignOut(auth);
        } catch (e) {
            console.error('Erro ao sair:', e ? (e.message || String(e)) : '');
        }
        window.location.href = 'login.html';
    },

    getCurrentUser() {
        const data = localStorage.getItem('logged_in_user');
        return data ? JSON.parse(data) : null;
    },

    async checkAuth() {
        const user = this.getCurrentUser();
        const p = window.location.pathname;
        const isLoginPage = p.endsWith('login.html') || p.endsWith('/login') || p === '/login' || p.endsWith('/login/');
        
        if (!user && !isLoginPage) {
            window.location.href = 'login.html';
            return;
        }
        
        if (user && isLoginPage) {
            window.location.href = 'index.html';
            return;
        }

        // Validação criptográfica assíncrona do Token de Sessão se estiver logado
        const token = localStorage.getItem('session_token');
        if (user && token && !isLoginPage) {
            try {
                const resp = await fetch('/api/auth/verify-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (!data.valid) {
                        console.warn('Sessão expirada ou inválida. Desconectando por segurança.');
                        this.logout();
                        return;
                    }
                }
            } catch (err) {
                // Silencioso em caso de ausência de conexão no PWA
            }
        }

        if (user && !isLoginPage) {
            if (window.FirebaseSync) window.FirebaseSync.start();
        }

        if (user && !user.isMaster && !isLoginPage) {
            this.applyPermissions(user);
        }
    },

    hasPermission(moduleName) {
        const user = this.getCurrentUser();
        if (!user) return false;
        if (user.isMaster) return true;
        return user.permissoes && user.permissoes.includes(moduleName);
    },

    applyPermissions(user) {
        const path = window.location.pathname;
        let currentModule = '';
        if (path.includes('agendamentos.html')) currentModule = 'agenda';
        if (path.includes('pedidos.html')) currentModule = 'pedidos';
        if (path.includes('caixa.html')) currentModule = 'caixa';
        if (path.includes('estoque.html')) currentModule = 'estoque';
        if (path.includes('fidelidade.html')) currentModule = 'posvenda';
        if (path.includes('clientes.html')) currentModule = 'clientes';
        if (path.includes('servicos.html')) currentModule = 'servicos';
        if (path.includes('configuracoes.html')) currentModule = 'configuracoes';

        if (currentModule && !this.hasPermission(currentModule)) {
            if (window.UI) window.UI.toast('Seu usuário não tem permissão para acessar esta área.', 'error');
            else alert('Seu usuário não tem permissão para acessar esta área.');
            window.location.href = 'index.html';
        }

        document.addEventListener('DOMContentLoaded', () => {
            const navMap = {
                'agenda': 'a[href="agendamentos.html"]',
                'pedidos': 'a[href="pedidos.html"]',
                'caixa': 'a[href="caixa.html"]',
                'estoque': 'a[href="estoque.html"]',
                'posvenda': 'a[href="fidelidade.html"]',
                'clientes': 'a[href="clientes.html"]',
                'servicos': 'a[href="servicos.html"]',
                'configuracoes': '.btn-settings-gear'
            };

            for (const [module, selector] of Object.entries(navMap)) {
                if (!this.hasPermission(module)) {
                    const el = document.querySelector(selector);
                    if (el) el.style.display = 'none';
                }
            }
        });
    }
};

window.AuthService = AuthService;
AuthService.checkAuth();

export default AuthService;
export { AuthService };
