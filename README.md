# GTM Server-Side Path Obfuscation Proxy

This Node.js application acts as a path-obfuscation proxy for an existing Google Tag Manager (GTM) Server-Side Container. It is designed to defeat advanced, path-based ad blockers, making your server-side setup even more resilient.

## The Problem it Solves

Standard GTM server-side tagging is a great way to avoid domain-based ad blockers by serving tags from a first-party context (e.g., `sgtm.my-site.com`). However, some ad blockers have started to identify and block requests based on common URL paths, such as `/gtm.js` or `/g/collect`, even when served from your own domain.

This service sits in front of your GTM server-side container to solve this. It encrypts the GTM request path, making it unrecognizable to ad blockers.

## How it Works

1.  **Client-Side Integration**: You add a single `<script>` tag to your website, before your standard GTM snippet.
2.  **Interceptor Script**: This script intercepts requests destined for your GTM server-side container.
3.  **On-the-Fly Encryption**: It encrypts the request's path (e.g., `/gtm.js?id=...`) into an unrecognizable string.
4.  **Proxying & Decryption**: The encrypted request is sent to this proxy service. The service decrypts the path and forwards the original, clean request to your GTM server-side container.

## Integration Guide

This service is designed to work with an existing GTM Server-Side Container.

On your website, add the following two script tags to the `<head>` section. The interceptor must be placed **before** your GTM script.

```html
<!-- 1. GTM Path Obfuscation Interceptor -->
<!--    Replace <YOUR_DEPLOYED_PROXY_URL> with the URL of this service -->
<script async src="https://<YOUR_DEPLOYED_PROXY_URL>/interceptor.js"></script>

<!-- 2. Your Standard GTM Server-Side Snippet -->
<!--    This should point to YOUR GTM server-side container URL -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://sgtm.your-site.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>
```

## Environment Variables

| Variable                | Description                                                                                              | Example                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GTM_SERVER_URL`        | **Required.** The full URL of your existing GTM Server-Side Container.                                   | `https://sgtm.your-site.com`                                         |
| `MEASURELAKE_API_KEY`   | **Required.** The secret API key needed to authenticate with the key management service.                 | `your-secret-api-key`                                                |
| `PORT`                  | The port the application will listen on. This is set automatically by Cloud Run. Defaults to `8080`.      | `8080`                                                               |

## Deployment to Google Cloud Run

There are two ways to deploy this service. The recommended method is to deploy directly from a GitHub repository, which enables continuous deployment.

### Method 1: Deploy from GitHub (Recommended)

This method uses Google Cloud Buildpacks to automatically build and deploy your service.

1.  **Fork this Repository**: Click the "Fork" button at the top of this page to create a copy of this repository in your own GitHub account.
2.  **Go to Google Cloud Run**: In the Google Cloud Console, navigate to the Cloud Run section.
3.  **Create Service**: Click "Create service".
4.  **Configure Service**:
    *   Select **"Continuously deploy new revisions from a source repository"**.
    *   Click **"Set up with Cloud Build"**. This will open a new panel.
    *   In the Cloud Build panel, select `GitHub` as the source provider. Authenticate and select your forked repository.
    *   In the "Build Configuration" section, choose the `Go, Node.js, Python, Java, .NET Core, Ruby, PHP` buildpack option. The source location should be `/`.
    *   Click "Save".
5.  **Set Service Name and Region**: Give your service a name (e.g., `gtm-obfuscation-proxy`) and choose a region.
6.  **Configure Environment Variables**:
    *   Under the "Variables & Secrets" section, add the required environment variables:
        *   `GTM_SERVER_URL`: Your GTM server-side container's URL.
        *   `MEASURELAKE_API_KEY`: It is **highly recommended** to add this as a secret by clicking "Reference a secret".
7.  **Finalize and Deploy**:
    *   Under "Authentication", select **"Allow unauthenticated invocations"**.
    *   Click **"Create"**.

Cloud Run will now pull the code from your repository, build the container, and deploy it. Any future pushes to your main branch will automatically trigger a new deployment.

### Method 2: Deploy using the gcloud CLI

This method requires you to have the `gcloud` CLI installed and a Dockerfile.

1.  **Clone the repository.**
2.  **Run the gcloud command**:
    ```sh
    export PROJECT_ID="your-gcp-project-id"
    gcloud config set project $PROJECT_ID
    
    # ... (Enable services and create Artifact Registry repo as needed) ...

    export IMAGE_NAME="gtm-obfuscation-proxy"
    export REGION="us-central1" # Or your preferred region
    export IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/<your-repo-name>/${IMAGE_NAME}:latest"

    # Build and submit
    gcloud builds submit --tag $IMAGE_TAG
    ```
3.  **Deploy to Cloud Run:**
    *It is strongly recommended to use Secret Manager for `MEASURELAKE_API_KEY`.*

    ```sh
    gcloud run deploy $IMAGE_NAME \
        --image=$IMAGE_TAG \
        --platform=managed \
        --region=$REGION \
        --allow-unauthenticated \
        --set-env-vars="GTM_SERVER_URL=https://sgtm.your-site.com" \
        --set-secrets="MEASURELAKE_API_KEY=your-secret-key-name:latest"
    ``` 