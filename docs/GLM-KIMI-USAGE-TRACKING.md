# GLM and Kimi Usage Tracking Implementation

## Overview
This document describes the implementation of usage tracking endpoints for GLM (Zhipu AI) and Kimi (Moonshot AI) in the OpenClaw Dashboard.

## Implementation Status

### ✅ Implemented
1. **Backend API Endpoints** (in `/server.js`):
   - `GET /api/glm-usage` - Returns GLM usage data
   - `POST /api/glm-usage-scrape` - Triggers GLM usage fetch
   - `GET /api/kimi-usage` - Returns Kimi usage data
   - `POST /api/kimi-usage-scrape` - Triggers Kimi usage fetch

2. **Scrape Scripts**:
   - `/scripts/scrape-glm-usage.sh` - GLM usage scraper (placeholder)
   - `/scripts/scrape-kimi-usage.sh` - Kimi usage scraper (placeholder)

3. **Data Files**:
   - `/data/glm-usage.json` - GLM usage data storage
   - `/data/kimi-usage.json` - Kimi usage data storage

## API Configuration

### GLM (Zhipu AI)
- **Platform**: https://open.bigmodel.cn/
- **API Base**: https://open.bigmodel.cn/api/paas/v4/
- **Authentication**: JWT Token (Bearer auth)
- **Models**: glm-5, glm-4.7, glm-4.7-flash, glm-4.7-flashx
- **Environment Variable**: `GLM_API_KEY` or `ZHIPU_API_KEY`

### Kimi (Moonshot AI)
- **Platform**: https://platform.moonshot.cn/
- **API Base**: https://api.moonshot.cn/v1/ (or https://api.kimi.com/coding/)
- **Authentication**: API Key (Bearer auth)
- **Models**: kimi-k2.5, k2p5 (coding)
- **Environment Variable**: `KIMI_API_KEY` or `MOONSHOT_API_KEY`

## Current Limitations

### ⚠️ GLM API
**Status**: Usage tracking endpoints are UNDOCUMENTED

**Findings**:
- Chat completion API is documented and working
- Account/balance/usage endpoints are not publicly documented
- Attempted endpoints (all returned errors):
  - `GET /api/paas/v4/account`
  - `GET /api/paas/v4/balance`
  - `GET /api/paas/v4/usage`

**Next Steps**:
1. Contact Zhipu AI support for usage API documentation
2. Check platform dashboard for API documentation
3. Explore platform's web interface for usage information
4. Consider web scraping as fallback (like Claude implementation)

### ⚠️ Kimi API
**Status**: Usage tracking endpoints are UNDOCUMENTED

**Findings**:
- Chat completion API is documented and working
- Account/balance/usage endpoints are not publicly documented
- Attempted endpoints (all returned errors):
  - `GET /v1/users/me`
  - `GET /v1/balance`
  - `GET /v1/usage`
  - `GET /v1/account`

**Next Steps**:
1. Check https://platform.moonshot.cn/docs for updates
2. Contact Moonshot AI support for usage API
3. Explore platform's web interface for usage information
4. Consider web scraping as fallback

## Response Format

Both endpoints return data in the following format (matching Claude usage):

```json
{
  "session": {
    "percent": 45,
    "resets": "in 2h 30m"
  },
  "scraped_at": "2024-03-08T10:00:00Z",
  "raw_response": { ... }
}
```

When API documentation is unavailable:
```json
{
  "error": "Unable to fetch usage data",
  "message": "API endpoint not found or not documented",
  "http_code": 404,
  "note": "Update scrape script when official API documentation is available",
  "documentation_links": [...],
  "scraped_at": "2024-03-08T10:00:00Z"
}
```

## Configuration Required

To enable usage tracking when APIs become available:

### For GLM:
```bash
export GLM_API_KEY="your_jwt_token_here"
# or
export ZHIPU_API_KEY="your_jwt_token_here"
```

### For Kimi:
```bash
export KIMI_API_KEY="your_api_key_here"
# or
export MOONSHOT_API_KEY="your_api_key_here"
```

## Testing the Endpoints

### Test GLM Usage:
```bash
# Scrape GLM usage
curl -X POST http://localhost:7000/api/glm-usage-scrape \
  -H "Authorization: Bearer YOUR_DASHBOARD_TOKEN"

# Get GLM usage data
curl http://localhost:7000/api/glm-usage \
  -H "Authorization: Bearer YOUR_DASHBOARD_TOKEN"
```

### Test Kimi Usage:
```bash
# Scrape Kimi usage
curl -X POST http://localhost:7000/api/kimi-usage-scrape \
  -H "Authorization: Bearer YOUR_DASHBOARD_TOKEN"

# Get Kimi usage data
curl http://localhost:7000/api/kimi-usage \
  -H "Authorization: Bearer YOUR_DASHBOARD_TOKEN"
```

## Alternative Approaches

If official APIs are not available, consider:

1. **Web Scraping** (like Claude implementation):
   - Use headless browser or tmux session
   - Login to platform dashboard
   - Extract usage information from HTML
   - Store in JSON format

2. **Manual Entry**:
   - Create admin interface to manually update usage
   - Store in JSON files
   - Display in dashboard

3. **Estimation**:
   - Track usage locally from API calls
   - Calculate approximate usage based on tokens
   - Display estimated usage

## Future Improvements

1. **When APIs become available**:
   - Update scrape scripts with correct endpoints
   - Add proper error handling
   - Implement caching to reduce API calls
   - Add usage history tracking

2. **Dashboard Integration**:
   - Add usage cards to dashboard UI
   - Display usage graphs
   - Set up alerts for usage limits
   - Compare usage across providers

## Files Modified

1. `/server.js`:
   - Added file path constants for GLM and Kimi usage files
   - Added `/api/glm-usage` endpoint
   - Added `/api/glm-usage-scrape` endpoint
   - Added `/api/kimi-usage` endpoint
   - Added `/api/kimi-usage-scrape` endpoint

2. `/scripts/scrape-glm-usage.sh`:
   - Created placeholder scraper
   - Documented known endpoints
   - Added error handling for missing API documentation

3. `/scripts/scrape-kimi-usage.sh`:
   - Created placeholder scraper
   - Documented known endpoints
   - Added error handling for missing API documentation

4. `/data/glm-usage.json`:
   - Initial placeholder data
   - Configuration documentation

5. `/data/kimi-usage.json`:
   - Initial placeholder data
   - Configuration documentation

## Conclusion

The infrastructure for GLM and Kimi usage tracking is now in place. The endpoints follow the same pattern as Claude and Gemini usage tracking. However, actual usage data retrieval requires:

1. **Official API documentation** from Zhipu AI and Moonshot AI
2. **API keys** to be configured as environment variables
3. **Scrape scripts** to be updated with correct endpoints

Once the APIs are documented, the implementation can be completed quickly by updating the scrape scripts with the correct endpoints and response parsing logic.

## Contact Information

- **GLM (Zhipu AI)**: https://open.bigmodel.cn/
- **Kimi (Moonshot AI)**: https://platform.moonshot.cn/
- **OpenClaw Dashboard**: http://localhost:7000
