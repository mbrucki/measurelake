(function () {
    const GTM_ID = '%%GTM_ID%%';
    const GTM_SERVER_URL = '%%GTM_SERVER_URL%%';
    const PROXY_BASE_URL = new URL(document.currentScript.src).origin;
    const PROXY_PATH_PREFIX = '/load';
    const KEY_API_ENDPOINT = `${PROXY_BASE_URL}/api/get-key`;
    let encryptionKey = null;

    // Define all functions first before setting up interception
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
        console.log('GTM Proxy: Encrypting URL data:', dataString);
        console.log('GTM Proxy: Key length:', encryptionKey.length);
        
        const encoder = new TextEncoder();
        const data = encoder.encode(dataString);
        const keyBytes = encoder.encode(encryptionKey);
        console.log('GTM Proxy: Key bytes length:', keyBytes.length);
        
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, data);
        const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
        const result = `${ivHex}:${encryptedHex}`;
        console.log('GTM Proxy: Encrypted result length:', result.length);
        return result;
    }

    async function encryptPayload(payloadString) {
        if (!encryptionKey) {
            encryptionKey = await getEncryptionKey();
            if (!encryptionKey) throw new Error("Encryption key not available.");
        }
        console.log('GTM Proxy: Encrypting payload, length:', payloadString.length);
        
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        const keyBytes = encoder.encode(encryptionKey);
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, data);
        const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
        const result = `${ivHex}:${encryptedHex}`;
        console.log('GTM Proxy: Encrypted payload result length:', result.length);
        return result;
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

    // NOW set up all interception AFTER functions are defined
    console.log('GTM Proxy: Setting up immediate interception for:', GTM_SERVER_URL);

    // Override document.createElement FIRST
    const originalCreateElement = document.createElement;
    document.createElement = function (tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);

        if (tagName.toLowerCase() === 'script') {
            const originalSetAttribute = element.setAttribute.bind(element);
            element.setAttribute = function (name, value) {
                if (name.toLowerCase() === 'src' && typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
                    console.log('GTM Proxy: Intercepting createElement setAttribute src:', value);
                    // Use a promise-based approach but don't block
                    modifyUrl(value).then(modifiedUrl => {
                        originalSetAttribute(name, modifiedUrl);
                    }).catch(error => {
                        console.error('GTM Proxy: createElement setAttribute error:', error);
                        originalSetAttribute(name, value);
                    });
                    return; // Don't call original
                } else {
                    originalSetAttribute(name, value);
                }
            };

            Object.defineProperty(element, 'src', {
                get: function () {
                    return this.getAttribute('src');
                },
                set: function (value) {
                    if (typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
                        console.log('GTM Proxy: Intercepting createElement src property:', value);
                        modifyUrl(value).then(modifiedUrl => {
                            this.setAttribute('src', modifiedUrl);
                        }).catch(error => {
                            console.error('GTM Proxy: createElement src property error:', error);
                            this.setAttribute('src', value);
                        });
                    } else {
                        this.setAttribute('src', value);
                    }
                },
                configurable: true
            });
        }

        if (tagName.toLowerCase() === 'iframe') {
            const originalSetAttribute = element.setAttribute.bind(element);
            element.setAttribute = function (name, value) {
                if (name.toLowerCase() === 'src' && typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
                    console.log('GTM Proxy: Intercepting iframe src:', value);
                    modifyUrl(value).then(modifiedUrl => {
                        originalSetAttribute(name, modifiedUrl);
                    }).catch(error => {
                        console.error('GTM Proxy: Error modifying iframe URL:', error);
                        originalSetAttribute(name, value);
                    });
                    return;
                } else {
                    originalSetAttribute(name, value);
                }
            };

            Object.defineProperty(element, 'src', {
                get: function () {
                    return this.getAttribute('src');
                },
                set: function (value) {
                    if (typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
                        console.log('GTM Proxy: Intercepting iframe src property:', value);
                        modifyUrl(value).then(modifiedUrl => {
                            this.setAttribute('src', modifiedUrl);
                        }).catch(error => {
                            console.error('GTM Proxy: Error modifying iframe src property:', error);
                            this.setAttribute('src', value);
                        });
                    } else {
                        this.setAttribute('src', value);
                    }
                },
                configurable: true
            });
        }

        return element;
    };

    // Override appendChild IMMEDIATELY
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(child) {
        if (child.tagName === 'SCRIPT' && child.src && child.src.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting appendChild script:', child.src);
            const originalSrc = child.src;
            child.src = ''; // Clear to prevent load
            modifyUrl(originalSrc).then(modifiedUrl => {
                child.src = modifiedUrl;
                originalAppendChild.call(this, child);
            }).catch(error => {
                console.error('GTM Proxy: appendChild error:', error);
                child.src = originalSrc;
                originalAppendChild.call(this, child);
            });
            return child;
        }
        return originalAppendChild.call(this, child);
    };

    // Override insertBefore IMMEDIATELY  
    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function(newNode, referenceNode) {
        if (newNode.tagName === 'SCRIPT' && newNode.src && newNode.src.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting insertBefore script:', newNode.src);
            const originalSrc = newNode.src;
            newNode.src = '';
            modifyUrl(originalSrc).then(modifiedUrl => {
                newNode.src = modifiedUrl;
                originalInsertBefore.call(this, newNode, referenceNode);
            }).catch(error => {
                console.error('GTM Proxy: insertBefore error:', error);
                newNode.src = originalSrc;
                originalInsertBefore.call(this, newNode, referenceNode);
            });
            return newNode;
        }
        return originalInsertBefore.call(this, newNode, referenceNode);
    };

    // Override fetch IMMEDIATELY
    const originalFetch = window.fetch;
    window.fetch = async function (resource, init = {}) {
        let finalResource = resource;
        let finalInit = { ...init };

        if (typeof resource === 'string' && resource.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting fetch:', resource);
            finalResource = await modifyUrl(resource);
            console.log('GTM Proxy: Fetch URL modified to:', finalResource);

            // Ensure cookies / auth headers are always included
            if (finalInit.credentials === undefined) {
                finalInit.credentials = 'include';
            }

            // Encrypt body for write-methods to preserve parity with server logic
            const method = (finalInit.method || 'GET').toUpperCase();
            if (finalInit.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
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

    // Override XMLHttpRequest IMMEDIATELY
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        // Remember method so we know later if body should be encrypted
        this._ml_method = method ? String(method).toUpperCase() : 'GET';

        if (typeof url === 'string' && url.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting XHR:', url);
            const xhr = this;
            modifyUrl(url).then(modifiedUrl => {
                console.log('GTM Proxy: XHR URL modified to:', modifiedUrl);
                xhr.withCredentials = true; // always send cookies
                originalXHROpen.call(xhr, method, modifiedUrl, ...args);
            }).catch(error => {
                console.error('GTM Proxy: Error modifying XHR URL:', error);
                xhr.withCredentials = true;
                originalXHROpen.call(xhr, method, url, ...args);
            });
            return;
        }
        this.withCredentials = true; // still send cookies for same-origin requests
        return originalXHROpen.call(this, method, url, ...args);
    };

    // Encrypt XHR request body if necessary
    const originalXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        // Only attempt encryption if body is a plain string and method warrants it
        if (this._ml_method && ['POST', 'PUT', 'PATCH'].includes(this._ml_method) && typeof body === 'string') {
            console.log('GTM Proxy: Encrypting XHR payload.');
            encryptPayload(body).then(encrypted => {
                originalXHRSend.call(this, encrypted);
            }).catch(err => {
                console.error('GTM Proxy: Failed to encrypt XHR payload – sending original. Reason:', err);
                originalXHRSend.call(this, body);
            });
            return;
        }
        return originalXHRSend.call(this, body);
    };

    console.log('GTM Proxy: Immediate interception setup complete.');

    // Override Service Worker registration to intercept worker scripts
    if ('serviceWorker' in navigator) {
        const originalRegister = navigator.serviceWorker.register;
        navigator.serviceWorker.register = function(scriptURL, options) {
            if (typeof scriptURL === 'string' && scriptURL.includes(GTM_SERVER_URL)) {
                console.log('GTM Proxy: Intercepting Service Worker registration:', scriptURL);
                return modifyUrl(scriptURL).then(modifiedUrl => {
                    console.log('GTM Proxy: Service Worker URL modified to:', modifiedUrl);
                    return originalRegister.call(this, modifiedUrl, options);
                }).catch(error => {
                    console.error('GTM Proxy: Error modifying Service Worker URL:', error);
                    return originalRegister.call(this, scriptURL, options);
                });
            }
            return originalRegister.call(this, scriptURL, options);
        };
        console.log('GTM Proxy: Service Worker interception setup complete.');
    }

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

    // Add a global listener to catch any requests we might have missed
    console.log('GTM Proxy: All interception methods initialized.');

    // Add MutationObserver to catch any script elements we might have missed
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SCRIPT' && node.src && node.src.includes(GTM_SERVER_URL)) {
                        console.log('GTM Proxy: MutationObserver caught unintercepted script:', node.src);
                        const originalSrc = node.src;
                        modifyUrl(originalSrc).then(modifiedUrl => {
                            console.log('GTM Proxy: MutationObserver modifying script URL to:', modifiedUrl);
                            node.src = modifiedUrl;
                        }).catch(error => {
                            console.error('GTM Proxy: MutationObserver error modifying URL:', error);
                        });
                    }
                });
            }
        });
    });

    // Start observing
    observer.observe(document, { childList: true, subtree: true });
    console.log('GTM Proxy: MutationObserver started.');

    // Override Image constructor in case GTM uses it for tracking pixels
    const OriginalImage = window.Image;
    window.Image = function(...args) {
        const img = new OriginalImage(...args);
        const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src') || {};
        const originalSetter = originalSrcDescriptor.set;
        
        if (originalSetter) {
            Object.defineProperty(img, 'src', {
                set: function(value) {
                    if (typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
                        console.log('GTM Proxy: Intercepting Image src:', value);
                        modifyUrl(value).then(modifiedUrl => {
                            originalSetter.call(this, modifiedUrl);
                        }).catch(error => {
                            console.error('GTM Proxy: Error modifying Image URL:', error);
                            originalSetter.call(this, value);
                        });
                    } else {
                        originalSetter.call(this, value);
                    }
                },
                get: originalSrcDescriptor.get,
                configurable: true
            });
        }
        return img;
    };

    // Override Navigator.sendBeacon for analytics requests
    const originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function(url, data) {
        if (typeof url === 'string' && url.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting sendBeacon:', url);
            return modifyUrl(url).then(modifiedUrl => {
                console.log('GTM Proxy: sendBeacon URL modified to:', modifiedUrl);
                return originalSendBeacon.call(this, modifiedUrl, data);
            }).catch(error => {
                console.error('GTM Proxy: Error modifying sendBeacon URL:', error);
                return originalSendBeacon.call(this, url, data);
            });
        }
        return originalSendBeacon.call(this, url, data);
    };

    // Add comprehensive IMG element interception
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'IMG' && name.toLowerCase() === 'src' && typeof value === 'string' && value.includes(GTM_SERVER_URL)) {
            console.log('GTM Proxy: Intercepting IMG setAttribute src:', value);
            modifyUrl(value).then(modifiedUrl => {
                originalSetAttribute.call(this, name, modifiedUrl);
            }).catch(error => {
                console.error('GTM Proxy: Error modifying IMG setAttribute URL:', error);
                originalSetAttribute.call(this, name, value);
            });
            return;
        }
        return originalSetAttribute.call(this, name, value);
    };
})(); 