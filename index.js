require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// --- Configuration ---
const GTM_ID = process.env.GTM_ID ? process.env.GTM_ID.trim() : null;
const GTM_SERVER_URL = process.env.GTM_SERVER_URL ? process.env.GTM_SERVER_URL.trim() : null;
const MEASURELAKE_API_KEY = process.env.MEASURELAKE_API_KEY ? process.env.MEASURELAKE_API_KEY.trim() : null;
// Comma-separated list of query-param names that receiving systems use for client IP (e.g. "uip,ip,client_ip")
const IP_PARAM_KEYS = process.env.IP_PARAM_KEYS ? process.env.IP_PARAM_KEYS.split(',').map(k => k.trim()).filter(Boolean) : ['uip', 'ip'];
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const KEY_API_URL = 'https://measurelake-249969218520.us-central1.run.app/givemekey';
const USAGE_API_URL = 'https://measurelake-usage-249969218520.us-central1.run.app/updateUsage';
const PORT = process.env.PORT || 8080;

// --- Utility: Enhanced Debug Logger ---
const debugLog = {
    log: (...args) => DEBUG && console.log('[DEBUG]', ...args),
    error: (...args) => DEBUG && console.error('[DEBUG ERROR]', ...args),
    warn: (...args) => DEBUG && console.warn('[DEBUG WARN]', ...args),
    info: (...args) => DEBUG && console.info('[DEBUG INFO]', ...args)
};

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", GTM_SERVER_URL],
            connectSrc: ["'self'", GTM_SERVER_URL],
            imgSrc: ["'self'", GTM_SERVER_URL, 'data:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            frameSrc: ["'self'", GTM_SERVER_URL]
        }
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter); // Apply rate limiting to API endpoints

if (!GTM_ID || !GTM_SERVER_URL || !MEASURELAKE_API_KEY) {
    console.error('FATAL: GTM_ID, GTM_SERVER_URL, and MEASURELAKE_API_KEY environment variables must be set.');
    process.exit(1);
}

// --- State ---
let encryptionKey = null;
let keyExpiry = null;

// --- Cryptography Helpers ---
function decrypt(encryptedString, key) {
    debugLog.log(`=== Decrypt Debug ===`);
    debugLog.log(`Input encrypted string length: ${encryptedString.length}`);
    debugLog.log(`Input key length: ${key ? key.length : 'null'}`);
    debugLog.log(`Encrypted string (first 50 chars): ${encryptedString.substring(0, 50)}...`);
    
    if (key) {
        debugLog.log(`Decrypt key value: "${key}"`);
        debugLog.log(`Decrypt key first 10 chars: "${key.substring(0, 10)}"`);
        debugLog.log(`Decrypt key last 10 chars: "${key.substring(key.length - 10)}"`);
    }
    
    try {
        const parts = encryptedString.split(':');
        debugLog.log(`Split parts count: ${parts.length}`);
        if (parts.length !== 2) {
            console.error(`Invalid format: expected 2 parts, got ${parts.length}`);
            throw new Error('Invalid encrypted string format.');
        }
        
        debugLog.log(`IV part length: ${parts[0].length}`);
        debugLog.log(`Encrypted data part length: ${parts[1].length}`);
        
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedData = Buffer.from(parts[1], 'hex');
        
        debugLog.log(`IV buffer length: ${iv.length}`);
        debugLog.log(`Encrypted data buffer length: ${encryptedData.length}`);
        
        // Web Crypto API includes the auth tag in the encrypted result
        // The last 16 bytes are the auth tag
        const tag = encryptedData.slice(-16);
        const ciphertext = encryptedData.slice(0, -16);
        
        debugLog.log(`Auth tag length: ${tag.length}`);
        debugLog.log(`Ciphertext length: ${ciphertext.length}`);
        
        // Create key with proper length - Web Crypto uses the key as-is
        const keyBuffer = Buffer.from(key, 'utf8');
        debugLog.log(`Key buffer length: ${keyBuffer.length}`);
        
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
        
        debugLog.log(`Using algorithm: ${algorithm}`);
        
        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(ciphertext, null, 'utf-8');
        decrypted += decipher.final('utf-8');
        
        debugLog.log(`Successfully decrypted. Result length: ${decrypted.length}`);
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
    debugLog.log('=== Update Encryption Key Debug ===');
    debugLog.log('Attempting to fetch new encryption key...');
    try {
        const referer = new URL(GTM_SERVER_URL).origin;
        debugLog.log(`Fetching key with Referer: ${referer}`);
        debugLog.log(`API URL: ${KEY_API_URL}`);
        debugLog.log(`API Key length: ${MEASURELAKE_API_KEY ? MEASURELAKE_API_KEY.length : 'missing'}`);
        
        const response = await axios.get(KEY_API_URL, {
            headers: { 
                'Referer': referer,
                'Authorization': `Bearer ${MEASURELAKE_API_KEY}`
            }
        });
        
        debugLog.log(`API Response Status: ${response.status}`);
        debugLog.log(`API Response Data:`, response.data);
        
        if (response.data && response.data.key && response.data.key_expiry) {
            encryptionKey = response.data.key;
            keyExpiry = new Date(response.data.key_expiry);
            debugLog.log(`Successfully updated encryption key. Key length: ${encryptionKey.length}, New expiry: ${keyExpiry.toISOString()}`);
        } else {
            console.error('Invalid response structure from key API:', response.data);
            throw new Error('Invalid response structure from key API.');
        }
    } catch (error) {
        debugLog.error('=== Key Fetch Error ===');
        debugLog.error('Error message:', error.message);
        if (error.response) {
            debugLog.error('Response status:', error.response.status);
            debugLog.error('Response data:', error.response.data);
            debugLog.error('Response headers:', error.response.headers);
        }
        debugLog.error('Failed to fetch encryption key:', error.response ? error.response.status : error.message);
        encryptionKey = null;
        keyExpiry = null;
    }
}

function isKeyValid() {
    return encryptionKey && keyExpiry && new Date() < keyExpiry;
}

async function ensureKey() {
    debugLog.log(`=== Ensure Key Debug ===`);
    debugLog.log(`Current key valid: ${isKeyValid()}`);
    debugLog.log(`Current key exists: ${!!encryptionKey}`);
    debugLog.log(`Current key expiry: ${keyExpiry ? keyExpiry.toISOString() : 'none'}`);
    
    if (encryptionKey) {
        debugLog.log(`Current key value: "${encryptionKey}"`);
        debugLog.log(`Current key first 10 chars: "${encryptionKey.substring(0, 10)}"`);
        debugLog.log(`Current key last 10 chars: "${encryptionKey.substring(encryptionKey.length - 10)}"`);
    }
    
    if (!isKeyValid()) {
        debugLog.log(`Key invalid, fetching new key...`);
        await updateEncryptionKey();
    }
    if (!encryptionKey) {
        console.error(`No encryption key available after ensure attempt`);
        throw new Error('Encryption key is not available.');
    }
    debugLog.log(`Returning key with length: ${encryptionKey.length}`);
    return encryptionKey;
}

// --- Usage Tracking ---
async function trackUsage(usageCount = 1) {
    try {
        const referer = new URL(GTM_SERVER_URL).origin;
        debugLog.log(`Tracking usage: ${usageCount} for domain: ${referer}`);
        
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
        
        debugLog.log(`Successfully tracked ${usageCount} usage(s)`);
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
    debugLog.log(`=== API Get Key Debug ===`);
    try {
        await ensureKey();
        debugLog.log(`Sending key to client - Length: ${encryptionKey.length}`);
        debugLog.log(`Key first 10 chars: "${encryptionKey.substring(0, 10)}"`);
        debugLog.log(`Key last 10 chars: "${encryptionKey.substring(encryptionKey.length - 10)}"`);
        debugLog.log(`Key expiry: ${keyExpiry.toISOString()}`);
        res.json({ key: encryptionKey, expiry: keyExpiry.toISOString() });
    } catch (error) {
        console.error(`Failed to get key for client:`, error.message);
        res.status(503).json({ error: 'Key not available' });
    }
});

// Accept raw bodies for **all** content types so we don’t lose multipart, json, etc.
// The limit is kept reasonable to avoid abuse but should comfortably fit GTM payloads.
app.use(express.raw({
    type: () => true,      // parse every incoming request as raw Buffer
    limit: '10mb'          // adjust if you expect larger uploads
}));

// Global error handler
app.use((err, req, res, next) => {
    const errorId = crypto.randomBytes(8).toString('hex');
    console.error(`Error ID: ${errorId}`, {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        headers: DEBUG ? req.headers : undefined // Only include headers in debug mode
    });
    
    res.status(err.status || 500).json({
        error: 'Internal server error',
        errorId: errorId,
        details: DEBUG ? err.message : undefined // Only include error details in debug mode
    });
});

// Catch unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// --- Main Proxy Endpoint ---
app.all('/load/:encryptedFragment', async (req, res) => {
    const { encryptedFragment } = req.params;

    debugLog.log(`=== GTM Proxy Request Debug ===`);
    debugLog.log(`Method: ${req.method}`);
    debugLog.log(`Encrypted Fragment (first 50 chars): ${encryptedFragment.substring(0, 50)}...`);
    debugLog.log(`Fragment Length: ${encryptedFragment.length}`);
    debugLog.log(`Referer: ${req.headers.referer || 'none'}`);

    try {
        debugLog.log(`Ensuring encryption key...`);
        const currentKey = await ensureKey();
        debugLog.log(`Key available: ${!!currentKey}, Key length: ${currentKey ? currentKey.length : 'N/A'}`);
        
        if (currentKey) {
            debugLog.log(`Proxy using key: "${currentKey}"`);
            debugLog.log(`Proxy key first 10 chars: "${currentKey.substring(0, 10)}"`);
            debugLog.log(`Proxy key last 10 chars: "${currentKey.substring(currentKey.length - 10)}"`);
        }
        
        // Add logging to debug encoding issues
        debugLog.log(`GTM Proxy: Received encrypted fragment: ${encryptedFragment.substring(0, 50)}...`);
        debugLog.log(`GTM Proxy: Fragment length: ${encryptedFragment.length}`);
        
        debugLog.log(`Attempting to decrypt fragment...`);
        const decryptedFragment = decrypt(encryptedFragment, currentKey);
        debugLog.log(`GTM Proxy: Decrypted fragment: ${decryptedFragment}`);

        // Attempt body decryption for **any** request that includes a payload.
        // If decryption fails we simply forward the original bytes – this keeps 1-1 parity.
        let requestBody = req.body;
        if (req.body && req.body.length > 0) {
            debugLog.log('GTM Proxy: Attempting to decrypt request body (length:', req.body.length, ') ...');
            try {
                const bodyAsString = req.body.toString('utf-8');
                requestBody = decrypt(bodyAsString, currentKey);
                debugLog.log('GTM Proxy: Body decrypted successfully – new length:', requestBody.length);
            } catch (e) {
                console.warn('GTM Proxy: Body not encrypted or decryption failed – forwarding as-is. Reason:', e.message);
                requestBody = req.body; // forward the original Buffer
            }
        }

        // Use the decrypted fragment directly (it should already be properly URL-encoded)
        const [decryptedPath, decryptedQuery] = decryptedFragment.split('?');
        
        const targetUrl = new URL(GTM_SERVER_URL);
        
        targetUrl.pathname = path.join(targetUrl.pathname, decryptedPath);

        // Capture client IP as early as possible
        const clientIp = getClientIp(req);
        debugLog.log(`Client IP resolved for forwarding: ${clientIp}`);

        // Build query string manually to preserve proper encoding
        let finalQueryString = '';
        
        if (decryptedQuery) {
            finalQueryString = decryptedQuery;
        }

        // Append client IP so GTM/GA sees the real user address (supports multiple param keys)
        if (clientIp) {
            let ipInserted = false;
            for (const key of IP_PARAM_KEYS) {
                if (!finalQueryString.includes(`${key}=`)) {
                    const encodedPair = `${encodeURIComponent(key)}=${encodeURIComponent(clientIp)}`;
                    if (finalQueryString) {
                        finalQueryString += `&${encodedPair}`;
                    } else {
                        finalQueryString = encodedPair;
                    }
                    ipInserted = true;
                    break; // insert only once using first suitable key
                }
            }
            if (!ipInserted) {
                debugLog.log('IP param already present in query – skipping automatic insertion.');
            }
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
        
        debugLog.log(`Forwarding request to: ${targetUrl.toString()}`);

        const response = await axios({
            method: req.method,
            url: targetUrl.toString(),
            data: (req.method !== 'GET' && req.method !== 'HEAD' && requestBody) ? requestBody : null,
            headers: (() => {
                const hdrs = { ...req.headers, host: targetUrl.hostname };
                // Ensure client IP is present in X-Forwarded-For chain
                if (clientIp) {
                    if (hdrs['x-forwarded-for']) {
                        hdrs['x-forwarded-for'] = `${hdrs['x-forwarded-for']}, ${clientIp}`;
                    } else {
                        hdrs['x-forwarded-for'] = clientIp;
                    }
                    hdrs['x-real-ip'] = hdrs['x-real-ip'] || clientIp;
                }
                return hdrs;
            })(),
            responseType: 'stream',
            validateStatus: () => true, // Let us handle all status codes
        });

        res.status(response.status);
        Object.keys(response.headers).forEach(key => {
            const lower = key.toLowerCase();
            if (lower === 'set-cookie') {
                const host = req.headers.host;
                // Compute eTLD+1 (root domain) from host
                function getRootDomain(host) {
                    const parts = host.split('.');
                    if (parts.length <= 2) return host;
                    return parts.slice(-2).join('.');
                }
                const rootDomain = getRootDomain(host);
                const cookies = Array.isArray(response.headers[key]) ? response.headers[key] : [response.headers[key]];
                const rewritten = cookies.map(orig => {
                    let c = orig;
                    // Always force domain to .<rootDomain>
                    if (/domain=/i.test(c)) {
                        c = c.replace(/domain=[^;]+/i, `Domain=.${rootDomain}`);
                    } else {
                        c += `; Domain=.${rootDomain}`;
                    }
                    // guarantee universal path to ensure sub-paths receive cookie
                    if (!/path=/i.test(c)) {
                        c += '; Path=/';
                    }
                    return c;
                });
                rewritten.forEach((rw, idx) => {
                    const orig = cookies[idx];
                    const domainMatch = rw.match(/domain=([^;]+)/i);
                    const domain = domainMatch ? domainMatch[1] : '(none)';
                    debugLog.log(`[CookieRewrite] [${idx}] domain=${domain} | orig: ${orig} | rewritten: ${rw}`);
                });
                res.setHeader('set-cookie', rewritten);
                return;
            }
            if (!['transfer-encoding', 'content-length'].includes(lower)) {
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
}); // end of /load/:encryptedFragment handler

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

// --- Utility: Resolve Client IP (handles various proxy headers) ---
function getClientIp(req) {
    const headerSources = [
        'cf-connecting-ip', // Cloudflare
        'true-client-ip',   // Akamai / CloudFront
        'x-real-ip',        // Nginx / generic
        'x-client-ip',
        'x-forwarded-for'
    ];
    for (const header of headerSources) {
        const value = req.headers[header];
        if (value) {
            // X-Forwarded-For can be a list. Take first element.
            const ip = header === 'x-forwarded-for' ? value.split(',')[0].trim() : value.trim();
            if (ip) return ip;
        }
    }
    // Fall back to Express-provided properties
    return (req.ip || req.connection?.remoteAddress || '').toString();
}

// --- Utility: extract eTLD+1 ---
function getRootDomain(host) {
    const parts = host.split('.');
    if (parts.length <= 2) return host; // e.g. example.com
    return parts.slice(-2).join('.'); // example.co.uk becomes co.uk? Actually this naive - include last two parts
}