# Security Policy

## Overview

Commit-X uses layered safeguards to reduce accidental disclosure and unsafe
local Git operations. Pattern-based redaction is defense in depth, not a
guarantee that arbitrary source code contains no sensitive information.

## Data Privacy & Protection

### Data Sent to AI Service

- **File identity**: Opaque IDs in prompt metadata; Git patch path headers are
  removed
- **Code changes**: Limited to 3000 characters per file, with sensitive content
  redacted
- **File metadata**: Addition/deletion counts and file status only
- **Total request size**: Diff-content budget capped near 50,000 characters;
  hard request guard at 750,000 characters

### Data NOT Included in the Prompt Payload

- API keys or authentication tokens found in source content (blocked or redacted
  when detected)
- Detected credentials and common personal identifiers (redacted or blocked)
- System information (OS details, hardware info)
- Repository metadata (remote URLs, branch names)
- Configuration data (user settings, preferences)

`GEMINI_API_KEY` is necessarily transmitted to Google's API infrastructure for
authentication; Commit-X does not include it in the model prompt or cache.

### Automatic Privacy Protections

- **Sensitive file filtering**: Automatically skips `.env`, `.key`, `.pem`,
  `.p12`, `.pfx`, `.p8` files
- **Directory protection**: Skips files in `secrets/`, `keys/`, `credentials/`
  directories
- **Content redaction**: Detects common provider tokens, private keys,
  credentials, and personal identifiers
- **Prompt injection defense**: System instructions identify diffs as untrusted
  inert data; output is constrained with JSON Schema
- **Path minimization**: Opaque file IDs replace repository paths in prompt
  metadata

## Security Features

### Input Validation & Sanitization

- Comprehensive input validation for all user inputs
- File path sanitization to prevent path traversal attacks
- Configuration key and value validation with strict type checking
- Commit message validation to prevent malicious content
- API key format validation

### Path Traversal Protection

- Containment validation uses `path.relative()` so sibling paths with a shared
  prefix are rejected
- Repository discovery supports normal repositories, subdirectories, worktrees,
  and submodules
- Secure file path validation in Git service

### Secure API Key Handling

- API keys are read only from `GEMINI_API_KEY`
- API keys are never accepted for config-file persistence
- API key format validation with proper error handling
- Secure key masking in configuration display

### Resource Limits & Timeouts

- File size limits (25MB default)
- Diff content size limits (100KB default)
- API request size limits (750KB default)
- Dynamic operation timeouts with Gemini request cancellation via `AbortSignal`
- Memory management for large files

### Error Handling

- SecureError class with proper error categorization
- Error recovery mechanisms with retry logic
- Error sanitization to prevent information leakage
- Graceful degradation for non-critical failures
- Comprehensive error logging with context

## Security Configuration

### Resource Limits

```typescript
const DEFAULT_LIMITS: ResourceLimits = {
  maxFileSize: 25 * 1024 * 1024, // 25MB
  maxDiffSize: 100_000, // 100KB
  maxApiRequestSize: 750_000, // 750KB
  timeoutMs: 25_000, // 25 seconds (base timeout, actual timeouts are calculated dynamically)
};
```

### File Permissions

- **AI cache directory/file**: `0o700` / `0o600`, with atomic replacement

### Optional AI cache

Caching is disabled unless `--use-cached` is supplied. Cached data contains
generated commit groups and local file paths, but not raw diff text. Cache keys
include a hash of the repository path, exact diffs, model, and prompt version.
Entries expire after seven days, are schema-validated, and must cover the
current file set exactly.

### Input Validation Rules

- **File paths**: Must be within repository directory
- **API keys**: 10-200 characters, alphanumeric with hyphens/underscores
- **Commit messages**: 1-200 characters with terminal control characters
  rejected
- **Configuration values**: Authentication is environment-only

## Security Best Practices

1. **Defense in Depth**: Multiple layers of validation and security checks
2. **Principle of Least Privilege**: Minimal file permissions and access
3. **Input Validation**: All inputs validated and sanitized
4. **Error Handling**: Secure error messages without information leakage
5. **Resource Management**: Limits on file sizes, timeouts, and memory usage
6. **Secure Defaults**: Safe configuration defaults
7. **Environment Variables**: Sensitive data only in environment variables
8. **Path Sanitization**: Protection against directory traversal
9. **Data Minimization**: Only necessary data sent to external services
10. **Transparency**: Clear visibility into data handling practices

## Environment Variables

Set your API key securely using environment variables:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

Never store API keys in configuration files or commit them to version control.

## Security Testing

The application includes built-in security testing for:

- Input validation and sanitization
- Path traversal protection
- Resource limit enforcement
- Error handling and information leakage
- Privacy protection mechanisms

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** create a public issue
2. **Email** security concerns to the maintainer
3. **Include** detailed reproduction steps
4. **Wait** for confirmation before public disclosure

**Last Updated**: July 2026 **Version**: 4.1.0 **Status**: ✅ Security features
implemented and tested
