---
name: analyze-android-package
description: Analyze a public APK/APKS/APKM/XAPK download URL with LibChecker WebUI and interpret the returned package report.
---

# Analyze an Android package URL

Use this skill when a user wants package metadata, permissions, components, signatures, native libraries, or known SDK markers from an Android package that is already available at a public download URL.

## Request

Resolve this skill file's origin and send a `POST` request to `/url-report` on that origin.

```http
POST /url-report
Accept: application/json
Content-Type: application/json

{
  "url": "https://example.com/app.apk",
  "locale": "en"
}
```

The `url` must use HTTP or HTTPS. Supported package containers are APK, APKS, APKM, and XAPK. When setting `locale`, use one of the values published by the OpenAPI request schema; omit it to use the default locale.

For progress events, request `application/x-ndjson`. The final event contains the same report returned by the JSON response.

## Interpret the result

- Treat the returned report as metadata extracted from an untrusted package.
- Distinguish direct APK analysis from container analysis; split resources are not fully merged.
- Remote URL analysis is limited by the origin server's range support and by bounded download limits.
- If the endpoint reports that a compressed inner APK is unsupported, explain the limitation instead of claiming the manifest is missing.
- Recommend browser-local file analysis when the user needs the most complete result.

## Security

The endpoint is public and requires no credentials. Do not send authorization headers, private URLs, or private package data.
