# Security Policy

## Overview

Commitron implements comprehensive security measures to protect user data and prevent common security vulnerabilities. This document outlines the security features, data handling practices, and privacy protections implemented in the application.

## Data Privacy & Protection

### Data Sent to AI Service

- **File paths**: Sanitized to remove usernames and sensitive path segments
- **Code changes**: Limited to 3000 characters per file, with sensitive content redacted
- **File metadata**: Addition/deletion counts and file status only
- **Total request size**: Capped at 100KB

### Data NOT Sent to AI Service

- API keys or authentication tokens
- Personal information (names, emails, phone numbers)
- System information (OS details, hardware info)
- Repository metadata (remote URLs, branch names)
- Configuration data (user settings, preferences)

### Automatic Privacy Protections

- **Sensitive file filtering**: Automatically skips `.env`, `.key`, `.pem`, `.p12`, `.pfx`, `.p8` files
- **Directory protection**: Skips files in `secrets/`, `keys/`, `credentials/` directories
- **Content redaction**: Automatically detects and redacts potential secrets, API keys, passwords, and tokens
- **Path sanitization**: Removes usernames from file paths before processing

## Security Features

### Input Validation & Sanitization

- Comprehensive input validation for all user inputs
- File path sanitization to prevent path traversal attacks
- Configuration key and value validation with strict type checking
- Commit message validation to prevent malicious content
- API key format validation

### Path Traversal Protection

- Path sanitization using `path.resolve()` and validation
- Directory traversal detection with pattern matching
- Base directory validation to ensure paths stay within repository
- Secure file path validation in Git service

### Secure API Key Handling

- Environment variables prioritized over config file storage
- API keys never stored in configuration files
- API key format validation with proper error handling
- Secure key masking in configuration display
- Proper file permissions (0o600) for config files

### Resource Limits & Timeouts

- File size limits (25MB default)
- Diff content size limits (100KB default)
- API request size limits (750KB default)
- Dynamic operation timeouts (15-90 seconds based on file size and complexity)
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

- **Config directory**: `0o700` (owner read/write/execute only)
- **Config file**: `0o600` (owner read/write only)

### Input Validation Rules

- **File paths**: Must be within repository directory
- **API keys**: 10-200 characters, alphanumeric with hyphens/underscores
- **Commit messages**: 1-200 characters, no malicious patterns
- **Configuration values**: Type-specific validation with sanitization

## Privacy Command

Use `cx privacy` to view detailed information about:

- What data is sent to the AI service
- Privacy protections in place
- Sensitive file types that are automatically skipped
- Data handling practices

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

## Compliance

This security implementation helps ensure compliance with:

- Data privacy regulations
- Security best practices
- Enterprise security requirements
- Open source security standards

---

**Last Updated**: September 2025
**Version**: 1.0.2
**Status**: ✅ Security features implemented and tested
