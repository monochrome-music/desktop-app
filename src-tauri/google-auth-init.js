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
        await signInWithCredential(auth, credential);
    }

    function shouldIntercept(btn) {
        if (!btn) return false;
        if (btn.classList.contains('danger')) return false;
        return true;
    }

    function findConnectButton(event) {
        if (!event) return null;
        if (event.composedPath) {
            const path = event.composedPath();
            for (const item of path) {
                if (item && item.id === 'firebase-connect-btn') return item;
            }
        }
        const target = event.target;
        if (target && target.closest) {
            return target.closest('#firebase-connect-btn');
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
