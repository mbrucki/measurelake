(function () {
    const GTM_ID = '%%GTM_ID%%';
    const GTM_SERVER_URL = '%%GTM_SERVER_URL%%';
    const PROXY_BASE_URL = new URL(document.currentScript.src).origin;
    const PROXY_PATH_PREFIX = '/load';
    const KEY_API_ENDPOINT = `${PROXY_BASE_URL}/api/get-key`;
    let encryptionKey = null;

    async function fetchEncryptionKey() {
        try {
            const response = await fetch(KEY_API_ENDPOINT);
            if (!response.ok) throw new Error(`Failed to fetch key: ${response.status}`);
            const data = await response.json();
            sessionStorage.setItem('gtmfpm_encryptionKey', data.key);
            sessionStorage.setItem('gtmfpm_keyExpiry', data.expiry);
            console.log('GTM Proxy: Encryption key loaded.');
            return data.key;
        } catch (error) {
            console.error('GTM Proxy: Error fetching key:', error);
            return null;
        }
    }

    async function getEncryptionKey() {
        const cachedKey = sessionStorage.getItem('gtmfpm_encryptionKey');
        const expiry = sessionStorage.getItem('gtmfpm_keyExpiry');
        if (cachedKey && expiry && new Date(expiry) > new Date()) return cachedKey;
        return await fetchEncryptionKey();
    }

    async function encryptUrl(dataString) {
        if (!encryptionKey) {
            encryptionKey = await getEncryptionKey();
            if (!encryptionKey) throw new Error("Encryption key not available.");
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(dataString);
        const keyBytes = encoder.encode(encryptionKey);
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, data);
        const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
        return `${ivHex}:${encryptedHex}`;
    }

    async function encryptPayload(payloadString) {
        if (!encryptionKey) {
            encryptionKey = await getEncryptionKey();
            if (!encryptionKey) throw new Error("Encryption key not available.");
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        const keyBytes = encoder.encode(encryptionKey);
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, data);
        const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
        return `${ivHex}:${encryptedHex}`;
    }

    async function modifyUrl(url) {
        if (typeof url !== 'string' || !url.includes(GTM_SERVER_URL)) {
            return url;
        }
        console.log('GTM Proxy: Intercepting URL:', url);
        const relativePath = url.substring(GTM_SERVER_URL.length);
        const encryptedFragment = await encryptUrl(relativePath);
        const finalUrl = `${PROXY_BASE_URL}${PROXY_PATH_PREFIX}/${encodeURIComponent(encryptedFragment)}`;
        console.log(`GTM Proxy: Rerouting to: ${finalUrl}`);
        return finalUrl;
    }

    // Override document.createElement to intercept src assignments via the .src property or setAttribute.
    const originalCreateElement = document.createElement;
    document.createElement = function (tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);

        if (tagName.toLowerCase() === 'script') {
            // First, grab the original setAttribute method before we override it.
            const originalSetAttribute = element.setAttribute.bind(element);

            // Now, override setAttribute to intercept 'src' changes.
            element.setAttribute = async function (name, value) {
                if (name.toLowerCase() === 'src') {
                    const finalUrl = await modifyUrl(value);
                    originalSetAttribute(name, finalUrl);
                } else {
                    originalSetAttribute(name, value);
                }
            };

            // Finally, define a custom setter for the 'src' property.
            // This setter will call our overridden setAttribute method, ensuring all logic is unified.
            Object.defineProperty(element, 'src', {
                get: function () {
                    return this.getAttribute('src');
                },
                set: function (value) {
                    // This calls our custom, overridden setAttribute method above.
                    element.setAttribute('src', value);
                },
                configurable: true
            });
        }
        return element;
    };

    const originalFetch = window.fetch;
    window.fetch = async function (resource, init = {}) {
        let finalResource = resource;
        let finalInit = { ...init };

        if (typeof resource === 'string' && resource.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting fetch:', resource);
            finalResource = await modifyUrl(resource);

            if (finalInit.body && (String(finalInit.method).toUpperCase() === 'POST' || String(finalInit.method).toUpperCase() === 'PUT')) {
                 if (typeof finalInit.body === 'string') {
                    console.log('GTM Proxy: Encrypting fetch payload.');
                    finalInit.body = await encryptPayload(finalInit.body);
                 } else {
                    console.warn('GTM Proxy: Fetch body is not a string, cannot encrypt.');
                 }
            }
        }
        return originalFetch.call(this, finalResource, finalInit);
    };

    (async function initialize() {
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', GTM_ID);
        console.log('GTM Proxy: dataLayer initialized for', GTM_ID);
        
        encryptionKey = await getEncryptionKey();
        if(encryptionKey) {
            console.log('GTM Proxy: Initialized successfully. Loading GTM...');
            const gtmScript = document.createElement('script');
            gtmScript.async = true;
            const gtmUrl = new URL(`gtm.js?id=${GTM_ID}`, GTM_SERVER_URL);
            gtmScript.src = gtmUrl.href;
            document.head.appendChild(gtmScript);
        } else {
            console.error('GTM Proxy: Initialization failed, key not retrieved.');
        }
    })();
})(); 