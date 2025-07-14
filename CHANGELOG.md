# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-07-14

### Added
- Security enhancements with Helmet.js middleware
- Rate limiting on API endpoints (100 requests per 15 minutes)
- Enhanced debug logging system with `debugLog` utility
- Client IP forwarding support with multiple header sources
- Cookie domain rewriting for proper cross-domain functionality
- Support for all HTTP methods in body encryption
- Comprehensive error handling with unique error IDs
- Global error handler for better error reporting
- Unhandled rejection and exception handlers

### Changed
- Improved logging system from console.log to structured debugLog
- Enhanced body handling to support all content types
- Better cookie handling with domain and path controls
- More robust XHR and Fetch request handling
- Updated dependencies to latest versions:
  - express-rate-limit: ^7.5.1
  - helmet: ^8.1.0
  - other dependencies updated to latest versions

### Security
- Added Helmet.js for secure HTTP headers
- Implemented rate limiting to prevent abuse
- Enhanced cookie security with proper domain controls
- Improved error handling to prevent information leakage
- Added support for various proxy headers for proper client IP handling

### Fixed
- CORS configuration for better cross-origin support
- Cookie domain handling for cross-subdomain functionality
- Body parsing for various content types
- Debug mode configuration and implementation

### Developer Experience
- Better debug logging with structured format
- More informative error messages
- Cleaner code organization
- Better handling of environment variables 