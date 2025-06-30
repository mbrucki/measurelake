require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// --- Configuration ---
const GTM_ID = process.env.GTM_ID ? process.env.GTM_ID.trim() : null;
const KEY_API_URL = 'https://measurelake-249969218520.us-central1.run.app/givemekey';
const PORT = process.env.PORT || 8080;

if (!GTM_ID) {
    console.error('FATAL: GTM_ID environment variable is not set.');
    process.exit(1);
}

// --- State ---
let encryptionKey = null;
let keyExpiry = null;

// --- Cryptography Helpers ---
function decrypt(encryptedString, key) {
    try {
        const parts = encryptedString.split(':');
        if (parts.length !== 2) throw new Error('Invalid encrypted string format.');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedData = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
        const tag = Buffer.from(encryptedData.slice(-32), 'hex');
        decipher.setAuthTag(tag);
        const encryptedContent = Buffer.from(encryptedData.slice(0, -32), 'hex');
        let decrypted = decipher.update(encryptedContent, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error.message);
        throw new Error('Decryption failed');
    }
}

// --- Key Management ---
async function updateEncryptionKey() {
    console.log('Attempting to fetch new encryption key...');
    try {
        const response = await axios.get(KEY_API_URL, {
            headers: { 'Referer': 'https://partytracking-app' }
        });
        if (response.data && response.data.key && response.data.key_expiry) {
            encryptionKey = response.data.key;
            keyExpiry = new Date(response.data.key_expiry);
            console.log(`Successfully updated encryption key. New expiry: ${keyExpiry.toISOString()}`);
        } else {
            throw new Error('Invalid response structure from key API.');
        }
    } catch (error) {
        console.error('Failed to fetch encryption key:', error.response ? error.response.status : error.message);
        encryptionKey = null;
        keyExpiry = null;
    }
}

function isKeyValid() {
    return encryptionKey && keyExpiry && new Date() < keyExpiry;
}

async function ensureKey() {
    if (!isKeyValid()) {
        await updateEncryptionKey();
    }
    if (!encryptionKey) {
        throw new Error('Encryption key is not available.');
    }
    return encryptionKey;
}

// --- API and Static Endpoints ---
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    const clientScript = `
(function () {
    const GTM_ID = '${GTM_ID}';
    const PROXY_BASE_URL = new URL(document.currentScript.src).origin;
    const PROXY_PATH_PREFIX = '/load';
    const KEY_API_ENDPOINT = \`\${PROXY_BASE_URL}/api/get-key\`;
    let encryptionKey = null;

    async function fetchEncryptionKey() {
        try {
            const response = await fetch(KEY_API_ENDPOINT);
            if (!response.ok) throw new Error(\`Failed to fetch key: \${response.status}\`);
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

    async function encrypt(dataString) {
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
        const encryptedData = new Uint8Array(encrypted);
        const tag = encryptedData.slice(-16);
        const ciphertext = encryptedData.slice(0, -16);
        const encryptedHex = Array.from(ciphertext).map(b => b.toString(16).padStart(2, '0')).join('') + Array.from(tag).map(b => b.toString(16).padStart(2, '0')).join('');
        return \`\${ivHex}:\${encryptedHex}\`;
    }

    const originalCreateElement = document.createElement;
    document.createElement = function (tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);
        if (tagName.toLowerCase() === 'script') {
            Object.defineProperty(element, 'src', {
                get: function() { return this.getAttribute('src'); },
                set: async function (value) {
                    if (typeof value === 'string' && value.includes('googletagmanager.com/')) {
                        console.log('GTM Proxy: Intercepting script load:', value);
                        const urlObject = new URL(value);
                        const pathAndQuery = urlObject.pathname.substring(1) + urlObject.search;
                        const encryptedFragment = await encrypt(pathAndQuery);
                        const finalUrl = \`\${PROXY_BASE_URL}\${PROXY_PATH_PREFIX}/\${encodeURIComponent(encryptedFragment)}\`;
                        console.log(\`GTM Proxy: Rerouting script to: \${finalUrl}\`);
                        this.setAttribute('src', finalUrl);
                    } else {
                        this.setAttribute('src', value);
                    }
                }
            });
        }
        return element;
    };
    
    const originalFetch = window.fetch;
    window.fetch = async function (resource, init = {}) {
        let finalResource = resource;
        let finalInit = init;
        if (typeof resource === 'string' && resource.includes('googletagmanager.com/')) {
             console.log('GTM Proxy: Intercepting fetch:', resource);
            const urlObject = new URL(resource);
            const pathAndQuery = urlObject.pathname.substring(1) + urlObject.search;
            const encryptedFragment = await encrypt(pathAndQuery);
            finalResource = \`\${PROXY_BASE_URL}\${PROXY_PATH_PREFIX}/\${encodeURIComponent(encryptedFragment)}\`;
            if (finalInit.body && (finalInit.method === 'POST' || finalInit.method === 'PUT')) {
                finalInit.body = await encrypt(finalInit.body);
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
            gtmScript.src = \`https://www.googletagmanager.com/gtm.js?id=\${GTM_ID}\`;
            document.head.appendChild(gtmScript);
        } else {
            console.error('GTM Proxy: Initialization failed, key not retrieved.');
        }
    })();
})();
    `;
    res.send(clientScript);
});

app.get('/api/get-key', cors(), async (req, res) => {
    try {
        await ensureKey();
        res.json({ key: encryptionKey, expiry: keyExpiry.toISOString() });
    } catch (error) {
        res.status(503).json({ error: 'Key not available' });
    }
});

app.use(express.raw({type: '*/*'}));

// --- Main Proxy Endpoint ---
app.all('/load/:encryptedFragment', async (req, res) => {
    const { encryptedFragment } = req.params;

    try {
        const currentKey = await ensureKey();
        const decryptedFragment = decrypt(encryptedFragment, currentKey);

        const upstreamHost = \`\${GTM_ID}.fps.goog\`;
        const targetUrl = new URL(\`https://\${upstreamHost}\`);
        targetUrl.pathname += \`/\${decryptedFragment}\`;

        Object.keys(req.query).forEach(key => {
            targetUrl.searchParams.append(key, req.query[key]);
        });
        
        console.log(\`Forwarding request to: \${targetUrl.toString()}\`);

        const response = await axios({
            method: req.method,
            url: targetUrl.toString(),
            data: req.method !== 'GET' && req.body.length > 0 ? req.body : null,
            headers: {
                ...req.headers,
                host: upstreamHost,
            },
            responseType: 'stream',
            validateStatus: () => true,
        });

        res.status(response.status);
        Object.keys(response.headers).forEach(key => {
            if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
                res.setHeader(key, response.headers[key]);
            }
        });
        response.data.pipe(res);

    } catch (error) {
        console.error('Proxy error:', error.message);
        if (error.response) {
            console.error('Upstream error details:', error.response.status, error.response.data);
            res.status(error.response.status).send('Error from upstream server.');
        } else if (error.message.includes('Decryption failed')) {
            res.status(400).send('Bad request: Decryption failed.');
        } else if (error.message.includes('key is not available')) {
            res.status(503).send('Service unavailable: Cannot get encryption key.');
        } else {
            res.status(500).send('Internal server error.');
        }
    }
});

// --- Server Initialization ---
(async () => {
    await updateEncryptionKey();
    setInterval(updateEncryptionKey, 60 * 60 * 1000);

    app.listen(PORT, () => {
        if (isKeyValid()) {
            console.log(`Server listening on port ${PORT}. GTM_ID: ${GTM_ID}. Key is valid.`);
        } else {
            console.warn(`Server listening on port ${PORT}. GTM_ID: ${GTM_ID}. WARNING: Key is NOT valid. Service will fail until a key is fetched.`);
        }
    });
})(); 