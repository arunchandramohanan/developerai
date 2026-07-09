Create a compact Postman Collection v2.1 from this OpenAPI/Swagger spec.
Save the file it to `{{outputDir}}/{{fileName}}-collection.json`.
 
Generate Postman requests with embedded test assertions for **every applicable endpoint** across these categories:
 
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
 
### 5. Execution Instructions
Include clear run instructions:
- Prerequisites and auth setup
- Required variables (`baseUrl`, token, etc.)
- How to import and run in Postman
- Which negative tests are expected to return 4xx and still pass
- Basic troubleshooting for common failures
 
---
 
OpenAPI/Swagger spec file: `{{prompt}}`
 
Read the complete contents of the file above using the view tool before generating the Postman collection.