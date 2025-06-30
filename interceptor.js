(function () {
    // Self-executing function to avoid polluting the global namespace

    // Dynamically determine the base URL of the proxy service from the script's own src.
    const scriptSrc = document.currentScript.src;
    const PROXY_BASE_URL = new URL(scriptSrc).origin;

    // --- Configuration ---
    // The base path for the proxy endpoint on this service.
    const PROXY_PATH_PREFIX = '/proxy';
    // The endpoint on this service that provides the public encryption key.
    const KEY_API_ENDPOINT = `${PROXY_BASE_URL}/api/get-key`;


    let encryptionKey = null;

    // --- Key Management ---

    async function fetchEncryptionKey() {
        try {
            const response = await fetch(KEY_API_ENDPOINT);
            if (!response.ok) {
                throw new Error(`Failed to fetch encryption key. Status: ${response.status}`);
            }
            const data = await response.json();

            sessionStorage.setItem('gtmfpm_encryptionKey', data.key);
            sessionStorage.setItem('gtmfpm_keyExpiry', data.expiry);
            console.log('GTM Proxy: Encryption key loaded and cached.');
            return data.key;
        } catch (error) {
            console.error('GTM Proxy: Error fetching encryption key:', error);
            return null;
        }
    }

    async function getEncryptionKey() {
        const cachedKey = sessionStorage.getItem('gtmfpm_encryptionKey');
        const expiry = sessionStorage.getItem('gtmfpm_keyExpiry');
        
        if (cachedKey && expiry && new Date(expiry) > new Date()) {
            return cachedKey;
        }

        console.log('GTM Proxy: Encryption key is missing or expired, fetching new one.');
        return await fetchEncryptionKey();
    }

    // --- Encryption Functions (using Web Crypto API) ---

    async function encrypt(dataString) {
        if (!encryptionKey) {
            encryptionKey = await getEncryptionKey();
            if (!encryptionKey) {
                throw new Error("Cannot encrypt, encryption key is not available.");
            }
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(dataString);
        const keyBytes = encoder.encode(encryptionKey);

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            cryptoKey,
            data
        );

        const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        return `${ivHex}:${encryptedHex}`;
    }

    // --- Interception Logic ---

    async function getModifiedUrl(originalUrl) {
         try {
            if (typeof originalUrl !== 'string') return originalUrl;
            
            const urlObject = new URL(originalUrl);
            const isGtmScript = urlObject.pathname.includes('/gtm.js') || urlObject.pathname.includes('/gtag/js');

            // Only intercept GTM scripts
            if (!isGtmScript) {
                return originalUrl;
            }

            const relativePathWithQuery = urlObject.pathname.substring(1) + urlObject.search; // e.g., 'gtm.js?id=GTM-XXXX'
            const encryptedFragment = await encrypt(relativePathWithQuery);
            
            const newUrl = `${PROXY_BASE_URL}${PROXY_PATH_PREFIX}/${encodeURIComponent(encryptedFragment)}`;
            console.log(`GTM Proxy: Rerouting ${originalUrl} -> ${newUrl}`);
            return newUrl;

        } catch (error) {
            console.error('GTM Proxy: Error modifying URL:', error);
            return originalUrl; // Fallback to original URL on error
        }
    }

    // Intercept <script> element additions
    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function (element) {
        if (element.tagName === 'SCRIPT' && element.src) {
            getModifiedUrl(element.src).then(modifiedURL => {
                element.src = modifiedURL;
                originalAppendChild.call(this, element);
            });
            return element;
        }
        return originalAppendChild.call(this, element);
    };

    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async function (resource, init = {}) {
        let finalResource = resource;
        
        if (typeof resource === 'string') {
             const urlObject = new URL(resource);
             // Intercept common GTM/GA collection paths
             const isCollectionRequest = urlObject.pathname.includes('/g/collect');

             if (isCollectionRequest) {
                const relativePathWithQuery = urlObject.pathname.substring(1) + urlObject.search; // 'g/collect?v=2...'
                const encryptedFragment = await encrypt(relativePathWithQuery);
                finalResource = `${PROXY_BASE_URL}${PROXY_PATH_PREFIX}/${encodeURIComponent(encryptedFragment)}`;
                console.log(`GTM Proxy: Rerouting fetch ${resource} -> ${finalResource}`);

                if (init.method && ['POST','PUT','PATCH'].includes(init.method.toUpperCase()) && init.body && typeof init.body === 'string') {
                    try {
                        init.body = await encrypt(init.body);
                    } catch (err) {
                        console.error('GTM Proxy: Error encrypting fetch payload:', err);
                    }
                }
             }
        }
        
        return originalFetch.call(this, finalResource, init);
    };

    // --- Initialization ---
    (async function initialize() {
        encryptionKey = await getEncryptionKey();
        if(encryptionKey) {
            console.log('GTM Proxy: Interceptor script initialized successfully.');
        } else {
            console.error('GTM Proxy: Initialization failed. Could not retrieve encryption key.');
        }
    })();

})(); 