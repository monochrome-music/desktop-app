(function () {
    if (window.__monochromeGoogleAuthInjected) {
        return;
    }
    window.__monochromeGoogleAuthInjected = true;

    // iOS client ID (from GoogleService-Info.plist, type 2)
    const IOS_CLIENT_ID = '895657412760-c5snes8l2o0sgrarq5fkhl04n3mb59u9.apps.googleusercontent.com';
    // Android web/server client ID (from google-services.json, type 3)
    const ANDROID_CLIENT_ID = '895657412760-batt2m0sfdn6nvkv8vv1th081b74cpe6.apps.googleusercontent.com';

    const isAndroid = /android/i.test(navigator.userAgent);
    const CLIENT_ID = isAndroid ? ANDROID_CLIENT_ID : IOS_CLIENT_ID;
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
        if (!invoke) return;

        setStatus('Opening Google sign-in...');
        const tokens = await invoke('plugin:google-auth|sign_in', {
            payload: { clientId: CLIENT_ID, scopes: SCOPES },
        });

        const { getAuth, GoogleAuthProvider, signInWithCredential } = await import(
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
        );

        const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
        const auth = getAuth();
        await signInWithCredential(auth, credential);

        if (isLoginPage()) {
            window.location.replace('/');
        } else {
            // Fermer le dropdown en douceur, le frontend web s'occupe de mettre à jour son contenu via onAuthStateChanged
            const dropdown = document.getElementById('header-account-dropdown');
            if (dropdown) dropdown.classList.remove('active');
        }
    }

    function shouldIntercept(btn) {
        if (!btn) return false;
        if (btn.classList.contains('danger')) return false;
        return true;
    }

    function findConnectButton(event) {
        if (!event) return null;
        const selector = '#header-google-auth, #firebase-connect-btn, #google-btn';
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
        // Intercepter silencieusement le bouton de déconnexion pour refermer le menu
        const target = event.target;
        if (target && target.closest && target.closest('#header-sign-out')) {
            const dropdown = document.getElementById('header-account-dropdown');
            if (dropdown) dropdown.classList.remove('active');
            // On le laisse continuer pour que le vrai script du site web gère la déconnexion Firebase
        }

        const btn = findConnectButton(event);
        if (!btn) return;
        if (!shouldIntercept(btn)) return;

        const invoke = getInvoke();
        if (!invoke) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        signInWithGooglePlugin().catch((error) => {
            console.error('[Google Auth Bridge] Google sign-in failed:', error);
            setStatus('Google sign-in failed.');
            alert(`Google sign-in failed: ${error?.message || error}`);
        });
    }

    document.addEventListener('click', onClick, true);
})();
