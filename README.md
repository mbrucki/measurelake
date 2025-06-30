# GTM Server-Side Path Obfuscation Proxy

This project provides a containerized Node.js application that acts as a path-obfuscating proxy for an existing Google Tag Manager (GTM) Server-Side Container. It is designed to make your server-side setup more resilient to ad-blockers that target common URL paths (e.g., `/gtm.js`, `/g/collect`).

## Deployment

This service is designed to be deployed as a container, for example using Google Cloud Run. You can deploy it directly from your GitHub repository using Google Cloud Build.

1.  Go to your Google Cloud Console and navigate to Cloud Build.
2.  Create a new trigger connected to your GitHub repository.
3.  Configure the trigger to use the `Dockerfile` in the root of the repository.
4.  In the "Substitution variables," you must add the environment variables required for the service to run.

## Environment Variables

The container is configured using the following environment variables:

-   `GTM_SERVER_URL` (Required): The full URL of your existing GTM Server-Side Container (e.g., `https://sgtm.example.com`).
-   `GTM_ID` (Required): Your Google Tag Manager container ID (e.g., `GTM-XXXXXXX`).
-   `PORT`: The port the application will listen on. This is usually set automatically by the hosting platform (like Cloud Run). Defaults to `8080`.

## How It Works

1.  **Client-Side Integration**: You place a single `<script>` tag on your website pointing to the root (`/`) of this deployed service. This replaces your normal GTM snippet.
2.  **Dynamic Script Generation**: The service responds with a JavaScript file configured with your `GTM_SERVER_URL` and `GTM_ID`.
3.  **Interception**: The client-side script overrides `document.createElement` and `window.fetch`. When it sees a request being made to your `GTM_SERVER_URL`, it intervenes.
4.  **Encryption**: It encrypts the request's relative path (e.g., `/gtm.js?id=...`) into an unrecognizable string.
5.  **Proxy Request**: The script sends the encrypted data to the `/load/:encryptedFragment` endpoint of this service.
6.  **Decryption & Forwarding**: The service decrypts the fragment and forwards the original, reconstructed request to your GTM Server-Side Container.
7.  **Response**: The response from your GTM container is streamed back to the client, making the proxy transparent.

This process ensures that from the browser's perspective, all GTM-related traffic is sent to your own domain, enhancing privacy and durability. 