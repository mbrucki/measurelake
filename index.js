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
const KEY_API_URL = 'https://measurelake-249969218520.us-central1.run.app/givemekey';
const PORT = process.env.PORT || 8080;

if (!GTM_ID || !GTM_SERVER_URL) {
    console.error('FATAL: GTM_ID and GTM_SERVER_URL environment variables must be set.');
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
        const encryptedData = Buffer.from(parts[1], 'hex');
        
        // The last 16 bytes of the encrypted data is the auth tag
        const tag = encryptedData.slice(-16);
        const ciphertext = encryptedData.slice(0, -16);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(ciphertext, 'binary', 'utf-8');
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
        const referer = new URL(GTM_SERVER_URL).origin;
        console.log(`Fetching key with Referer: ${referer}`);
        const response = await axios.get(KEY_API_URL, {
            headers: { 'Referer': referer }
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
    try {
        await ensureKey();
        res.json({ key: encryptionKey, expiry: keyExpiry.toISOString() });
    } catch (error) {
        res.status(503).json({ error: 'Key not available' });
    }
});

app.use(express.raw({type: 'text/plain'}));

// --- Main Proxy Endpoint ---
app.all('/load/:encryptedFragment', async (req, res) => {
    const { encryptedFragment } = req.params;

    try {
        const currentKey = await ensureKey();
        const decryptedFragment = decrypt(encryptedFragment, currentKey);

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

        const [decryptedPath, decryptedQuery] = decryptedFragment.split('?');
        
        const targetUrl = new URL(GTM_SERVER_URL);
        
        targetUrl.pathname = path.join(targetUrl.pathname, decryptedPath);

        if (decryptedQuery) {
            const params = new URLSearchParams(decryptedQuery);
            params.forEach((value, key) => {
                targetUrl.searchParams.append(key, value);
            });
        }
        
        Object.keys(req.query).forEach(key => {
            targetUrl.searchParams.append(key, req.query[key]);
        });
        
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