# GTM Ad-Blocker Bypass Service

A professional solution to ensure your Google Tag Manager analytics continue working even when visitors use ad-blockers. This service routes your GTM requests through your own domain, making them invisible to ad-blocking software.

## What This Service Does

✅ **Bypasses Ad-Blockers**: Ensures your analytics work even with aggressive ad-blockers like uBlock Origin, AdBlock Plus, and Brave Shields  
✅ **Zero Analytics Loss**: Maintains 100% of your tracking data  
✅ **First-Party Tracking**: All requests appear to come from your own domain  
✅ **Easy Integration**: Simple one-script implementation  
✅ **No Code Changes**: Works with your existing GTM setup  

## Prerequisites

Before you begin, you'll need:
- A Google Tag Manager account with a container ID
- A GTM Server-Side Container already deployed
- Access to Google Cloud Platform (or another container hosting service)
- Identity and Access Management (IAM) API enabled
- Basic website editing permissions
- MeasureLake API key (contact welcome@measurelake.com to get access during pilot phase)

## Implementation Guide

### Step 1: Deploy the Service

1. **Fork this repository** to your GitHub account
2. **Go to Google Cloud Console** → Cloud Run
3. **Create a new service**:
   - Source: Deploy from Git repository
   - Connect your forked repository
   - Branch: main
   - Build type: Dockerfile
4. **Set environment variables**:
   - `GTM_SERVER_URL`: Your GTM server URL (e.g., `https://sgtm.yourdomain.com`)
   - `GTM_ID`: Your GTM container ID (e.g., `GTM-XXXXXXX`)
   - `MEASURELAKE_API_KEY`: Your API key for the encryption service (provided by MeasureLake)
5. **Deploy the service**
6. **Note your service URL** (e.g., `https://your-service-abc123.run.app`)

### Step 2: Add to Your Website

Add the following script to your website's `<head>` section:

```html
<script>(function(w,d,s,l,i,p,t,u){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s);j.async=true;t=new URLSearchParams(w.location.search);
j.src=t.has('gtm_debug')?(u=new URL('gtm.js','https://sgtm.yourdomain.com/'),
u.searchParams.set('id',i),t.forEach((v,k)=>u.searchParams.set(k,v)),u.href):
'https://your-proxy-domain.com/';f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXX');</script>
```

Replace:
- `GTM-XXXXX` with your GTM container ID
- `https://your-proxy-domain.com` with your proxy service URL
- `https://sgtm.yourdomain.com` with your GTM server-side container URL

The script automatically:
- Uses the proxy root URL for normal traffic
- Switches to direct server-side container access for debug/preview mode with all parameters
- Maintains all GTM functionality including preview mode

### Step 3: Set Up Custom Domain

1. **Choose a subdomain name**: Select a subdomain that won't trigger ad blockers. Avoid using obvious terms like 'gtm', 'analytics', or 'tracking'. Instead, use neutral terms like 'loading', 'assets', or 'static'
2. **Configure Load Balancer** in your cloud provider
3. **Set up DNS records** for your custom domain
4. **Map the domain** to your service
5. **Verify SSL/TLS** certificates are properly configured

### Step 4: Test Your Implementation

1. **Open your website** in a browser with ad-blocker enabled
2. **Open Developer Tools** (F12) → Network tab
3. **Refresh the page**
4. **Verify**: You should see requests going to your service domain instead of Google's domains
5. **Check Analytics**: Confirm events are appearing in your GA4/GTM debug console

### Step 5: Verify Ad-Blocker Bypass

Test with popular ad-blockers:
- **Brave Browser**: Enable "Aggressive" blocking
- **uBlock Origin**: Default settings
- **AdBlock Plus**: Default settings

Your analytics should continue working with all of them.

## Troubleshooting

### Service Not Loading
- Check that environment variables are set correctly
- Verify your GTM Server-Side Container is accessible
- Check Cloud Run logs for error messages

### Analytics Not Working
- Confirm your GTM container ID is correct
- Verify your GTM Server-Side Container is properly configured
- Check browser console for any JavaScript errors

### Still Getting Blocked
- Ensure you've completely replaced the old GTM snippet
- Clear browser cache and cookies
- Test in an incognito/private browsing window

## Support

For technical support or questions about implementation, please us at welcome@measurelake.com

---

**Important**: This service is designed to ensure compliance with privacy regulations while maintaining analytics functionality. Always ensure your data collection practices comply with applicable privacy laws. 


____
© 2025 Mariusz Brucki MeasureLake. Licensed under CC BY-NC 4.0 (see LICENSE file).