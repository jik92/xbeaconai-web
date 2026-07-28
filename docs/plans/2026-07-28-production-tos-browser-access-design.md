# Production TOS Browser Access Repair Design

## Goal

Make browser uploads, previews, and downloads from `https://app.xbeaconai.com` work against the private production
material bucket without proxying large files through the API server.

## Architecture

- Keep `xbeacon-shanghai` private and retain the existing split endpoint model: the Server and Worker use the
  Shanghai intranet endpoint, while browser-facing signed URLs use the Shanghai public endpoint.
- The API continues to issue short-lived signed PUT and GET URLs. The browser origin is
  `https://app.xbeaconai.com`; the signed object host remains the TOS public host.
- Configure one deterministic bucket CORS rule containing all approved production and local origins, with
  `GET`, `HEAD`, and `PUT`, wildcard request headers, and the response headers needed by upload and range-read
  clients.
- Do not make the bucket public, expose permanent credentials, route material objects through the frontend CDN
  bucket, or send large files through the API process.

## Production Repair

1. Read and preserve the approved origin set from production configuration.
2. Replace drifted CORS rules with one canonical rule and verify the value returned by TOS.
3. Use a dedicated temporary object under `__cors-doctor__/` to perform a signed PUT carrying the real browser
   Origin and Content-Type.
4. Verify signed GET, HEAD, and Range `206`, including the exact CORS headers, content type, size, and bytes.
5. Delete the temporary object and verify it no longer exists.
6. Re-run the production TOS Doctor and verify API and Worker health.

## Error Handling and Safety

- Fail before changing CORS if the configured bucket, region, or public endpoint differs from the expected
  production values.
- Never print signed URLs, access keys, secrets, tokens, object contents, or user-owned object keys.
- Use an exact temporary prefix and delete only the object created by this verification.
- Keep existing material objects and database records untouched.

## Verification

Completion requires evidence from the real production bucket: PUT success, GET success, Range `206`, matching
payload and metadata, correct `Access-Control-Allow-Origin`, successful cleanup, an available TOS Doctor, and
healthy API and Worker services. Browser click-level verification remains manual under repository policy.
