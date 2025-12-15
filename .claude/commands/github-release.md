# Create GitHub Release for Browser Extension

Build the browser extension and create a GitHub release with the zip package.

## Steps

1. Build the extension: `cd extension && npm run build`
2. Create zip package from `extension/dist/` directory
3. Commit any pending changes
4. Create and push git tag (e.g., `v1.0.x`)
5. Create GitHub release with the zip file attached

## Commands

```bash
# Build extension
cd extension && npm run build

# Create zip (from extension/dist directory)
cd extension/dist && powershell "Compress-Archive -Path * -DestinationPath ../../browser-agent-extension-v{VERSION}.zip -Force"

# Commit changes (if any)
git add -A && git commit -m "chore: bump version to {VERSION}"

# Create and push tag
git tag -a v{VERSION} -m "Release v{VERSION}"
git push origin main
git push origin v{VERSION}

# Create release with gh CLI
gh release create v{VERSION} browser-agent-extension-v{VERSION}.zip --title "v{VERSION}" --notes "Release v{VERSION}"
```

## Prerequisites

- GitHub CLI (`gh`) must be installed and authenticated
- If gh is not in PATH, use: `/c/Users/CPN/gh_cli/bin/gh.exe`

## Notes

- The zip file should contain the contents of `extension/dist/` (not the dist folder itself)
- Users can download the zip and load it as an unpacked extension in Chrome
- Release URL format: https://github.com/agents-cc/browser-agent-extension/releases/tag/v{VERSION}
