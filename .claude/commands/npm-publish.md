# Publish MCP Server to npm

Publish the `browser-agent-extension-mcp` package to npm registry.

## Steps

1. Navigate to `mcp-server/` directory
2. Check `package.json` for current version
3. Run `npm publish` to publish the package
4. Verify the publish was successful

## Prerequisites

- npm auth token must be configured: `npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN`
- Or use a Granular Access Token with read/write permissions

## Command

```bash
cd mcp-server && npm publish
```

## Notes

- The package has a `prepublishOnly` script that runs `npm run build` automatically
- If 2FA is required, use a Granular Access Token to bypass
- After publishing, verify at: https://www.npmjs.com/package/browser-agent-extension-mcp
