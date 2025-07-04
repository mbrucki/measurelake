require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// --- Configuration ---
const GTM_ID = process.env.GTM_ID ? process.env.GTM_ID.trim() : null;
const GTM_SERVER_URL = process.env.GTM_SERVER_URL ? process.env.GTM_SERVER_URL.trim() : null;
const MEASURELAKE_API_KEY = process.env.MEASURELAKE_API_KEY ? process.env.MEASURELAKE_API_KEY.trim() : null;
const KEY_API_URL = 'https://measurelake-249969218520.us-central1.run.app/givemekey';
const USAGE_API_URL = 'https://measurelake-usage-249969218520.us-central1.run.app/updateUsage';
const PORT = process.env.PORT || 8080;

if (!GTM_ID || !GTM_SERVER_URL || !MEASURELAKE_API_KEY) {
    console.error('FATAL: GTM_ID, GTM_SERVER_URL, and MEASURELAKE_API_KEY environment variables must be set.');
    process.exit(1);
}

// --- State ---
let encryptionKey = null;
let keyExpiry = null;

// --- Cryptography Helpers ---
function decrypt(encryptedString, key) {
    console.log(`=== Decrypt Debug ===`);
    console.log(`Input encrypted string length: ${encryptedString.length}`);
    console.log(`Input key length: ${key ? key.length : 'null'}`);
    console.log(`Encrypted string (first 50 chars): ${encryptedString.substring(0, 50)}...`);
    
    if (key) {
        console.log(`Decrypt key value: "${key}"`);
        console.log(`Decrypt key first 10 chars: "${key.substring(0, 10)}"`);
        console.log(`Decrypt key last 10 chars: "${key.substring(key.length - 10)}"`);
    }
    
    try {
        const parts = encryptedString.split(':');
        console.log(`Split parts count: ${parts.length}`);
        if (parts.length !== 2) {
            console.error(`Invalid format: expected 2 parts, got ${parts.length}`);
            throw new Error('Invalid encrypted string format.');
        }
        
        console.log(`IV part length: ${parts[0].length}`);
        console.log(`Encrypted data part length: ${parts[1].length}`);
        
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedData = Buffer.from(parts[1], 'hex');
        
        console.log(`IV buffer length: ${iv.length}`);
        console.log(`Encrypted data buffer length: ${encryptedData.length}`);
        
        // Web Crypto API includes the auth tag in the encrypted result
        // The last 16 bytes are the auth tag
        const tag = encryptedData.slice(-16);
        const ciphertext = encryptedData.slice(0, -16);
        
        console.log(`Auth tag length: ${tag.length}`);
        console.log(`Ciphertext length: ${ciphertext.length}`);
        
        // Create key with proper length - Web Crypto uses the key as-is
        const keyBuffer = Buffer.from(key, 'utf8');
        console.log(`Key buffer length: ${keyBuffer.length}`);
        
        // Determine AES variant based on key length to match client side
        let algorithm;
        if (keyBuffer.length === 16) {
            algorithm = 'aes-128-gcm';
        } else if (keyBuffer.length === 24) {
            algorithm = 'aes-192-gcm';
        } else if (keyBuffer.length === 32) {
            algorithm = 'aes-256-gcm';
        } else {
            console.error(`Invalid key length: ${keyBuffer.length} bytes`);
            throw new Error(`Invalid key length: ${keyBuffer.length} bytes. Expected 16, 24, or 32 bytes.`);
        }
        
        console.log(`Using algorithm: ${algorithm}`);
        
        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(ciphertext, null, 'utf-8');
        decrypted += decipher.final('utf-8');
        
        console.log(`Successfully decrypted. Result length: ${decrypted.length}`);
        return decrypted;
    } catch (error) {
        console.error('=== Decryption Error Details ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Key length:', Buffer.from(key, 'utf8').length);
        if (encryptedString.includes(':')) {
            const parts = encryptedString.split(':');
            console.error('IV length:', Buffer.from(parts[0], 'hex').length);
            console.error('Encrypted data length:', Buffer.from(parts[1], 'hex').length);
        }
        throw new Error('Decryption failed');
    }
}

// --- Key Management ---
async function updateEncryptionKey() {
    console.log('=== Update Encryption Key Debug ===');
    console.log('Attempting to fetch new encryption key...');
    try {
        const referer = new URL(GTM_SERVER_URL).origin;
        console.log(`Fetching key with Referer: ${referer}`);
        console.log(`API URL: ${KEY_API_URL}`);
        console.log(`API Key length: ${MEASURELAKE_API_KEY ? MEASURELAKE_API_KEY.length : 'missing'}`);
        
        const response = await axios.get(KEY_API_URL, {
            headers: { 
                'Referer': referer,
                'Authorization': `Bearer ${MEASURELAKE_API_KEY}`
            }
        });
        
        console.log(`API Response Status: ${response.status}`);
        console.log(`API Response Data:`, response.data);
        
        if (response.data && response.data.key && response.data.key_expiry) {
            encryptionKey = response.data.key;
            keyExpiry = new Date(response.data.key_expiry);
            console.log(`Successfully updated encryption key. Key length: ${encryptionKey.length}, New expiry: ${keyExpiry.toISOString()}`);
        } else {
            console.error('Invalid response structure from key API:', response.data);
            throw new Error('Invalid response structure from key API.');
        }
    } catch (error) {
        console.error('=== Key Fetch Error ===');
        console.error('Error message:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
            console.error('Response headers:', error.response.headers);
        }
        console.error('Failed to fetch encryption key:', error.response ? error.response.status : error.message);
        encryptionKey = null;
        keyExpiry = null;
    }
}

function isKeyValid() {
    return encryptionKey && keyExpiry && new Date() < keyExpiry;
}

async function ensureKey() {
    console.log(`=== Ensure Key Debug ===`);
    console.log(`Current key valid: ${isKeyValid()}`);
    console.log(`Current key exists: ${!!encryptionKey}`);
    console.log(`Current key expiry: ${keyExpiry ? keyExpiry.toISOString() : 'none'}`);
    
    if (encryptionKey) {
        console.log(`Current key value: "${encryptionKey}"`);
        console.log(`Current key first 10 chars: "${encryptionKey.substring(0, 10)}"`);
        console.log(`Current key last 10 chars: "${encryptionKey.substring(encryptionKey.length - 10)}"`);
    }
    
    if (!isKeyValid()) {
        console.log(`Key invalid, fetching new key...`);
        await updateEncryptionKey();
    }
    if (!encryptionKey) {
        console.error(`No encryption key available after ensure attempt`);
        throw new Error('Encryption key is not available.');
    }
    console.log(`Returning key with length: ${encryptionKey.length}`);
    return encryptionKey;
}

// --- Usage Tracking ---
async function trackUsage(usageCount = 1) {
    try {
        const referer = new URL(GTM_SERVER_URL).origin;
        console.log(`Tracking usage: ${usageCount} for domain: ${referer}`);
        
        await axios.post(USAGE_API_URL, 
            { usage: usageCount }, 
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': referer,
                    'Referer': referer,
                    'Authorization': `Bearer ${MEASURELAKE_API_KEY}`
                },
                timeout: 5000 // 5 second timeout to avoid blocking main response
            }
        );
        
        console.log(`Successfully tracked ${usageCount} usage(s)`);
    } catch (error) {
        // Don't let usage tracking failures affect the main functionality
        console.warn('Failed to track usage:', error.response ? 
            `${error.response.status} - ${error.response.statusText}` : 
            error.message
        );
    }
}

// --- API and Static Endpoints ---

// Enable CORS for all routes
app.use(cors({
    origin: true, // Allow any origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Read the loader script template once on startup
let loaderScriptTemplate = '';
try {
    loaderScriptTemplate = fs.readFileSync(path.join(__dirname, 'loader.js'), 'utf8');
} catch (error) {
    console.error("FATAL: Could not read loader.js. Make sure the file exists.", error);
    process.exit(1);
}

// Serve the dynamic loader script from the root
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    const finalScript = loaderScriptTemplate
        .replace(/%%GTM_ID%%/g, GTM_ID)
        .replace(/%%GTM_SERVER_URL%%/g, GTM_SERVER_URL);
    res.send(finalScript);
});

// Serve the encryption key
app.get('/api/get-key', cors(), async (req, res) => {
    console.log(`=== API Get Key Debug ===`);
    try {
        await ensureKey();
        console.log(`Sending key to client - Length: ${encryptionKey.length}`);
        console.log(`Key first 10 chars: "${encryptionKey.substring(0, 10)}"`);
        console.log(`Key last 10 chars: "${encryptionKey.substring(encryptionKey.length - 10)}"`);
        console.log(`Key expiry: ${keyExpiry.toISOString()}`);
        res.json({ key: encryptionKey, expiry: keyExpiry.toISOString() });
    } catch (error) {
        console.error(`Failed to get key for client:`, error.message);
        res.status(503).json({ error: 'Key not available' });
    }
});

app.use(express.raw({type: 'text/plain'}));

// --- Main Proxy Endpoint ---
app.all('/load/:encryptedFragment', async (req, res) => {
    const { encryptedFragment } = req.params;

    console.log(`=== GTM Proxy Request Debug ===`);
    console.log(`Method: ${req.method}`);
    console.log(`Encrypted Fragment (first 50 chars): ${encryptedFragment.substring(0, 50)}...`);
    console.log(`Fragment Length: ${encryptedFragment.length}`);
    console.log(`Referer: ${req.headers.referer || 'none'}`);

    try {
        console.log(`Ensuring encryption key...`);
        const currentKey = await ensureKey();
        console.log(`Key available: ${!!currentKey}, Key length: ${currentKey ? currentKey.length : 'N/A'}`);
        
        if (currentKey) {
            console.log(`Proxy using key: "${currentKey}"`);
            console.log(`Proxy key first 10 chars: "${currentKey.substring(0, 10)}"`);
            console.log(`Proxy key last 10 chars: "${currentKey.substring(currentKey.length - 10)}"`);
        }
        
        // Add logging to debug encoding issues
        console.log(`GTM Proxy: Received encrypted fragment: ${encryptedFragment.substring(0, 50)}...`);
        console.log(`GTM Proxy: Fragment length: ${encryptedFragment.length}`);
        
        console.log(`Attempting to decrypt fragment...`);
        const decryptedFragment = decrypt(encryptedFragment, currentKey);
        console.log(`GTM Proxy: Decrypted fragment: ${decryptedFragment}`);

        // Handle encrypted body for POST/PUT requests
        let requestBody = req.body;
        if ((req.method === 'POST' || req.method === 'PUT') && req.body && req.body.length > 0) {
            console.log('GTM Proxy: Decrypting request body...');
            try {
                const bodyAsString = req.body.toString('utf-8');
                requestBody = decrypt(bodyAsString, currentKey);
            } catch(e) {
                console.error('GTM Proxy: Failed to decrypt request body.', e.message);
                // Decide if you want to forward with undecrypted body or return an error
                return res.status(400).send('Bad Request: Body decryption failed.');
            }
        }

        // Use the decrypted fragment directly (it should already be properly URL-encoded)
        const [decryptedPath, decryptedQuery] = decryptedFragment.split('?');
        
        const targetUrl = new URL(GTM_SERVER_URL);
        
        targetUrl.pathname = path.join(targetUrl.pathname, decryptedPath);

        // Build query string manually to preserve proper encoding
        let finalQueryString = '';
        
        if (decryptedQuery) {
            finalQueryString = decryptedQuery;
        }
        
        // Add any additional query parameters from the original request
        if (Object.keys(req.query).length > 0) {
            const additionalParams = new URLSearchParams(req.query).toString();
            if (finalQueryString) {
                finalQueryString += '&' + additionalParams;
            } else {
                finalQueryString = additionalParams;
            }
        }
        
        // Set the search manually to preserve encoding
        if (finalQueryString) {
            targetUrl.search = '?' + finalQueryString;
        }
        
        console.log(`Forwarding request to: ${targetUrl.toString()}`);

        const response = await axios({
            method: req.method,
            url: targetUrl.toString(),
            data: (req.method !== 'GET' && req.method !== 'HEAD' && requestBody) ? requestBody : null,
            headers: {
                ...req.headers,
                host: targetUrl.hostname,
            },
            responseType: 'stream',
            validateStatus: () => true, // Let us handle all status codes
        });

        res.status(response.status);
        Object.keys(response.headers).forEach(key => {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
                res.setHeader(key, response.headers[key]);
            }
        });
        response.data.pipe(res);

        // Track usage after successful response (non-blocking)
        // Only track for successful responses (2xx status codes)
        if (response.status >= 200 && response.status < 300) {
            setImmediate(() => trackUsage(1));
        }

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

// Start the server and then initialize key fetching and refreshing.
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}. GTM_ID: ${GTM_ID}.`);
    
    updateEncryptionKey().then(() => {
        if (isKeyValid()) {
            console.log('Initial encryption key fetch successful.');
        } else {
            console.warn('Initial encryption key fetch failed. The service will retry.');
        }
    });

    setInterval(updateEncryptionKey, 60 * 60 * 1000);
});