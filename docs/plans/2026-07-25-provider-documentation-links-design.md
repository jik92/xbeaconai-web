# Provider documentation links in credential management

## Goal

Make every active Provider name in credential management link to documentation that explains the capabilities available
to its API key.

## Data model

Add a `docsUrl` field to each managed Provider credential definition. The masked credential API returns this field, so
the Provider-to-documentation mapping remains centralized in the backend catalog instead of being duplicated in Web
components.

Mappings:

- AIHubMix: `https://aihubmix.mintlify.app/cn/api/Models-API`
- Volc TOS: `https://www.volcengine.com/docs/6349/163211?lang=zh`
- AI MediaKit: `https://www.volcengine.com/docs/6448/2373721`
- Qwen Audio: `https://help.aliyun.com/zh/model-studio/speech-synthesis-api-reference/`

The hidden Volc Speech catalog entries may retain no active documentation link because they are not returned by the
credential-management API.

## UI

Render the existing Provider name as a compact text link with a small external-link icon. Open documentation in a new
tab with `target="_blank"` and `rel="noopener noreferrer"`. Do not add another table column or explanatory copy.

## Contract and tests

Update the administrator credential schema with a required URL string and regenerate OpenAPI and the Web SDK. Tests
cover catalog mappings, API schema exposure, and safe link rendering. Run unit tests, typecheck, and production build;
do not run E2E.

