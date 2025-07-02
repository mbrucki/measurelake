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

### Step 2: Set Up Custom Domain

1. **Choose a subdomain name**: Select a subdomain that won't trigger ad blockers. Avoid using obvious terms like 'gtm', 'analytics', or 'tracking'. Instead, use neutral terms like 'loading', 'assets', or 'static'
2. **Configure Load Balancer** in your cloud provider
3. **Set up DNS records** for your custom domain
4. **Map the domain** to your service
5. **Verify SSL/TLS** certificates are properly configured

### Step 3: Update Your Website

**Remove your existing GTM snippet** and replace it with:

```html
<script src="https://loading.yourdomain.com/"></script>
```

That's it! Replace `loading.yourdomain.com` with your actual custom domain configured in Step 2.

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

For technical support or questions about implementation, please contact our team.

---

**Important**: This service is designed to ensure compliance with privacy regulations while maintaining analytics functionality. Always ensure your data collection practices comply with applicable privacy laws. 