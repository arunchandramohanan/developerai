Generate a complete Postman shakedown test collection from the following OpenAPI/Swagger specification.  
You MUST follow the exact structure below. Do not deviate from this format.
 
The selected OpenAPI/Swagger file defines the API contract under test.  
Your task is to parse the specification, identify all endpoints, methods, request/response schemas, authentication schemes, and error codes, then produce a Postman Collection v2.1 JSON that exercises the API across the test categories listed below.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Apply these project-specific API conventions, testing patterns, and environment configurations while generating the shakedown collection:
 
{{ragExamples}}
{{/if}}
 
---
 
## Example Output Structure
 
### 1. Summary
- High-level description of the generated shakedown suite (e.g., "42 requests across 8 endpoints covering 6 test categories")
- Brief explanation of API surface coverage
 
---
 
### 2. Scope
- API spec source: `{{fileName}}`
- Test generation source: `Parsed OpenAPI/Swagger specification`
 
---
 
### 3. Test Categories
 
Generate Postman requests with embedded test assertions for **every applicable endpoint** across these categories:
 
#### 3.1 Health Checks
- Liveness/readiness probes (e.g., `GET /health`, `GET /ready`)
- Root endpoint smoke test
- Assert HTTP 200 and expected response schema
 
#### 3.2 CRUD Operations
- Full create → read → update → delete lifecycle for each resource
- Use collection variables for IDs returned from create operations
- Assert correct HTTP status codes (201, 200, 204) and response body structure
 
#### 3.3 Authentication & Authorization
- Requests with valid credentials (Bearer token, API key, OAuth — based on spec `securityDefinitions`/`securitySchemes`)
- Requests with missing or invalid credentials → assert 401/403
- Expired token scenarios where applicable
 
#### 3.4 Error Responses
- Missing required fields → assert 400
- Invalid field types/formats → assert 400/422
- Non-existent resource IDs → assert 404
- Method not allowed → assert 405
 
#### 3.5 Edge Cases
- Empty request bodies where a body is expected
- Boundary values for numeric fields (0, negative, max int)
- Overly long strings for text fields
- Special characters and unicode in string fields
- Duplicate creation attempts where uniqueness is enforced
 
#### 3.6 Performance Baselines
- Add `pm.expect(pm.response.responseTime).to.be.below(2000)` assertions
- Pagination endpoints with varying `limit`/`offset` or `page`/`size` parameters
- Bulk endpoints with minimum and maximum payload sizes
 
---
 
### 4. Collection Structure
 
The Postman Collection v2.1 JSON **must** include:
 
1. **Folder structure** — One top-level folder per test category (Health Checks, CRUD Operations, Auth, Error Responses, Edge Cases, Performance)
2. **Requests** — Each request must include:
   - `method`, `url` (using `{{baseUrl}}` collection variable)
   - `header` array with `Content-Type` and auth headers as needed
   - `body` (raw JSON) where applicable
3. **Test scripts** (`event[type=test].script.exec`) — Chai/BDD assertions for:
   - Status code validation
   - Response time thresholds
   - Response body schema/field checks
   - Content-Type header verification
4. **Pre-request scripts** where needed (e.g., setting dynamic variables, timestamps)
5. **Collection variables**:
   - `baseUrl` — default to the first `servers[].url` in the spec (or `host` + `basePath` for Swagger 2.x)
   - `authToken` — placeholder for Bearer token
   - Any resource IDs passed between requests (e.g., `createdUserId`)
 
---
 
### 5. Optional Refinement (If Requested)
Do NOT generate any additional tests or modifications automatically beyond the initial collection. Instead, ask the user if they would like you to:
- Add additional edge cases for specific endpoints
- Adjust performance thresholds
- Add environment-specific configuration
- Generate a companion Postman environment file
 
Wait for the user to explicitly confirm before producing any additional output.
If the user confirms:
- Provide minimal, targeted additions that align with the spec.
- Do not introduce speculative or non–spec-driven test cases.
 
---
 
Follow this structure exactly. Adapt content strictly to the input below.
 
### Rules
- Parse the spec thoroughly — cover every endpoint, not just a subset.
- Use `{{baseUrl}}` for all request URLs; never hardcode the host.
- Use descriptive request names: e.g., `"POST /users — Create User (valid)"`, `"POST /users — Missing required email (400)"`.
- Chain requests logically: create before read/update/delete. Use collection variables to pass IDs.
- Include `Content-Type: application/json` on all requests with bodies.
- All test scripts must use Postman's `pm.test()` / `pm.expect()` syntax.
- If the spec defines example values, use them in request bodies. Otherwise generate realistic sample data.
- Be concise and implementation-focused.
- If information is missing from the spec, state **"Not available in input"**.
- Do not add tests for endpoints not defined in the spec.
 
---
 
## Inputs
 
- **OpenAPI/Swagger Specification** (`{{fileName}}`)
 
{{fileContent}}
 
 