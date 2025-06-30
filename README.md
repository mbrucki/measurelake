# GTM First-Party Proxy Service

This project provides a containerized Node.js application that acts as a server-side proxy for Google Tag Manager (GTM). Its primary purpose is to serve GTM assets (`gtm.js`, `gtag.js`, etc.) and forward analytics data from a first-party context, making tracking more resilient to ad-blockers and third-party cookie restrictions.

The service dynamically serves a single JavaScript file that intercepts all GTM-related requests, encrypts their paths, and routes them through this proxy. The proxy then forwards them to Google's `fps.goog` first-party serving infrastructure.

## Deployment

This service is designed to be deployed as a container, for example using Google Cloud Run.

### Prerequisites

-   A Google Cloud project.
-   `gcloud` CLI installed and authenticated.
-   A GitHub repository with the code.

### From GitHub

You can deploy this service directly from your GitHub repository using Google Cloud Build.

1.  Go to your Google Cloud Console and navigate to Cloud Build.
2.  Create a new trigger.
3.  Connect your GitHub repository.
4.  Configure the trigger to use the `Dockerfile` in the root of the repository for the build.
5.  Set up a "Push to branch" event (e.g., for the `main` branch).
6.  In the "Advanced" section, under "Substitution variables," you must add the environment variables required for the service to run.

## Environment Variables

The container is configured using the following environment variables:

-   `GTM_ID` (Required): Your Google Tag Manager container ID (e.g., `GTM-XXXXXXX`).
-   `CANONICAL_HOSTNAME` (Required): The full domain name of the website where this GTM container is deployed (e.g., `www.example.com`). This is used to securely fetch the correct encryption key for your domain.
-   `PORT`: The port the application will listen on. This is usually set automatically by the hosting platform (like Cloud Run). Defaults to `8080`.

## How It Works

1.  **Client-Side Integration**: You place a single `<script>` tag on your website pointing to the root (`/`) of this deployed service.
2.  **Dynamic Script Generation**: The service responds with a dynamically generated JavaScript file. This script is pre-configured with your `GTM_ID`.
3.  **Interception**: The client-side script overrides `document.createElement` and `window.fetch` to intercept any attempt by your website to load GTM assets or send analytics data.
4.  **Encryption**: Before making a request, the script encrypts the path and query parameters of the original Google URL (e.g., `/gtm.js?id=GTM-XXXXXXX`).
5.  **Proxy Request**: The script sends the encrypted data to the `/load/:encryptedFragment` endpoint of this service.
6.  **Decryption & Forwarding**: The service decrypts the fragment using a shared secret key and forwards the original, reconstructed request to Google's dedicated first-party serving domain (`[GTM_ID].fps.goog`).
7.  **Response**: The response from Google is streamed back to the client, making the proxy transparent.

This process ensures that from the browser's perspective, all GTM-related traffic is sent to your own domain, enhancing privacy and durability. 