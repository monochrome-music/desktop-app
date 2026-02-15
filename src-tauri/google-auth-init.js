(function() {
    if (window.__monochromeGoogleAuthInjected) {
        return;
    }
    window.__monochromeGoogleAuthInjected = true;

    const CLIENT_ID = '895657412760-c5snes8l2o0sgrarq5fkhl04n3mb59u9.apps.googleusercontent.com';
    const SCOPES = ['openid', 'email', 'profile'];

    function getInvoke() {
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
        }
        if (window.__TAURI__?.tauri?.invoke) {
            return window.__TAURI__.tauri.invoke.bind(window.__TAURI__.tauri);
        }
        return null;
    }

    function setStatus(message) {
        const statusEl = document.getElementById('firebase-status');
        if (statusEl && message) {
            statusEl.textContent = message;
        }
    }

    function isLoginPage() {
        return window.location.pathname.indexOf('/login') === 0;
    }

    async function signInWithGooglePlugin() {
        if (!CLIENT_ID || CLIENT_ID.startsWith('REPLACE_ME')) {
            alert('Google OAuth client ID is missing.');
            return;
        }

        const invoke = getInvoke();
        if (!invoke) {
            return;
        }

        setStatus('Opening Google sign-in...');
        const tokens = await invoke('plugin:google-auth|sign_in', {
            payload: {
                clientId: CLIENT_ID,
                scopes: SCOPES,
            },
        });

        const { getAuth, GoogleAuthProvider, signInWithCredential } = await import(
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
        );

        const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
        const auth = getAuth();
        const userCredential = await signInWithCredential(auth, credential);

        if (isLoginPage()) {
            const idToken = await userCredential.user.getIdToken();
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: idToken }),
            });
            if (!res.ok) {
                throw new Error('Server login failed: ' + res.status);
            }
            window.location.href = '/';
        }
    }

    function shouldIntercept(btn) {
        if (!btn) return false;
        if (btn.classList.contains('danger')) return false;
        return true;
    }

    function findConnectButton(event) {
        if (!event) return null;
        const selector = '#firebase-connect-btn, #google-btn';
        if (event.composedPath) {
            const path = event.composedPath();
            for (const item of path) {
                if (item && item.matches && item.matches(selector)) return item;
            }
        }
        const target = event.target;
        if (target && target.closest) {
            return target.closest(selector);
        }
        return null;
    }

    function onClick(event) {
        const btn = findConnectButton(event);
        if (!btn) return;
        if (!shouldIntercept(btn)) return;
        if (!getInvoke()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        signInWithGooglePlugin().catch((error) => {
            console.error('Google sign-in failed:', error);
            setStatus('Google sign-in failed.');
            alert(`Google sign-in failed: ${error?.message || error}`);
        });
    }

    document.addEventListener('click', onClick, true);
})();
