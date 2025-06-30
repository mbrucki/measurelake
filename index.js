const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

// --- Configuration from Environment Variables ---
const GTM_SERVER_URL = process.env.GTM_SERVER_URL;
// The Key API URL is fixed and not configurable by the user.
const KEY_API_URL = 'https://measurelake-249969218520.us-central1.run.app/givemekey';
const MEASURELAKE_API_KEY = process.env.MEASURELAKE_API_KEY;
const PORT = process.env.PORT || 8080;

// --- Validate Configuration ---
if (!GTM_SERVER_URL || !MEASURELAKE_API_KEY) {
    console.error('Missing required environment variables: GTM_SERVER_URL, MEASURELAKE_API_KEY must be set.');
    process.exit(1);
}

// --- Key Management ---
const keyManager = {
    key: null,
    keyExpiry: null,

    async getKey() {
        if (this.isKeyValid()) {
            return this.key;
        }
        await this.fetchKey();
        return this.key;
    },

    isKeyValid() {
        return this.key && this.keyExpiry && new Date() < this.keyExpiry;
    },

    async fetchKey() {
        console.log('Fetching new encryption key...');
        try {
            // The API expects a Referer header to identify the client.
            const referer = new URL(GTM_SERVER_URL).origin;

            const response = await axios.get(KEY_API_URL, {
                headers: { 
                    'X-API-Key': MEASURELAKE_API_KEY,
                    'Referer': referer 
                }
            });

            if (response.data && response.data.key && response.data.key_expiry) {
                this.key = response.data.key;
                this.keyExpiry = new Date(response.data.key_expiry);
                console.log(`Successfully fetched new key. Expiry: ${this.keyExpiry.toISOString()}`);
            } else {
                throw new Error('Invalid response format from key API.');
            }
        } catch (error) {
            console.error('Failed to fetch encryption key:', error.message);
            // Reset key info on failure to force a retry on the next request
            this.key = null;
            this.keyExpiry = null;
            throw new Error('Could not retrieve encryption key.');
        }
    }
};

// --- Decryption Logic ---
function decrypt(encryptedText, key) {
    try {
        const keyBuffer = Buffer.from(key, 'utf8');
        const parts = encryptedText.split(':');
        if (parts.length !== 2) {
            throw new Error('Invalid encrypted string format. Expected ivHex:encryptedDataHex.');
        }

        const [ivHex, encryptedDataHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const encryptedData = Buffer.from(encryptedDataHex, 'hex');

        if (iv.length !== 12) {
             throw new Error(`Invalid IV length: ${iv.length}. Must be 12 bytes.`);
        }

        const authTagLength = 16;
        if (encryptedData.length < authTagLength) {
            throw new Error('Encrypted data is too short to contain an authentication tag.');
        }

        const ciphertext = encryptedData.slice(0, -authTagLength);
        const authTag = encryptedData.slice(-authTagLength);

        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error.message);
        throw new Error('Decryption failed.'); // Rethrow a generic error
    }
}

// --- Express App Setup ---
const app = express();

// --- CORS Middleware ---
// This must come before the routes to ensure headers are set for all responses.
app.use((req, res, next) => {
    // Allow requests from any origin. For a production environment with known
    // clients, you might want to restrict this to a specific list of domains.
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Allow the browser to send the headers it needs.
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Allow the methods the browser might use.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');

    // Handle preflight requests (the browser sends an OPTIONS request first)
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    next();
});

// Middleware to read raw body for POST/PUT/PATCH requests
app.use(express.text({ type: '*/*' }));

// --- API and Static Endpoints ---

// Endpoint to serve the client-side interceptor script
app.get('/interceptor.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'interceptor.js'));
});

// Endpoint for the client-side script to fetch the public key details
app.get('/api/get-key', async (req, res) => {
    try {
        const key = await keyManager.getKey();
        if (!key) {
            return res.status(503).json({ error: 'Key not available.' });
        }
        res.json({
            key: keyManager.key,
            expiry: keyManager.keyExpiry.toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: 'Could not retrieve key.' });
    }
});

app.all('/proxy/:encrypted_fragment', async (req, res) => {
    try {
        const key = await keyManager.getKey();
        if (!key) {
            return res.status(503).send('Service Unavailable: Encryption key not available.');
        }

        // 1. Decrypt URL fragment
        const { encrypted_fragment } = req.params;
        const decrypted_full_path = decrypt(encrypted_fragment, key);

        // 2. Decrypt body if present
        let decryptedBody = req.body;
        const hasBody = req.body && typeof req.body === 'string' && req.body.length > 0;
        
        // Only try to decrypt if it looks like our encrypted format: hex:hex
        const isBodyPotentiallyEncrypted = hasBody && req.body.includes(':');

        if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase()) && isBodyPotentiallyEncrypted) {
             try {
                decryptedBody = decrypt(req.body, key);
             } catch (e) {
                // If decryption fails, it might not have been encrypted after all.
                // Log the error and proceed with the raw body as a fallback.
                console.warn(`Body looked encrypted but failed to decrypt for ${req.path}. Proceeding with raw body. Error: ${e.message}`);
                decryptedBody = req.body;
             }
        }
        
        // Split the decrypted full path into a path and a query string
        const [decrypted_path, decrypted_query_string] = decrypted_full_path.split('?');

        // 3. Construct the target URL for the client's GTM Server-Side Container
        const targetUrlObject = new URL(GTM_SERVER_URL);
        // Safely join the base path from the GTM_SERVER_URL with the decrypted path
        targetUrlObject.pathname = path.join(targetUrlObject.pathname, decrypted_path);
        // Set the search parameters from the decrypted query string
        targetUrlObject.search = decrypted_query_string || '';
        
        const targetUrl = targetUrlObject.toString();
        
        console.log(`Forwarding request to: ${targetUrl}`);

        // 4. Forward the request to the client's GTM Server
        const headers = {
            'Host': targetUrlObject.hostname,
            'User-Agent': req.headers['user-agent'],
            'Accept': req.headers['accept'],
            'Accept-Language': req.headers['accept-language'],
            'Accept-Encoding': req.headers['accept-encoding'],
            'Cookie': req.headers['cookie'],
            'X-Forwarded-For': req.ip,
        };

        if (hasBody) {
            headers['Content-Type'] = req.headers['content-type'] || 'text/plain';
            headers['Content-Length'] = Buffer.byteLength(decryptedBody);
        }

        const gtmResponse = await axios({
            method: req.method,
            url: targetUrl,
            headers: headers,
            data: hasBody ? decryptedBody : undefined,
            responseType: 'stream',
            validateStatus: () => true, // Accept any status code from Google
        });
        
        // 5. Proxy the response back to the client
        res.status(gtmResponse.status);
        for (const header in gtmResponse.headers) {
             // Let Express handle content-length and encoding
            if (header.toLowerCase() !== 'content-length' && header.toLowerCase() !== 'transfer-encoding') {
                res.setHeader(header, gtmResponse.headers[header]);
            }
        }
        gtmResponse.data.pipe(res);

    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        // Avoid sending detailed error messages to the client
        if (!res.headersSent) {
            res.status(500).send('An internal server error occurred.');
        }
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`GTM Obfuscation Proxy listening on port ${PORT}`);
    console.log(`Forwarding requests to GTM Server URL: ${GTM_SERVER_URL}`);
    
    // Perform an initial key fetch in the background. 
    // This allows the server to start immediately and handle health checks
    // while the key is being fetched. If it fails, the service will
    // attempt to refetch on the first actual proxy request.
    keyManager.fetchKey().catch(error => {
        console.error(`Initial key fetch failed: ${error.message}.`);
    });
}); 