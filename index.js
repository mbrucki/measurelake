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
    const finalScript = loaderScriptTemplate.replace('%%GTM_ID%%', GTM_ID);
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

app.use(express.raw({type: '*/*'}));

// --- Main Proxy Endpoint ---
app.all('/load/:encryptedFragment', async (req, res) => {
    const { encryptedFragment } = req.params;

    try {
        const currentKey = await ensureKey();
        const decryptedFragment = decrypt(encryptedFragment, currentKey);

        const upstreamHost = `${GTM_ID}.fps.goog`;
        const targetUrl = new URL(`https://${upstreamHost}`);
        targetUrl.pathname += `/${decryptedFragment}`;

        Object.keys(req.query).forEach(key => {
            targetUrl.searchParams.append(key, req.query[key]);
        });
        
        console.log(`Forwarding request to: ${targetUrl.toString()}`);

        const response = await axios({
            method: req.method,
            url: targetUrl.toString(),
            data: req.method !== 'GET' && req.body.length > 0 ? req.body : null,
            headers: {
                ...req.headers,
                host: upstreamHost,
            },
            responseType: 'stream',
            validateStatus: () => true, // Let us handle all status codes
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
    // Start the server immediately. This ensures the container is responsive to
    // Cloud Run health checks even if the initial key fetch fails.
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}. GTM_ID: ${GTM_ID}.`);
        
        // Attempt the initial key fetch in the background after starting.
        updateEncryptionKey().then(() => {
            if (isKeyValid()) {
                console.log('Initial encryption key fetch successful.');
            } else {
                console.warn('Initial encryption key fetch failed. The service will retry.');
            }
        });
    });

    // Periodically refresh the key in the background.
    setInterval(updateEncryptionKey, 60 * 60 * 1000);
})();